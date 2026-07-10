import { useState, useEffect, useRef, useCallback } from 'react'
import { Upload, FileSpreadsheet, FileText, AlertTriangle, CheckCircle2, Download, X, Loader2, Wand2, DollarSign } from 'lucide-react'
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

export default function QuoteTool() {
  const [replyColumns, setReplyColumns] = useState(REPLY_FALLBACK)
  const [files, setFiles] = useState([])
  const [dragActive, setDragActive] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [customers, setCustomers] = useState([])
  const [customer, setCustomer] = useState('')
  const [pricing, setPricing] = useState(false)
  const [priced, setPriced] = useState(null) // priced rows (with _status) or null
  const inputRef = useRef(null)

  useEffect(() => {
    fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'}/api/quotes/reply-columns`)
      .then((r) => r.ok ? r.json() : null).then((d) => d?.columns && setReplyColumns(d.columns)).catch(() => {})
    api.getCustomers().then(setCustomers).catch(() => {})
  }, [])

  const initMapping = useCallback((suggestions, replyCols) => {
    const map = {}; const used = new Set()
    for (const rc of replyCols) {
      const best = (suggestions?.[rc] || []).find((s) => s.score >= 0.5 && !used.has(s.source_col))
      if (best) { map[rc] = best.source_col; used.add(best.source_col) } else map[rc] = null
    }
    return map
  }, [])

  // match a parsed guess (e.g. "Boeing") to a known contract customer
  const matchCustomer = useCallback((guess) => {
    if (!guess) return ''
    const g = guess.toLowerCase()
    const hit = customers.find((c) => c.toLowerCase().includes(g) || g.includes(c.toLowerCase()))
    return hit || ''
  }, [customers])

  const handleFiles = useCallback(async (fileList) => {
    setPriced(null)
    for (const file of Array.from(fileList)) {
      const id = ++_uid
      setFiles((prev) => [...prev, { id, filename: file.name, busy: true }])
      try {
        const res = await api.processFile(file)
        const cols = res.reply_columns || replyColumns
        setFiles((prev) => prev.map((f) => f.id === id ? {
          ...f, busy: false, ...res, mapping: res.recognized ? null : initMapping(res.suggestions, cols),
        } : f))
        if (res.customer_guess) setCustomer((cur) => cur || matchCustomer(res.customer_guess) || res.customer_guess)
      } catch (e) {
        setFiles((prev) => prev.map((f) => f.id === id ? { ...f, busy: false, error: e.message } : f))
      }
    }
  }, [replyColumns, initMapping, matchCustomer])

  const onDrop = (e) => { e.preventDefault(); setDragActive(false); if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files) }
  const applyMapping = async (id) => {
    const f = files.find((x) => x.id === id); if (!f) return
    setFiles((prev) => prev.map((x) => x.id === id ? { ...x, busy: true } : x))
    try {
      const res = await api.applyMapping(f.raw_records, f.mapping)
      setFiles((prev) => prev.map((x) => x.id === id ? { ...x, busy: false, rows: res.rows, mapped: true } : x))
      setPriced(null)
    } catch (e) { setFiles((prev) => prev.map((x) => x.id === id ? { ...x, busy: false, error: e.message } : x)) }
  }
  const setMapping = (id, mapping) => setFiles((prev) => prev.map((x) => x.id === id ? { ...x, mapping, mapped: false } : x))
  const removeFile = (id) => { setFiles((prev) => prev.filter((x) => x.id !== id)); setPriced(null) }

  const normalizedRows = files.flatMap((f) => (f.recognized || f.mapped) ? (f.rows || []) : [])

  const applyPricing = async () => {
    if (!customer || !normalizedRows.length) return
    setPricing(true)
    try { setPriced(await api.priceRows(normalizedRows, customer)) }
    catch (e) { alert(e.message) } finally { setPricing(false) }
  }

  // export: only in-scope (Top-100) rows; _status is ignored by the backend workbook builder
  const exportRows = (priced || normalizedRows).filter((r) => r._status?.in_scope !== false)
  const doExport = async () => {
    setExporting(true)
    try { await api.exportRows(exportRows, 'anillo_quote.xlsx') }
    catch (e) { alert(e.message) } finally { setExporting(false) }
  }

  const flaggedCount = (priced || []).filter((r) => r._status?.flagged).length
  const outCount = (priced || []).filter((r) => r._status?.in_scope === false).length

  return (
    <div className="space-y-6">
      {/* Dropzone */}
      <div onDragOver={(e) => { e.preventDefault(); setDragActive(true) }} onDragLeave={() => setDragActive(false)}
        onDrop={onDrop} onClick={() => inputRef.current?.click()}
        className={cn('rounded-xl border-2 border-dashed p-10 text-center cursor-pointer transition-colors',
          dragActive ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50')}>
        <input ref={inputRef} type="file" multiple accept=".xlsx,.xls,.xlsm,.csv,.pdf" className="hidden"
          onChange={(e) => e.target.files?.length && handleFiles(e.target.files)} />
        <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
        <p className="font-medium">Drop quote files here, or click to browse</p>
        <p className="text-sm text-muted-foreground mt-1">Excel (.xlsx) or PDF — mix formats freely</p>
      </div>

      {/* File cards */}
      {files.map((f) => (
        <Card key={f.id}>
          <CardContent className="pt-5 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                {f.filename.toLowerCase().endsWith('.pdf')
                  ? <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
                  : <FileSpreadsheet className="h-5 w-5 text-muted-foreground shrink-0" />}
                <span className="font-medium truncate">{f.filename}</span>
                {f.busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                {f.detected_format && (
                  <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium shrink-0',
                    f.recognized ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                                  : 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200')}>
                    {FORMAT_LABELS[f.detected_format] || f.detected_format}
                  </span>
                )}
                {(f.recognized || f.mapped) && f.rows?.length > 0 && (
                  <span className="text-xs text-muted-foreground shrink-0">{f.rows.length} parts</span>
                )}
              </div>
              <button onClick={() => removeFile(f.id)} className="p-1 rounded hover:bg-muted shrink-0"><X className="h-4 w-4" /></button>
            </div>
            {f.error && <div className="flex items-start gap-2 text-sm text-destructive"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {f.error}</div>}
            {f.warnings?.map((w, i) => (
              <div key={i} className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400"><AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" /> {w}</div>
            ))}
            {f.detected_format === 'unknown' && !f.error && (
              <div className="space-y-3">
                <ColumnMapper replyColumns={replyColumns} sourceColumns={f.source_columns || []} sampleData={f.sample_data}
                  suggestions={f.suggestions} mapping={f.mapping || {}} onChange={(m) => setMapping(f.id, m)} />
                <Button size="sm" onClick={() => applyMapping(f.id)} disabled={f.busy || !f.mapping?.['Part Number']}>
                  <Wand2 className="h-4 w-4 mr-1.5" /> Apply mapping
                </Button>
              </div>
            )}
            {(f.recognized || f.mapped) && f.rows?.length > 0 && <PreviewTable columns={replyColumns} rows={f.rows} />}
          </CardContent>
        </Card>
      ))}

      {/* Pricing section */}
      {normalizedRows.length > 0 && (
        <Card>
          <CardContent className="pt-5 space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[240px]">
                <label className="text-sm font-medium flex items-center gap-1.5 mb-1"><DollarSign className="h-4 w-4 text-primary" />Customer (for contract lookup)</label>
                <input list="customer-list" value={customer} onChange={(e) => { setCustomer(e.target.value); setPriced(null) }}
                  placeholder="Select or type the customer…"
                  className="w-full px-3 py-2 border rounded-md text-sm bg-background" />
                <datalist id="customer-list">{customers.map((c) => <option key={c} value={c} />)}</datalist>
              </div>
              <Button onClick={applyPricing} disabled={pricing || !customer}>
                {pricing ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Wand2 className="h-4 w-4 mr-1.5" />}
                Apply pricing
              </Button>
            </div>

            {priced && (
              <>
                {(flaggedCount > 0 || outCount > 0) && (
                  <div className="flex flex-wrap gap-3 text-xs">
                    {flaggedCount > 0 && <span className="flex items-center gap-1 text-amber-700 dark:text-amber-400"><AlertTriangle className="h-3.5 w-3.5" />{flaggedCount} flagged for manual pricing</span>}
                    {outCount > 0 && <span className="text-muted-foreground">{outCount} excluded (not Top-100)</span>}
                  </div>
                )}
                <PreviewTable columns={replyColumns} rows={priced} showStatus max={200} />
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Export bar */}
      {exportRows.length > 0 && (
        <div className="sticky bottom-4 flex items-center justify-between gap-4 rounded-xl border bg-card/95 backdrop-blur p-4 shadow-lg">
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="h-5 w-5 text-primary" />
            <span className="font-medium">{exportRows.length} parts</span>
            <span className="text-muted-foreground">{priced ? 'priced & ready' : 'ready (prices blank — apply pricing first)'}</span>
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

function PreviewTable({ columns, rows, showStatus = false, max = 8 }) {
  const shown = rows.slice(0, max)
  const fmt = (v) => (v === null || v === undefined || v === '') ? '' : (typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(4)) : v)
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            {showStatus && <th className="px-3 py-2 text-left font-medium">Status</th>}
            {columns.map((c) => <th key={c} className="px-3 py-2 text-left font-medium whitespace-nowrap">{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => {
            const st = r._status
            const badge = st ? (STATUS[st.rule] || STATUS.flagged) : null
            return (
              <tr key={i} className={cn('border-t', st?.in_scope === false && 'opacity-50')}>
                {showStatus && <td className="px-3 py-1.5">{badge && <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', badge.cls)}>{badge.label}</span>}</td>}
                {columns.map((c) => <td key={c} className="px-3 py-1.5 whitespace-nowrap">{fmt(r[c])}</td>)}
              </tr>
            )
          })}
        </tbody>
      </table>
      {rows.length > shown.length && <div className="px-3 py-1.5 text-xs text-muted-foreground bg-muted/30">+{rows.length - shown.length} more rows</div>}
    </div>
  )
}
