import { Trash2, Download, Loader2, Plus, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Persistent right-hand quote drawer: the list of parts to quote + pinned Download. */
export default function QuoteDrawer({
  items, selectedKey, onSelect, onRemove, onAddParts, canAdd = true, onExport, exporting, customer,
}) {
  // downloadable once at least one line has been re-priced (confirmed via "Add to quote");
  // only those confirmed lines are written to the workbook.
  const canDownload = items.some((it) => it.confirmed) && !!customer

  return (
    <aside className="flex flex-col h-full min-h-0 rounded-xl border bg-card">
      <div className="shrink-0 px-4 py-3 border-b">
        <h3 className="font-semibold text-primary text-center text-[1.05rem]">
          Parts to quote
        </h3>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 px-3 py-3 space-y-2">
        {items.length === 0 ? (
          <div className="h-full flex items-center justify-center text-center text-sm text-muted-foreground px-4 py-10">
            Parts to quote will appear here.
          </div>
        ) : (
          items.map((it) => {
            const noData = it.status === 'no_data'
            return (
              <div key={it.key}
                onClick={() => onSelect(it.key)}
                style={it.confirmed ? { backgroundColor: '#8BFFCB', borderColor: '#00A45A' } : undefined}
                className={cn('group border rounded-lg px-3 py-2 cursor-pointer transition-colors',
                  !it.confirmed && (it.key === selectedKey ? 'border-primary ring-1 ring-primary bg-accent/10' : 'hover:border-primary/50 hover:bg-accent/5'))}>
                <div className="flex items-center justify-between gap-2">
                  <div className={cn('font-medium text-sm truncate min-w-0 flex-1', it.confirmed ? 'text-gray-900' : 'text-foreground')} title={it.part}>{it.part}</div>
                  {it.confirmed
                    ? <CheckCircle2 className="w-7 h-7 shrink-0" style={{ color: '#00A45A' }} />
                    : <span className={cn('shrink-0 px-2.5 py-1 rounded-md text-xs font-semibold',
                        noData ? 'bg-muted text-muted-foreground' : 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200')}>
                        {noData ? 'No pricing data' : 'Not priced'}
                      </span>}
                  <button
                    onClick={(e) => { e.stopPropagation(); onRemove(it.key) }}
                    className={cn('shrink-0 transition-opacity',
                      it.confirmed
                        ? 'p-1.5 rounded-md bg-white hover:bg-white/80'
                        : 'p-1 rounded hover:bg-destructive/10 opacity-60 group-hover:opacity-100')}
                    title="Remove part">
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>

      <div className="shrink-0 border-t">
        <div className="px-3 py-2.5">
          <button onClick={onAddParts} disabled={!canAdd} title={canAdd ? undefined : 'Select customer and customer type first'}
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md border border-dashed border-primary/50 text-sm font-medium text-primary hover:bg-primary/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            <Plus className="w-4 h-4" /> Add part(s)
          </button>
        </div>

        <div className="px-4 py-3 border-t">
          <button onClick={onExport} disabled={!canDownload || exporting}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md font-semibold text-primary-foreground bg-primary disabled:opacity-40 disabled:cursor-not-allowed transition-opacity">
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : canDownload ? <CheckCircle2 className="w-4 h-4" /> : <Download className="w-4 h-4" />}
            Download quote
          </button>
          {items.length > 0 && (
            <p className="mt-2 text-sm text-muted-foreground text-center">
              {!customer ? 'Set the customer to price' : 'Only parts that have been re-priced will appear in the download'}
            </p>
          )}
        </div>
      </div>
    </aside>
  )
}
