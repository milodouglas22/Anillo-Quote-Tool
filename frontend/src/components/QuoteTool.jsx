import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Upload, FileSpreadsheet, AlertTriangle, X, Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import api from '@/services/ApiService'
import ColumnMapper from '@/components/ColumnMapper'
import PartSearch from '@/components/PartSearch'
import CustomerInput from '@/components/CustomerInput'
import PartWorkspace from '@/components/PartWorkspace'
import QuoteDrawer from '@/components/QuoteDrawer'

const REPLY_FALLBACK = ['Part Number', 'Qty 1', 'Price 1', 'Qty 2', 'Price 2', 'Qty 3', 'Price 3', 'L/T', 'MFG', 'REV']
const normPart = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'
const qtysOf = (row) => ['Qty 1', 'Qty 2', 'Qty 3'].map((k) => row[k]).filter((q) => q !== null && q !== '' && q !== undefined).map(Number)
const money = (v) => (v == null || v === '') ? '—' : (Math.abs(Number(v)) >= 1 ? '$' + Number(v).toFixed(2) : (Number(v) * 100).toFixed(2) + '¢')
const qf = (v) => (v == null || v === '') ? '—' : Number(v).toLocaleString()
let _uid = 0
// Globally-unique key, immune to HMR resetting the counter (which caused duplicate keys → multi-select).
const newKey = () => (globalThis.crypto?.randomUUID?.() ?? `p${Date.now().toString(36)}_${++_uid}`)

