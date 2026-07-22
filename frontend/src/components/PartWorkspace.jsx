import { useState, useEffect, useCallback, useRef } from 'react'
import { Loader2, AlertTriangle, Calculator, Plus, X, Trash2, Check } from 'lucide-react'
import api from '@/services/ApiService'
import { cn } from '@/lib/utils'
import { CATEGORY } from '@/components/PartSearch'

const money2 = (v) => v == null || v === '' ? '—' : '$' + Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dec2 = (v) => v == null || v === '' ? '—' : Number(v).toFixed(2)
const cents = (v) => {
  if (v == null || v === '') return '—'
  const n = Number(v)
  return Math.abs(n) >= 1 ? '$' + n.toFixed(2) : (n * 100).toFixed(2) + '¢'
}
const pct = (v) => v == null ? '—' : (Number(v) * 100).toFixed(1) + '%'
const qtyf = (v) => v == null || v === '' ? '' : Number(v).toLocaleString()
// Per-box guiding rule caption (contract universe).
const CONTRACT_RULE = {
  contract: 'Contract price',
  markup_60: 'Contract price + 60% for quantity < 50K',
  markup_40: 'Contract price + 40% for quantity ≥ 50K',
  out_of_scope: 'Not on contract',
  no_contract: 'No baseline price',
}
const datef = (v) => {
  if (!v) return '—'
  const m = String(v).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return m ? `${m[2]}/${m[3]}/${m[1]}` : String(v).slice(0, 10)
}

/**
 * Selected-part workspace. Renders TWO grid columns as a fragment:
 *   1) part info (top) + required selections (bottom)
 *   2) bookings history + computed price
 * Contract parts are auto-priced & read-only; Trade-Brand parts are configurable.
 */
