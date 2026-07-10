# Column Mapping Pattern

A standardized pattern for implementing user-driven column mapping when processing Excel/CSV files. This guide provides a reusable approach for mapping source file columns to a target schema.

---

## Quick Start for Claude

When a user needs column mapping functionality:

1. Install dependencies (`xlsx` for client-side parsing)
2. Implement the 4-step workflow (Master → Upload → Map → Export)
3. Use the data structures and components below
4. Add backend endpoints for file parsing and suggestions

---

## Table of Contents

- [Overview](#overview)
- [Data Structures](#data-structures)
- [Frontend Implementation](#frontend-implementation)
- [Backend Implementation](#backend-implementation)
- [UI Components](#ui-components)
- [Smart Features](#smart-features)
- [Complete Example](#complete-example)

---

## Overview

### When to Use This Pattern

Use this pattern when your application needs to:
- Accept Excel/CSV files with varying column structures
- Map user columns to a standardized schema
- Process multiple files with different column names
- Remember mapping preferences across files

### 4-Step Workflow

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  1. Master      │ -> │  2. Upload      │ -> │  3. Map         │ -> │  4. Export      │
│  Columns        │    │  Source Files   │    │  Columns        │    │  Results        │
└─────────────────┘    └─────────────────┘    └─────────────────┘    └─────────────────┘
   Define target          Upload files          Drag & drop or        Download mapping
   schema columns         to be mapped          select mappings       matrix / process
```

---

## Data Structures

### Core State

```javascript
// Step 1: Master columns (target schema)
const [masterColumns, setMasterColumns] = useState([]);
// Example: ['Vendor Name', 'Invoice Number', 'Amount', 'Date', 'Category']

// Step 2: Uploaded files with their sheet/column info
const [uploadedFiles, setUploadedFiles] = useState([]);
// Structure shown below

// Step 3: Mappings per file
const [fileMappings, setFileMappings] = useState({});
// Example: { "file1.xlsx": { "Vendor Name": "Supplier", "Amount": "Total" } }

// Smart learning: Remember mappings across files
const [learnedMappings, setLearnedMappings] = useState({});
// Example: { "Supplier": "Vendor Name" } - source col -> master col

// Track which sheet is active per file (for multi-sheet Excel files)
const [activeSheets, setActiveSheets] = useState({});
// Example: { "file1.xlsx": 0, "file2.xlsx": 1 }

// UI state: Which file cards are expanded
const [expandedFiles, setExpandedFiles] = useState({});
```

### Uploaded File Structure

```javascript
// Each uploaded file object
{
  original_filename: "purchases_2024.xlsx",
  file_id: "uuid-here",  // If storing on backend
  sheets: [
    {
      sheet_name: "Sheet1",
      columns: ["Supplier", "Total", "Invoice #", "Pmt Date"],
      row_count: 1523,
      header_row_index: 0,  // Which row contains headers
      sample_data: {
        "Supplier": ["Acme Corp", "Widget Inc", "Tech Co"],
        "Total": ["$1,234.56", "$789.00", "$2,345.67"],
        // ... 3-5 sample values per column
      },
      candidate_rows: [
        ["Supplier", "Total", "Invoice #", "Pmt Date"],  // Row 0
        ["Acme Corp", "$1,234.56", "INV-001", "2024-01-15"],  // Row 1
        // ... first few rows for header detection
      ]
    }
  ],
  suggestions: {
    "Vendor Name": [
      { source_col: "Supplier", score: 0.95 },
      { source_col: "Vendor", score: 0.85 }
    ],
    "Amount": [
      { source_col: "Total", score: 0.90 }
    ]
  }
}
```

### Mapping Structure

```javascript
// fileMappings[filename][masterColumn] = sourceColumn or null
{
  "purchases_2024.xlsx": {
    "Vendor Name": "Supplier",      // Mapped
    "Invoice Number": "Invoice #",  // Mapped
    "Amount": "Total",              // Mapped
    "Date": "Pmt Date",             // Mapped
    "Category": null                // Not mapped
  },
  "expenses_q1.xlsx": {
    "Vendor Name": "Vendor",
    "Invoice Number": null,         // No match in this file
    "Amount": "Cost",
    "Date": "Transaction Date",
    "Category": "Type"
  }
}
```

---

## Frontend Implementation

### Dependencies

```bash
npm install xlsx lucide-react
```

### Step 1: Master Columns Upload

```jsx
const handleMasterUpload = async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  setLoading(true);
  try {
    const XLSX = await import('xlsx');
    const reader = new FileReader();

    reader.onload = (event) => {
      const data = new Uint8Array(event.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });

      // First row contains column headers
      const columns = jsonData[0].filter(col => col && col.toString().trim());
      setMasterColumns(columns);
    };

    reader.readAsArrayBuffer(file);
  } catch (err) {
    setError(err.message);
  } finally {
    setLoading(false);
  }
};
```

### Step 2: Source Files Upload

```jsx
const handleFilesUpload = async (files) => {
  setUploading(true);

  for (const file of files) {
    try {
      const XLSX = await import('xlsx');
      const reader = new FileReader();

      const fileData = await new Promise((resolve, reject) => {
        reader.onload = (event) => {
          const data = new Uint8Array(event.target.result);
          const workbook = XLSX.read(data, { type: 'array' });

          const sheets = workbook.SheetNames.map(sheetName => {
            const sheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 });
            const columns = jsonData[0]?.filter(c => c && !c.toString().startsWith('Unnamed')) || [];

            // Build sample data (first 5 values per column)
            const sampleData = {};
            columns.forEach((col, colIdx) => {
              sampleData[col] = jsonData
                .slice(1, 6)
                .map(row => row[colIdx])
                .filter(v => v !== undefined && v !== null);
            });

            return {
              sheet_name: sheetName,
              columns,
              row_count: jsonData.length - 1,
              header_row_index: 0,
              sample_data: sampleData,
              candidate_rows: jsonData.slice(0, 10)  // First 10 rows for header selection
            };
          });

          resolve({
            original_filename: file.name,
            sheets,
            suggestions: generateSuggestions(masterColumns, sheets[0]?.columns || [])
          });
        };
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
      });

      setUploadedFiles(prev => [...prev, fileData]);

      // Initialize mappings for this file
      initializeMappings(fileData);

    } catch (err) {
      setError(`Failed to process ${file.name}: ${err.message}`);
    }
  }

  setUploading(false);
};

// Generate initial suggestions based on column name similarity
const generateSuggestions = (masterCols, sourceCols) => {
  const suggestions = {};

  masterCols.forEach(masterCol => {
    const matches = [];
    const masterLower = masterCol.toLowerCase();

    sourceCols.forEach(sourceCol => {
      const sourceLower = sourceCol.toLowerCase();
      let score = 0;

      // Exact match
      if (sourceLower === masterLower) {
        score = 1.0;
      }
      // Contains match
      else if (sourceLower.includes(masterLower) || masterLower.includes(sourceLower)) {
        score = 0.7;
      }
      // Word overlap
      else {
        const masterWords = masterLower.split(/[\s_-]+/);
        const sourceWords = sourceLower.split(/[\s_-]+/);
        const overlap = masterWords.filter(w => sourceWords.some(sw => sw.includes(w) || w.includes(sw)));
        if (overlap.length > 0) {
          score = 0.5 * (overlap.length / Math.max(masterWords.length, sourceWords.length));
        }
      }

      if (score > 0.3) {
        matches.push({ source_col: sourceCol, score });
      }
    });

    suggestions[masterCol] = matches.sort((a, b) => b.score - a.score);
  });

  return suggestions;
};
```

### Step 3: Mapping Handler

```jsx
const handleMapping = (filename, masterCol, sourceCol) => {
  setFileMappings(prev => {
    const fileMap = { ...prev[filename] };

    // If selecting a source column, unmap it from any other master column first
    if (sourceCol) {
      Object.keys(fileMap).forEach(mc => {
        if (fileMap[mc] === sourceCol && mc !== masterCol) {
          fileMap[mc] = null;
        }
      });
    }

    fileMap[masterCol] = sourceCol || null;
    const updated = { ...prev, [filename]: fileMap };

    // Learn this mapping and propagate to other files
    if (sourceCol) {
      propagateLearnedMapping(sourceCol, masterCol, updated);
    }

    return updated;
  });
};

// When user maps a column, remember it and apply to other files
const propagateLearnedMapping = (sourceCol, masterCol, currentMappings) => {
  setLearnedMappings(prev => {
    const newLearned = { ...prev, [sourceCol]: masterCol };

    // Apply to other files that have this source column
    const propagated = { ...currentMappings };

    uploadedFiles.forEach(file => {
      const fname = file.original_filename;
      const sheetIdx = activeSheets[fname] || 0;
      const sheet = file.sheets[sheetIdx];

      if (!sheet) return;

      // If this file has the same source column and master col isn't mapped yet
      if (sheet.columns.includes(sourceCol) && !propagated[fname]?.[masterCol]) {
        propagated[fname] = {
          ...propagated[fname],
          [masterCol]: sourceCol
        };
      }
    });

    setFileMappings(propagated);
    return newLearned;
  });
};
```

### Initialize Mappings for New File

```jsx
const initializeMappings = (fileData) => {
  const fname = fileData.original_filename;
  const sheet = fileData.sheets[0];
  if (!sheet) return;

  const mapping = {};
  const usedSources = new Set();

  // First pass: Apply learned mappings
  masterColumns.forEach(mc => {
    const learnedSource = Object.entries(learnedMappings).find(
      ([srcCol, mappedMaster]) => mappedMaster === mc
    );
    if (learnedSource && sheet.columns.includes(learnedSource[0]) && !usedSources.has(learnedSource[0])) {
      mapping[mc] = learnedSource[0];
      usedSources.add(learnedSource[0]);
    }
  });

  // Second pass: Apply backend suggestions (score >= 0.6)
  masterColumns.forEach(mc => {
    if (mapping[mc]) return;  // Already mapped

    const suggestions = fileData.suggestions?.[mc] || [];
    for (const sugg of suggestions) {
      if (!usedSources.has(sugg.source_col) && sugg.score >= 0.6) {
        mapping[mc] = sugg.source_col;
        usedSources.add(sugg.source_col);
        break;
      }
    }
  });

  // Fill remaining with null
  masterColumns.forEach(mc => {
    if (!mapping[mc]) mapping[mc] = null;
  });

  setFileMappings(prev => ({ ...prev, [fname]: mapping }));
  setActiveSheets(prev => ({ ...prev, [fname]: 0 }));
  setExpandedFiles(prev => ({ ...prev, [fname]: true }));
};
```

---

## Backend Implementation

### FastAPI Endpoints

```python
from fastapi import APIRouter, UploadFile, File
from pydantic import BaseModel
from typing import List, Dict, Optional
import pandas as pd
from rapidfuzz import fuzz  # pip install rapidfuzz

router = APIRouter(prefix="/api/mapping", tags=["mapping"])


class SheetInfo(BaseModel):
    sheet_name: str
    columns: List[str]
    row_count: int
    header_row_index: int
    sample_data: Dict[str, List[str]]
    candidate_rows: List[List[str]]


class FileInfo(BaseModel):
    original_filename: str
    sheets: List[SheetInfo]
    suggestions: Dict[str, List[Dict]]


@router.post("/parse-file", response_model=FileInfo)
async def parse_file(
    file: UploadFile = File(...),
    master_columns: List[str] = []
):
    """Parse uploaded Excel/CSV file and return structure with suggestions."""

    content = await file.read()

    if file.filename.endswith('.csv'):
        df = pd.read_csv(io.BytesIO(content))
        sheets_data = [process_dataframe(df, "Sheet1")]
    else:
        excel_file = pd.ExcelFile(io.BytesIO(content))
        sheets_data = []
        for sheet_name in excel_file.sheet_names:
            df = pd.read_excel(excel_file, sheet_name=sheet_name, header=None)
            sheets_data.append(process_dataframe(df, sheet_name))

    # Generate suggestions if master columns provided
    suggestions = {}
    if master_columns and sheets_data:
        source_cols = sheets_data[0]["columns"]
        suggestions = generate_suggestions(master_columns, source_cols)

    return FileInfo(
        original_filename=file.filename,
        sheets=sheets_data,
        suggestions=suggestions
    )


def process_dataframe(df: pd.DataFrame, sheet_name: str) -> dict:
    """Process a dataframe to extract column info and sample data."""

    # Detect header row (first row with mostly non-null string values)
    header_row = 0
    for idx, row in df.head(10).iterrows():
        non_null = row.dropna()
        if len(non_null) > len(row) * 0.5:
            string_vals = sum(1 for v in non_null if isinstance(v, str))
            if string_vals > len(non_null) * 0.7:
                header_row = idx
                break

    # Set headers
    df.columns = df.iloc[header_row].fillna('').astype(str)
    df = df.iloc[header_row + 1:].reset_index(drop=True)

    columns = [c for c in df.columns if c and not c.startswith('Unnamed')]

    # Sample data (first 5 non-null values per column)
    sample_data = {}
    for col in columns:
        values = df[col].dropna().head(5).astype(str).tolist()
        sample_data[col] = values

    # Candidate rows for header selection
    candidate_rows = df.head(10).fillna('').astype(str).values.tolist()

    return {
        "sheet_name": sheet_name,
        "columns": columns,
        "row_count": len(df),
        "header_row_index": header_row,
        "sample_data": sample_data,
        "candidate_rows": candidate_rows
    }


def generate_suggestions(
    master_columns: List[str],
    source_columns: List[str]
) -> Dict[str, List[Dict]]:
    """Generate column mapping suggestions using fuzzy matching."""

    suggestions = {}

    for master_col in master_columns:
        matches = []
        master_lower = master_col.lower()

        for source_col in source_columns:
            source_lower = source_col.lower()

            # Calculate similarity score
            ratio = fuzz.ratio(master_lower, source_lower) / 100
            partial = fuzz.partial_ratio(master_lower, source_lower) / 100
            token_sort = fuzz.token_sort_ratio(master_lower, source_lower) / 100

            # Weighted average
            score = (ratio * 0.3) + (partial * 0.4) + (token_sort * 0.3)

            # Boost exact substring matches
            if master_lower in source_lower or source_lower in master_lower:
                score = max(score, 0.7)

            if score > 0.4:
                matches.append({
                    "source_col": source_col,
                    "score": round(score, 2)
                })

        suggestions[master_col] = sorted(matches, key=lambda x: -x["score"])[:5]

    return suggestions


class MappingEntry(BaseModel):
    filename: str
    mapping: Dict[str, Optional[str]]


@router.post("/export")
async def export_mapping_matrix(
    master_columns: List[str],
    entries: List[MappingEntry]
):
    """Export the mapping matrix as an Excel file."""

    # Build matrix dataframe
    data = []
    for entry in entries:
        row = {"Source File": entry.filename}
        for mc in master_columns:
            row[mc] = entry.mapping.get(mc) or "—"
        data.append(row)

    df = pd.DataFrame(data)

    # Create Excel file
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        df.to_excel(writer, index=False, sheet_name='Column Mappings')

    output.seek(0)

    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=column_mappings.xlsx"}
    )
```

---

## UI Components

### Drag & Drop Source Column

```jsx
import { GripVertical, Check, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

function SourceColumnList({ columns, mappedColumns, sampleData, onShowTooltip, onHideTooltip }) {
  return (
    <div className="space-y-1.5 max-h-[500px] overflow-y-auto pr-2">
      {columns.map(srcCol => {
        const isUsed = mappedColumns.has(srcCol);
        const samples = sampleData?.[srcCol] || [];

        return (
          <div key={srcCol} className="flex items-center gap-1">
            <div
              draggable={!isUsed}
              onDragStart={(e) => {
                e.dataTransfer.setData('sourceCol', srcCol);
              }}
              className={cn(
                "flex-1 min-w-0 px-3 py-2 rounded-md border text-sm transition-all",
                isUsed
                  ? "opacity-40 cursor-not-allowed bg-muted border-muted"
                  : "cursor-grab bg-card border-border hover:shadow-md hover:border-primary/50 active:cursor-grabbing"
              )}
            >
              <span className="flex items-center gap-1.5">
                {!isUsed && <GripVertical className="w-3 h-3 text-muted-foreground shrink-0" />}
                {isUsed && <Check className="w-3 h-3 text-primary shrink-0" />}
                <span className="flex-1 truncate">{srcCol}</span>
              </span>
            </div>
            <button
              onMouseEnter={(e) => onShowTooltip(e, srcCol, samples)}
              onMouseLeave={onHideTooltip}
              className="shrink-0 p-1 rounded hover:bg-muted transition-colors"
            >
              <Info className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
```

### Master Column Drop Zone

```jsx
import { GripVertical, X } from 'lucide-react';
import { cn } from '@/lib/utils';

function MasterColumnDropZone({
  masterCol,
  mappedCol,
  sourceColumns,
  mappedSourceCols,
  suggestions,
  onMap,
  onUnmap
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 p-2.5 rounded-lg border-2 border-dashed transition-all",
        mappedCol
          ? "border-solid border-primary/30 bg-primary/5"
          : "border-border bg-muted/20"
      )}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const srcCol = e.dataTransfer.getData('sourceCol');
        if (srcCol) onMap(masterCol, srcCol);
      }}
    >
      {/* Master column name */}
      <span className="w-[180px] shrink-0 text-sm font-medium text-right truncate">
        {masterCol}
      </span>

      <span className="text-muted-foreground text-xs">←</span>

      {mappedCol ? (
        /* Mapped column chip */
        <div
          draggable
          onDragStart={(e) => e.dataTransfer.setData('sourceCol', mappedCol)}
          className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-1.5 rounded-full text-sm font-medium cursor-grab active:cursor-grabbing"
        >
          <GripVertical className="w-3 h-3" />
          {mappedCol}
          <button
            onClick={() => onUnmap(masterCol)}
            className="ml-1 hover:text-destructive transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        /* Dropdown + Suggestions */
        <div className="flex-1 flex flex-col gap-1">
          <select
            className="w-full px-2.5 py-1.5 border rounded-md text-sm bg-background"
            value=""
            onChange={(e) => e.target.value && onMap(masterCol, e.target.value)}
          >
            <option value="">-- Not Mapped --</option>
            {sourceColumns
              .sort((a, b) => (mappedSourceCols.has(a) ? 1 : 0) - (mappedSourceCols.has(b) ? 1 : 0))
              .map(srcCol => (
                <option key={srcCol} value={srcCol} disabled={mappedSourceCols.has(srcCol)}>
                  {srcCol}{mappedSourceCols.has(srcCol) ? ' (used)' : ''}
                </option>
              ))
            }
          </select>

          {/* Quick suggestion badges */}
          {suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {suggestions.map(({ type, sourceCol }) => (
                <button
                  key={sourceCol}
                  onClick={() => onMap(masterCol, sourceCol)}
                  className={cn(
                    "px-2 py-0.5 rounded-full text-xs font-medium transition-all hover:scale-105",
                    type === 'exact' && "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
                    type === 'learned' && "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
                    type === 'fuzzy' && "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                  )}
                >
                  {sourceCol}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

### Suggestion Badge Types

```jsx
// Generate suggestions for a master column
const getSuggestions = (sheetColumns, masterCol, filename) => {
  const suggestions = [];
  const fileMap = fileMappings[filename] || {};
  const mappedSources = new Set(Object.values(fileMap).filter(Boolean));

  // 1. Exact name match (green)
  if (sheetColumns.includes(masterCol) && !mappedSources.has(masterCol)) {
    suggestions.push({ type: 'exact', sourceCol: masterCol });
  }

  // 2. Learned mapping from other files (blue)
  const learnedEntry = Object.entries(learnedMappings).find(
    ([srcCol, mappedMaster]) => mappedMaster === masterCol
  );
  if (learnedEntry && sheetColumns.includes(learnedEntry[0]) &&
      learnedEntry[0] !== masterCol && !mappedSources.has(learnedEntry[0])) {
    suggestions.push({ type: 'learned', sourceCol: learnedEntry[0] });
  }

  // 3. Fuzzy matches (gray)
  sheetColumns.forEach(srcCol => {
    if (mappedSources.has(srcCol)) return;
    if (srcCol === masterCol) return;
    if (learnedEntry && srcCol === learnedEntry[0]) return;

    const srcLower = srcCol.toLowerCase();
    const masterLower = masterCol.toLowerCase();

    if (srcLower === masterLower ||
        (masterLower.length > 2 && (srcLower.includes(masterLower) || masterLower.includes(srcLower)))) {
      suggestions.push({ type: 'fuzzy', sourceCol: srcCol });
    }
  });

  return suggestions;
};
```

### Header Row Selector

```jsx
function HeaderRowSelector({ candidateRows, currentHeaderRow, onChange, loading }) {
  if (candidateRows.length <= 1) return null;

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground whitespace-nowrap">Header row:</span>
      <select
        value={currentHeaderRow}
        onChange={(e) => onChange(parseInt(e.target.value))}
        className="flex-1 px-2 py-1 border rounded text-xs bg-background max-w-md"
        disabled={loading}
      >
        {candidateRows.map((row, ri) => {
          const preview = row.filter(v => v).slice(0, 4).join(', ');
          const truncated = preview.length > 60 ? preview.slice(0, 60) + '...' : preview;
          return (
            <option key={ri} value={ri}>
              Row {ri + 1}{ri === currentHeaderRow ? ' (detected)' : ''}: {truncated}
            </option>
          );
        })}
      </select>
      {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
    </div>
  );
}
```

### Sample Data Tooltip

```jsx
import { createPortal } from 'react-dom';

function SampleDataTooltip({ tooltip }) {
  if (!tooltip) return null;

  return createPortal(
    <div
      className="fixed z-[9999] pointer-events-none"
      style={{
        left: tooltip.x,
        top: tooltip.y,
        transform: 'translate(-50%, -100%)',
      }}
    >
      <div className="mb-2 w-56 bg-popover border rounded-lg shadow-xl p-2.5 text-left">
        <div className="text-xs font-semibold mb-1.5 text-foreground truncate">
          Sample: {tooltip.colName}
        </div>
        {tooltip.values.length > 0 ? (
          <div className="space-y-1">
            {tooltip.values.map((val, i) => (
              <div
                key={i}
                className="text-xs text-muted-foreground bg-muted/50 px-2 py-0.5 rounded truncate"
                title={val}
              >
                {val}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground italic">No sample data</div>
        )}
      </div>
    </div>,
    document.body
  );
}

// Usage with state
const [tooltip, setTooltip] = useState(null);

const showTooltip = useCallback((e, colName, values) => {
  const rect = e.currentTarget.getBoundingClientRect();
  setTooltip({
    colName,
    values: values || [],
    x: rect.left + rect.width / 2,
    y: rect.top,
  });
}, []);

const hideTooltip = useCallback(() => setTooltip(null), []);
```

---

## Smart Features

### 1. Learned Mappings

When a user maps "Supplier" → "Vendor Name" in one file, automatically apply this mapping to other files that also have a "Supplier" column.

### 2. Suggestion Scoring

Priority order for suggestions:
1. **Exact match** (score: 1.0) - Column names are identical
2. **Learned** (from other files) - User previously mapped this
3. **Fuzzy match** (score: 0.4-0.9) - Similar names via fuzzy matching

### 3. Prevent Duplicate Mappings

- Each source column can only map to ONE master column
- When a source column is mapped, it's greyed out in the list
- Dropdown shows "(used)" next to already-mapped columns

### 4. Header Row Detection

- Auto-detect header row (first row with mostly string values)
- Allow user to override if detection is wrong
- Re-run suggestions when header row changes

---

## Checklist for Implementation

### Frontend
- [ ] Master columns upload and display
- [ ] Multi-file upload with drag & drop
- [ ] Sheet selector for multi-sheet Excel files
- [ ] Header row selector with preview
- [ ] Drag & drop mapping interface
- [ ] Dropdown fallback for mapping
- [ ] Suggestion badges (exact, learned, fuzzy)
- [ ] Sample data tooltips on hover
- [ ] Learned mappings propagation
- [ ] Mapping matrix preview
- [ ] Export functionality

### Backend
- [ ] File parsing endpoint (Excel/CSV)
- [ ] Column suggestion generation
- [ ] Mapping matrix export
- [ ] (Optional) Save/load mapping templates
