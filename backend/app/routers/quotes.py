"""Quote normalization API: process any RFQ/quote file into Anillo's reply format."""
from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
import io

from ..services import quote_normalizer as qn
from ..services.contract_pricing import engine as pricing

router = APIRouter(prefix="/api/quotes", tags=["quotes"])


@router.get("/customers")
async def customers():
    """Distinct Anillo contract customer names for the customer selector."""
    pricing.ensure_loaded()
    return {"customers": pricing.customers}


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
            tiers.append({"rule": pr.rule, "price": pr.unit_price, "reason": pr.reason})
        out["_status"] = {
            "in_scope": row_scope,
            "flagged": row_flag,
            "rule": ("out_of_scope" if not row_scope else
                     ("flagged" if row_flag and rule_summary is None else (rule_summary or "flagged"))),
            "tiers": tiers,
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
