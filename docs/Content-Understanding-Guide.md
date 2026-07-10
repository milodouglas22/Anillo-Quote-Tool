# Azure AI Content Understanding Guide

How to use Azure AI Content Understanding to extract text and structure from PDFs and documents with OCR capability. This is the Azure AI Foundry service that converts scanned PDFs, images-in-PDFs, and complex document layouts into clean structured markdown.

---

## How to Use This Guide

1. **Share this file with Claude** along with your application code
2. **Describe your document processing needs** — what file types, what you want to extract
3. **Claude will implement** the Content Understanding integration following this pattern

---

## What Content Understanding Does

Traditional PDF text extraction (like pypdf) reads the text layer embedded in a PDF. This fails when:

- The PDF is a **scanned image** (no text layer at all)
- The PDF has **tables, charts, or mixed layouts** that lose structure when read as plain text
- The document is a **legacy .doc** file or other non-standard format

Azure AI Content Understanding solves this by using OCR and layout analysis to:

- Read text from scanned/image-based PDFs
- Preserve **table structure** as markdown tables
- Identify **headings, sections, and page breaks**
- Output clean **markdown** with page number markers

```
Input: Scanned 50-page contract PDF (image-based, no selectable text)
   ↓
Azure Content Understanding (prebuilt-layout analyzer)
   ↓
Output: Structured markdown with headings, tables, and page markers
        <!-- PageNumber="1" -->
        # Master Supply Agreement
        | Term | Value |
        |------|-------|
        | Duration | 3 years |
        ...
```

---

## Instructions for Claude

### Step 1: Gather Requirements

Ask the user:
- What file types will be processed? (PDF, DOCX, DOC, images)
- Is OCR needed? (scanned documents, image-based PDFs)
- What happens after text extraction? (AI analysis, search indexing, display)
- Should Content Understanding be required or used as a fallback?

### Step 2: Set Up Azure Resources

Ask the developer for their Azure Content Understanding **Endpoint URL** and **API Key**. These are provisioned in the Azure Portal under an Azure AI Services resource — the developer (or their admin) manages this, not the end user. Do not build any UI for entering these credentials. They go in the backend `.env` file as `AZURE_CU_ENDPOINT` and `AZURE_CU_API_KEY`.

### Step 3: Implement the Pattern Below

---

## Environment Configuration

Add these to your backend `.env` or `local.settings.json`:

```env
# Azure Content Understanding (OCR)
AZURE_CU_ENDPOINT=https://<your-resource>.cognitiveservices.azure.com
AZURE_CU_API_KEY=<your-api-key>
```

In your settings/config:

```python
# core/config.py
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    # ... other settings ...

    # Azure Content Understanding (OCR)
    AZURE_CU_ENDPOINT: str = ""
    AZURE_CU_API_KEY: str = ""

    class Config:
        env_file = ".env"
        extra = "ignore"

settings = Settings()
```

---

## Python Package

Install the Content Understanding SDK:

```bash
pip install azure-ai-contentunderstanding
```

Add to `requirements.txt`:

```
azure-ai-contentunderstanding
```

---

## Document Parser Implementation

The core pattern: try Content Understanding first (OCR-capable), fall back to pypdf if it's not configured or fails.

```python
"""Document parsing service — extracts text from PDF and DOCX files.

Uses Azure Content Understanding for OCR-capable PDF extraction,
with pypdf as a fallback when Azure CU is not configured or fails.
"""

import io
import os
import re
import logging
import tempfile
import pypdf
from docx2python import docx2python
from core.config import settings

logger = logging.getLogger(__name__)


# ── Azure CU Output Conversion ──────────────────────────────────────────────

def _convert_cu_page_markers(markdown: str) -> str:
    """Convert Azure CU page metadata comments to readable page markers.

    Azure CU outputs page metadata as HTML comments:
        <!-- PageNumber="1" -->
        <!-- PageBreak -->
        <!-- PageHeader="..." -->

    Convert PageNumber to '--- Page N ---' markers (useful for AI
    pipelines that need page references) and strip the rest.
    """
    markdown = re.sub(
        r'<!--\s*PageNumber="(\d+)"\s*-->',
        r'\n--- Page \1 ---',
        markdown,
    )
    markdown = re.sub(
        r'<!--\s*Page(?:Break|Header|Footer)(?:="[^"]*")?\s*-->\n?',
        '',
        markdown,
    )
    return markdown.strip()


def _get_page_count_from_markdown(markdown: str) -> int | None:
    """Extract page count from the highest PageNumber comment in Azure CU output."""
    page_numbers = re.findall(r'<!--\s*PageNumber="(\d+)"\s*-->', markdown)
    if page_numbers:
        return max(int(n) for n in page_numbers)
    return None


# ── PDF Extraction: Azure Content Understanding (OCR) ───────────────────────

def extract_text_from_pdf_ocr(file_bytes: bytes) -> tuple[str, int | None]:
    """Extract text from PDF using Azure Content Understanding.

    Returns (text, page_count) with '--- Page N ---' markers.
    Handles scanned PDFs, image-based PDFs, and complex layouts.
    """
    if not settings.AZURE_CU_ENDPOINT or not settings.AZURE_CU_API_KEY:
        raise RuntimeError("Azure Content Understanding is not configured")

    from azure.ai.contentunderstanding import ContentUnderstandingClient
    from azure.core.credentials import AzureKeyCredential

    client = ContentUnderstandingClient(
        endpoint=settings.AZURE_CU_ENDPOINT,
        credential=AzureKeyCredential(settings.AZURE_CU_API_KEY),
    )

    # Initialize defaults (required by Azure CU on first use)
    try:
        client.update_defaults()
    except Exception:
        pass  # May fail if already set — that's OK

    # Use prebuilt-layout for best structure extraction (headings, tables)
    poller = client.begin_analyze_binary(
        analyzer_id="prebuilt-layout",
        binary_input=file_bytes,
    )
    result = poller.result()

    if not result.contents:
        raise RuntimeError("Azure CU returned no content")

    raw_markdown = result.contents[0].markdown or ""
    page_count = _get_page_count_from_markdown(raw_markdown)

    # Fallback: check the content object for page count
    if page_count is None:
        content = result.contents[0]
        if hasattr(content, "end_page_number") and content.end_page_number:
            page_count = content.end_page_number

    text = _convert_cu_page_markers(raw_markdown)
    return text, page_count


# ── PDF Extraction: pypdf (Fallback, no OCR) ────────────────────────────────

def extract_text_from_pdf(file_bytes: bytes) -> tuple[str, int]:
    """Extract text from PDF using pypdf (no OCR — text layer only).

    Returns (text, page_count). Each page is prefixed with
    '--- Page N ---' markers for consistency with the CU output.
    """
    reader = pypdf.PdfReader(io.BytesIO(file_bytes))
    parts = []
    for i, page in enumerate(reader.pages):
        text = page.extract_text()
        if text:
            parts.append(f"--- Page {i + 1} ---\n{text}")
    return "\n\n".join(parts).strip(), len(reader.pages)


# ── DOCX Extraction ─────────────────────────────────────────────────────────

def extract_text_from_docx(file_bytes: bytes) -> tuple[str, None]:
    """Extract text from DOCX bytes.

    Returns (text, None) since DOCX has no native page concept.
    """
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as tmp:
            tmp.write(file_bytes)
            tmp_path = tmp.name
        doc = docx2python(tmp_path)
        return doc.text.strip(), None
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)


# ── Main Router ──────────────────────────────────────────────────────────────

def parse_document(file_bytes: bytes, filename: str) -> dict:
    """Route to the appropriate parser based on file extension.

    For PDFs, tries Azure Content Understanding (OCR) first, then
    falls back to pypdf if Azure CU is not configured or fails.

    Returns dict with keys: text, page_count, file_type.
    """
    ext = filename.rsplit(".", 1)[-1].lower()

    if ext == "pdf":
        # Try OCR-capable extraction first
        try:
            text, pages = extract_text_from_pdf_ocr(file_bytes)
            logger.info(f"PDF parsed via Azure Content Understanding: {filename}")
            return {"text": text, "page_count": pages, "file_type": "pdf"}
        except Exception as e:
            logger.warning(
                f"Azure CU failed for {filename}, falling back to pypdf: {e}"
            )
            text, pages = extract_text_from_pdf(file_bytes)
            return {"text": text, "page_count": pages, "file_type": "pdf"}

    elif ext == "doc":
        # Legacy .doc — try Azure CU first (it can handle binary .doc)
        try:
            text, pages = extract_text_from_pdf_ocr(file_bytes)
            logger.info(f"DOC parsed via Azure Content Understanding: {filename}")
            return {"text": text, "page_count": pages, "file_type": "doc"}
        except Exception as e:
            logger.warning(f"Azure CU failed for {filename}: {e}")
            text, _ = extract_text_from_docx(file_bytes)
            return {"text": text, "page_count": None, "file_type": "doc"}

    elif ext == "docx":
        text, _ = extract_text_from_docx(file_bytes)
        return {"text": text, "page_count": None, "file_type": "docx"}

    else:
        raise ValueError(f"Unsupported file type: {ext}")
```

---

## Using It in an Endpoint

Call `parse_document` when files are uploaded, then store the extracted text for downstream use (AI analysis, search, display):

```python
from fastapi import APIRouter, UploadFile, File
from services.document_parser import parse_document

router = APIRouter()

@router.post("/upload")
async def upload_document(file: UploadFile = File(...)):
    file_bytes = await file.read()

    # Extract text (tries Azure CU → falls back to pypdf)
    parsed = parse_document(file_bytes, file.filename)

    # parsed = {
    #   "text": "--- Page 1 ---\n# Contract Title\n...",
    #   "page_count": 12,
    #   "file_type": "pdf"
    # }

    # Store extracted text for later use
    # e.g., save to database, send to AI for analysis, index for search
    return {
        "filename": file.filename,
        "page_count": parsed["page_count"],
        "text_length": len(parsed["text"]),
        "file_type": parsed["file_type"],
    }
```

