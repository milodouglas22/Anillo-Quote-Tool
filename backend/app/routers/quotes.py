"""Quote normalization API: process any RFQ/quote file into Anillo's reply format."""
from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
import io

from ..services import quote_normalizer as qn
from ..services.contract_pricing import engine as pricing
from ..services.pmm_pricing import engine as pmm

# A contract price this many times the part's own highest historical booking ASP is
# almost certainly a normalization collision (e.g. dashed NAS620-6 washer colliding
# with dashless NAS6206 bolt), not a real price. Flag it rather than ship it silently.
ANOMALY_ASP_MULTIPLE = 5.0

router = APIRouter(prefix="/api/quotes", tags=["quotes"])


@router.get("/customers")
async def customers():
    """Distinct Anillo contract customer names for the customer selector."""
    pricing.ensure_loaded()
    return {"customers": pricing.customers}


@router.get("/top-parts")
async def top_parts():
    """Normalized keys of every part on a Boeing/Airbus contract, so the UI can route
    contract (auto-priced) vs pmm parts pre-pricing."""
    pricing.ensure_loaded()
    return {"parts": sorted(pricing.contract_parts)}


@router.get("/contract-info")
async def contract_info(part: str = ""):
    """Contract (anchor) price + which contract (Boeing/Airbus) a price-list part references."""
    info = pricing.contract_info(part)
    return info or {}


@router.get("/customer-suggest")
async def customer_suggest(q: str = "", limit: int = 12):
    """Closest historical customer names for the typed text, tagged with contract family
    (Boeing/Airbus/Spirit), whether they're on a contract, their type, and Airbus-enabled flag.
    Lets the UI validate the customer and offer a canonical name (or accept a new one)."""
    pricing.ensure_loaded()
    pmm.ensure_loaded()
    from ..services.contract_pricing import norm_cust, family_of
    needle = norm_cust(q)
    if not needle:
        return {"suggestions": []}
    seen: dict[str, dict] = {}
    for name in pricing.customers:                       # contract customers
        nc = norm_cust(name)
        seen[nc] = {"name": name, "family": family_of(name), "on_contract": True,
                    "type": pmm.customers.get(nc), "airbus_enabled": nc in pmm.airbus_enabled}
    for row in pmm.customer_rows:                          # historical (booking) customers
        nc = norm_cust(row["name"])
        if nc in seen:
            seen[nc]["type"] = seen[nc]["type"] or row["type"]
            continue
        seen[nc] = {"name": row["name"], "family": family_of(row["name"]), "on_contract": False,
                    "type": row["type"], "airbus_enabled": nc in pmm.airbus_enabled}
    hits = []
    for nc, rec in seen.items():
        if needle in nc:
            hits.append({**rec, "starts": nc.startswith(needle)})
    hits.sort(key=lambda h: (not h["starts"], not h["on_contract"], h["name"]))
    return {"suggestions": hits[:limit]}


@router.get("/search-parts")
async def search_parts(q: str = "", limit: int = 30):
    """Type-ahead over every part we know about (Boeing/Airbus contract universe ∪ PMM
    booking history). Returns display part number + whether it is auto-priced (contract)."""
    pricing.ensure_loaded()
    pmm.ensure_loaded()
    from ..services.contract_pricing import norm_part
    needle = norm_part(q)
    if not needle:
        return {"parts": []}
    # display-name map: prefer a real raw string; fall back to normalized key
    seen = {}
    for pn, raws in pricing.raw_by_norm.items():
        seen[pn] = sorted(raws)[0] if raws else pn
    for pn, g in pmm.parts.items():
        seen.setdefault(pn, g.get("orig") or pn)
    hits = []
    for pn, disp in seen.items():
        if needle in pn:
            g = pmm.parts.get(pn)
            contract = pn in pricing.contract_parts
            category = "contract" if contract else (pmm.classify(pn) or "unknown")
            hits.append({"part": disp, "norm": pn,
                         "contract": contract, "category": category,
                         "material": (g.get("material") if g else "") or "",
                         "finish": (g.get("finish") if g else "") or "",
                         "starts": pn.startswith(needle)})
    # prefix matches first, then alphabetical, capped
    hits.sort(key=lambda h: (not h["starts"], h["part"]))
    return {"parts": hits[:limit]}


class PriceRequest(BaseModel):
    rows: list[dict]
    customer: str


@router.post("/price")
async def price(req: PriceRequest):
    """Fill Price 1/2/3 per the contract formula. Adds a UI-only `_status` per row
    (never written to the exported workbook)."""
    results = []
    for row in req.rows:
        part = row.get("Part Number")
        out = dict(row)
        tiers = []
        row_scope = True
        row_flag = False
        rule_summary = None
        anomaly_reason = None
        max_priced = None
        for i in (1, 2, 3):
            q = row.get(f"Qty {i}")
            if q in (None, ""):
                tiers.append(None)
                continue
            pr = pricing.price(part, req.customer, q)
            if pr.rule == "out_of_scope":
                row_scope = False
            if pr.flagged:
                row_flag = True
            if pr.unit_price is not None:
                out[f"Price {i}"] = pr.unit_price
                rule_summary = rule_summary or pr.rule
                max_priced = pr.unit_price if max_priced is None else max(max_priced, pr.unit_price)
            tiers.append({"rule": pr.rule, "price": pr.unit_price, "reason": pr.reason, "caption": pr.caption})
        # anomaly guard: a contract price far above the part's own booking history is
        # almost certainly a part-number normalization collision — surface, don't ship.
        if row_scope and max_priced is not None:
            asp_max = pmm.booking_asp_max(part)
            if asp_max and max_priced > asp_max * ANOMALY_ASP_MULTIPLE:
                row_flag = True
                anomaly_reason = (f"Priced ${max_priced:.2f} vs highest historical ASP "
                                  f"${asp_max:.2f} (>{ANOMALY_ASP_MULTIPLE:g}x) — possible part-number collision")
        out["_status"] = {
            "in_scope": row_scope,
            "flagged": row_flag,
            "rule": ("out_of_scope" if not row_scope else
                     ("flagged" if row_flag and rule_summary is None else (rule_summary or "flagged"))),
            "tiers": tiers,
            "anomaly": anomaly_reason,
        }
        results.append(out)
    return {"rows": results, "reply_columns": qn.REPLY_COLUMNS}


@router.get("/reply-columns")
async def reply_columns():
    return {"columns": qn.REPLY_COLUMNS, "required": qn.REQUIRED_REPLY_COLUMNS}


@router.post("/process")
async def process_file(file: UploadFile = File(...)):
    """Detect the format and either normalize it or return data for manual mapping."""
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file.")
    result = qn.normalize(file.filename, content)
    return result.to_dict()


class ApplyMappingRequest(BaseModel):
    raw_records: list[dict]
    mapping: dict[str, Optional[str]]


@router.post("/apply-mapping")
async def apply_mapping(req: ApplyMappingRequest):
    """Turn a user-confirmed column mapping into reply-format rows."""
    rows = qn.apply_mapping(req.raw_records, req.mapping)
    return {"rows": rows, "reply_columns": qn.REPLY_COLUMNS}


class ExportRequest(BaseModel):
    rows: list[dict]
    filename: Optional[str] = "anillo_quote.xlsx"


@router.post("/export")
async def export(req: ExportRequest):
    """Export reply-format rows as a formatted .xlsx."""
    data = qn.build_reply_workbook(req.rows)
    fname = req.filename or "anillo_quote.xlsx"
    if not fname.lower().endswith(".xlsx"):
        fname += ".xlsx"
    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )
