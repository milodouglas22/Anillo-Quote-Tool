import { useState, useEffect, useRef, useCallback } from 'react'
import { Upload, FileSpreadsheet, FileText, AlertTriangle, CheckCircle2, Download, X, Loader2, DollarSign } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import api from '@/services/ApiService'
import ColumnMapper from '@/components/ColumnMapper'

const REPLY_FALLBACK = ['Part Number','Qty 1','Price 1','Qty 2','Price 2','Qty 3','Price 3','L/T','MFG','REV']
const FORMAT_LABELS = {
  adept: 'ADEPT', incora: 'Incora', boeing_sap: 'Boeing (SAP upload)',
  boeing_pdf: 'Boeing (PDF RFQ)', unknown: 'Unrecognized',
}
const STATUS = {
  contract:   { label: 'Contract',    cls: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' },
  markup_40:  { label: '+40%',        cls: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' },
  markup_60:  { label: '+60%',        cls: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200' },
  flagged:    { label: 'Flag',        cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200' },
  ambiguous_customer: { label: 'Ambiguous', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200' },
  no_contract:{ label: 'No contract', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200' },
  out_of_scope:{ label: 'Not Top-100', cls: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' },
}
let _uid = 0
const mapSig = (f) => JSON.stringify(f.mapping || {})
const priceSig = (f) => `${f.customer}|${(f.rows || []).length}|${f.mapped}`
const normPart = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'

export default function QuoteTool() {
  const [replyColumns, setReplyColumns] = useState(REPLY_FALLBACK)
  const [files, setFiles] = useState([])
  const [dragActive, setDragActive] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [topSet, setTopSet] = useState(null)   // Set of normalized Top-100 part keys
  const inputRef = useRef(null)
  const working = useRef(new Set())

  useEffect(() => {
    fetch(`${API}/api/quotes/reply-columns`)
      .then((r) => r.ok ? r.json() : null).then((d) => d?.columns && setReplyColumns(d.columns)).catch(() => {})
    fetch(`${API}/api/quotes/top-parts`)
      .then((r) => r.ok ? r.json() : null).then((d) => d?.parts && setTopSet(new Set(d.parts))).catch(() => {})
  }, [])

  const rowInScope = useCallback((r) =>
    r._status ? r._status.in_scope !== false : (topSet ? topSet.has(normPart(r['Part Number'])) : true), [topSet])

  const patch = useCallback((id, obj) =>
    setFiles((prev) => prev.map((f) => f.id === id ? { ...f, ...obj } : f)), [])

  const initMapping = useCallback((suggestions, replyCols) => {
    const map = {}; const used = new Set()
    for (const rc of replyCols) {
      const best = (suggestions?.[rc] || []).find((s) => s.score >= 0.5 && !used.has(s.source_col))
      if (best) { map[rc] = best.source_col; used.add(best.source_col) } else map[rc] = null
    }
    return map
  }, [])

  const handleFiles = useCallback(async (fileList) => {
    for (const file of Array.from(fileList)) {
      const id = ++_uid
      setFiles((prev) => [...prev, { id, filename: file.name, busy: true, customer: '', priced: null }])
      try {
        const res = await api.processFile(file)
        const cols = res.reply_columns || replyColumns
        patch(id, {
          busy: false, ...res,
          mapping: res.recognized ? null : initMapping(res.suggestions, cols),
          customer: res.customer_guess || '', priced: null,
        })
      } catch (e) { patch(id, { busy: false, error: e.message }) }
    }
  }, [replyColumns, initMapping, patch])

  // ---- automatic mapping + pricing (debounced), no buttons ----
  useEffect(() => {
    const t = setTimeout(() => {
      for (const f of files) {
        if (f.busy || f.error) continue

        // unknown format: auto-apply mapping once Part Number is mapped and mapping changed
        if (f.detected_format === 'unknown' && f.mapping?.['Part Number'] && mapSig(f) !== f._mapSig) {
          const k = 'map' + f.id
          if (working.current.has(k)) continue
          working.current.add(k)
          const sig = mapSig(f)
          api.applyMapping(f.raw_records, f.mapping)
            .then((res) => patch(f.id, { rows: res.rows, mapped: true, _mapSig: sig, priced: null, _priceSig: null }))
            .catch((e) => patch(f.id, { error: e.message }))
            .finally(() => working.current.delete(k))
          continue
        }

        // auto-price once we have rows + a customer, whenever inputs changed
        if ((f.recognized || f.mapped) && f.rows?.length && f.customer && priceSig(f) !== f._priceSig) {
          const k = 'price' + f.id
          if (working.current.has(k)) continue
          working.current.add(k)
          const sig = priceSig(f)
          api.priceRows(f.rows, f.customer)
            .then((rows) => patch(f.id, { priced: rows, _priceSig: sig }))
            .catch((e) => patch(f.id, { error: e.message }))
            .finally(() => working.current.delete(k))
        }
      }
    }, 350)
    return () => clearTimeout(t)
  }, [files, patch])

  const onDrop = (e) => { e.preventDefault(); setDragActive(false); if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files) }
  const setMapping = (id, mapping) => patch(id, { mapping })
  const setCustomer = (id, customer) => patch(id, { customer })
  const removeFile = (id) => setFiles((prev) => prev.filter((x) => x.id !== id))

  // Always downloadable, always Top-100 only: priced rows where priced, else parsed rows,
  // filtered to in-scope parts (prices blank until a customer is entered).
  const exportRows = files.flatMap((f) => (f.priced || f.rows || []).filter(rowInScope))
  const anyPriced = files.some((f) => f.priced)
  const doExport = async () => {
    setExporting(true)
    try { await api.exportRows(exportRows, 'anillo_quote.xlsx') }
    catch (e) { alert(e.message) } finally { setExporting(false) }
  }

  return (
    <div className="space-y-6">
      <div onDragOver={(e) => { e.preventDefault(); setDragActive(true) }} onDragLeave={() => setDragActive(false)}
        onDrop={onDrop} onClick={() => inputRef.current?.click()}
        className={cn('rounded-xl border-2 border-dashed p-10 text-center cursor-pointer transition-colors',
          dragActive ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50')}>
        <input ref={inputRef} type="file" multiple accept=".xlsx,.xls,.xlsm,.csv,.pdf" className="hidden"
          onChange={(e) => e.target.files?.length && handleFiles(e.target.files)} />
        <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
        <p className="font-medium">Drop a quote file here, or click to browse</p>
        <p className="text-sm text-muted-foreground mt-1">Excel (.xlsx) or PDF — it parses and prices automatically</p>
      </div>

      {files.map((f) => {
        const priced = f.priced
        const pricing = working.current.has('price' + f.id) || working.current.has('map' + f.id)
        const needsCustomer = (f.recognized || f.mapped) && f.rows?.length && !f.customer
        const flaggedCount = (priced || []).filter((r) => r._status?.flagged).length
        const outCount = (priced || []).filter((r) => r._status?.in_scope === false).length
        const inCount = (priced || []).filter((r) => r._status?.in_scope !== false).length
        return (
        <Card key={f.id}>
          <CardContent className="pt-5 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                {f.filename.toLowerCase().endsWith('.pdf')
                  ? <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
                  : <FileSpreadsheet className="h-5 w-5 text-muted-foreground shrink-0" />}
                <span className="font-medium truncate">{f.filename}</span>
                {(f.busy || pricing) && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                {f.detected_format && (
                  <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium shrink-0',
                    f.recognized ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                                  : 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200')}>
                    {FORMAT_LABELS[f.detected_format] || f.detected_format}
                  </span>
                )}
                {priced && <span className="text-xs text-muted-foreground shrink-0">{inCount} priced{outCount ? ` · ${outCount} excluded` : ''}</span>}
              </div>
              <button onClick={() => removeFile(f.id)} className="p-1 rounded hover:bg-muted shrink-0"><X className="h-4 w-4" /></button>
            </div>

            {f.error && <div className="flex items-start gap-2 text-sm text-destructive"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {f.error}</div>}
            {f.warnings?.map((w, i) => (
              <div key={i} className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400"><AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" /> {w}</div>
            ))}

            {f.detected_format === 'unknown' && !f.error && (
              <ColumnMapper replyColumns={replyColumns} sourceColumns={f.source_columns || []} sampleData={f.sample_data}
                suggestions={f.suggestions} mapping={f.mapping || {}} onChange={(m) => setMapping(f.id, m)} />
            )}

            {(f.recognized || f.mapped) && f.rows?.length > 0 && (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="text-sm font-medium flex items-center gap-1.5 shrink-0"><DollarSign className="h-4 w-4 text-primary" />Customer</label>
                  <input type="text" value={f.customer || ''} onChange={(e) => setCustomer(f.id, e.target.value)}
                    placeholder="Who is this quote for? (e.g. Boeing, Incora)"
                    className={cn('flex-1 min-w-[220px] px-3 py-1.5 border rounded-md text-sm bg-background', needsCustomer && 'border-amber-400')} />
                  {needsCustomer && <span className="text-xs text-amber-600 dark:text-amber-400">Enter the customer to price this quote.</span>}
                </div>

                {priced && (flaggedCount > 0 || outCount > 0) && (
                  <div className="flex flex-wrap gap-3 text-xs">
                    {flaggedCount > 0 && <span className="flex items-center gap-1 text-amber-700 dark:text-amber-400"><AlertTriangle className="h-3.5 w-3.5" />{flaggedCount} flagged for manual pricing</span>}
                    {outCount > 0 && <span className="text-muted-foreground">{outCount} excluded (not Top-100)</span>}
                  </div>
                )}
                <PreviewTable columns={replyColumns} rows={priced || f.rows} showStatus={!!priced} inScope={rowInScope} />
              </>
            )}
          </CardContent>
        </Card>
      )})}

      {exportRows.length > 0 && (
        <div className="sticky bottom-4 flex items-center justify-between gap-4 rounded-xl border bg-card/95 backdrop-blur p-4 shadow-lg">
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="h-5 w-5 text-primary" />
            <span className="font-medium">{exportRows.length} parts</span>
            <span className="text-muted-foreground">{anyPriced ? 'priced & ready to export' : 'parsed — enter a customer to price, or export as-is'}</span>
          </div>
          <Button onClick={doExport} disabled={exporting}>
            {exporting ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Download className="h-4 w-4 mr-1.5" />}
            Export reply format
          </Button>
        </div>
      )}
    </div>
  )
}

function PreviewTable({ columns, rows, showStatus = false, inScope = () => true }) {
  const fmt = (v) => (v === null || v === undefined || v === '') ? '' : (typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(4)) : v)
  // Top-100 (in-scope) rows first; out-of-scope collapsed to a count.
  const inRows = rows.filter((r) => inScope(r))
  const outCount = rows.length - inRows.length

  if (inRows.length === 0) {
    return (
      <div className="rounded-lg border px-3 py-4 text-sm text-muted-foreground bg-muted/20">
        None of the {rows.length} parts on this quote are in the Top-100 — nothing to price.
      </div>
    )
  }
  return (
    <div className="rounded-lg border">
      {/* Long lists scroll inside the table; the page's export bar stays pinned. */}
      <div className="overflow-auto max-h-[55vh]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-muted">
            <tr>
              {showStatus && <th className="px-3 py-2 text-left font-medium">Status</th>}
              {columns.map((c) => <th key={c} className="px-3 py-2 text-left font-medium whitespace-nowrap">{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {inRows.map((r, i) => {
              const st = r._status
              const badge = st ? (STATUS[st.rule] || STATUS.flagged) : null
              return (
                <tr key={i} className="border-t">
                  {showStatus && <td className="px-3 py-1.5">{badge && <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', badge.cls)}>{badge.label}</span>}</td>}
                  {columns.map((c) => <td key={c} className="px-3 py-1.5 whitespace-nowrap">{fmt(r[c])}</td>)}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {outCount > 0 && <div className="px-3 py-1.5 text-xs text-muted-foreground bg-muted/30 border-t">{outCount} other part{outCount > 1 ? 's' : ''} not in Top-100 — excluded from output</div>}
    </div>
  )
}
