import { useState, useEffect, useRef } from 'react'
import { Search, Loader2 } from 'lucide-react'
import api from '@/services/ApiService'
import { cn } from '@/lib/utils'

export const CATEGORY = {
  contract:           { label: 'Price list',          cls: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' },
  platform_maturity:  { label: 'Platform maturity',   cls: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200' },
  strong_trade_brand: { label: 'Strong trade brand',  cls: 'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200' },
  modest_trade_brand: { label: 'Modest trade brand',  cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200' },
  unknown:            { label: 'No pricing data',     cls: 'bg-muted text-muted-foreground' },
}

/** Type-ahead search over every known part. onPick(partObj) adds it to the quote. */
export default function PartSearch({ onPick, exclude, autoFocus = false, placeholder = 'Search for a part to quote…' }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const boxRef = useRef(null)

  useEffect(() => {
    if (!q.trim()) { setResults([]); setOpen(false); return }
    let alive = true
    setLoading(true)
    const t = setTimeout(() => {
      api.searchParts(q.trim()).then((r) => { if (alive) { setResults(r); setOpen(true) } })
        .catch(() => { if (alive) setResults([]) })
        .finally(() => { if (alive) setLoading(false) })
    }, 200)
    return () => { alive = false; clearTimeout(t) }
  }, [q])

  useEffect(() => {
    const onDoc = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const pick = (p) => { onPick(p); setQ(''); setResults([]); setOpen(false) }

  // hide parts already in the quote
  const shown = exclude ? results.filter((p) => !exclude.has(p.norm)) : results

  return (
    <div ref={boxRef} className="relative w-full">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => results.length && setOpen(true)}
          autoFocus={autoFocus} placeholder={placeholder}
          className="w-full pl-9 pr-9 py-2.5 border rounded-lg text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring" />
        {loading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      {open && (
        <div className="absolute z-30 mt-1 w-full max-h-72 overflow-y-auto rounded-lg border bg-popover shadow-lg">
          {shown.length === 0 ? (
            <div className="px-3 py-3 text-sm text-muted-foreground">{loading ? 'Searching…' : 'No matching parts.'}</div>
          ) : (
            shown.map((p) => {
              const clean = (v) => v && !['unknown', 'n/a', 'none', 'other / unknown'].includes(String(v).trim().toLowerCase()) ? v : null
              const material = clean(p.material), finish = clean(p.finish)
              const cat = CATEGORY[p.category] || CATEGORY.unknown
              return (
                <button key={p.norm} onClick={() => pick(p)}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-accent/40 transition-colors">
                  <div className="min-w-0">
                    <div className="font-medium text-sm truncate">{p.part}</div>
                    {(material || finish) && (
                      <div className="text-xs text-muted-foreground truncate">
                        {[material && `Material: ${material}`, finish && `Coating: ${finish}`].filter(Boolean).join('  ·  ')}
                      </div>
                    )}
                  </div>
                  <span className={cn('shrink-0 inline-flex items-center rounded-md px-2.5 py-1 text-xs font-semibold', cat.cls)}>
                    {cat.label}
                  </span>
                </button>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
