import { useState, useEffect, useRef } from 'react'
import { UserPlus, Check } from 'lucide-react'
import api from '@/services/ApiService'
import { cn } from '@/lib/utils'

const FAMILY_CLS = {
  Boeing: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  Airbus: 'bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-200',
  Spirit: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200',
}

/**
 * Customer name input with historical-match suggestions. Picking a suggestion returns the
 * canonical name + type; the "new customer" row keeps whatever was typed.
 */
export default function CustomerInput({ value, invalid, onChange, onPick }) {
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const boxRef = useRef(null)

  useEffect(() => {
    const q = (value || '').trim()
    if (!q) { setResults([]); return }
    let alive = true
    const t = setTimeout(() => {
      api.customerSuggest(q).then((r) => { if (alive) setResults(r) }).catch(() => { if (alive) setResults([]) })
    }, 180)
    return () => { alive = false; clearTimeout(t) }
  }, [value])

  useEffect(() => {
    const onDoc = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const exact = results.find((r) => r.name.toLowerCase() === (value || '').trim().toLowerCase())

  const pick = (r) => { onPick(r.name, r.type); setOpen(false) }
  const keepNew = () => { onPick((value || '').trim(), null); setOpen(false) }

  return (
    <div ref={boxRef} className="relative w-[420px] max-w-full">
      <input
        value={value} onChange={(e) => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => value && setOpen(true)} placeholder="Customer name"
        className={cn('w-full px-3 py-1.5 border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring', invalid && 'border-amber-400')} />

      {open && (results.length > 0 || (value || '').trim()) && (
        <div className="absolute z-30 mt-1 min-w-full w-max max-w-[640px] max-h-72 overflow-y-auto rounded-lg border bg-popover shadow-lg">
          {results.map((r) => (
            <button key={r.name} onClick={() => pick(r)}
              className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-accent/40 transition-colors">
              <span className="font-medium whitespace-nowrap">{r.name}</span>
              <span className="shrink-0 flex items-center gap-1">
                {r.family && <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-semibold', FAMILY_CLS[r.family] || 'bg-muted text-muted-foreground')}>{r.family}{r.on_contract ? ' contract' : ''}</span>}
                {r.airbus_enabled && <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200">Airbus-enabled</span>}
                {r.type && r.type !== 'Unknown' && <span className="text-[10px] text-muted-foreground">{r.type}</span>}
              </span>
            </button>
          ))}
          {(value || '').trim() && !exact && (
            <button onClick={keepNew}
              className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm border-t hover:bg-accent/40 transition-colors text-primary">
              <UserPlus className="w-3.5 h-3.5" /> Use “{(value || '').trim()}” as a new customer
            </button>
          )}
        </div>
      )}

      {exact && !open && (
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-green-600 dark:text-green-400" title={`Matched: ${exact.family || 'historical'} customer`}>
          <Check className="w-4 h-4" />
        </span>
      )}
    </div>
  )
}