export default function QuoteTool() {
  const [replyColumns, setReplyColumns] = useState(REPLY_FALLBACK)
  const [topSet, setTopSet] = useState(null)
  const [customer, setCustomer] = useState('')
  const [customerType, setCustomerType] = useState('')
  const [items, setItems] = useState([])
  const [selectedKey, setSelectedKey] = useState(null)
  const [priceNonce, setPriceNonce] = useState(0)
  const [mapper, setMapper] = useState(null)          // { filename, raw_records, source_columns, sample_data, suggestions, mapping, customer_guess }
  const [addOpen, setAddOpen] = useState(false)       // "Add part(s)" search popup
  const [previewOpen, setPreviewOpen] = useState(false) // "Preview quote" table modal
  const [uploading, setUploading] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [exporting, setExporting] = useState(false)
  const inputRef = useRef(null)

  const itemsRef = useRef(items); itemsRef.current = items
  const selectedRef = useRef(selectedKey); selectedRef.current = selectedKey
  const working = useRef(false)

  useEffect(() => {
    fetch(`${API}/api/quotes/reply-columns`).then((r) => r.ok ? r.json() : null).then((d) => d?.columns && setReplyColumns(d.columns)).catch(() => {})
    fetch(`${API}/api/quotes/top-parts`).then((r) => r.ok ? r.json() : null).then((d) => d?.parts && setTopSet(new Set(d.parts))).catch(() => {})
  }, [])

  const isContract = useCallback((pn) => topSet ? topSet.has(normPart(pn)) : false, [topSet])

  // ---------- add parts ----------
  const addParts = useCallback((entries, { select = false } = {}) => {
    // entries: [{ part, qtys, source }]. Dedupe against current items; build additions once
    // (outside the state updater) so keys are stable and unique.
    const seen = new Set(itemsRef.current.map((it) => normPart(it.part)))
    const additions = []
    for (const e of entries) {
      const np = normPart(e.part)
      if (!np || seen.has(np)) continue
      seen.add(np)
      additions.push({
        key: newKey(), part: e.part, contract: isContract(e.part),
        qtys: (e.qtys && e.qtys.length) ? e.qtys : [], source: e.source || 'search',
        row: null, config: null, status: 'needs_config', priceReady: false, anomaly: null, _sig: null,
      })
    }
    if (!additions.length) return
    setItems((prev) => [...prev, ...additions])
    if (select) setSelectedKey(additions[additions.length - 1].key)
    setPriceNonce((n) => n + 1)
  }, [isContract])

  const rowsToEntries = (rows) => rows.filter((r) => r['Part Number']).map((r) => ({ part: r['Part Number'], qtys: qtysOf(r), source: 'upload' }))

  const initMapping = useCallback((sugg, cols) => {
    const map = {}; const used = new Set()
    for (const rc of cols) { const b = (sugg?.[rc] || []).find((s) => s.score >= 0.5 && !used.has(s.source_col)); if (b) { map[rc] = b.source_col; used.add(b.source_col) } else map[rc] = null }
    return map
  }, [])

  const handleFiles = useCallback(async (fileList) => {
    for (const file of Array.from(fileList)) {
      setUploading(true)
      try {
        const res = await api.processFile(file)
        if (res.customer_guess && !customer) setCustomer(res.customer_guess)
        if (res.recognized && res.rows?.length) {
          addParts(rowsToEntries(res.rows))
        } else {
          // unknown format → open the column mapper
          setMapper({ ...res, filename: file.name, mapping: initMapping(res.suggestions, res.reply_columns || replyColumns) })
        }
      } catch (e) { alert(`Could not read ${file.name}: ${e.message}`) } finally { setUploading(false) }
    }
  }, [customer, addParts, initMapping, replyColumns])

  const confirmMapping = useCallback(async () => {
    if (!mapper?.mapping?.['Part Number']) return
    try {
      const r = await api.applyMapping(mapper.raw_records, mapper.mapping)
      if (mapper.customer_guess && !customer) setCustomer(mapper.customer_guess)
      addParts(rowsToEntries(r.rows))
      setMapper(null)
    } catch (e) { alert(e.message) }
  }, [mapper, customer, addParts])

  // ---------- centralized (batch) pricing for unopened items ----------
  useEffect(() => {
    if (!customer || working.current) return
    const sig = `${customer}|${customerType || ''}`
    const todo = itemsRef.current.filter((it) => it._sig !== sig && it.key !== selectedRef.current && it.qtys?.length)
    if (!todo.length) return
    working.current = true
    const contract = todo.filter((it) => it.contract)
    const pmm = todo.filter((it) => !it.contract)

    const jobs = []
    if (contract.length) {
      const rows = contract.map((it) => { const row = { 'Part Number': it.part, _key: it.key }; it.qtys.forEach((q, i) => { row[`Qty ${i + 1}`] = q }); return row })
      jobs.push(api.priceRows(rows, customer).then((priced) => ({ kind: 'contract', priced })).catch(() => ({ kind: 'contract', priced: [] })))
    }
    if (pmm.length) {
      const basketItems = pmm.map((it) => ({ part: it.part, qtys: it.qtys }))
      jobs.push(api.pmmBasket(basketItems, customer, 'OE', customerType || null).then((b) => ({ kind: 'pmm', b })).catch(() => ({ kind: 'pmm', b: { items: [] } })))
    }

    Promise.all(jobs).then((res) => {
      setItems((prev) => prev.map((it) => {
        if (it._sig === sig || it.key === selectedRef.current || !it.qtys?.length) return it
        if (it.contract) {
          const r = res.find((x) => x.kind === 'contract')?.priced?.find((p) => p._key === it.key)
          if (!r) return it
          const st = r._status
          return { ...it, row: r, _sig: sig, anomaly: st?.anomaly || null,
            priceReady: r['Price 1'] != null && st?.in_scope !== false,
            status: st?.anomaly ? 'flagged' : (st?.in_scope === false ? 'no_data' : 'contract') }
        } else {
          const b = res.find((x) => x.kind === 'pmm')?.b
          const bi = (b?.items || []).find((x) => normPart(x.part) === normPart(it.part))
          if (!bi) return it
          if (!bi.found || !bi.prices?.length) return { ...it, _sig: sig, status: 'no_data', priceReady: false }
          const row = { 'Part Number': it.part, _pmm: { framework: bi.framework, trade: bi.trade_position, gov: bi.prices[0]?.governing_rule, gm: bi.prices[0]?.gross_margin, cost: bi.cost_per_unit } }
          bi.prices.forEach((p, i) => { row[`Qty ${i + 1}`] = p.qty; row[`Price ${i + 1}`] = p.unit_price })
          return { ...it, row, _sig: sig, status: 'quoted', priceReady: true, customerTypeResolved: bi.new_customer_type }
        }
      }))
    }).finally(() => { working.current = false; setPriceNonce((n) => n + 1) })
  }, [customer, customerType, priceNonce])

  // when customer/type changes, invalidate prices so the batch reprices everything
  const changeCustomer = (v) => { setCustomer(v); setItems((prev) => prev.map((it) => ({ ...it, _sig: null }))); setPriceNonce((n) => n + 1) }
  const changeCustomerType = (v) => { setCustomerType(v); setItems((prev) => prev.map((it) => ({ ...it, _sig: null }))); setPriceNonce((n) => n + 1) }

  // ---------- item updates from the workspace ----------
  const updateItem = useCallback((key, patch) => {
    const sig = `${customer}|${customerType || ''}`
    setItems((prev) => prev.map((it) => it.key === key ? { ...it, ...patch, _sig: sig } : it))
  }, [customer, customerType])

  const removeItem = (key) => setItems((prev) => {
    const next = prev.filter((it) => it.key !== key)
    if (key === selectedRef.current) setSelectedKey(null)
    return next
  })

  const selected = items.find((it) => it.key === selectedKey) || null

  // self-heal: never let selectedKey dangle (would desync the workspace vs the drawer)
  useEffect(() => {
    if (selectedKey && !items.some((it) => it.key === selectedKey)) setSelectedKey(null)
  }, [items, selectedKey])

  // ---------- export ----------
  const totals = useMemo(() => {
    let units = 0, rev = 0
    for (const it of items) { const q = Number(it.row?.['Qty 1']) || 0; const p = Number(it.row?.['Price 1']) || 0; units += q; rev += q * p }
    return { units, rev }
  }, [items])

  const doExport = async () => {
    const rows = items.filter((it) => it.confirmed && it.row).map((it) => {
      const { _key, ...clean } = it.row; return clean
    })
    if (!rows.length) return
    setExporting(true)
    try { await api.exportRows(rows, 'anillo_quote.xlsx') } catch (e) { alert(e.message) } finally { setExporting(false) }
  }

  const ready = Boolean(customer && customerType)   // customer + type must be set before adding parts
  const onDrop = (e) => { e.preventDefault(); setDragActive(false); if (ready && e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files) }

  // ================= render =================
  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 8.5rem)' }}>
      {/* customer bar */}
      <div className="shrink-0 flex flex-wrap items-center justify-center gap-3 pb-3 mb-3 border-b">
        <label className="text-sm font-medium text-primary">Quote for</label>
        <CustomerInput value={customer} invalid={!customer}
          onChange={changeCustomer}
          onPick={(name, type) => { changeCustomer(name); if (['OEM', 'Distributor', 'Tier'].includes(type)) changeCustomerType(type) }} />
        <select value={customerType} onChange={(e) => changeCustomerType(e.target.value)}
          className={cn('px-2 py-1.5 border rounded-md text-sm bg-background', !customerType && 'border-amber-400')}>
          <option value="" disabled hidden>Customer type</option>
          <option>OEM</option><option>Distributor</option><option>Tier</option>
        </select>
      </div>

      {/* 3-zone body: [ left | center ]  +  [ drawer ] */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-4">
        <div className="min-h-0 overflow-y-auto pr-1">
          {selected ? (
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)] gap-4">
              <PartWorkspace key={selected.key} item={selected} customer={customer} customerType={customerType} onUpdate={updateItem} />
            </div>
          ) : (
            <div className="space-y-5">
              {!ready && (
                <p className="text-center text-lg font-semibold text-amber-600 dark:text-amber-400">First select customer and customer type</p>
              )}
              <div onDragOver={(e) => { if (ready) { e.preventDefault(); setDragActive(true) } }} onDragLeave={() => setDragActive(false)} onDrop={onDrop}
                onClick={() => ready && inputRef.current?.click()}
                className={cn('rounded-xl border-2 border-dashed flex flex-col items-center justify-center text-center transition-colors p-12 min-h-[420px]',
                  !ready ? 'opacity-40 cursor-not-allowed border-border' : cn('cursor-pointer', dragActive ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'))}>
                <input ref={inputRef} type="file" multiple accept=".xlsx,.xls,.xlsm,.csv,.pdf" className="hidden" disabled={!ready} onChange={(e) => e.target.files?.length && handleFiles(e.target.files)} />
                {uploading ? <Loader2 className="h-12 w-12 text-primary animate-spin mb-3" /> : <Upload className="h-12 w-12 text-muted-foreground mb-3" />}
                <p className="font-semibold text-2xl">Upload an RFP</p>
                <p className="text-sm text-muted-foreground mt-2">Drop an Excel or PDF quote here, or click to browse</p>
              </div>
              {ready && (
                <p className="text-center text-sm text-muted-foreground">
                  Or use{' '}
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-dashed border-primary/50 text-primary font-medium text-xs align-middle">
                    <Plus className="w-3 h-3" /> Add part(s)
                  </span>{' '}
                  to manually add parts to the quote
                </p>
              )}
            </div>
          )}
        </div>

        {/* RIGHT drawer */}
        <div className="min-h-0">
          <QuoteDrawer
            items={items} selectedKey={selectedKey} onSelect={setSelectedKey} onRemove={removeItem}
            onAddParts={() => ready && setAddOpen(true)} canAdd={ready}
            onPreview={() => setPreviewOpen(true)} onExport={doExport} exporting={exporting}
            customer={customer} totalUnits={totals.units} totalRevenue={totals.rev} />
        </div>
      </div>

      {/* Add part(s) search popup */}
      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[15vh]" onClick={() => setAddOpen(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative bg-card rounded-xl shadow-xl w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <div className="relative flex items-center px-5 py-4 border-b">
              <span className="flex-1 text-center font-medium text-primary">Add a part to quote</span>
              <button onClick={() => setAddOpen(false)} className="absolute right-4 p-1 rounded hover:bg-muted"><X className="h-4 w-4" /></button>
            </div>
            <div className="p-5">
              <PartSearch autoFocus exclude={new Set(items.map((it) => normPart(it.part)))}
                onPick={(p) => addParts([{ part: p.part, qtys: [], source: 'search' }])} />
            </div>
          </div>
        </div>
      )}

      {/* Preview quote table */}
      {previewOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[8vh]">
          <div className="absolute inset-0 bg-black/40" onClick={() => setPreviewOpen(false)} />
          <div className="relative bg-card rounded-xl shadow-xl w-full max-w-4xl max-h-[85vh] flex flex-col">
            <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b">
              <h3 className="font-semibold text-primary">Quote preview{customer ? ` — ${customer}` : ''}</h3>
              <button onClick={() => setPreviewOpen(false)} className="p-1 rounded hover:bg-muted"><X className="h-4 w-4" /></button>
            </div>
            <div className="overflow-auto px-5 py-4">
              <table className="w-full text-sm">
                <thead className="text-white" style={{ backgroundColor: '#3A736F' }}>
                  <tr>
                    <th className="py-2 px-3 font-bold text-left">Part Number</th>
                    <th className="py-2 px-3 font-bold">Qty 1</th><th className="py-2 px-3 font-bold">Price 1</th>
                    <th className="py-2 px-3 font-bold">Qty 2</th><th className="py-2 px-3 font-bold">Price 2</th>
                    <th className="py-2 px-3 font-bold">Qty 3</th><th className="py-2 px-3 font-bold">Price 3</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={it.key} className="border-b border-border/50">
                      <td className="py-2 px-3 font-medium">{it.part}</td>
                      {it.confirmed && it.row ? (
                        <>
                          <td className="py-2 px-3 text-center tabular-nums">{qf(it.row['Qty 1'])}</td>
                          <td className="py-2 px-3 text-center tabular-nums">{it.row['Qty 1'] ? money(it.row['Price 1']) : '—'}</td>
                          <td className="py-2 px-3 text-center tabular-nums">{qf(it.row['Qty 2'])}</td>
                          <td className="py-2 px-3 text-center tabular-nums">{it.row['Qty 2'] ? money(it.row['Price 2']) : '—'}</td>
                          <td className="py-2 px-3 text-center tabular-nums">{qf(it.row['Qty 3'])}</td>
                          <td className="py-2 px-3 text-center tabular-nums">{it.row['Qty 3'] ? money(it.row['Price 3']) : '—'}</td>
                        </>
                      ) : (
                        <td colSpan={6} className="py-2 px-3 text-center font-bold text-foreground">Pending re-pricing</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {items.length === 0 && <p className="text-muted-foreground text-sm py-4 text-center">No parts in the quote yet.</p>}
            </div>
          </div>
        </div>
      )}

      {/* column mapper modal (unknown formats) */}
      {mapper && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setMapper(null)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative bg-card rounded-xl shadow-xl w-full max-w-3xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b sticky top-0 bg-card">
              <div className="flex items-center gap-2 min-w-0">
                <FileSpreadsheet className="h-5 w-5 text-muted-foreground shrink-0" />
                <span className="font-medium truncate">{mapper.filename}</span>
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">Map columns</span>
              </div>
              <button onClick={() => setMapper(null)} className="p-1 rounded hover:bg-muted"><X className="h-4 w-4" /></button>
            </div>
            <div className="p-5 space-y-4">
              {mapper.warnings?.map((w, i) => <div key={i} className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400"><AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" /> {w}</div>)}
              <ColumnMapper replyColumns={mapper.reply_columns || replyColumns} sourceColumns={mapper.source_columns || []} sampleData={mapper.sample_data}
                suggestions={mapper.suggestions} mapping={mapper.mapping || {}} onChange={(m) => setMapper((prev) => ({ ...prev, mapping: m }))} />
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setMapper(null)}>Cancel</Button>
                <Button onClick={confirmMapping} disabled={!mapper.mapping?.['Part Number']}>Add parts</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