export default function PartWorkspace({ item, customer, customerType, onUpdate }) {
  const part = item.part
  const isContract = item.contract
  const [ctx, setCtx] = useState(null)
  const [loadingCtx, setLoadingCtx] = useState(true)
  const [pricing, setPricing] = useState(false)
  const [result, setResult] = useState(null)          // pmm price result
  const [contractRow, setContractRow] = useState(null) // contract priced row
  const [contractInfo, setContractInfo] = useState(null) // {contract_price, family} for price-list parts

  const [qtys, setQtys] = useState(() => (item.qtys?.length ? item.qtys.slice(0, 3) : []))
  const [refIdx, setRefIdx] = useState(item.config?.refIdx ?? null)  // null = user hasn't picked a reference yet
  const [tradePosition, setTradePosition] = useState(item.config?.trade_position || '')
  const [orderType, setOrderType] = useState(item.config?.order_type || 'OE')
  const [supplierDynamic, setSupplierDynamic] = useState(item.config?.supplier_dynamic || '')
  const [showPane, setShowPane] = useState(false)   // "Generate new pricing" pane (A&D-style modal)

  const onUpdateRef = useRef(onUpdate); onUpdateRef.current = onUpdate

  // fetch part context (bookings history + attributes) whenever the part changes
  useEffect(() => {
    let alive = true; setLoadingCtx(true); setCtx(null); setResult(null); setContractRow(null); setContractInfo(null)
    if (isContract) api.contractInfo(part).then((ci) => { if (alive) setContractInfo(ci) }).catch(() => {})
    setQtys(item.qtys?.length ? item.qtys.slice(0, 3) : [])
    setRefIdx(item.config?.refIdx ?? null)
    setTradePosition(item.config?.trade_position || '')
    setOrderType(item.config?.order_type || 'OE')
    setSupplierDynamic(item.config?.supplier_dynamic || '')
    api.pmmPartContext(part).then((c) => {
      if (!alive) return
      setCtx(c)
      if (!item.config && c.trade_position) setTradePosition(c.trade_position)
      // one empty break by default — the qty is a placeholder, entered in the pricing pane
      if (!(item.qtys?.length)) setQtys([''])
    }).catch(() => { if (alive) { setCtx({ found: false }); if (!(item.qtys?.length)) setQtys(['']) } }).finally(() => { if (alive) setLoadingCtx(false) })
    return () => { alive = false }
  }, [part]) // eslint-disable-line react-hooks/exhaustive-deps

  const orders = ctx?.reference_orders || []
  const shipOrders = ctx?.shipment_orders || []
  const hasBookings = orders.length > 0
  // reference comes from 2026 bookings; only from 2025 shipments when there are no bookings
  const refList = hasBookings ? orders : shipOrders
  const ref = refList[refIdx]
  const isTradeBrand = ctx ? ctx.framework?.startsWith('Trade') : true

  const buildReplyRow = useCallback((prices, extra = {}) => {
    const row = { 'Part Number': part, ...extra }
    prices.forEach((p, i) => { row[`Qty ${i + 1}`] = p.qty; row[`Price ${i + 1}`] = p.unit_price })
    return row
  }, [part])

  // ---- CONTRACT pricing (auto) ----
  const priceContract = useCallback(async () => {
    if (!isContract || !customer || !qtys.length) return
    setPricing(true)
    try {
      const row = { 'Part Number': part }
      qtys.forEach((q, i) => { row[`Qty ${i + 1}`] = q })
      const [priced] = await api.priceRows([row], customer)
      setContractRow(priced)
      const st = priced?._status
      onUpdateRef.current(item.key, {
        row: priced, qtys,
        priceReady: priced?.['Price 1'] != null && st?.in_scope !== false,
        status: st?.anomaly ? 'flagged' : (st?.in_scope === false ? 'no_data' : 'contract'),
        anomaly: st?.anomaly || null,
      })
    } catch { /* ignore */ } finally { setPricing(false) }
  }, [isContract, customer, qtys, part, item.key])

  // ---- PMM / Trade-Brand pricing ----
  const priceTradeBrand = useCallback(async () => {
    if (isContract || !ctx?.found || !ref || !qtys.length) return
    setPricing(true)
    try {
      const res = await api.pmmPrice({
        part, reference_price: ref.unit_price, reference_qty: ref.qty, reference_customer_type: ref.customer_type,
        reference_date: ref.date, new_customer_type: customerType || 'Distributor', order_type: orderType, qtys,
        trade_position: tradePosition, maturity: ctx.maturity, anchor_qty: ctx.anchor_qty,
        cost_per_unit: ctx.cost_per_unit, supplier_dynamic: supplierDynamic || null,
      })
      setResult(res)
      const prices = res?.prices || []
      const needSupplier = !isTradeBrand && !supplierDynamic
      const row = buildReplyRow(prices, {
        _pmm: { framework: ctx.framework, trade: tradePosition, gov: prices[0]?.governing_rule, gm: prices[0]?.gross_margin, cost: ctx.cost_per_unit },
      })
      onUpdateRef.current(item.key, {
        row, qtys,
        config: { refIdx, trade_position: tradePosition, customer_type: customerType, order_type: orderType, supplier_dynamic: supplierDynamic },
        priceReady: prices.length > 0 && !needSupplier,
        status: needSupplier ? 'needs_config' : 'quoted',
      })
    } catch { /* ignore */ } finally { setPricing(false) }
  }, [isContract, ctx, ref, qtys, part, customerType, orderType, tradePosition, supplierDynamic, refIdx, isTradeBrand, buildReplyRow, item.key])

  useEffect(() => { if (isContract) priceContract() }, [priceContract, isContract])
  useEffect(() => { if (!isContract && ctx?.found) priceTradeBrand() }, [priceTradeBrand, isContract, ctx])

  // ---------- render ----------
  // any pricing input change un-confirms the line (it must be re-added to the quote)
  const touch = () => onUpdateRef.current(item.key, { confirmed: false })
  const setQty = (i, val) => {
    const n = val === '' ? '' : Number(String(val).replace(/[^0-9]/g, ''))
    setQtys((prev) => { const next = prev.slice(); next[i] = n; return next }); touch()
  }
  const addBreak = () => { setQtys((prev) => (prev.length < 3 ? [...prev, ''] : prev)); touch() }
  const removeBreak = (i) => { setQtys((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev)); touch() }
  const pickRef = (i) => { setRefIdx(i); touch() }
  const changeSel = (setter) => (v) => { setter(v); touch() }

  const Detail = ({ label, value }) => {
    const v = (value == null || value === '' || value === '—') ? 'Unknown' : value
    return <div className="flex justify-between gap-2 text-sm"><span className="text-primary">{label}</span><span className="font-medium text-right">{v}</span></div>
  }

  // price + guiding rule for the quantity break at slot i (0..2)
  const boxFor = (i) => {
    const qty = qtys[i]
    if (qty === '' || qty == null) return { qty }
    if (isContract) {
      const t = contractRow?._status?.tiers?.[i]
      return { qty, unit_price: t?.price, caption: t?.caption || CONTRACT_RULE[t?.rule] }
    }
    const p = (result?.prices || []).find((x) => Number(x.qty) === Number(qty))
    return { qty, unit_price: p?.unit_price, gross_margin: p?.gross_margin, caption: p?.governing_rule }
  }
  const anomaly = contractRow?._status?.anomaly

  // ===== LEFT COLUMN: part info + selections =====
  const left = (
    <div className="space-y-4 min-w-0">
      <div className="bg-card rounded-xl p-4 border">
        <div className="flex items-center justify-between gap-2 mb-3">
          <h3 className="font-semibold text-[1.05rem] uppercase tracking-wide text-primary">Part info</h3>
          {(() => {
            const catKey = isContract ? 'contract'
              : (!isTradeBrand ? 'platform_maturity'
                : (tradePosition === 'Modest Position' ? 'modest_trade_brand' : 'strong_trade_brand'))
            const cat = CATEGORY[catKey] || CATEGORY.unknown
            return <span className={cn('inline-flex items-center rounded-md px-2.5 py-1 text-xs font-semibold', cat.cls)}>{cat.label}</span>
          })()}
        </div>
        <div className="text-lg font-bold break-all">{part}</div>
        {loadingCtx ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm mt-3"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : (
          <div className="mt-3 space-y-1.5">
            {isContract && <Detail label="Contract price" value={cents(contractInfo?.contract_price)} />}
            {isContract && <Detail label="Contract" value={contractInfo?.family} />}
            <Detail label="Platform" value={ctx?.platform} />
            <Detail label="Material" value={ctx?.material} />
            <Detail label="Finish" value={ctx?.finish} />
            <Detail label="Maturity" value={ctx?.maturity} />
            {!isContract && <Detail label="Framework" value={isTradeBrand ? 'Trade Brand' : 'Platform Maturity'} />}
            <Detail label="Anchor Qty" value={qtyf(ctx?.anchor_qty)} />
            <Detail label="Unit Cost" value={cents(ctx?.cost_per_unit)} />
          </div>
        )}
      </div>

      {/* Reference order details — hidden for contract (auto-priced) parts */}
      {!isContract && (
        <div className="bg-card rounded-xl p-4 border">
          <h3 className="font-semibold text-[1.05rem] uppercase tracking-wide text-primary mb-3">Reference order details</h3>
          {loadingCtx ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
          ) : ref ? (
            <div className="space-y-1.5">
              <Detail label="Source" value={hasBookings ? '2026 booking' : '2025 shipment'} />
              <Detail label="Date" value={datef(ref.date)} />
              <Detail label="Customer" value={ref.customer} />
              <Detail label="Type" value={ref.customer_type} />
              <Detail label="Quantity" value={qtyf(ref.qty)} />
              <Detail label="Unit price" value={cents(ref.unit_price)} />
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">No reference order — select a row from the history at right.</p>
          )}
        </div>
      )}

      {!isContract && (
        <div className="bg-card rounded-xl p-4 border">
          <h3 className="font-semibold text-[1.05rem] uppercase tracking-wide text-primary mb-3">New quote selections</h3>
          <div className="space-y-3">
            {isTradeBrand ? (
              <div>
                <label className="block text-sm font-medium mb-1">Trade Brand Position</label>
                <select value={tradePosition} onChange={(e) => changeSel(setTradePosition)(e.target.value)}
                  className="w-full border rounded-md px-2 py-1.5 text-sm bg-background">
                  <option>Strong Position</option><option>Modest Position</option>
                </select>
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium mb-1">Supplier Dynamic <span className="text-destructive">*</span></label>
                <select value={supplierDynamic} onChange={(e) => changeSel(setSupplierDynamic)(e.target.value)}
                  className="w-full border rounded-md px-2 py-1.5 text-sm bg-background" style={{ color: supplierDynamic ? undefined : '#9ca3af' }}>
                  <option value="" disabled hidden>Selection required</option>
                  {(ctx?.supplier_dynamics || []).map((s) => <option key={s} value={s} style={{ color: '#000' }}>{s}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium mb-1">Order Type</label>
              <select value={orderType} onChange={(e) => changeSel(setOrderType)(e.target.value)}
                className="w-full border rounded-md px-2 py-1.5 text-sm bg-background">
                <option>OE</option><option>Spares</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Generate new pricing → opens the pricing pane */}
      <button onClick={() => setShowPane(true)} disabled={!customer || (!isContract && !ref)}
        className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md font-semibold text-primary-foreground bg-primary disabled:opacity-40 disabled:cursor-not-allowed">
        <Calculator className="w-4 h-4" /> Generate new pricing
      </button>
    </div>
  )

  // ===== CENTER COLUMN: bookings + 2025 shipments history =====
  const center = (
    <div className="space-y-4 min-w-0">
      {anomaly && (
        <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-800 dark:text-red-200 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> <span>{anomaly}</span>
        </div>
      )}

      {/* bookings history */}
      <div className="border rounded-xl p-5 bg-card">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-[1.05rem] uppercase tracking-wide text-primary">Bookings history</h3>
          {!isContract && hasBookings && <span className="text-xs text-muted-foreground">Click a row to set the reference order</span>}
        </div>
        {loadingCtx ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : orders.length === 0 ? (
          <p className="text-muted-foreground text-sm">No booking history for this part.</p>
        ) : (
          <HistoryTable orders={orders} selectable={!isContract && hasBookings} selectedIdx={refIdx} onSelect={pickRef} />
        )}
      </div>

      {/* 2025 shipments history — same table format; the reference source when there are no bookings */}
      <div className="border rounded-xl p-5 bg-card">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-[1.05rem] uppercase tracking-wide text-primary">2025 shipments history</h3>
        </div>
        {loadingCtx ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : shipOrders.length === 0 ? (
          <p className="text-muted-foreground text-sm">No 2025 shipments recorded for this part.</p>
        ) : (
          <>
            {!isContract && !hasBookings && <p className="text-xs text-muted-foreground mb-2">No bookings — click a row to set the reference order.</p>}
            <HistoryTable orders={shipOrders} selectable={!isContract && !hasBookings} selectedIdx={refIdx} onSelect={pickRef} />
          </>
        )}
      </div>
    </div>
  )

  // ===== PRICING PANE (A&D-style modal) — quantities adjusted here =====
  const pane = (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[8vh]">
      {/* close only on a genuine backdrop click (a text-drag ending here bubbles to the wrapper, not this div) */}
      <div className="absolute inset-0 bg-black/40" onClick={() => setShowPane(false)} />
      <div className="relative bg-card rounded-xl shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col">
        <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b">
          <h3 className="font-semibold text-primary flex items-center gap-2">
            <Calculator className="w-4 h-4" /> New pricing — <span className="font-bold">{part}</span>
            {pricing && <Loader2 className="h-4 w-4 animate-spin" />}
          </h3>
          <button onClick={() => setShowPane(false)} className="p-1 rounded hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>

        <div className="overflow-y-auto px-5 py-4 space-y-4">
          {anomaly && (
            <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-800 dark:text-red-200 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> <span>{anomaly}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {qtys.map((_, i) => {
              const b = boxFor(i)
              return (
                <div key={i} className="relative rounded-lg border p-4 text-center flex flex-col">
                  {qtys.length > 1 && (
                    <button onClick={() => removeBreak(i)} className="absolute top-1.5 right-1.5 p-1 rounded hover:bg-destructive/10" title="Remove break">
                      <Trash2 className="w-3.5 h-3.5 text-destructive" />
                    </button>
                  )}
                  <div className="flex items-center justify-center gap-1">
                    <input inputMode="numeric" value={qtyf(qtys[i])} onChange={(e) => setQty(i, e.target.value)} placeholder="1,000"
                      className="w-24 text-center border rounded-md px-2 py-1 text-sm bg-background tabular-nums focus:outline-none focus:ring-2 focus:ring-ring" />
                    <span className="text-sm text-muted-foreground">units</span>
                  </div>
                  <div className="text-2xl font-bold mt-2 tabular-nums">{b.unit_price != null ? cents(b.unit_price) : '—'}</div>
                  {b.gross_margin != null && <div className="text-xs text-muted-foreground mt-1">GM {pct(b.gross_margin)}</div>}
                  {b.caption && <div className="text-xs text-muted-foreground mt-2 pt-2 border-t">{b.caption}</div>}
                </div>
              )
            })}
            {qtys.length < 3 && (
              <button onClick={addBreak}
                className="rounded-lg border border-dashed border-primary/50 p-4 flex flex-col items-center justify-center gap-1 text-primary hover:bg-primary/5 transition-colors min-h-[120px]">
                <Plus className="w-5 h-5" /> <span className="text-sm font-medium">Add quantity break</span>
              </button>
            )}
          </div>

          {!isContract && result?.shared && (
            <div className="rounded-lg bg-muted/30 p-3 text-sm grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
              <KV k="Reference price" v={cents(result.shared.reference_price)} />
              <KV k="Governing rule" v={result.prices?.[0]?.governing_rule} strong />
              <KV k={`Min GM% floor (${pct(result.shared.min_gm_pct)})`} v={cents(result.shared.helper_min_gm_or_maturity)} />
              <KV k="Min / Max YoY" v={`${cents(result.shared.min_yoy_price)} / ${cents(result.shared.max_yoy_price)}`} />
              <KV k="Volume factor" v={dec2(result.shared.volume_factor)} />
              <KV k="Cust×Order mult." v={dec2(result.shared.multiplier)} />
            </div>
          )}
        </div>

        <div className="shrink-0 border-t px-5 py-3 flex justify-end">
          <button onClick={() => { onUpdateRef.current(item.key, { confirmed: true }); setShowPane(false) }}
            disabled={!qtys.some((q) => q) || (!isContract && !ref)}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-md font-semibold text-primary-foreground bg-primary disabled:opacity-40 disabled:cursor-not-allowed">
            <Check className="w-4 h-4" /> Add to quote
          </button>
        </div>
      </div>
    </div>
  )

  return <>{left}{center}{showPane && pane}</>
}

function HistoryTable({ orders, selectable = false, selectedIdx, onSelect }) {
  return (
    <div className="overflow-auto max-h-[46vh] rounded-md border">
      <table className="w-full text-[13px]">
        <thead className="sticky top-0 text-white" style={{ backgroundColor: '#3A736F' }}>
          <tr>
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
            <tr key={i} onClick={selectable ? () => onSelect(i) : undefined}
              className={cn('border-b border-border/50 text-center',
                selectable && 'cursor-pointer hover:bg-accent/10 transition-colors',
                selectable && i === selectedIdx && 'bg-primary/10 font-medium')}>
              <td className="py-1.5 px-2 text-left">{datef(o.date)}</td>
              <td className="py-1.5 px-2 text-left truncate max-w-[180px]" title={o.customer}>{o.customer || '—'}</td>
              <td className="py-1.5 px-2">{o.customer_type || '—'}</td>
              <td className="py-1.5 px-2 tabular-nums">{qtyf(o.qty)}</td>
              <td className="py-1.5 px-2 tabular-nums">{cents(o.unit_price)}</td>
              <td className="py-1.5 px-2 tabular-nums">{money2(o.qty * o.unit_price)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function KV({ k, v, strong }) {
  return <div className="flex items-center justify-between gap-2"><span className="text-muted-foreground">{k}</span><span className={strong ? 'font-semibold text-foreground' : 'text-foreground'}>{v ?? '—'}</span></div>
}
