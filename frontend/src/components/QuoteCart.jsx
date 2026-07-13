import { X, ShoppingCart, Trash2, Download, Loader2, Pencil, AlertTriangle, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

const money0 = (v) => '$' + Math.round(Number(v) || 0).toLocaleString()
const cents = (v) => v == null || v === '' ? '—' : (Number(v) * 100).toFixed(2) + '¢'
const qtyf = (v) => v == null ? '' : Number(v).toLocaleString()

function info(row) {
  const breaks = []
  for (let i = 1; i <= 3; i++) {
    const q = row[`Qty ${i}`], p = row[`Price ${i}`]
    if (q !== null && q !== undefined && q !== '') breaks.push({ qty: Number(q), price: (p === '' || p == null) ? null : Number(p) })
  }
  const pmm = row._pmm, st = row._status
  let badge
  if (pmm) badge = { label: pmm.framework?.startsWith('Trade') ? `Trade Brand · ${String(pmm.trade || '').replace(' Position', '')}` : 'Platform Maturity',
                     cls: 'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200' }
  else if (st) badge = { label: 'Price List', cls: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' }
  return { breaks, gm: pmm?.gm, cost: pmm?.cost, badge, configurable: !!pmm }
}

export default function QuoteCart({ open, onClose, lines, onSelect, onRemove, onClear, onExport, exporting }) {
  if (!open) return null
  const totalUnits = lines.reduce((s, r) => s + (Number(r['Qty 1']) || 0), 0)
  const totalRevenue = lines.reduce((s, r) => s + (Number(r['Qty 1']) || 0) * (Number(r['Price 1']) || 0), 0)
  const needCfg = lines.filter((r) => r._pmm && (r['Price 1'] == null || r['Price 1'] === '')).length

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="absolute top-0 right-0 h-full w-full max-w-md bg-card shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b">
          <h3 className="text-lg font-bold flex items-center gap-2 text-primary">
            <ShoppingCart className="w-5 h-5" /> Quote ({lines.length} {lines.length === 1 ? 'line' : 'lines'})
          </h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted transition-colors"><X className="w-5 h-5" /></button>
        </div>

        {needCfg > 0 && (
          <div className="shrink-0 px-5 py-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 flex items-center gap-1.5 border-b">
            <AlertTriangle className="w-3.5 h-3.5" /> {needCfg} part{needCfg > 1 ? 's' : ''} need review — click to configure pricing
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">No parts yet. Upload a quote and enter a customer.</p>
          ) : (
            <ul className="space-y-2">
              {lines.map((row) => {
                const l = info(row)
                return (
                  <li key={row._key}
                    className={cn('border rounded-md px-3 py-2 flex items-start justify-between gap-2',
                      l.configurable && 'cursor-pointer hover:border-primary/50 hover:bg-accent/10 transition-colors')}
                    onClick={l.configurable ? () => onSelect(row) : undefined}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate text-primary" title={row['Part Number']}>{row['Part Number']}</span>
                        {l.badge && <span className={cn('px-2 py-0.5 rounded-full text-[11px] font-medium shrink-0', l.badge.cls)}>{l.badge.label}</span>}
                        {row._repriced && <span className="px-2 py-0.5 rounded-full text-[11px] font-medium shrink-0 bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 inline-flex items-center gap-0.5"><Check className="w-3 h-3" /> Re-priced</span>}
                      </div>
                      <div className="text-sm text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                        {l.breaks.map((b, j) => <span key={j} className="tabular-nums">{qtyf(b.qty)}: <span className="text-foreground font-medium">{cents(b.price)}</span></span>)}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Cost: <span className="text-foreground">{cents(l.cost)}</span><span className="mx-2">·</span>
                        GM%: <span className="text-foreground">{l.gm != null ? (l.gm * 100).toFixed(1) + '%' : '—'}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {l.configurable && <span className="p-1.5 rounded hover:bg-accent/20" title="Configure"><Pencil className="w-4 h-4 text-primary" /></span>}
                      <button onClick={(e) => { e.stopPropagation(); onRemove(row._key) }} className="p-1.5 rounded hover:bg-destructive/10 transition-colors" title="Remove">
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="shrink-0 border-t">
          {lines.length > 0 && (
            <div className="px-5 py-3 border-b text-sm flex items-center justify-between">
              <span><span className="text-muted-foreground">Total units:</span> <span className="font-semibold text-primary">{totalUnits.toLocaleString()}</span></span>
              <span><span className="text-muted-foreground">Total:</span> <span className="font-semibold text-primary">{money0(totalRevenue)}</span></span>
            </div>
          )}
          <div className="px-5 py-4 flex items-center justify-between gap-3">
            <button onClick={onClear} disabled={!lines.length} className="text-sm font-medium text-primary hover:opacity-70 disabled:opacity-30">Clear all</button>
            <button onClick={onExport} disabled={!lines.length || exporting}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md font-medium text-primary-foreground bg-primary disabled:opacity-50">
              {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Export reply format
            </button>
          </div>
          {lines.length > 0 && <div className="px-5 pb-3 -mt-2 text-[11px] text-muted-foreground italic">Totals at first quantity break.</div>}
        </div>
      </div>
    </div>
  )
}
