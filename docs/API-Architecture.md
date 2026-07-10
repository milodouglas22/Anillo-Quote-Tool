# API Architecture Guide

A comprehensive guide for building REST APIs with FastAPI that can be consumed by both the React frontend and external services with proper authentication.

---

## Quick Start for Claude

When implementing API endpoints:

1. Create a new router file in `backend/app/routers/`
2. Define Pydantic models for requests and responses
3. Add authentication using the `get_current_user` dependency
4. Register the router in `main.py`
5. Update the frontend `ApiService.js` with new methods

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [REST API Conventions](#rest-api-conventions)
- [Router Structure](#router-structure)
- [Pydantic Models](#pydantic-models)
- [Authentication Integration](#authentication-integration)
- [Error Handling](#error-handling)
- [File Upload Handling](#file-upload-handling)
- [Background Jobs](#background-jobs)
- [Frontend API Client](#frontend-api-client)
- [External Service Access](#external-service-access)
- [CORS Configuration](#cors-configuration)

---

## Architecture Overview

The API follows a stateless REST architecture where:

1. **Backend is the API Gateway** - Standalone REST API server
2. **Frontend is a Consumer** - Separate React application calling the API
3. **External Access** - Any authorized client can call the same endpoints
4. **Token-Based Auth** - JWT bearer tokens authenticate all requests

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   React SPA     │     │  External App   │     │  Mobile App     │
│   (Frontend)    │     │  (Backend-to-   │     │  (Future)       │
│                 │     │   Backend)      │     │                 │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         │  Bearer Token         │  Bearer Token         │  Bearer Token
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
                                 ▼
                    ┌────────────────────────┐
                    │   FastAPI Backend      │
                    │   (REST API Server)    │
                    │                        │
                    │  • CORS configured     │
                    │  • JWT validation      │
                    │  • RBAC enforcement    │
                    └────────────────────────┘
```

---

## REST API Conventions

### URL Structure

```
/api/{resource}                    # Collection
/api/{resource}/{id}               # Single item
/api/{resource}/{id}/{sub-resource}  # Nested resource
```

### HTTP Methods

| Method | Usage | Example |
|--------|-------|---------|
| `GET` | Retrieve resource(s) | `GET /api/users` |
| `POST` | Create new resource | `POST /api/users` |
| `PUT` | Replace entire resource | `PUT /api/users/123` |
| `PATCH` | Partial update | `PATCH /api/users/123` |
| `DELETE` | Remove resource | `DELETE /api/users/123` |

### Status Codes

| Code | Meaning | When to Use |
|------|---------|-------------|
| `200` | OK | Successful GET, PUT, PATCH |
| `201` | Created | Successful POST |
| `204` | No Content | Successful DELETE |
| `400` | Bad Request | Invalid input data |
| `401` | Unauthorized | Missing/invalid auth token |
| `403` | Forbidden | Authenticated but not authorized |
| `404` | Not Found | Resource doesn't exist |
| `422` | Unprocessable Entity | Validation error |
| `500` | Internal Server Error | Unexpected server error |

### Naming Conventions

- Use **kebab-case** for URLs: `/api/sku-datacut`
- Use **snake_case** for JSON keys: `{ "user_name": "John" }`
- Use **plural nouns** for collections: `/api/users`, not `/api/user`
- Use **verbs** only for actions: `/api/jobs/{id}/cancel`

---

## Router Structure

### Creating a New Router

```python
# backend/app/routers/items.py
from fastapi import APIRouter, Depends, HTTPException, status
from typing import List

from ..core.security import get_current_user
from ..models.user import CurrentUser
from ..models.items import Item, ItemCreate, ItemUpdate

router = APIRouter()


@router.get("", response_model=List[Item])
async def list_items(
    current_user: CurrentUser = Depends(get_current_user),
):
    """List all items for the authenticated user."""
    items = get_items_for_user(current_user.oid)
    return items


@router.post("", response_model=Item, status_code=status.HTTP_201_CREATED)
async def create_item(
    data: ItemCreate,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Create a new item."""
    item = create_item_in_db(current_user.oid, data)
    return item


@router.get("/{item_id}", response_model=Item)
async def get_item(
    item_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Get a specific item by ID."""
    item = get_item_by_id(item_id)

    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    if item.user_id != current_user.oid:
        raise HTTPException(status_code=403, detail="Not authorized")

    return item


@router.patch("/{item_id}", response_model=Item)
async def update_item(
    item_id: str,
    data: ItemUpdate,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Update an item."""
    item = get_item_by_id(item_id)

    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    if item.user_id != current_user.oid:
        raise HTTPException(status_code=403, detail="Not authorized")

    updated = update_item_in_db(item_id, data)
    return updated


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_item(
    item_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Delete an item."""
    item = get_item_by_id(item_id)

    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    if item.user_id != current_user.oid:
        raise HTTPException(status_code=403, detail="Not authorized")

    delete_item_from_db(item_id)
    return None
```

### Registering the Router

```python
# backend/app/main.py
from .routers import health, items

# Register routers
app.include_router(health.router, tags=["health"])
app.include_router(items.router, prefix="/api/items", tags=["items"])
```

---

## Pydantic Models

### Request/Response Models

```python
# backend/app/models/items.py
from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime
from uuid import UUID


class ItemBase(BaseModel):
    """Shared properties."""
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=500)


class ItemCreate(ItemBase):
    """Properties to receive on creation."""
    category: str


class ItemUpdate(BaseModel):
    """Properties to receive on update (all optional)."""
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    category: Optional[str] = None
    status: Optional[str] = None


class Item(ItemBase):
    """Properties to return to client."""
    id: UUID
    user_id: str
    category: str
    status: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True  # Enable ORM mode
```

### Common Response Models

```python
# backend/app/models/common.py
from pydantic import BaseModel
from typing import Optional, List, Any


class MessageResponse(BaseModel):
    """Simple message response."""
    message: str


class ErrorResponse(BaseModel):
    """Error response."""
    detail: str
    code: Optional[str] = None


class PaginatedResponse(BaseModel):
    """Paginated list response."""
    items: List[Any]
    total: int
    page: int
    page_size: int
    total_pages: int


class JobResponse(BaseModel):
    """Background job response."""
    job_id: str
    status: str  # "queued", "running", "completed", "failed"
    progress: Optional[int] = None
    error: Optional[str] = None
    result: Optional[Any] = None
```

---

## Authentication Integration

### Protected Endpoints (Required Auth)

```python
from ..core.security import get_current_user
from ..models.user import CurrentUser

@router.get("/protected")
async def protected_endpoint(
    current_user: CurrentUser = Depends(get_current_user),
):
    """This endpoint requires authentication."""
    return {"user": current_user.username}
```

### Optional Auth Endpoints

```python
from ..core.security import get_current_user_optional

@router.get("/public")
async def public_endpoint(
    current_user: CurrentUser | None = Depends(get_current_user_optional),
):
    """This endpoint works for both authenticated and anonymous users."""
    if current_user:
        return {"message": f"Hello, {current_user.name}!"}
    return {"message": "Hello, anonymous user!"}
```

### Group-Based Authorization

```python
from ..core.config import settings

@router.get("/admin")
async def admin_endpoint(
    current_user: CurrentUser = Depends(get_current_user),
):
    """This endpoint requires admin group membership."""
    admin_group_id = "your-admin-group-id"

    if admin_group_id not in current_user.groups:
        raise HTTPException(
            status_code=403,
            detail="Admin access required"
        )

    return {"message": "Admin content"}
```

---

## Error Handling

### Standard Error Responses

```python
from fastapi import HTTPException, status

# 400 - Bad Request
raise HTTPException(
    status_code=status.HTTP_400_BAD_REQUEST,
    detail="Invalid input: name cannot be empty"
)

# 401 - Unauthorized
raise HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Authentication required",
    headers={"WWW-Authenticate": "Bearer"}
)

# 403 - Forbidden
raise HTTPException(
    status_code=status.HTTP_403_FORBIDDEN,
    detail="You don't have permission to access this resource"
)

# 404 - Not Found
raise HTTPException(
    status_code=status.HTTP_404_NOT_FOUND,
    detail=f"Item with ID {item_id} not found"
)

# 422 - Validation Error (automatic from Pydantic)
# FastAPI handles this automatically

# 500 - Internal Server Error
raise HTTPException(
    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
    detail="An unexpected error occurred"
)
```

### Global Exception Handler

```python
# backend/app/main.py
from fastapi import Request
from fastapi.responses import JSONResponse

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Handle unexpected exceptions."""
    logger.error(f"Unexpected error: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "An internal error occurred"}
    )
```

---

## File Upload Handling

### Single File Upload

```python
from fastapi import UploadFile, File
import shutil
import uuid

@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Upload a single file."""
    # Validate file type
    allowed_types = [".xlsx", ".csv", ".xls"]
    file_ext = os.path.splitext(file.filename)[1].lower()

    if file_ext not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail=f"File type not allowed. Allowed: {allowed_types}"
        )

    # Generate unique filename
    unique_id = str(uuid.uuid4())
    filename = f"{unique_id}{file_ext}"
    filepath = os.path.join(UPLOAD_FOLDER, filename)

    # Save file
    with open(filepath, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    return {
        "file_id": unique_id,
        "filename": file.filename,
        "size": os.path.getsize(filepath)
    }
```

### Multiple File Upload

```python
from typing import List

@router.post("/upload-multiple")
async def upload_multiple_files(
    files: List[UploadFile] = File(...),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Upload multiple files."""
    results = []

    for file in files:
        # Process each file
        unique_id = str(uuid.uuid4())
        filename = f"{unique_id}_{file.filename}"
        filepath = os.path.join(UPLOAD_FOLDER, filename)

        with open(filepath, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        results.append({
            "file_id": unique_id,
            "filename": file.filename
        })

    return {"files": results}
```

### File Download

```python
from fastapi.responses import FileResponse

@router.get("/download/{file_id}")
async def download_file(
    file_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Download a file."""
    # Find file (implement your logic)
    filepath = find_file_by_id(file_id)

    if not filepath or not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(
        path=filepath,
        filename=os.path.basename(filepath),
        media_type="application/octet-stream"
    )
```

---

## Background Jobs

### Job Pattern for Long-Running Tasks

```python
# backend/app/models/jobs.py
from pydantic import BaseModel
from typing import Optional, Any
from enum import Enum


class JobStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class JobCreateResponse(BaseModel):
    job_id: str


class JobStatusResponse(BaseModel):
    job_id: str
    status: JobStatus
    progress: Optional[int] = None
    error: Optional[str] = None
    output_file: Optional[str] = None
```

```python
# backend/app/routers/jobs.py
import threading
import uuid

# In-memory job storage (use Redis/DB in production)
jobs = {}

def run_background_task(job_id: str, data: dict):
    """Background worker function."""
    try:
        jobs[job_id]["status"] = "running"

        # Your long-running logic here
        for i in range(100):
            # Update progress
            jobs[job_id]["progress"] = i + 1
            time.sleep(0.1)

        jobs[job_id]["status"] = "completed"
        jobs[job_id]["output_file"] = "result.xlsx"

    except Exception as e:
        jobs[job_id]["status"] = "failed"
        jobs[job_id]["error"] = str(e)


@router.post("/jobs", response_model=JobCreateResponse)
async def create_job(
    data: JobInput,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Create a new background job."""
    job_id = str(uuid.uuid4())

    jobs[job_id] = {
        "status": "queued",
        "progress": 0,
        "user_id": current_user.oid
    }

    # Start background thread
    thread = threading.Thread(
        target=run_background_task,
        args=(job_id, data.dict())
    )
    thread.start()

    return {"job_id": job_id}


@router.get("/jobs/{job_id}", response_model=JobStatusResponse)
async def get_job_status(
    job_id: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Get job status."""
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")

    job = jobs[job_id]

    if job["user_id"] != current_user.oid:
        raise HTTPException(status_code=403, detail="Not authorized")

    return {
        "job_id": job_id,
        "status": job["status"],
        "progress": job.get("progress"),
        "error": job.get("error"),
        "output_file": job.get("output_file")
    }
```

---

## Frontend API Client

### Complete API Service

```javascript
// frontend/src/services/ApiService.js
import { API_CONFIG } from '../config/apiConfig';

class ApiService {
  constructor() {
    this.baseUrl = API_CONFIG.baseUrl;
  }

  /**
   * Generic fetch wrapper with authentication.
   */
  async fetchWithAuth(endpoint, options = {}, getAccessToken) {
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    // Add Bearer token if available
    if (getAccessToken) {
      const token = await getAccessToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
      throw new Error(error.detail || `API Error: ${response.status}`);
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return null;
    }

    return response.json();
  }

  /**
   * File upload with authentication.
   */
  async uploadFile(endpoint, file, getAccessToken) {
    const formData = new FormData();
    formData.append('file', file);

    const headers = {};

    if (getAccessToken) {
      const token = await getAccessToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Upload failed' }));
      throw new Error(error.detail);
    }

    return response.json();
  }

  /**
   * File download with authentication.
   */
  async downloadFile(endpoint, filename, getAccessToken) {
    const headers = {};

    if (getAccessToken) {
      const token = await getAccessToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, { headers });

    if (!response.ok) {
      throw new Error('Download failed');
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  }

  // ============================================================
  // Public API Methods
  // ============================================================

  // Health check (no auth)
  async healthCheck() {
    const response = await fetch(`${this.baseUrl}/health`);
    return response.json();
  }

  // Items CRUD
  async getItems(getAccessToken) {
    return this.fetchWithAuth('/api/items', { method: 'GET' }, getAccessToken);
  }

  async createItem(data, getAccessToken) {
    return this.fetchWithAuth(
      '/api/items',
      { method: 'POST', body: JSON.stringify(data) },
      getAccessToken
    );
  }

  async getItem(id, getAccessToken) {
    return this.fetchWithAuth(`/api/items/${id}`, { method: 'GET' }, getAccessToken);
  }

  async updateItem(id, data, getAccessToken) {
    return this.fetchWithAuth(
      `/api/items/${id}`,
      { method: 'PATCH', body: JSON.stringify(data) },
      getAccessToken
    );
  }

  async deleteItem(id, getAccessToken) {
    return this.fetchWithAuth(`/api/items/${id}`, { method: 'DELETE' }, getAccessToken);
  }

  // File operations
  async uploadFile(file, getAccessToken) {
    return this.uploadFile('/api/files/upload', file, getAccessToken);
  }

  async downloadFile(fileId, filename, getAccessToken) {
    return this.downloadFile(`/api/files/${fileId}/download`, filename, getAccessToken);
  }

  // Jobs
  async createJob(data, getAccessToken) {
    return this.fetchWithAuth(
      '/api/jobs',
      { method: 'POST', body: JSON.stringify(data) },
      getAccessToken
    );
  }

  async getJobStatus(jobId, getAccessToken) {
    return this.fetchWithAuth(`/api/jobs/${jobId}`, { method: 'GET' }, getAccessToken);
  }
}

export const apiService = new ApiService();
```

### Using the API Service in Components

```jsx
import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { apiService } from '../services/ApiService';

function ItemList() {
  const { getAccessToken } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function loadItems() {
      try {
        setLoading(true);
        const data = await apiService.getItems(getAccessToken);
        setItems(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    loadItems();
  }, [getAccessToken]);

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <ul>
      {items.map(item => (
        <li key={item.id}>{item.name}</li>
      ))}
    </ul>
  );
}
```

---

## External Service Access

### Service-to-Service Authentication

External applications can call the same API using client credentials flow:

```python
# external_service/call_api.py
import httpx
from msal import ConfidentialClientApplication

# Get token using client credentials
app = ConfidentialClientApplication(
    client_id="external-service-client-id",
    client_credential="external-service-secret",
    authority="https://login.microsoftonline.com/your-tenant-id",
)

result = app.acquire_token_for_client(
    scopes=["api://your-api-client-id/.default"]
)

access_token = result["access_token"]

# Call the API
response = httpx.get(
    "https://your-api.com/api/items",
    headers={"Authorization": f"Bearer {access_token}"}
)
print(response.json())
```

---

## CORS Configuration

### Development CORS

```python
# backend/app/main.py
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)
```

### Production CORS

In production, restrict origins to your specific domains:

```env
# backend/.env
ALLOWED_ORIGINS=https://your-app.azurestaticapps.net,https://custom-domain.com
```

---

## API Documentation

FastAPI automatically generates OpenAPI documentation:

- **Swagger UI**: `http://localhost:8000/docs`
- **ReDoc**: `http://localhost:8000/redoc`
- **OpenAPI JSON**: `http://localhost:8000/openapi.json`

### Adding Documentation to Endpoints

```python
@router.post(
    "",
    response_model=Item,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new item",
    description="""
    Create a new item for the authenticated user.

    **Required fields:**
    - name: Item name (1-100 characters)
    - category: Item category

    **Optional fields:**
    - description: Item description (max 500 characters)
    """,
    responses={
        201: {"description": "Item created successfully"},
        400: {"description": "Invalid input data"},
        401: {"description": "Authentication required"},
    }
)
async def create_item(data: ItemCreate, ...):
    ...
```

---

## Checklist for New API Endpoints

- [ ] Create Pydantic models for request/response
- [ ] Create router file in `app/routers/`
- [ ] Add authentication dependency (`get_current_user`)
- [ ] Implement proper error handling
- [ ] Register router in `main.py`
- [ ] Update `ApiService.js` in frontend
- [ ] Test endpoint with Swagger UI
- [ ] Test authentication flow
- [ ] Test error scenarios