---

## Available Analyzer IDs

Content Understanding offers several prebuilt analyzers:

| Analyzer ID | Best For | Output |
|:------------|:---------|:-------|
| **prebuilt-layout** | General documents — contracts, reports, manuals | Markdown with headings, tables, page markers |
| **prebuilt-read** | Simple text extraction with OCR | Plain text, less structure |
| **prebuilt-invoice** | Invoices specifically | Structured fields (vendor, total, line items) |
| **prebuilt-receipt** | Receipts | Structured fields (merchant, total, date) |
| **prebuilt-idDocument** | IDs, passports, driver's licenses | Structured fields (name, DOB, ID number) |

> **Recommendation:** Use `prebuilt-layout` as your default. It handles the widest range of documents and preserves the most structure. Only switch to a specialized analyzer if you need structured field extraction (invoices, receipts).

---

## Output Format

Azure CU returns markdown with HTML comment metadata. The raw output looks like:

```markdown
<!-- PageNumber="1" -->
<!-- PageHeader="CONFIDENTIAL" -->

# Master Supply Agreement

This Agreement is entered into as of January 15, 2025...

| Term | Details |
|------|---------|
| Duration | 3 years |
| Payment | Net 30 |

<!-- PageBreak -->
<!-- PageNumber="2" -->

## Section 2: Pricing

...
```

After conversion with `_convert_cu_page_markers()`, this becomes:

```markdown
--- Page 1 ---

# Master Supply Agreement

This Agreement is entered into as of January 15, 2025...

| Term | Details |
|------|---------|
| Duration | 3 years |
| Payment | Net 30 |

--- Page 2 ---

## Section 2: Pricing

...
```

The `--- Page N ---` markers are useful for:
- **AI analysis** — the LLM can reference which page a term came from
- **Citation tracking** — link extracted data back to source pages
- **Chunking** — split long documents at page boundaries

---

## Feeding Extracted Text to an LLM

Once you have the extracted text, you can send it to an LLM (via Azure AI Foundry) for analysis. The text includes page markers so the LLM can cite page numbers in its responses:

```python
import requests
from core.config import settings

def analyze_document(extracted_text: str, prompt: str) -> str:
    """Send extracted document text to an LLM for analysis."""

    messages = [
        {"role": "system", "content": prompt},
        {"role": "user", "content": f"Document text:\n\n{extracted_text}"},
    ]

    response = requests.post(
        settings.AZURE_AI_ENDPOINT,
        headers={
            "Content-Type": "application/json",
            "x-api-key": settings.AZURE_AI_API_KEY,
            "anthropic-version": "2023-06-01",
        },
        json={
            "model": settings.AZURE_AI_MODEL,
            "messages": [m for m in messages if m["role"] != "system"],
            "system": messages[0]["content"],
            "max_tokens": 8000,
            "temperature": 0.1,
        },
        timeout=120,
    )
    response.raise_for_status()
    return response.json()["content"][0]["text"]
```

---

## Gotchas

| Issue | Solution |
|:------|:---------|
| **Azure CU returns empty content** | Some analyzer IDs behave differently. Use `prebuilt-layout` — it's the most reliable for general documents. |
| **Slow processing for large PDFs** | CU processes synchronously via a poller. For 100+ page PDFs, expect 30-60 seconds. Run extraction in a background thread. |
| **API key vs managed identity** | The pattern above uses API key auth (`AzureKeyCredential`). For production, consider `DefaultAzureCredential` for managed identity. |
| **Legacy .doc files** | Azure CU can handle binary `.doc` files — pass them through `begin_analyze_binary` the same as PDFs. |
| **Cost** | CU charges per page analyzed. For high-volume workloads, skip CU for PDFs that have a good text layer and only use it for scanned/image PDFs. |
| **`update_defaults()` fails** | This call initializes CU defaults on first use. It may fail on subsequent calls — wrap it in a try/except. |
| **Table extraction quality** | `prebuilt-layout` handles most tables well. For very complex nested tables, you may need to post-process the markdown. |

---

## Full Pipeline Example

A typical document processing pipeline combining Content Understanding with AI analysis:

```
1. User uploads PDF
   ↓
2. parse_document() — Azure CU extracts text + structure as markdown
   ↓
3. Store extracted text in database
   ↓
4. (Optional) Chunk text if > 200K characters
   ↓
5. Send to LLM for analysis (extraction, summarization, Q&A)
   ↓
6. Store AI results, display to user
```

This is the same pipeline used by the contract-review application, where uploaded contracts are parsed by Content Understanding, then analyzed by Claude Sonnet to extract commercial terms, dates, and clauses.
