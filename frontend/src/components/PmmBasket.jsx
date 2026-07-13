import { useState, useEffect, useRef, useMemo } from 'react'
import { ChevronDown, ChevronRight, Loader2, AlertTriangle, SlidersHorizontal } from 'lucide-react'
import api from '@/services/ApiService'
import { cn } from '@/lib/utils'

const fmtP = (v) => v == null ? '' : (Number.isInteger(v) ? v : Number(v).toFixed(4))
const fmtPct = (v) => v == null ? '' : (Number(v) * 100).toFixed(1) + '%'
const fmtQty = (v) => v == null ? '' : Number(v).toLocaleString()

/**
 * Non-Top-100 parts priced via the Anillo PMM / Trade-Brand model.
 * Each part is a basket item: auto-priced with defaults, expandable to adjust
 * the required selections (reference order, trade position, customer/order type),
 * which re-prices that item. Emits reply-format rows up via onRows.
 */
export default function PmmBasket({ items, customerName, onRows }) {
  const [orderType, setOrderType] = useState('OE')
  const [state, setState] = useState({})       // part -> item state
  const [loading, setLoading] = useState(false)
  const [newCustType, setNewCustType] = useState('Distributor')
  const [expanded, setExpanded] = useState({})
  const onRowsRef = useRef(onRows); onRowsRef.current = onRows

  const sig = useMemo(
    () => JSON.stringify(items.map((i) => [i.part, i.qtys])) + '|' + customerName + '|' + orderType,
    [items, customerName, orderType]
  )

  // fetch basket defaults
  useEffect(() => {
    if (!items.length || !customerName) { setState({}); return }
    let alive = true
    setLoading(true)
    api.pmmBasket(items, customerName, orderType).then((d) => {
      if (!alive) return
      setNewCustType(d.new_customer_type)
      const qmap = Object.fromEntries(items.map((i) => [i.part, i.qtys]))
      const st = {}
      for (const it of d.items) {
        st[it.part] = { ...it, qtys: qmap[it.part] || [], order_type: orderType,
                        customer_type: d.new_customer_type, refIdx: 0 }
      }
      setState(st)
    }).catch(() => {}).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [sig])   // eslint-disable-line react-hooks/exhaustive-deps

  // emit reply rows whenever pricing changes
  useEffect(() => {
    const rows = []
    for (const part of Object.keys(state)) {
      const it = state[part]
      if (!it.found || !it.prices?.length) continue
      const r = { 'Part Number': part, _pmm: { framework: it.framework, trade: it.trade_position,
                  gov: it.prices[0]?.governing_rule } }
      it.prices.forEach((p, i) => { r[`Qty ${i + 1}`] = p.qty; r[`Price ${i + 1}`] = p.unit_price })
      rows.push(r)
    }
    onRowsRef.current?.(rows)
  }, [state])

  const reprice = async (part, patch) => {
    const it = state[part]; if (!it) return
    const next = { ...it, ...patch }
    const ref = it.reference_orders?.[next.refIdx] || it.reference
    if (!ref) return
    setState((s) => ({ ...s, [part]: { ...next, _busy: true } }))
    try {
      const res = await api.pmmPrice({
        part, reference_price: ref.unit_price, reference_qty: ref.qty,
        reference_customer_type: ref.customer_type, reference_date: ref.date,
        new_customer_type: next.customer_type, order_type: next.order_type,
        qtys: it.qtys, trade_position: next.trade_position, maturity: it.maturity,
        anchor_qty: it.anchor_qty, cost_per_unit: it.cost_per_unit,
      })
      setState((s) => ({ ...s, [part]: { ...next, _busy: false, prices: res.prices, reference: ref } }))
    } catch { setState((s) => ({ ...s, [part]: { ...next, _busy: false } })) }
  }

  const found = Object.values(state).filter((it) => it.found)
  const notFound = Object.values(state).filter((it) => !it.found)
  if (!items.length) return null

  return (
    <div className="rounded-lg border">
      <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 bg-muted/40 border-b">
        <div className="text-sm font-medium flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-primary" />
          Other parts — PMM / Trade-Brand pricing
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          <span className="text-xs text-muted-foreground font-normal">
            {found.length} priced{notFound.length ? ` · ${notFound.length} no data` : ''} · customer type: {newCustType}
          </span>
        </div>
        <label className="text-xs flex items-center gap-1.5">
          Order type
          <select value={orderType} onChange={(e) => setOrderType(e.target.value)}
            className="px-2 py-1 border rounded bg-background text-xs">
            <option>OE</option><option>Spares</option>
          </select>
        </label>
      </div>

      <div className="max-h-[55vh] overflow-auto divide-y">
        {found.map((it) => {
          const open = expanded[it.part]
          return (
            <div key={it.part} className="px-3 py-2">
              <div className="flex items-center gap-3">
                <button onClick={() => setExpanded((e) => ({ ...e, [it.part]: !e[it.part] }))}
                  className="shrink-0 text-muted-foreground hover:text-foreground">
                  {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
                <span className="font-medium text-sm w-[150px] shrink-0 truncate">{it.part}</span>
                <span className={cn('px-2 py-0.5 rounded-full text-xs shrink-0',
                  it.framework?.startsWith('Trade') ? 'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200'
                    : 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200')}>
                  {it.framework?.startsWith('Trade') ? `Trade Brand · ${it.trade_position?.replace(' Position','')}` : 'Platform Maturity'}
                </span>
                {it._busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                <div className="flex-1 flex flex-wrap gap-x-4 gap-y-0.5 justify-end text-sm">
                  {(it.prices || []).map((p, i) => (
                    <span key={i} className="tabular-nums">
                      <span className="text-muted-foreground text-xs">{fmtQty(p.qty)}:</span> ${fmtP(p.unit_price)}
                    </span>
                  ))}
                </div>
              </div>

              {open && (
                <div className="mt-2 ml-7 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs bg-muted/20 rounded-md p-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-muted-foreground">Reference order</span>
                    <select value={it.refIdx} onChange={(e) => reprice(it.part, { refIdx: Number(e.target.value) })}
                      className="px-2 py-1 border rounded bg-background">
                      {(it.reference_orders || []).map((r, i) => (
                        <option key={i} value={i}>{String(r.date).slice(0, 10)} · {r.customer} · {fmtQty(r.qty)} @ ${fmtP(r.unit_price)}</option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-muted-foreground">Trade position</span>
                    <select value={it.trade_position} onChange={(e) => reprice(it.part, { trade_position: e.target.value })}
                      className="px-2 py-1 border rounded bg-background">
                      <option>Strong Position</option><option>Modest Position</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-muted-foreground">Customer type</span>
                    <select value={it.customer_type} onChange={(e) => reprice(it.part, { customer_type: e.target.value })}
                      className="px-2 py-1 border rounded bg-background">
                      <option>OEM</option><option>Distributor</option><option>Tier</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-muted-foreground">Order type</span>
                    <select value={it.order_type} onChange={(e) => reprice(it.part, { order_type: e.target.value })}
                      className="px-2 py-1 border rounded bg-background">
                      <option>OE</option><option>Spares</option>
                    </select>
                  </label>
                  <div className="sm:col-span-2 lg:col-span-4 text-muted-foreground">
                    anchor {fmtQty(it.anchor_qty)} · cost {it.cost_per_unit != null ? '$' + fmtP(it.cost_per_unit) : 'n/a'} · GM {fmtPct(it.prices?.[0]?.gross_margin)} · governing: {it.prices?.[0]?.governing_rule}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {notFound.length > 0 && (
        <div className="px-3 py-1.5 text-xs text-muted-foreground bg-muted/30 border-t flex items-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5" />
          {notFound.length} part{notFound.length > 1 ? 's' : ''} not in PMM data — excluded: {notFound.map((i) => i.part).join(', ')}
        </div>
      )}
    </div>
  )
}
