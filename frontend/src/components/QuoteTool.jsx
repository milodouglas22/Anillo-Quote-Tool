import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Upload, FileSpreadsheet, FileText, AlertTriangle, X, Loader2, ShoppingCart, DollarSign } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import api from '@/services/ApiService'
import ColumnMapper from '@/components/ColumnMapper'
import QuoteCart from '@/components/QuoteCart'
import PmmConfigurator from '@/components/PmmConfigurator'

const REPLY_FALLBACK = ['Part Number','Qty 1','Price 1','Qty 2','Price 2','Qty 3','Price 3','L/T','MFG','REV']
const FORMAT_LABELS = { adept: 'ADEPT', incora: 'Incora', boeing_sap: 'Boeing (SAP)', boeing_pdf: 'Boeing (PDF)', unknown: 'Unrecognized' }
const normPart = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'
const qtysOf = (row) => ['Qty 1','Qty 2','Qty 3'].map((k) => row[k]).filter((q) => q !== null && q !== '' && q !== undefined).map(Number)
let _uid = 0

export default function QuoteTool() {
  const [replyColumns, setReplyColumns] = useState(REPLY_FALLBACK)
  const [topSet, setTopSet] = useState(null)
  const [files, setFiles] = useState([])
  const [dragActive, setDragActive] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [showCart, setShowCart] = useState(false)
  const [selected, setSelected] = useState(null)     // { key, fileId, part, qtys, initial }
  const [overrides, setOverrides] = useState({})      // key -> configured reply row
  const [removed, setRemoved] = useState({})          // key -> true
  const inputRef = useRef(null)
  const working = useRef(new Set())

  useEffect(() => {
    fetch(`${API}/api/quotes/reply-columns`).then((r) => r.ok ? r.json() : null).then((d) => d?.columns && setReplyColumns(d.columns)).catch(() => {})
    fetch(`${API}/api/quotes/top-parts`).then((r) => r.ok ? r.json() : null).then((d) => d?.parts && setTopSet(new Set(d.parts))).catch(() => {})
  }, [])

  const patch = useCallback((id, obj) => setFiles((prev) => prev.map((f) => f.id === id ? { ...f, ...obj } : f)), [])
  const isTop100 = useCallback((pn) => topSet ? topSet.has(normPart(pn)) : false, [topSet])
  const initMapping = useCallback((sugg, cols) => {
    const map = {}; const used = new Set()
    for (const rc of cols) { const b = (sugg?.[rc] || []).find((s) => s.score >= 0.5 && !used.has(s.source_col)); if (b) { map[rc] = b.source_col; used.add(b.source_col) } else map[rc] = null }
    return map
  }, [])

  const handleFiles = useCallback(async (fileList) => {
    for (const file of Array.from(fileList)) {
      const id = ++_uid
      setFiles((prev) => [...prev, { id, filename: file.name, busy: true, customer: '' }])
      try {
        const res = await api.processFile(file)
        patch(id, { busy: false, ...res, mapping: res.recognized ? null : initMapping(res.suggestions, res.reply_columns || replyColumns), customer: res.customer_guess || '' })
      } catch (e) { patch(id, { busy: false, error: e.message }) }
    }
  }, [replyColumns, initMapping, patch])

  // auto: top-100 contract pricing + PMM basket defaults per file
  useEffect(() => {
    const t = setTimeout(() => {
      for (const f of files) {
        if (f.busy || f.error || !(f.recognized || f.mapped) || !f.rows?.length) continue
        // unknown-format mapping auto-apply
        if (f.detected_format === 'unknown' && f.mapping?.['Part Number'] && JSON.stringify(f.mapping) !== f._mapSig) {
          const k = 'map' + f.id; if (working.current.has(k)) continue; working.current.add(k)
          const sig = JSON.stringify(f.mapping)
          api.applyMapping(f.raw_records, f.mapping).then((r) => patch(f.id, { rows: r.rows, mapped: true, _mapSig: sig, _sig: null })).catch((e) => patch(f.id, { error: e.message })).finally(() => working.current.delete(k))
          continue
        }
        if (!f.customer) continue
        const sig = `${f.customer}|${f.rows.length}|${f.mapped}`
        if (sig === f._sig) continue
        const k = 'price' + f.id; if (working.current.has(k)) continue; working.current.add(k)
        const topRows = f.rows.filter((r) => r['Part Number'] && isTop100(r['Part Number']))
        const pmmItems = f.rows.filter((r) => r['Part Number'] && !isTop100(r['Part Number'])).map((r) => ({ part: r['Part Number'], qtys: qtysOf(r) }))
        Promise.all([
          topRows.length ? api.priceRows(topRows, f.customer) : Promise.resolve([]),
          pmmItems.length ? api.pmmBasket(pmmItems, f.customer, 'OE') : Promise.resolve({ items: [] }),
        ]).then(([priced, basket]) => {
          const basketRows = []; const noData = []
          for (const it of (basket.items || [])) {
            if (!it.found || !it.prices?.length) { noData.push(it.part); continue }
            const row = { 'Part Number': it.part, _pmm: { framework: it.framework, trade: it.trade_position, gov: it.prices[0]?.governing_rule, gm: it.prices[0]?.gross_margin, cost: it.cost_per_unit } }
            it.prices.forEach((p, i) => { row[`Qty ${i + 1}`] = p.qty; row[`Price ${i + 1}`] = p.unit_price })
            basketRows.push(row)
          }
          patch(f.id, { priced, basketRows, basketNoData: noData, _sig: sig })
        }).catch((e) => patch(f.id, { error: e.message })).finally(() => working.current.delete(k))
      }
    }, 300)
    return () => clearTimeout(t)
  }, [files, isTop100, patch])

  const removeFile = (id) => setFiles((prev) => prev.filter((x) => x.id !== id))
  const setCustomer = (id, customer) => patch(id, { customer, _sig: null, priced: null, basketRows: null })
  const setMapping = (id, mapping) => patch(id, { mapping })

  // cart lines across files (with _key), applying overrides + removals
  const cartLines = useMemo(() => {
    const out = []
    for (const f of files) {
      if (!f.rows) continue
      for (const r of (f.priced || []).filter((x) => x._status?.in_scope !== false)) {
        const key = `${f.id}|${r['Part Number']}`
        if (!removed[key]) out.push({ ...r, _key: key })
      }
      for (const r of (f.basketRows || [])) {
        const key = `${f.id}|${r['Part Number']}`
        if (removed[key]) continue
        out.push(overrides[key] ? { ...overrides[key], _key: key, _repriced: true } : { ...r, _key: key })
      }
    }
    return out
  }, [files, overrides, removed])

  const openConfigurator = (row) => {
    const [fileId] = row._key.split('|')
    setSelected({ key: row._key, fileId, part: row['Part Number'], qtys: qtysOf(row), initial: overrides[row._key]?._config })
    setShowCart(false)
  }
  const saveConfig = (row) => {
    setOverrides((o) => ({ ...o, [selected.key]: row }))
    setSelected(null); setShowCart(true)
  }
  const removeLine = (key) => setRemoved((r) => ({ ...r, [key]: true }))
  const clearAll = () => { setFiles([]); setOverrides({}); setRemoved({}); setShowCart(false) }

  const doExport = async () => {
    setExporting(true)
    try { await api.exportRows(cartLines, 'anillo_quote.xlsx') } catch (e) { alert(e.message) } finally { setExporting(false) }
  }

  const onDrop = (e) => { e.preventDefault(); setDragActive(false); if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files) }

  // ---------- configurator view ----------
  if (selected) {
    return (
      <PmmConfigurator part={selected.part} qtys={selected.qtys} initial={selected.initial}
        onBack={() => { setSelected(null); setShowCart(true) }} onSave={saveConfig} />
    )
  }

  return (
    <div className="space-y-5">
      {/* top bar */}
      <div className="flex items-center justify-end">
        <Button variant={cartLines.length ? 'default' : 'outline'} onClick={() => setShowCart(true)} disabled={!cartLines.length}>
          <ShoppingCart className="h-4 w-4 mr-1.5" /> Quote ({cartLines.length})
        </Button>
      </div>

      {/* dropzone */}
      <div onDragOver={(e) => { e.preventDefault(); setDragActive(true) }} onDragLeave={() => setDragActive(false)} onDrop={onDrop} onClick={() => inputRef.current?.click()}
        className={cn('rounded-xl border-2 border-dashed p-8 text-center cursor-pointer transition-colors', dragActive ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50')}>
        <input ref={inputRef} type="file" multiple accept=".xlsx,.xls,.xlsm,.csv,.pdf" className="hidden" onChange={(e) => e.target.files?.length && handleFiles(e.target.files)} />
        <Upload className="h-7 w-7 mx-auto text-muted-foreground mb-2" />
        <p className="font-medium">Drop a quote file here, or click to browse</p>
        <p className="text-sm text-muted-foreground mt-1">Excel (.xlsx) or PDF</p>
      </div>

      {/* file cards */}
      {files.map((f) => {
        const busy = f.busy || working.current.has('price' + f.id) || working.current.has('map' + f.id)
        const total = f.rows?.length || 0
        const topN = (f.rows || []).filter((r) => r['Part Number'] && isTop100(r['Part Number'])).length
        const pmmN = (f.basketRows || []).length
        const noDataN = (f.basketNoData || []).length
        const needCustomer = (f.recognized || f.mapped) && total > 0 && !f.customer
        return (
          <Card key={f.id}>
            <CardContent className="pt-5 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  {f.filename.toLowerCase().endsWith('.pdf') ? <FileText className="h-5 w-5 text-muted-foreground shrink-0" /> : <FileSpreadsheet className="h-5 w-5 text-muted-foreground shrink-0" />}
                  <span className="font-medium truncate">{f.filename}</span>
                  {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                  {f.detected_format && <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium shrink-0', f.recognized ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' : 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200')}>{FORMAT_LABELS[f.detected_format] || f.detected_format}</span>}
                </div>
                <button onClick={() => removeFile(f.id)} className="p-1 rounded hover:bg-muted shrink-0"><X className="h-4 w-4" /></button>
              </div>

              {f.error && <div className="flex items-start gap-2 text-sm text-destructive"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {f.error}</div>}
              {f.warnings?.map((w, i) => <div key={i} className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400"><AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" /> {w}</div>)}

              {f.detected_format === 'unknown' && !f.error && (
                <ColumnMapper replyColumns={replyColumns} sourceColumns={f.source_columns || []} sampleData={f.sample_data} suggestions={f.suggestions} mapping={f.mapping || {}} onChange={(m) => setMapping(f.id, m)} />
              )}

              {(f.recognized || f.mapped) && total > 0 && (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="text-sm font-medium flex items-center gap-1.5 shrink-0"><DollarSign className="h-4 w-4 text-primary" />Customer</label>
                    <input type="text" value={f.customer || ''} onChange={(e) => setCustomer(f.id, e.target.value)} placeholder="Who is this quote for? (e.g. Boeing, Incora)"
                      className={cn('flex-1 min-w-[220px] px-3 py-1.5 border rounded-md text-sm bg-background', needCustomer && 'border-amber-400')} />
                    {needCustomer && <span className="text-xs text-amber-600 dark:text-amber-400">Enter the customer to price.</span>}
                  </div>

                  {f.customer && (
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                      <span className="text-muted-foreground">{total} parts:</span>
                      <span className="text-green-700 dark:text-green-400">{topN} Top-100 (auto-priced)</span>
                      <span className="text-teal-700 dark:text-teal-400">{pmmN} Trade-Brand</span>
                      {noDataN > 0 && <span className="text-muted-foreground">{noDataN} no pricing data</span>}
                      <Button size="sm" variant="outline" className="ml-auto" onClick={() => setShowCart(true)} disabled={!cartLines.length}>
                        <ShoppingCart className="h-3.5 w-3.5 mr-1.5" /> Open quote
                      </Button>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )
      })}

      <QuoteCart open={showCart} onClose={() => setShowCart(false)} lines={cartLines}
        onSelect={openConfigurator} onRemove={removeLine} onClear={clearAll} onExport={doExport} exporting={exporting} />
    </div>
  )
}
