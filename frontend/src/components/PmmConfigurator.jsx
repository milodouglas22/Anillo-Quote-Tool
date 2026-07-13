import { useState, useEffect, useCallback } from 'react'
import { ArrowLeft, Loader2, Check } from 'lucide-react'
import api from '@/services/ApiService'
import { cn } from '@/lib/utils'

const inputCls = 'w-full border rounded-md px-3 py-2 text-base bg-background focus:outline-none focus:ring-2 focus:ring-ring'
const money2 = (v) => v == null || v === '' ? '—' : '$' + Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dec2 = (v) => v == null || v === '' ? '—' : Number(v).toFixed(2)
// unit prices & cost: $ with 2dp when >= $1, otherwise cents with 2dp
const cents = (v) => {
  if (v == null || v === '') return '—'
  const n = Number(v)
  return Math.abs(n) >= 1 ? '$' + n.toFixed(2) : (n * 100).toFixed(2) + '¢'
}
const pct = (v) => v == null ? '—' : (Number(v) * 100).toFixed(1) + '%'
const qtyf = (v) => v == null ? '' : Number(v).toLocaleString()
const datef = (v) => !v ? '—' : String(v).slice(0, 10)

/**
 * A&D-style single-part pricing panel (verbatim layout), wired to the Anillo PMM model.
 * Left: part details + order inputs (selections). Right: order history (pick reference row).
 * Bottom: computed quote + breakdown, Update Quote → writes the cart line.
 */
