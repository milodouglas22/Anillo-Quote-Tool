import { useState, useEffect, useRef, useCallback } from 'react'
import { Upload, FileSpreadsheet, FileText, AlertTriangle, CheckCircle2, Download, X, Loader2, Wand2 } from 'lucide-react'
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

let _uid = 0

export default function QuoteTool() {
  const [replyColumns, setReplyColumns] = useState(REPLY_FALLBACK)
  const [files, setFiles] = useState([])
  const [dragActive, setDragActive] = useState(false)
  const [exporting, setExporting] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    fetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'}/api/quotes/reply-columns`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => d?.columns && setReplyColumns(d.columns))
      .catch(() => {})
  }, [])

  const initMapping = useCallback((suggestions, replyCols) => {
    const map = {}
    const used = new Set()
    for (const rc of replyCols) {
      const best = (suggestions?.[rc] || []).find((s) => s.score >= 0.5 && !used.has(s.source_col))
      if (best) { map[rc] = best.source_col; used.add(best.source_col) }
      else map[rc] = null
    }
    return map
  }, [])

  const handleFiles = useCallback(async (fileList) => {
    const arr = Array.from(fileList)
    for (const file of arr) {
      const id = ++_uid
      setFiles((prev) => [...prev, { id, filename: file.name, busy: true }])
      try {
        const res = await api.processFile(file)
        const cols = res.reply_columns || replyColumns
        setFiles((prev) => prev.map((f) => f.id === id ? {
          ...f, busy: false, ...res,
          mapping: res.recognized ? null : initMapping(res.suggestions, cols),
        } : f))
      } catch (e) {
        setFiles((prev) => prev.map((f) => f.id === id ? { ...f, busy: false, error: e.message } : f))
      }
    }
  }, [replyColumns, initMapping])

  const onDrop = (e) => { e.preventDefault(); setDragActive(false); if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files) }

  const applyMapping = async (id) => {
    const f = files.find((x) => x.id === id)
    if (!f) return
    setFiles((prev) => prev.map((x) => x.id === id ? { ...x, busy: true } : x))
    try {
      const res = await api.applyMapping(f.raw_records, f.mapping)
      setFiles((prev) => prev.map((x) => x.id === id ? { ...x, busy: false, rows: res.rows, mapped: true } : x))
    } catch (e) {
      setFiles((prev) => prev.map((x) => x.id === id ? { ...x, busy: false, error: e.message } : x))
    }
  }

  const setMapping = (id, mapping) =>
    setFiles((prev) => prev.map((x) => x.id === id ? { ...x, mapping, mapped: false } : x))

  const removeFile = (id) => setFiles((prev) => prev.filter((x) => x.id !== id))

  const combinedRows = files.flatMap((f) => (f.recognized || f.mapped) ? (f.rows || []) : [])

  const doExport = async () => {
    setExporting(true)
    try { await api.exportRows(combinedRows, 'anillo_quote.xlsx') }
    catch (e) { alert(e.message) }
    finally { setExporting(false) }
  }

  return (
    <div className="space-y-6">
      {/* Dropzone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragActive(true) }}
        onDragLeave={() => setDragActive(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'rounded-xl border-2 border-dashed p-10 text-center cursor-pointer transition-colors',
          dragActive ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
        )}
      >
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
                {(f.recognized || f.mapped) && (f.rows?.length > 0) && (
                  <span className="text-xs text-muted-foreground shrink-0">{f.rows.length} parts</span>
                )}
              </div>
              <button onClick={() => removeFile(f.id)} className="p-1 rounded hover:bg-muted shrink-0">
                <X className="h-4 w-4" />
              </button>
            </div>

            {f.error && (
              <div className="flex items-start gap-2 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {f.error}
              </div>
            )}

            {f.warnings?.map((w, i) => (
              <div key={i} className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" /> {w}
              </div>
            ))}

            {/* Unknown format -> mapping UI */}
            {f.detected_format === 'unknown' && !f.error && (
              <div className="space-y-3">
                <ColumnMapper
                  replyColumns={replyColumns}
                  sourceColumns={f.source_columns || []}
                  sampleData={f.sample_data}
                  suggestions={f.suggestions}
                  mapping={f.mapping || {}}
                  onChange={(m) => setMapping(f.id, m)}
                />
                <Button size="sm" onClick={() => applyMapping(f.id)} disabled={f.busy || !f.mapping?.['Part Number']}>
                  <Wand2 className="h-4 w-4 mr-1.5" /> Apply mapping
                </Button>
                {!f.mapping?.['Part Number'] && (
                  <span className="text-xs text-muted-foreground ml-2">Map “Part Number” to continue.</span>
                )}
              </div>
            )}

            {/* Preview */}
            {(f.recognized || f.mapped) && f.rows?.length > 0 && <PreviewTable columns={replyColumns} rows={f.rows} />}
          </CardContent>
        </Card>
      ))}

      {/* Export bar */}
      {combinedRows.length > 0 && (
        <div className="sticky bottom-4 flex items-center justify-between gap-4 rounded-xl border bg-card/95 backdrop-blur p-4 shadow-lg">
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="h-5 w-5 text-primary" />
            <span className="font-medium">{combinedRows.length} parts</span>
            <span className="text-muted-foreground">ready across {files.filter((f)=>f.recognized||f.mapped).length} file(s)</span>
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

function PreviewTable({ columns, rows }) {
  const shown = rows.slice(0, 8)
  const fmt = (v) => (v === null || v === undefined || v === '') ? '' : v
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>{columns.map((c) => <th key={c} className="px-3 py-2 text-left font-medium whitespace-nowrap">{c}</th>)}</tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={i} className="border-t">
              {columns.map((c) => <td key={c} className="px-3 py-1.5 whitespace-nowrap">{fmt(r[c])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > shown.length && (
        <div className="px-3 py-1.5 text-xs text-muted-foreground bg-muted/30">+{rows.length - shown.length} more rows</div>
      )}
    </div>
  )
}
