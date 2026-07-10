# Python Packages Standard

This guide defines the standard Python packages for all Arcline backend applications. Every application should use these packages to ensure consistency, reliability, and maintainability across projects.

---

## Quick Start for Claude

When setting up a new backend:

1. Create the `backend/` directory
2. Create a Python virtual environment
3. Create `requirements.txt` with the packages below
4. Install all dependencies

```bash
cd backend
python -m venv venv

# Activate (Windows)
venv\Scripts\activate

# Activate (macOS/Linux)
source venv/bin/activate

# Install packages
pip install -r requirements.txt
```

---

## Table of Contents

- [Complete Requirements File](#complete-requirements-file)
- [Package Categories](#package-categories)
- [Package Details](#package-details)
- [Virtual Environment Setup](#virtual-environment-setup)
- [Version Pinning Strategy](#version-pinning-strategy)
- [Adding New Packages](#adding-new-packages)

---

## Complete Requirements File

Copy this entire block to `backend/requirements.txt`:

```txt
# ============================================================
# Arcline Standard Python Packages
# ============================================================

# ----------------------------------------
# Web Framework (FastAPI)
# ----------------------------------------
fastapi==0.109.0
uvicorn==0.27.0
pydantic==2.5.3
pydantic-settings==2.1.0
python-multipart==0.0.6

# ----------------------------------------
# Data Processing
# ----------------------------------------
pandas==2.1.3
numpy==1.26.2
openpyxl==3.1.2
xlsxwriter==3.1.9

# ----------------------------------------
# Visualization
# ----------------------------------------
matplotlib==3.8.2
plotly==5.18.0
kaleido==0.2.1

# ----------------------------------------
# Authentication & Security
# ----------------------------------------
PyJWT==2.8.0
cryptography==41.0.7

# ----------------------------------------
# HTTP & Networking
# ----------------------------------------
requests==2.31.0
httpx==0.26.0

# ----------------------------------------
# Utilities
# ----------------------------------------
python-dotenv==1.0.0

# ----------------------------------------
# Production Server
# ----------------------------------------
gunicorn==21.2.0

# ----------------------------------------
# Development & Testing (optional)
# ----------------------------------------
pytest==7.4.3
pytest-asyncio==0.23.2
black==23.12.1
ruff==0.1.9
```

---

## Package Categories

### 1. Web Framework

| Package | Purpose |
|---------|---------|
| `fastapi` | Modern, fast web framework for building APIs |
| `uvicorn` | ASGI server to run FastAPI applications |
| `pydantic` | Data validation using Python type annotations |
| `pydantic-settings` | Settings management with environment variables |
| `python-multipart` | File upload support in FastAPI |

### 2. Data Processing

| Package | Purpose |
|---------|---------|
| `pandas` | Data manipulation and analysis |
| `numpy` | Numerical computing foundation |
| `openpyxl` | Read Excel files (.xlsx) |
| `xlsxwriter` | Write Excel files with formatting |

### 3. Visualization

| Package | Purpose |
|---------|---------|
| `matplotlib` | Static charts and graphs |
| `plotly` | Interactive charts for web |
| `kaleido` | Export Plotly charts as images |

### 4. Authentication & Security

| Package | Purpose |
|---------|---------|
| `PyJWT` | JSON Web Token handling |
| `cryptography` | Cryptographic operations |

### 5. HTTP & Networking

| Package | Purpose |
|---------|---------|
| `requests` | Simple HTTP requests |
| `httpx` | Modern async HTTP client |

### 6. Utilities

| Package | Purpose |
|---------|---------|
| `python-dotenv` | Load environment variables from .env files |

### 7. Production

| Package | Purpose |
|---------|---------|
| `gunicorn` | Production WSGI/ASGI server |

---

## Package Details

### FastAPI Stack

```python
# FastAPI - Main web framework
from fastapi import FastAPI, HTTPException, Depends, status
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="My API", version="1.0.0")

# Pydantic - Request/Response validation
from pydantic import BaseModel, Field

class Item(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    price: float = Field(..., gt=0)

# Pydantic Settings - Configuration
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    api_key: str
    database_url: str

    class Config:
        env_file = ".env"

# Uvicorn - Running the server
# uvicorn app.main:app --reload --port 8000
```

### Pandas & Data Processing

```python
import pandas as pd
import numpy as np

# Read Excel file
df = pd.read_excel("data.xlsx", engine="openpyxl")

# Data manipulation
df_filtered = df[df["revenue"] > 1000]
df_grouped = df.groupby("category").agg({
    "revenue": "sum",
    "quantity": "mean"
})

# Write Excel with formatting
with pd.ExcelWriter("output.xlsx", engine="xlsxwriter") as writer:
    df.to_excel(writer, sheet_name="Data", index=False)

    # Access xlsxwriter workbook for formatting
    workbook = writer.book
    worksheet = writer.sheets["Data"]

    # Add number format
    money_fmt = workbook.add_format({"num_format": "$#,##0.00"})
    worksheet.set_column("B:B", 12, money_fmt)
```

### Matplotlib (Static Charts)

```python
import matplotlib.pyplot as plt
import io
import base64

# Create a chart
fig, ax = plt.subplots(figsize=(10, 6))
ax.bar(categories, values, color="#234948")
ax.set_title("Sales by Category")
ax.set_xlabel("Category")
ax.set_ylabel("Sales ($)")

# Save to bytes for API response
buf = io.BytesIO()
plt.savefig(buf, format="png", dpi=150, bbox_inches="tight")
buf.seek(0)
plt.close()

# Convert to base64 for JSON response
image_base64 = base64.b64encode(buf.read()).decode("utf-8")
```

### Plotly (Interactive Charts)

```python
import plotly.express as px
import plotly.graph_objects as go

# Create interactive chart
fig = px.bar(
    df,
    x="category",
    y="revenue",
    color="region",
    title="Revenue by Category and Region"
)

# Customize with Arcline colors
fig.update_layout(
    template="plotly_white",
    colorway=["#234948", "#C9E5E4", "#8CB4AB", "#3d7c79"],
    font_family="Inter",
)

# Export as JSON for frontend
chart_json = fig.to_json()

# Export as static image (requires kaleido)
fig.write_image("chart.png", scale=2)
```

### JWT Authentication

```python
import jwt
from jwt import PyJWKClient
from datetime import datetime, timedelta

# Decode and validate token
jwks_client = PyJWKClient(
    f"https://login.microsoftonline.com/{tenant_id}/discovery/v2.0/keys"
)

signing_key = jwks_client.get_signing_key_from_jwt(token)

decoded = jwt.decode(
    token,
    signing_key.key,
    algorithms=["RS256"],
    audience=client_id,
    issuer=f"https://login.microsoftonline.com/{tenant_id}/v2.0"
)

user_id = decoded.get("oid")
username = decoded.get("preferred_username")
```

### HTTP Requests

```python
import requests
import httpx

# Synchronous requests
response = requests.get(
    "https://api.example.com/data",
    headers={"Authorization": f"Bearer {token}"}
)
data = response.json()

# Async requests with httpx
async with httpx.AsyncClient() as client:
    response = await client.get(
        "https://api.example.com/data",
        headers={"Authorization": f"Bearer {token}"}
    )
    data = response.json()
```

### Environment Variables

```python
from dotenv import load_dotenv
import os

# Load .env file
load_dotenv()

# Access variables
database_url = os.getenv("DATABASE_URL")
api_key = os.getenv("API_KEY")

# With default values
debug = os.getenv("DEBUG", "false").lower() == "true"
```

---

## Virtual Environment Setup

### Windows

```bash
# Navigate to backend directory
cd backend

# Create virtual environment
python -m venv venv

# Activate
venv\Scripts\activate

# Verify activation (should show venv path)
where python

# Install packages
pip install -r requirements.txt

# Deactivate when done
deactivate
```

### macOS / Linux

```bash
# Navigate to backend directory
cd backend

# Create virtual environment
python3 -m venv venv

# Activate
source venv/bin/activate

# Verify activation
which python

# Install packages
pip install -r requirements.txt

# Deactivate when done
deactivate
```

### VS Code Integration

Create `.vscode/settings.json` in your project:

```json
{
  "python.defaultInterpreterPath": "${workspaceFolder}/backend/venv/Scripts/python.exe",
  "python.terminal.activateEnvironment": true
}
```

For macOS/Linux, use:
```json
{
  "python.defaultInterpreterPath": "${workspaceFolder}/backend/venv/bin/python"
}
```

---

## Version Pinning Strategy

### Why Pin Versions?

- **Reproducibility**: Same versions across all environments
- **Stability**: Avoid unexpected breaking changes
- **Security**: Controlled updates after testing

### How to Update Packages

1. **Create a test branch**
   ```bash
   git checkout -b update-packages
   ```

2. **Update specific package**
   ```bash
   pip install --upgrade pandas
   pip freeze | grep pandas  # Check new version
   ```

3. **Test thoroughly**
   ```bash
   pytest
   ```

4. **Update requirements.txt with new version**

5. **Merge after testing passes**

### Checking for Updates

```bash
# List outdated packages
pip list --outdated

# Check for security vulnerabilities
pip install pip-audit
pip-audit
```

---

## Adding New Packages

### Before Adding a Package

Ask these questions:

1. **Is it necessary?** Can we achieve this with existing packages?
2. **Is it maintained?** Check GitHub stars, recent commits, issues
3. **Is it secure?** Check for known vulnerabilities
4. **Is it compatible?** Will it work with our Python version and other packages?

### Adding Process

1. **Install and test locally**
   ```bash
   pip install new-package
   # Test your code
   ```

2. **Pin the version**
   ```bash
   pip show new-package  # Get exact version
   ```

3. **Add to requirements.txt with comment**
   ```txt
   # PDF Generation
   reportlab==4.0.8
   ```

4. **Document usage** in code or README

### Common Additional Packages

| Use Case | Package | Command |
|----------|---------|---------|
| PDF generation | `reportlab` | `pip install reportlab` |
| Email sending | `sendgrid` | `pip install sendgrid` |
| AWS integration | `boto3` | `pip install boto3` |
| Azure integration | `azure-storage-blob` | `pip install azure-storage-blob` |
| Date handling | `python-dateutil` | `pip install python-dateutil` |
| Timezone handling | `pytz` | `pip install pytz` |
| JSON Schema | `jsonschema` | `pip install jsonschema` |
| YAML parsing | `pyyaml` | `pip install pyyaml` |
| Image processing | `pillow` | `pip install pillow` |
| Scientific computing | `scipy` | `pip install scipy` |
| Machine learning | `scikit-learn` | `pip install scikit-learn` |

---

## Troubleshooting

### Package Installation Fails

```bash
# Upgrade pip first
pip install --upgrade pip

# Try installing with no cache
pip install --no-cache-dir package-name

# On Windows, if build fails
pip install --only-binary :all: package-name
```

### Version Conflicts

```bash
# Check what's installed
pip list

# Check dependencies of a package
pip show package-name

# Force reinstall
pip install --force-reinstall package-name==version
```

### Virtual Environment Issues

```bash
# Delete and recreate
rm -rf venv  # or rmdir /s venv on Windows
python -m venv venv
source venv/bin/activate  # or venv\Scripts\activate
pip install -r requirements.txt
```

---

## Checklist for New Projects

- [ ] Created `backend/` directory
- [ ] Created virtual environment (`python -m venv venv`)
- [ ] Activated virtual environment
- [ ] Created `requirements.txt` with standard packages
- [ ] Installed all packages (`pip install -r requirements.txt`)
- [ ] Verified installation (`pip list`)
- [ ] Added `venv/` to `.gitignore`
- [ ] Tested that imports work correctly
