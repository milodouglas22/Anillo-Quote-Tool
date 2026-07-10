# Excel Output Formatting Pattern

This document provides a standardized pattern for generating Excel files with consistent, professional styling. It replaces the default pandas Excel output with clean formatting using xlsxwriter.

---

## Table of Contents

- [Overview](#overview)
- [Key Styling Rules](#key-styling-rules)
- [Backend Implementation](#backend-implementation)
  - [Basic Setup](#basic-setup)
  - [Standard Format Definitions](#standard-format-definitions)
  - [Writing Data with Formatting](#writing-data-with-formatting)
  - [Number Format Reference](#number-format-reference)
- [Complete Example](#complete-example)
- [Checklist](#checklist)

---

## Overview

By default, pandas writes Excel files with:
- Visible gridlines
- Calibri font (Excel default)
- Basic number formatting

This pattern standardizes output to:
- **Font**: Century Gothic, size 10
- **Gridlines**: Hidden
- **Engine**: xlsxwriter (for full formatting control)
- **Clean styling**: No cell borders unless intentional

---

## Key Styling Rules

| Element | Style |
|---------|-------|
| Font | Century Gothic |
| Font Size | 10 (14 for titles) |
| Gridlines | Hidden |
| Numbers | Comma-separated with proper negatives |
| Currency | Dollar sign with comma separators |
| Percentages | Whole number with % symbol |
| Alignment | Numbers right-aligned, text left-aligned |

---

## Backend Implementation

### Basic Setup

Use xlsxwriter as the Excel engine instead of the default openpyxl:

```python
import pandas as pd
import io

def create_excel_output(dataframe: pd.DataFrame, sheet_name: str = "Sheet1") -> bytes:
    """
    Create a formatted Excel file from a DataFrame.

    Args:
        dataframe: The data to write
        sheet_name: Name of the worksheet

    Returns:
        Excel file as bytes
    """
    output = io.BytesIO()

    with pd.ExcelWriter(
        output,
        engine='xlsxwriter',
        engine_kwargs={'options': {'nan_inf_to_errors': True}}
    ) as writer:

        workbook = writer.book
        worksheet = workbook.add_worksheet(sheet_name)

        # Hide gridlines (2 = hide both screen and printed gridlines)
        worksheet.hide_gridlines(2)

        # Define formats and write data here...

    output.seek(0)
    return output.getvalue()
```

### Standard Format Definitions

Create a helper function that returns all standard formats:

```python
def get_standard_formats(workbook):
    """
    Create standard format definitions for consistent Excel styling.

    Args:
        workbook: xlsxwriter Workbook object

    Returns:
        Dictionary of format objects
    """
    base_font = {
        'font_name': 'Century Gothic',
        'font_size': 10
    }

    formats = {
        # Basic text format
        'text': workbook.add_format({
            **base_font
        }),

        # Bold text
        'bold': workbook.add_format({
            **base_font,
            'bold': True
        }),

        # Title format (larger, bold)
        'title': workbook.add_format({
            'font_name': 'Century Gothic',
            'font_size': 14,
            'bold': True
        }),

        # Header format (bold, underlined, centered)
        'header': workbook.add_format({
            **base_font,
            'bold': True,
            'underline': 33,  # Double accounting underline
            'align': 'center',
            'valign': 'vcenter'
        }),

        # Number format (with comma separators)
        'number': workbook.add_format({
            **base_font,
            'num_format': '#,##0_);(#,##0)',
            'align': 'right'
        }),

        # Number with decimals
        'number_decimal': workbook.add_format({
            **base_font,
            'num_format': '#,##0.00_);(#,##0.00)',
            'align': 'right'
        }),

        # Currency format
        'currency': workbook.add_format({
            **base_font,
            'num_format': '$#,##0_);($#,##0)',
            'align': 'right'
        }),

        # Currency with decimals
        'currency_decimal': workbook.add_format({
            **base_font,
            'num_format': '$#,##0.00_);($#,##0.00)',
            'align': 'right'
        }),

        # Percentage format
        'percent': workbook.add_format({
            **base_font,
            'num_format': '0%',
            'align': 'right'
        }),

        # Percentage with decimals
        'percent_decimal': workbook.add_format({
            **base_font,
            'num_format': '0.00%',
            'align': 'right'
        }),

        # Date format
        'date': workbook.add_format({
            **base_font,
            'num_format': 'yyyy-mm-dd',
            'align': 'center'
        }),
    }

    return formats
```

### Writing Data with Formatting

Write data cell by cell to apply proper formatting:

```python
def write_dataframe_formatted(worksheet, dataframe, formats, start_row=0, start_col=0, include_header=True):
    """
    Write a DataFrame to a worksheet with proper formatting.

    Args:
        worksheet: xlsxwriter Worksheet object
        dataframe: pandas DataFrame to write
        formats: Dictionary of format objects from get_standard_formats()
        start_row: Starting row (0-indexed)
        start_col: Starting column (0-indexed)
        include_header: Whether to write column headers
    """
    current_row = start_row

    # Write headers
    if include_header:
        for col_idx, col_name in enumerate(dataframe.columns):
            worksheet.write(current_row, start_col + col_idx, col_name, formats['header'])
        current_row += 1

    # Write data rows
    for row_idx, row in dataframe.iterrows():
        for col_idx, (col_name, value) in enumerate(row.items()):
            excel_col = start_col + col_idx

            # Determine format based on value type or column name
            cell_format = get_cell_format(value, col_name, formats)

            # Handle NaN/None values
            if pd.isna(value):
                worksheet.write_blank(current_row, excel_col, None, cell_format)
            else:
                worksheet.write(current_row, excel_col, value, cell_format)

        current_row += 1

    return current_row  # Return next available row


def get_cell_format(value, column_name: str, formats: dict):
    """
    Determine the appropriate format for a cell based on its value and column name.

    Args:
        value: The cell value
        column_name: Name of the column
        formats: Dictionary of format objects

    Returns:
        Appropriate format object
    """
    col_lower = column_name.lower()

    # Check column name hints
    if any(hint in col_lower for hint in ['price', 'cost', 'revenue', 'amount', 'total', '$']):
        return formats['currency']

    if any(hint in col_lower for hint in ['percent', 'rate', 'margin', '%']):
        return formats['percent']

    if any(hint in col_lower for hint in ['date', 'time']):
        return formats['date']

    # Check value type
    if isinstance(value, (int, float)):
        return formats['number']

    return formats['text']
```

### Number Format Reference

Common Excel number format strings for xlsxwriter:

```python
NUMBER_FORMATS = {
    # Basic numbers
    'integer': '#,##0',
    'decimal_1': '#,##0.0',
    'decimal_2': '#,##0.00',

    # With negative handling (negatives in parentheses)
    'integer_neg': '#,##0_);(#,##0)',
    'decimal_neg': '#,##0.00_);(#,##0.00)',

    # Currency
    'currency': '$#,##0',
    'currency_neg': '$#,##0_);($#,##0)',
    'currency_decimal': '$#,##0.00_);($#,##0.00)',

    # Scaled numbers (K = thousands, M = millions)
    'thousands': '#,##0,_);(#,##0,)',           # Displays 1000 as 1
    'millions': '#,##0,,_);(#,##0,,)',          # Displays 1000000 as 1
    'currency_thousands': '$#,##0,_);($#,##0,)',
    'currency_millions': '$#,##0,,_);($#,##0,,)',

    # Percentages
    'percent': '0%',
    'percent_decimal': '0.0%',
    'percent_decimal_2': '0.00%',

    # Dates
    'date_iso': 'yyyy-mm-dd',
    'date_us': 'mm/dd/yyyy',
    'date_short': 'm/d/yy',
    'datetime': 'yyyy-mm-dd hh:mm:ss',
}
```

---

## Complete Example

Full example of creating a formatted Excel report:

```python
import pandas as pd
import io
from typing import Optional

def create_formatted_report(
    data: pd.DataFrame,
    title: Optional[str] = None,
    sheet_name: str = "Report"
) -> bytes:
    """
    Create a professionally formatted Excel report.

    Args:
        data: DataFrame containing the report data
        title: Optional title to display at top of sheet
        sheet_name: Name for the worksheet

    Returns:
        Excel file as bytes
    """
    output = io.BytesIO()

    with pd.ExcelWriter(
        output,
        engine='xlsxwriter',
        engine_kwargs={'options': {'nan_inf_to_errors': True}}
    ) as writer:

        workbook = writer.book
        worksheet = workbook.add_worksheet(sheet_name)

        # Hide gridlines
        worksheet.hide_gridlines(2)

        # Get standard formats
        formats = get_standard_formats(workbook)

        current_row = 0

        # Write title if provided
        if title:
            worksheet.write(current_row, 0, title, formats['title'])
            current_row += 2  # Leave a blank row after title

        # Write the data
        current_row = write_dataframe_formatted(
            worksheet=worksheet,
            dataframe=data,
            formats=formats,
            start_row=current_row,
            start_col=0,
            include_header=True
        )

        # Auto-fit column widths (approximate)
        for col_idx, col_name in enumerate(data.columns):
            # Calculate width based on header and data
            max_len = len(str(col_name))
            for value in data[col_name]:
                if pd.notna(value):
                    max_len = max(max_len, len(str(value)))

            # Add padding and set width (max 50 to prevent extremely wide columns)
            worksheet.set_column(col_idx, col_idx, min(max_len + 2, 50))

    output.seek(0)
    return output.getvalue()


# Usage in FastAPI endpoint
from fastapi import APIRouter
from fastapi.responses import Response

router = APIRouter()

@router.get("/export")
async def export_data():
    # Get your data
    df = pd.DataFrame({
        'Product': ['Widget A', 'Widget B', 'Widget C'],
        'Revenue': [150000, 230000, 89000],
        'Quantity': [1500, 2300, 890],
        'Margin': [0.35, 0.42, 0.28]
    })

    # Generate formatted Excel
    excel_bytes = create_formatted_report(
        data=df,
        title="Sales Report",
        sheet_name="Sales"
    )

    return Response(
        content=excel_bytes,
        media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        headers={
            'Content-Disposition': 'attachment; filename="report.xlsx"'
        }
    )
```

---

## Checklist

### Setup
- [ ] Installed `xlsxwriter` package (`pip install xlsxwriter`)
- [ ] Using `pd.ExcelWriter` with `engine='xlsxwriter'`
- [ ] Set `nan_inf_to_errors: True` in engine kwargs

### Formatting
- [ ] All cells use Century Gothic font, size 10
- [ ] Gridlines hidden with `worksheet.hide_gridlines(2)`
- [ ] Numbers have comma separators
- [ ] Currency values have `$` prefix
- [ ] Percentages display with `%` symbol
- [ ] Negative numbers in parentheses (accounting style)

### Output
- [ ] File returned as bytes with proper MIME type
- [ ] Content-Disposition header set for download
- [ ] Sheet name is descriptive
