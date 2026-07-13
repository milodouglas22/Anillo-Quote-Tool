"""PMM / Trade-Brand pricing API (non-Top-100 parts)."""
from datetime import datetime, date
from dataclasses import asdict

from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional

from ..services.pmm_pricing import engine as pmm

router = APIRouter(prefix="/api/pmm", tags=["pmm"])


@router.get("/options")
async def options():
    """Selector options for the basket UI, sourced from Control Inputs."""
    pmm.ensure_loaded()
    ci = pmm.ci
    return {
        "customer_types": list(ci["cust_mult"].keys()),        # OEM, Distributor, Tier
        "order_types": list(ci["order_mult"].keys()),          # OE, Spares
        "supplier_dynamics": list(ci["alt_min_gm"].keys()),    # alt-supplier descriptions (known-platform only)
        "trade_positions": ["Strong Position", "Modest Position"],
    }


@router.get("/part-context/{part}")
async def part_context(part: str):
    ctx = pmm.part_context(part)
    return asdict(ctx)


class PmmPriceRequest(BaseModel):
    part: str
    reference_price: Optional[float] = None
    reference_qty: Optional[int] = None
    reference_customer_type: str = "Distributor"
    reference_date: Optional[str] = None
    new_customer_type: str = "OEM"
    order_type: str = "OE"
    qtys: list[int] = []                # one price per requested quantity break
    trade_position: str = "Strong Position"
    maturity: str = "Other / Unknown"
    anchor_qty: Optional[int] = None
    cost_per_unit: Optional[float] = None
    supplier_dynamic: Optional[str] = None


def _years_since(ref_date: Optional[str]) -> int:
    if not ref_date:
        return 0
    try:
        y = datetime.fromisoformat(ref_date).year
    except ValueError:
        try:
            y = int(str(ref_date)[:4])
        except ValueError:
            return 0
    return max(date.today().year - y, 0)


@router.post("/price")
async def price(req: PmmPriceRequest):
    """Price each requested quantity break for one basket item (shared inputs)."""
    yrs = _years_since(req.reference_date)
    qtys = req.qtys or ([req.reference_qty] if req.reference_qty else [])
    prices = []
    shared = None
    for q in qtys:
        bd = pmm.price(
            req.part, reference_price=req.reference_price, reference_qty=req.reference_qty,
            reference_customer_type=req.reference_customer_type, new_customer_type=req.new_customer_type,
            order_type=req.order_type, new_qty=q, trade_position=req.trade_position, maturity=req.maturity,
            anchor_qty=req.anchor_qty, cost_per_unit=req.cost_per_unit,
            supplier_dynamic=req.supplier_dynamic, years_since_ref=yrs,
        )
        prices.append({"qty": q, "unit_price": bd.new_unit_price, "gross_margin": bd.new_gross_margin,
                       "governing_rule": bd.governing_rule, "volume_factor": bd.volume_factor,
                       "flagged": bd.flagged, "reason": bd.reason})
        if shared is None:
            shared = asdict(bd)
    return {"part": req.part, "framework": (shared or {}).get("framework"),
            "shared": shared, "prices": prices, "years_since_ref": yrs}


class BasketItem(BaseModel):
    part: str
    qtys: list[int] = []


class BasketRequest(BaseModel):
    items: list[BasketItem]
    customer_name: str = ""
    order_type: str = "OE"


@router.post("/basket")
async def basket(req: BasketRequest):
    """Batch: for each non-Top-100 part, return its context + a default price per qty.
    Defaults mirror the Excel: most-recent reference order, derived trade position,
    the quote customer's type, and the given order type. The UI can then refine per item."""
    from ..services.pmm_pricing import norm_cust
    pmm.ensure_loaded()
    new_ct = pmm.customers.get(norm_cust(req.customer_name), "Distributor")
    out = []
    for it in req.items:
        ctx = pmm.part_context(it.part)
        if not ctx.found:
            out.append({"part": it.part, "found": False})
            continue
        ref = ctx.reference_orders[0] if ctx.reference_orders else None
        prices = []
        if ref:
            yrs = _years_since(ref["date"])
            for q in (it.qtys or [ref["qty"]]):
                bd = pmm.price(
                    it.part, reference_price=ref["unit_price"], reference_qty=ref["qty"],
                    reference_customer_type=ref["customer_type"], new_customer_type=new_ct,
                    order_type=req.order_type, new_qty=q, trade_position=ctx.trade_position,
                    maturity=ctx.maturity, anchor_qty=ctx.anchor_qty, cost_per_unit=ctx.cost_per_unit,
                    years_since_ref=yrs,
                )
                prices.append({"qty": q, "unit_price": bd.new_unit_price,
                               "gross_margin": bd.new_gross_margin, "governing_rule": bd.governing_rule,
                               "flagged": bd.flagged})
        out.append({"part": it.part, "found": True, "framework": ctx.framework,
                    "trade_position": ctx.trade_position, "anchor_qty": ctx.anchor_qty,
                    "cost_per_unit": ctx.cost_per_unit, "maturity": ctx.maturity,
                    "reference": ref, "reference_orders": ctx.reference_orders[:12],
                    "new_customer_type": new_ct, "prices": prices})
    return {"new_customer_type": new_ct, "order_type": req.order_type, "items": out}

