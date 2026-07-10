import { useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Info, Sparkles, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Manual column-matching UI for unrecognized formats.
 * Each reply column gets a dropdown + predicted-suggestion chips.
 * A source column can only map to one reply column.
 */
export default function ColumnMapper({
  replyColumns,
  sourceColumns,
  sampleData,
  suggestions,
  mapping,
  onChange,
}) {
  const [tooltip, setTooltip] = useState(null)

  const usedSources = new Set(Object.values(mapping).filter(Boolean))

  const setMap = (replyCol, srcCol) => {
    const next = { ...mapping }
    // free the source from any other reply col
    if (srcCol) {
      for (const rc of Object.keys(next)) {
        if (next[rc] === srcCol && rc !== replyCol) next[rc] = null
      }
    }
    next[replyCol] = srcCol || null
    onChange(next)
  }

  const showTip = useCallback((e, col) => {
    const r = e.currentTarget.getBoundingClientRect()
    setTooltip({ col, values: sampleData?.[col] || [], x: r.left + r.width / 2, y: r.top })
  }, [sampleData])
  const hideTip = useCallback(() => setTooltip(null), [])

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Sparkles className="h-4 w-4 text-primary" />
        Unrecognized format — confirm how its columns map to the reply format. Green chips are the predicted match.
      </div>

      <div className="rounded-lg border divide-y">
        {replyColumns.map((rc) => {
          const mapped = mapping[rc]
          const sugg = (suggestions?.[rc] || []).filter((s) => !usedSources.has(s.source_col) || s.source_col === mapped)
          return (
            <div key={rc} className="flex items-center gap-3 p-2.5">
              <span className="w-[110px] shrink-0 text-sm font-medium text-right">{rc}</span>
              <span className="text-muted-foreground text-xs">←</span>

              <div className="flex-1 flex flex-wrap items-center gap-2">
                <select
                  className="min-w-[200px] px-2.5 py-1.5 border rounded-md text-sm bg-background"
                  value={mapped || ''}
                  onChange={(e) => setMap(rc, e.target.value)}
                >
                  <option value="">— Not mapped —</option>
                  {sourceColumns.map((sc) => (
                    <option key={sc} value={sc} disabled={usedSources.has(sc) && sc !== mapped}>
                      {sc}{usedSources.has(sc) && sc !== mapped ? ' (used)' : ''}
                    </option>
                  ))}
                </select>

                {/* prediction chips */}
                {!mapped && sugg.slice(0, 3).map((s, i) => (
                  <button
                    key={s.source_col}
                    onClick={() => setMap(rc, s.source_col)}
                    onMouseEnter={(e) => showTip(e, s.source_col)}
                    onMouseLeave={hideTip}
                    className={cn(
                      'px-2 py-0.5 rounded-full text-xs font-medium transition-all hover:scale-105 flex items-center gap-1',
                      i === 0 && s.score >= 0.8
                        ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                        : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                    )}
                  >
                    {s.source_col}
                    <span className="opacity-60">{Math.round(s.score * 100)}%</span>
                  </button>
                ))}

                {mapped && (
                  <span
                    className="inline-flex items-center gap-1 text-xs text-primary"
                    onMouseEnter={(e) => showTip(e, mapped)}
                    onMouseLeave={hideTip}
                  >
                    <Check className="h-3.5 w-3.5" />
                    <Info className="h-3.5 w-3.5 opacity-50" />
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {tooltip && createPortal(
        <div className="fixed z-[9999] pointer-events-none"
          style={{ left: tooltip.x, top: tooltip.y, transform: 'translate(-50%, -100%)' }}>
          <div className="mb-2 w-56 bg-popover border rounded-lg shadow-xl p-2.5">
            <div className="text-xs font-semibold mb-1.5 truncate">Sample: {tooltip.col}</div>
            {tooltip.values.length ? tooltip.values.map((v, i) => (
              <div key={i} className="text-xs text-muted-foreground bg-muted/50 px-2 py-0.5 rounded truncate mb-1">{v}</div>
            )) : <div className="text-xs text-muted-foreground italic">No sample data</div>}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