export default function PmmConfigurator({ part, qtys, initial, onBack, onSave }) {
  const [ctx, setCtx] = useState(null)
  const [loading, setLoading] = useState(true)
  const [pricing, setPricing] = useState(false)
  const [result, setResult] = useState(null)
  const [refIdx, setRefIdx] = useState(initial?.refIdx ?? 0)
  const [tradePosition, setTradePosition] = useState(initial?.trade_position || 'Strong Position')
  const [customerType, setCustomerType] = useState(initial?.customer_type || 'Distributor')
  const [orderType, setOrderType] = useState(initial?.order_type || 'OE')
  const [supplierDynamic, setSupplierDynamic] = useState(initial?.supplier_dynamic || '')

  useEffect(() => {
    let alive = true; setLoading(true)
    api.pmmPartContext(part).then((c) => {
      if (!alive) return
      setCtx(c)
      if (!initial && c.trade_position) setTradePosition(c.trade_position)
    }).catch(() => {}).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [part])   // eslint-disable-line react-hooks/exhaustive-deps

  const isTradeBrand = ctx ? ctx.framework?.startsWith('Trade') : true
  const orders = ctx?.reference_orders || []
  const ref = orders[refIdx]

  const reprice = useCallback(async () => {
    if (!ctx || !ref) return
    setPricing(true)
    try {
      setResult(await api.pmmPrice({
        part, reference_price: ref.unit_price, reference_qty: ref.qty, reference_customer_type: ref.customer_type,
        reference_date: ref.date, new_customer_type: customerType, order_type: orderType, qtys,
        trade_position: tradePosition, maturity: ctx.maturity, anchor_qty: ctx.anchor_qty,
        cost_per_unit: ctx.cost_per_unit, supplier_dynamic: supplierDynamic || null,
      }))
    } catch { /* ignore */ } finally { setPricing(false) }
  }, [ctx, ref, part, qtys, customerType, orderType, tradePosition, supplierDynamic])

  useEffect(() => { if (ctx && ref) reprice() }, [ctx, refIdx, tradePosition, customerType, orderType, supplierDynamic]) // eslint-disable-line

  const save = () => {
    if (!result?.prices?.length) return
    const row = {
      'Part Number': part,
      _pmm: { framework: ctx.framework, trade: tradePosition, gov: result.prices[0]?.governing_rule, gm: result.prices[0]?.gross_margin, cost: ctx.cost_per_unit },
      _config: { refIdx, trade_position: tradePosition, customer_type: customerType, order_type: orderType, supplier_dynamic: supplierDynamic },
    }
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

  const Detail = ({ label, value }) => {
    const v = (value == null || value === '' || value === '—') ? 'Unknown' : value
    return <div className="flex justify-between"><span className="text-primary">{label}:</span><span className="font-medium text-right max-w-[60%]">{v}</span></div>
  }

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-sm text-primary flex items-center gap-1"><ArrowLeft className="h-4 w-4" /> Back to quote</button>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Part Selection + Order Inputs */}
        <div className="lg:col-span-4 space-y-4">
          <div className="bg-card rounded-lg p-4 border">
            <h3 className="font-semibold text-base uppercase tracking-wide mb-3 text-primary">Part Selection</h3>
            <div className="text-lg font-bold">{part}</div>
            <div className="mt-3 space-y-2 text-base">
              <Detail label="Platform" value={ctx.platform || '—'} />
              <Detail label="Material" value={ctx.material && ctx.material !== 'Unknown' ? ctx.material : '—'} />
              <Detail label="Finish" value={ctx.finish && ctx.finish !== 'Unknown' ? ctx.finish : '—'} />
              <Detail label="Maturity" value={ctx.maturity} />
              <Detail label="Framework" value={isTradeBrand ? 'Trade Brand' : 'Platform Maturity'} />
              <Detail label="Anchor Qty" value={qtyf(ctx.anchor_qty)} />
              <Detail label="Total Unit Cost" value={cents(ctx.cost_per_unit)} />
              <hr className="border-border" />
              <Detail label="Last Order Price" value={cents(ref?.unit_price)} />
              <Detail label="Last Order Qty" value={qtyf(ref?.qty)} />
              <Detail label="Last Order Date" value={datef(ref?.date)} />
              <Detail label="Last Order Customer" value={ref?.customer} />
            </div>
          </div>

          <div className="bg-card rounded-lg p-4 border">
            <h3 className="font-semibold text-base uppercase tracking-wide mb-3 text-primary">Order Inputs</h3>
            <div className="space-y-3">
              {isTradeBrand ? (
                <div>
                  <label className="block text-base font-medium mb-1">Trade Brand Position</label>
                  <select value={tradePosition} onChange={(e) => setTradePosition(e.target.value)} className={inputCls}>
                    <option>Strong Position</option><option>Modest Position</option>
                  </select>
                </div>
              ) : (
                <div>
                  <label className="block text-base font-medium mb-1">Supplier Dynamic</label>
                  <select value={supplierDynamic} onChange={(e) => setSupplierDynamic(e.target.value)} className={inputCls} style={{ color: supplierDynamic ? undefined : '#9ca3af' }}>
                    <option value="" disabled hidden>Selection required</option>
                    {(ctx.supplier_dynamics || []).map((s) => <option key={s} value={s} style={{ color: '#000' }}>{s}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-base font-medium mb-1">New Quote Customer Type</label>
                <select value={customerType} onChange={(e) => setCustomerType(e.target.value)} className={inputCls}>
                  <option>OEM</option><option>Distributor</option><option>Tier</option>
                </select>
              </div>
              <div>
                <label className="block text-base font-medium mb-1">Order Type</label>
                <select value={orderType} onChange={(e) => setOrderType(e.target.value)} className={inputCls}>
                  <option>OE</option><option>Spares</option>
                </select>
              </div>
              <div>
                <label className="block text-base font-medium mb-1">New Order Quantities</label>
                <div className="flex flex-wrap gap-1.5">
                  {qtys.map((q, i) => <span key={i} className="px-2 py-1 rounded-md border bg-muted/40 text-sm tabular-nums">{qtyf(q)}</span>)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">From the uploaded quote's price breaks.</p>
              </div>
            </div>
          </div>
          <div className="text-xs text-muted-foreground px-1">Pick the reference order on the right → pricing updates automatically.</div>
        </div>

        {/* Right: Order History */}
        <div className="lg:col-span-8 space-y-4">
          <div className="border rounded-lg p-5 bg-card">
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-semibold text-base uppercase tracking-wide text-primary flex items-center gap-2">
                Order History {pricing && <Loader2 className="h-4 w-4 animate-spin" />}
              </h3>
              <span className="text-xs text-muted-foreground">Click a row to set the reference order</span>
            </div>
            {orders.length === 0 ? (
              <p className="text-muted-foreground">No order history for this part.</p>
            ) : (
              <div className="overflow-auto max-h-[46vh] rounded-md border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 text-white" style={{ backgroundColor: '#3A736F' }}>
                    <tr className="text-center">
                      <th className="py-2 px-2 font-bold text-left">Date</th>
                      <th className="py-2 px-2 font-bold text-left">Customer</th>
                      <th className="py-2 px-2 font-bold">Type</th>
                      <th className="py-2 px-2 font-bold">Qty</th>
                      <th className="py-2 px-2 font-bold">Unit Price</th>
                      <th className="py-2 px-2 font-bold">Total Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o, i) => (
                      <tr key={i} onClick={() => setRefIdx(i)}
                        className={cn('border-b border-border/50 cursor-pointer transition-colors hover:bg-accent/10 text-center',
                          i === refIdx && 'bg-primary/10 font-medium')}>
                        <td className="py-1.5 px-2 text-left">{datef(o.date)}</td>
                        <td className="py-1.5 px-2 text-left truncate max-w-[180px]" title={o.customer}>{o.customer || '—'}</td>
                        <td className="py-1.5 px-2">{o.customer_type || '—'}</td>
                        <td className="py-1.5 px-2">{qtyf(o.qty)}</td>
                        <td className="py-1.5 px-2">{cents(o.unit_price)}</td>
                        <td className="py-1.5 px-2">{money2(o.qty * o.unit_price)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Results */}
          <div className="border border-primary/20 rounded-lg p-5" >
            <h3 className="font-semibold text-base uppercase tracking-wide mb-3 text-primary">New Quote Price</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {(result?.prices || []).map((p, i) => (
                <div key={i} className="rounded-lg border p-4 text-center">
                  <div className="text-base text-muted-foreground">{qtyf(p.qty)} units</div>
                  <div className="text-3xl font-bold text-foreground mt-1 tabular-nums">{cents(p.unit_price)}</div>
                  <div className="text-sm text-muted-foreground mt-1">GM {pct(p.gross_margin)}</div>
                </div>
              ))}
              {!result?.prices?.length && <div className="text-sm text-muted-foreground">No quantities to price.</div>}
            </div>
            {shared && (
              <div className="mt-4 rounded-lg bg-muted/30 p-3 text-sm grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
                <Row k="Reference price" v={cents(shared.reference_price)} />
                <Row k="Governing rule" v={result?.prices?.[0]?.governing_rule} strong />
                <Row k={`Min GM% floor (${pct(shared.min_gm_pct)})`} v={cents(shared.helper_min_gm_or_maturity)} />
                <Row k="Min / Max YoY" v={`${cents(shared.min_yoy_price)} / ${cents(shared.max_yoy_price)}`} />
                <Row k="Volume factor" v={dec2(shared.volume_factor)} />
                <Row k="Cust×Order multiplier" v={dec2(shared.multiplier)} />
              </div>
            )}
            <div className="flex justify-end mt-4">
              <button onClick={save} disabled={!result?.prices?.length}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-md font-medium text-primary-foreground bg-primary disabled:opacity-50">
                <Check className="h-4 w-4" /> Update quote
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Row({ k, v, strong }) {
  return <div className="flex items-center justify-between"><span className="text-muted-foreground">{k}</span><span className={strong ? 'font-semibold text-foreground' : 'text-foreground'}>{v ?? '—'}</span></div>
}
