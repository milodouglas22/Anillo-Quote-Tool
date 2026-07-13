import { useState, useEffect, useCallback } from 'react'
import { ArrowLeft, Loader2, Check, Info } from 'lucide-react'
import api from '@/services/ApiService'
import { cn } from '@/lib/utils'

const inputCls = 'w-full px-3 py-2 border rounded-md bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring'

const money = (v) => v == null ? '—' : '$' + Number(v).toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })
const pct = (v) => v == null ? '—' : (Number(v) * 100).toFixed(1) + '%'
const qtyf = (v) => v == null ? '' : Number(v).toLocaleString()

/**
 * A&D-style single-part configurator for a non-Top-100 part.
 * Loads the part's PMM context, exposes the required selections, shows the live
 * pricing breakdown, and calls onSave(replyRow) to write the line into the cart.
 */
export default function PmmConfigurator({ part, qtys, initial, onBack, onSave }) {
  const [ctx, setCtx] = useState(null)
  const [loading, setLoading] = useState(true)
  const [pricing, setPricing] = useState(false)
  const [result, setResult] = useState(null)   // {prices, shared}
  // required selections
  const [refIdx, setRefIdx] = useState(initial?.refIdx ?? 0)
  const [tradePosition, setTradePosition] = useState(initial?.trade_position || 'Strong Position')
  const [customerType, setCustomerType] = useState(initial?.customer_type || 'Distributor')
  const [orderType, setOrderType] = useState(initial?.order_type || 'OE')
  const [supplierDynamic, setSupplierDynamic] = useState(initial?.supplier_dynamic || '')

  useEffect(() => {
    let alive = true
    setLoading(true)
    api.pmmPartContext(part).then((c) => {
      if (!alive) return
      setCtx(c)
      if (!initial) {
        setTradePosition(c.trade_position || 'Strong Position')
      }
    }).catch(() => {}).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [part])   // eslint-disable-line react-hooks/exhaustive-deps

  const isTradeBrand = ctx ? ctx.framework?.startsWith('Trade') : true
  const ref = ctx?.reference_orders?.[refIdx]

  const reprice = useCallback(async () => {
    if (!ctx || !ref) return
    setPricing(true)
    try {
      const res = await api.pmmPrice({
        part, reference_price: ref.unit_price, reference_qty: ref.qty,
        reference_customer_type: ref.customer_type, reference_date: ref.date,
        new_customer_type: customerType, order_type: orderType, qtys,
        trade_position: tradePosition, maturity: ctx.maturity, anchor_qty: ctx.anchor_qty,
        cost_per_unit: ctx.cost_per_unit, supplier_dynamic: supplierDynamic || null,
      })
      setResult(res)
    } catch { /* ignore */ } finally { setPricing(false) }
  }, [ctx, ref, part, qtys, customerType, orderType, tradePosition, supplierDynamic])

  useEffect(() => { if (ctx && ref) reprice() }, [ctx, refIdx, tradePosition, customerType, orderType, supplierDynamic]) // eslint-disable-line

  const save = () => {
    if (!result?.prices?.length) return
    const row = { 'Part Number': part, _pmm: {
      framework: ctx.framework, trade: tradePosition,
      gov: result.prices[0]?.governing_rule, gm: result.prices[0]?.gross_margin, cost: ctx.cost_per_unit },
      _config: { refIdx, trade_position: tradePosition, customer_type: customerType, order_type: orderType, supplier_dynamic: supplierDynamic } }
    result.prices.forEach((p, i) => { row[`Qty ${i + 1}`] = p.qty; row[`Price ${i + 1}`] = p.unit_price })
    onSave(row)
  }

  if (loading) return <div className="flex items-center gap-2 text-muted-foreground p-8"><Loader2 className="h-5 w-5 animate-spin" /> Loading part…</div>
  if (!ctx?.found) return (
    <div className="p-6">
      <button onClick={onBack} className="text-sm text-primary flex items-center gap-1 mb-4"><ArrowLeft className="h-4 w-4" /> Back to quote</button>
      <p className="text-muted-foreground">No PMM history for <span className="font-medium text-foreground">{part}</span> — it can't be priced by the Trade-Brand model.</p>
    </div>
  )

  const shared = result?.shared

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="text-sm text-primary flex items-center gap-1"><ArrowLeft className="h-4 w-4" /> Back to quote</button>
        <span className={cn('px-2.5 py-1 rounded-full text-xs font-medium',
          isTradeBrand ? 'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200'
                       : 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200')}>
          {isTradeBrand ? 'Trade Brand Strategy' : 'Platform Maturity Strategy'}
        </span>
      </div>

      <div>
        <h2 className="text-2xl font-bold text-primary">{part}</h2>
        <p className="text-sm text-muted-foreground">
          {[ctx.platform, ctx.material !== 'Unknown' && ctx.material, ctx.finish !== 'Unknown' && ctx.finish].filter(Boolean).join(' · ') || 'No platform/material data'}
          {' · '}anchor {qtyf(ctx.anchor_qty)} · cost {money(ctx.cost_per_unit)}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Selections */}
        <div className="space-y-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Required selections</h3>

          <Field label="Reference order">
            <select value={refIdx} onChange={(e) => setRefIdx(Number(e.target.value))} className={inputCls}>
              {(ctx.reference_orders || []).map((r, i) => (
                <option key={i} value={i}>{String(r.date).slice(0, 10)} · {r.customer} · {qtyf(r.qty)} @ ${Number(r.unit_price).toFixed(4)}</option>
              ))}
            </select>
          </Field>

          {isTradeBrand ? (
            <Field label="Trade brand position">
              <select value={tradePosition} onChange={(e) => setTradePosition(e.target.value)} className={inputCls}>
                <option>Strong Position</option><option>Modest Position</option>
              </select>
            </Field>
          ) : (
            <Field label="Supplier dynamic">
              <select value={supplierDynamic} onChange={(e) => setSupplierDynamic(e.target.value)} className={inputCls}>
                <option value="">— select —</option>
                {(ctx.supplier_dynamics || []).map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
          )}

          <Field label="New quote customer type">
            <select value={customerType} onChange={(e) => setCustomerType(e.target.value)} className={inputCls}>
              <option>OEM</option><option>Distributor</option><option>Tier</option>
            </select>
          </Field>

          <Field label="Order type">
            <select value={orderType} onChange={(e) => setOrderType(e.target.value)} className={inputCls}>
              <option>OE</option><option>Spares</option>
            </select>
          </Field>
        </div>

        {/* Pricing output */}
        <div className="space-y-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
            New quote price {pricing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          </h3>
          <div className="rounded-lg border divide-y">
            {(result?.prices || []).map((p, i) => (
              <div key={i} className="flex items-center justify-between px-4 py-2.5">
                <span className="text-sm text-muted-foreground">{qtyf(p.qty)} units</span>
                <span className="text-lg font-semibold text-primary tabular-nums">{money(p.unit_price)}</span>
                <span className="text-xs text-muted-foreground">GM {pct(p.gross_margin)}</span>
              </div>
            ))}
            {!result?.prices?.length && <div className="px-4 py-3 text-sm text-muted-foreground">No quantities to price.</div>}
          </div>

          {shared && (
            <div className="rounded-lg bg-muted/30 p-3 text-xs space-y-1">
              <div className="font-medium text-muted-foreground flex items-center gap-1"><Info className="h-3.5 w-3.5" /> How it's built</div>
              <Row k="Reference price" v={money(shared.reference_price)} />
              <Row k="Min GM% floor" v={`${pct(shared.min_gm_pct)} → ${money(shared.helper_min_gm_or_maturity)}`} />
              <Row k="Min / Max YoY" v={`${money(shared.min_yoy_price)} / ${money(shared.max_yoy_price)}`} />
              <Row k="Volume factor" v={shared.volume_factor} />
              <Row k="Cust×Order multiplier" v={shared.multiplier} />
              <Row k="Governing rule" v={result?.prices?.[0]?.governing_rule} strong />
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-end">
        <button onClick={save} disabled={!result?.prices?.length}
          className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-md font-medium text-primary-foreground bg-primary disabled:opacity-50">
          <Check className="h-4 w-4" /> Update quote
        </button>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return <label className="flex flex-col gap-1"><span className="text-sm font-medium">{label}</span>{children}</label>
}
function Row({ k, v, strong }) {
  return <div className="flex items-center justify-between"><span className="text-muted-foreground">{k}</span><span className={strong ? 'font-semibold text-foreground' : 'text-foreground'}>{v ?? '—'}</span></div>
}
