"""Quote normalization API: process any RFQ/quote file into Anillo's reply format."""
from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
import io

from ..services import quote_normalizer as qn

router = APIRouter(prefix="/api/quotes", tags=["quotes"])


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
