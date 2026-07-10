# File Retention Pattern

This document provides standardized patterns for managing uploaded files, including naming conventions, directory structure, and automatic cleanup strategies.

---

## Table of Contents

- [Overview](#overview)
- [Directory Structure](#directory-structure)
- [File Naming Conventions](#file-naming-conventions)
- [Retention Strategies](#retention-strategies)
  - [Strategy 1: Immediate Cleanup (Process and Delete)](#strategy-1-immediate-cleanup-process-and-delete)
  - [Strategy 2: TTL-Based Cleanup (Background Task)](#strategy-2-ttl-based-cleanup-background-task)
  - [Strategy 3: Session-Based Cleanup](#strategy-3-session-based-cleanup)
- [Implementation](#implementation)
  - [File Manager Utility](#file-manager-utility)
  - [Cleanup Background Task](#cleanup-background-task)
  - [Integration with Upload Endpoint](#integration-with-upload-endpoint)
- [Configuration](#configuration)
- [Checklist](#checklist)

---

## Overview

When applications accept file uploads, files must be:
1. **Stored safely** - Prevent filename collisions and path traversal attacks
2. **Isolated by user** - Users should not access each other's uploads
3. **Cleaned up** - Prevent disk space exhaustion from orphaned files

### Default Behavior

Unless the application explicitly needs to persist files long-term, **all uploaded files should be deleted after processing**. This is the safest default.

---

## Directory Structure

### User-Scoped Uploads (Recommended)

```
backend/
├── uploads/
│   ├── .gitkeep
│   ├── {user_oid}/           # User's Azure AD Object ID
│   │   ├── {uuid}_{original_filename}
│   │   ├── {uuid}_{original_filename}
│   │   └── ...
│   └── {another_user_oid}/
│       └── ...
```

### Session-Scoped Uploads

For workflows where files are uploaded, processed, and discarded within a single session:

```
backend/
├── uploads/
│   ├── .gitkeep
│   └── temp/
│       ├── {uuid}_{timestamp}_{filename}
│       └── ...
```

---

## File Naming Conventions

**Never use the original filename directly.** Always prefix with a UUID to prevent:
- Filename collisions
- Path traversal attacks
- Predictable file locations

### Naming Pattern

```python
import uuid
from datetime import datetime

def generate_safe_filename(original_filename: str) -> str:
    """
    Generate a safe, unique filename.

    Format: {uuid}_{timestamp}_{sanitized_original}
    Example: a1b2c3d4_20240115_143022_quarterly_report.xlsx
    """
    # Generate unique prefix
    unique_id = uuid.uuid4().hex[:8]
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    # Sanitize original filename (keep only safe characters)
    safe_name = "".join(c for c in original_filename if c.isalnum() or c in "._-")

    # Limit length
    if len(safe_name) > 100:
        name, ext = safe_name.rsplit(".", 1) if "." in safe_name else (safe_name, "")
        safe_name = f"{name[:90]}.{ext}" if ext else name[:100]

    return f"{unique_id}_{timestamp}_{safe_name}"
```

---

## Retention Strategies

### Strategy 1: Immediate Cleanup (Process and Delete)

**Use when:** Files are processed immediately and results are returned in the response.

```python
import os
from contextlib import contextmanager

@contextmanager
def temporary_upload(file_path: str):
    """
    Context manager that ensures file is deleted after processing.

    Usage:
        with temporary_upload(saved_path) as path:
            result = process_file(path)
        # File is automatically deleted here
    """
    try:
        yield file_path
    finally:
        if os.path.exists(file_path):
            os.remove(file_path)


# Example usage in endpoint
@router.post("/process")
async def process_file(file: UploadFile, current_user: CurrentUser = Depends(get_current_user)):
    # Save file
    file_path = save_upload(file, current_user.oid)

    # Process and auto-delete
    with temporary_upload(file_path) as path:
        result = analyze_file(path)

    return {"result": result}
```

### Strategy 2: TTL-Based Cleanup (Background Task)

**Use when:** Files need to persist for some time (e.g., multi-step workflows, download links).

```python
# Default: Delete files older than 1 hour
FILE_TTL_HOURS = 1

# For longer workflows (e.g., batch processing)
FILE_TTL_HOURS = 24
```

### Strategy 3: Session-Based Cleanup

**Use when:** Files are tied to a user session and should be cleaned when the session ends.

This requires tracking session IDs and cleaning up on logout or session timeout.

---

## Implementation

### File Manager Utility

Create `backend/app/core/file_manager.py`:

```python
"""
File Manager Utility
Handles file uploads with proper naming, storage, and cleanup.
"""

import os
import uuid
import shutil
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional
from fastapi import UploadFile

from .config import settings


class FileManager:
    """Manages file uploads with automatic cleanup."""

    def __init__(self, base_path: str = None):
        self.base_path = Path(base_path or settings.upload_folder)
        self.base_path.mkdir(parents=True, exist_ok=True)

    def get_user_directory(self, user_oid: str) -> Path:
        """Get or create user-specific upload directory."""
        user_dir = self.base_path / user_oid
        user_dir.mkdir(parents=True, exist_ok=True)
        return user_dir

    def generate_filename(self, original_filename: str) -> str:
        """Generate a safe, unique filename."""
        unique_id = uuid.uuid4().hex[:8]
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

        # Sanitize original filename
        safe_name = "".join(c for c in original_filename if c.isalnum() or c in "._-")
        if len(safe_name) > 100:
            name_parts = safe_name.rsplit(".", 1)
            if len(name_parts) == 2:
                safe_name = f"{name_parts[0][:90]}.{name_parts[1]}"
            else:
                safe_name = safe_name[:100]

        return f"{unique_id}_{timestamp}_{safe_name}"

    async def save_upload(
        self,
        file: UploadFile,
        user_oid: str,
        subdirectory: Optional[str] = None
    ) -> Path:
        """
        Save an uploaded file to the user's directory.

        Args:
            file: The uploaded file
            user_oid: User's Azure AD Object ID
            subdirectory: Optional subdirectory within user folder

        Returns:
            Path to the saved file
        """
        # Determine target directory
        target_dir = self.get_user_directory(user_oid)
        if subdirectory:
            target_dir = target_dir / subdirectory
            target_dir.mkdir(parents=True, exist_ok=True)

        # Generate safe filename
        safe_filename = self.generate_filename(file.filename)
        file_path = target_dir / safe_filename

        # Save file
        content = await file.read()
        with open(file_path, "wb") as f:
            f.write(content)

        return file_path

    def delete_file(self, file_path: Path) -> bool:
        """Delete a specific file."""
        try:
            if file_path.exists():
                file_path.unlink()
                return True
            return False
        except Exception as e:
            print(f"Error deleting file {file_path}: {e}")
            return False

    def delete_user_files(self, user_oid: str) -> int:
        """Delete all files for a specific user."""
        user_dir = self.base_path / user_oid
        if not user_dir.exists():
            return 0

        count = 0
        for file_path in user_dir.rglob("*"):
            if file_path.is_file():
                file_path.unlink()
                count += 1

        # Remove empty directories
        for dir_path in sorted(user_dir.rglob("*"), reverse=True):
            if dir_path.is_dir() and not any(dir_path.iterdir()):
                dir_path.rmdir()

        if user_dir.exists() and not any(user_dir.iterdir()):
            user_dir.rmdir()

        return count

    def cleanup_old_files(self, max_age_hours: int = 1) -> int:
        """
        Delete files older than max_age_hours.

        Args:
            max_age_hours: Maximum file age in hours

        Returns:
            Number of files deleted
        """
        cutoff_time = datetime.now() - timedelta(hours=max_age_hours)
        count = 0

        for file_path in self.base_path.rglob("*"):
            if file_path.is_file() and file_path.name != ".gitkeep":
                # Check file modification time
                mtime = datetime.fromtimestamp(file_path.stat().st_mtime)
                if mtime < cutoff_time:
                    try:
                        file_path.unlink()
                        count += 1
                    except Exception as e:
                        print(f"Error deleting {file_path}: {e}")

        # Clean up empty directories
        for dir_path in sorted(self.base_path.rglob("*"), reverse=True):
            if dir_path.is_dir() and not any(dir_path.iterdir()):
                try:
                    dir_path.rmdir()
                except Exception:
                    pass

        return count

    def get_user_storage_usage(self, user_oid: str) -> dict:
        """Get storage usage statistics for a user."""
        user_dir = self.base_path / user_oid
        if not user_dir.exists():
            return {"file_count": 0, "total_bytes": 0, "total_mb": 0.0}

        total_bytes = 0
        file_count = 0

        for file_path in user_dir.rglob("*"):
            if file_path.is_file():
                total_bytes += file_path.stat().st_size
                file_count += 1

        return {
            "file_count": file_count,
            "total_bytes": total_bytes,
            "total_mb": round(total_bytes / (1024 * 1024), 2)
        }


# Global instance
file_manager = FileManager()
```

### Cleanup Background Task

Add cleanup task to `backend/app/main.py`:

```python
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI

from .core.file_manager import file_manager
from .core.config import settings

# Cleanup configuration
CLEANUP_INTERVAL_MINUTES = 30
FILE_TTL_HOURS = 1


async def cleanup_task():
    """Background task to clean up old files periodically."""
    while True:
        await asyncio.sleep(CLEANUP_INTERVAL_MINUTES * 60)
        try:
            deleted_count = file_manager.cleanup_old_files(max_age_hours=FILE_TTL_HOURS)
            if deleted_count > 0:
                print(f"Cleanup: Deleted {deleted_count} expired files")
        except Exception as e:
            print(f"Cleanup error: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler with cleanup task."""
    # Startup
    print("Starting API...")

    # Start background cleanup task
    cleanup = asyncio.create_task(cleanup_task())

    # Run initial cleanup on startup
    deleted = file_manager.cleanup_old_files(max_age_hours=FILE_TTL_HOURS)
    if deleted > 0:
        print(f"Startup cleanup: Deleted {deleted} expired files")

    yield

    # Shutdown
    cleanup.cancel()
    try:
        await cleanup
    except asyncio.CancelledError:
        pass
    print("Shutting down API...")


app = FastAPI(
    title="Arcline Application API",
    lifespan=lifespan,
)
```

### Integration with Upload Endpoint

Example endpoint using the file manager:

```python
from fastapi import APIRouter, UploadFile, File, Depends, HTTPException
from fastapi.responses import FileResponse
from pathlib import Path

from app.core.security import get_current_user
from app.core.file_manager import file_manager
from app.models.user import CurrentUser

router = APIRouter(prefix="/files", tags=["files"])


@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(get_current_user)
):
    """
    Upload a file. Files are automatically cleaned up after 1 hour.
    """
    # Validate file type
    allowed_extensions = {".xlsx", ".xls", ".csv"}
    file_ext = Path(file.filename).suffix.lower()
    if file_ext not in allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type. Allowed: {', '.join(allowed_extensions)}"
        )

    # Validate file size (50MB max)
    content = await file.read()
    if len(content) > 50 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large. Maximum size: 50MB")

    # Reset file position for saving
    await file.seek(0)

    # Save file
    file_path = await file_manager.save_upload(file, current_user.oid)

    return {
        "success": True,
        "filename": file_path.name,
        "message": "File uploaded successfully. Will be automatically deleted after 1 hour."
    }


@router.delete("/cleanup")
async def cleanup_user_files(
    current_user: CurrentUser = Depends(get_current_user)
):
    """Delete all uploaded files for the current user."""
    deleted_count = file_manager.delete_user_files(current_user.oid)
    return {
        "success": True,
        "deleted_count": deleted_count,
        "message": f"Deleted {deleted_count} files"
    }


@router.get("/storage")
async def get_storage_usage(
    current_user: CurrentUser = Depends(get_current_user)
):
    """Get storage usage for the current user."""
    usage = file_manager.get_user_storage_usage(current_user.oid)
    return usage
```

---

## Configuration

Add these settings to `backend/.env`:

```env
# File Upload Configuration
UPLOAD_FOLDER=./uploads
MAX_UPLOAD_SIZE_MB=50

# File Retention (in hours)
# Set to 0 to disable automatic cleanup
FILE_TTL_HOURS=1

# Cleanup interval (in minutes)
CLEANUP_INTERVAL_MINUTES=30
```

Update `backend/app/core/config.py`:

```python
class Settings(BaseSettings):
    # ... existing settings ...

    # File Upload
    upload_folder: str = "./uploads"
    max_upload_size_mb: int = 50

    # File Retention
    file_ttl_hours: int = 1
    cleanup_interval_minutes: int = 30

    @property
    def max_upload_size_bytes(self) -> int:
        return self.max_upload_size_mb * 1024 * 1024
```

---

## Checklist

### Setup
- [ ] Created `backend/app/core/file_manager.py` with FileManager class
- [ ] Added cleanup background task to `app/main.py`
- [ ] Added file retention settings to `.env`
- [ ] Updated `config.py` with retention settings

### File Naming
- [ ] All uploaded files use UUID prefix
- [ ] Original filenames are sanitized
- [ ] Filenames include timestamp for debugging

### Directory Structure
- [ ] User files stored in `uploads/{user_oid}/`
- [ ] Directories created automatically
- [ ] Empty directories cleaned up

### Cleanup
- [ ] Background task runs periodically
- [ ] Startup cleanup removes expired files
- [ ] Manual cleanup endpoint available
- [ ] Storage usage endpoint available

### Security
- [ ] Users can only access their own files
- [ ] Path traversal attacks prevented
- [ ] File type validation on upload
- [ ] File size limits enforced

### Logging
- [ ] Cleanup operations logged
- [ ] Errors logged with details
- [ ] Storage usage trackable
