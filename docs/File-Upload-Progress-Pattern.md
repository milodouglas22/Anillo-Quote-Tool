# File Upload Progress Pattern

This document provides a standardized pattern for implementing file uploads with real-time progress tracking. Users see a visual progress bar and status messages as their file uploads and processes on the server.

---

## Table of Contents

- [Overview](#overview)
- [Progress Stages](#progress-stages)
- [Frontend Implementation](#frontend-implementation)
  - [State Management](#state-management)
  - [API Service](#api-service)
  - [Upload Handler](#upload-handler)
  - [Progress UI Component](#progress-ui-component)
- [Backend Implementation](#backend-implementation)
- [Customization](#customization)
- [Checklist](#checklist)

---

## Overview

This pattern uses **XMLHttpRequest (XHR)** instead of `fetch()` because XHR provides native upload progress events that fetch doesn't support. The progress is divided into stages:

1. **Upload phase** (0-70%): Real-time progress based on bytes transferred
2. **Server processing phase** (71-90%): Simulated progress while server parses the file
3. **Finalization phase** (95%): Server has responded, wrapping up
4. **Complete** (100%): Set by the caller after successful processing

---

## Progress Stages

| Stage | Percentage | Message | Trigger |
|-------|------------|---------|---------|
| Upload | 0-70% | "Uploading file..." | Real bytes transferred via `xhr.upload.onprogress` |
| Server Processing | 71-90% | "Server is parsing file..." | Simulated (increments every 800ms) |
| Finalize | 95% | "Finalizing..." | Server response received |
| Complete | 100% | "Upload complete!" | Set by caller after success |

---

## Frontend Implementation

### State Management

Add state variables to track upload progress in your component:

```jsx
// src/App.jsx (or your upload component)
import { useState } from 'react';

function App() {
  // Upload state
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadMessage, setUploadMessage] = useState('');
  const [uploadError, setUploadError] = useState('');

  // ... rest of component
}
```

### API Service

Create an API service with a progress-tracking upload method. This uses XHR to capture real upload progress:

```javascript
// src/services/ApiService.js

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

class ApiService {
  constructor() {
    this.baseUrl = API_BASE_URL;
  }

  /**
   * Upload a file with real-time progress tracking
   *
   * @param {File} file - The file to upload
   * @param {string} endpoint - API endpoint (e.g., '/files/upload')
   * @param {Function} getAccessToken - Async function to get auth token (optional)
   * @param {Function} onProgress - Callback function (percent, message)
   * @param {Object} additionalData - Additional form data to include
   * @returns {Promise<Object>} - Upload response data
   */
  async uploadFileWithProgress(file, endpoint, getAccessToken, onProgress, additionalData = {}) {
    const token = getAccessToken ? await getAccessToken() : null;

    const formData = new FormData();
    formData.append('file', file);

    // Add any additional form data
    Object.entries(additionalData).forEach(([key, value]) => {
      formData.append(key, value);
    });

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${this.baseUrl}${endpoint}`);

      // Set auth header if token provided
      if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      }

      let serverWaitTimer = null;
      let serverProgress = 71;

      // Track actual upload progress (0-70%)
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          const pct = Math.round((e.loaded / e.total) * 70);
          onProgress(pct, 'Uploading file...');
        }
      };

      // Upload complete, now waiting for server processing (71-90%)
      xhr.upload.onload = () => {
        if (onProgress) onProgress(71, 'Server is processing file...');

        // Simulate progress while waiting for server
        serverWaitTimer = setInterval(() => {
          if (serverProgress < 90) {
            serverProgress++;
            if (onProgress) onProgress(serverProgress, 'Server is processing file...');
          }
        }, 800);
      };

      // Server has responded
      xhr.onload = () => {
        if (serverWaitTimer) clearInterval(serverWaitTimer);

        if (xhr.status >= 200 && xhr.status < 300) {
          if (onProgress) onProgress(95, 'Finalizing...');
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch {
            reject(new Error('Invalid response from server'));
          }
        } else if (xhr.status === 401) {
          reject(new Error('Authentication failed. Please log in again.'));
        } else if (xhr.status === 403) {
          reject(new Error('Access denied. You do not have permission to upload files.'));
        } else {
          try {
            const err = JSON.parse(xhr.responseText);
            reject(new Error(err.detail || err.error || 'Upload failed'));
          } catch {
            reject(new Error(`Upload failed (status ${xhr.status})`));
          }
        }
      };

      // Network error
      xhr.onerror = () => {
        if (serverWaitTimer) clearInterval(serverWaitTimer);
        reject(new Error('Upload failed - network error'));
      };

      // Abort handler
      xhr.onabort = () => {
        if (serverWaitTimer) clearInterval(serverWaitTimer);
        reject(new Error('Upload cancelled'));
      };

      xhr.send(formData);
    });
  }
}

export const apiService = new ApiService();
export default apiService;
```

### Upload Handler

Handle the file upload in your component:

```jsx
// In your component

const handleFileUpload = async (file) => {
  if (!file) return;

  setIsUploading(true);
  setUploadError('');
  setUploadProgress(0);
  setUploadMessage('Preparing upload...');

  try {
    const data = await apiService.uploadFileWithProgress(
      file,
      '/files/upload',
      getAccessToken, // from useAuth hook, or null if no auth
      (pct, msg) => {
        setUploadProgress(pct);
        setUploadMessage(msg);
      },
      { /* additional form data if needed */ }
    );

    // Upload successful
    setUploadProgress(100);
    setUploadMessage('Upload complete!');

    // Process the response data
    console.log('Upload response:', data);

    // Optional: Auto-hide progress after delay
    setTimeout(() => {
      setIsUploading(false);
      setUploadProgress(0);
      setUploadMessage('');
    }, 1500);

  } catch (error) {
    console.error('Upload failed:', error);
    setUploadError(error.message);
    setIsUploading(false);
  }
};
```

### Progress UI Component

#### Option 1: Full-Screen Overlay

Use this for uploads that block the entire UI:

```jsx
// src/components/UploadOverlay.jsx
import { Loader2, Check, X } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';

function UploadOverlay({
  isUploading,
  uploadProgress,
  uploadMessage,
  uploadError,
  onDismissError
}) {
  if (!isUploading && !uploadError) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="text-center max-w-md w-full px-8">
        {/* Uploading State */}
        {isUploading && !uploadError && uploadProgress < 100 && (
          <>
            <Loader2 className="w-16 h-16 animate-spin mx-auto mb-5 text-primary" />
            <h3 className="text-2xl font-semibold text-primary mb-4">
              Uploading file...
            </h3>
            <Progress value={uploadProgress} className="h-3 mb-3" />
            <p className="text-sm text-muted-foreground">
              {uploadMessage} ({uploadProgress}%)
            </p>
          </>
        )}

        {/* Success State */}
        {isUploading && uploadProgress === 100 && (
          <>
            <div className="w-20 h-20 bg-green-500 text-white rounded-full flex items-center justify-center mx-auto mb-5 animate-in zoom-in duration-300">
              <Check className="w-12 h-12" />
            </div>
            <h3 className="text-2xl font-semibold text-primary mb-2">
              Upload Successful!
            </h3>
            <p className="text-muted-foreground">{uploadMessage}</p>
          </>
        )}

        {/* Error State */}
        {uploadError && (
          <>
            <div className="w-20 h-20 bg-destructive text-white rounded-full flex items-center justify-center mx-auto mb-5">
              <X className="w-12 h-12" />
            </div>
            <h3 className="text-2xl font-semibold text-destructive mb-2">
              Upload Failed
            </h3>
            <p className="text-muted-foreground mb-4">{uploadError}</p>
            <Button onClick={onDismissError}>Try Again</Button>
          </>
        )}
      </div>
    </div>
  );
}

export default UploadOverlay;
```

#### Option 2: Inline Progress

Use this for uploads within a specific section of the UI:

```jsx
// Inline progress within a card or section
import { Loader2 } from 'lucide-react';
import { Progress } from '@/components/ui/progress';

function FileUploadCard({ isUploading, uploadProgress, uploadMessage, onFileSelect }) {
  return (
    <div className="border rounded-lg p-6">
      {isUploading ? (
        <div className="text-center py-4">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-primary" />
          <Progress value={uploadProgress} className="h-2 mb-2" />
          <p className="text-sm text-muted-foreground">
            {uploadMessage} ({uploadProgress}%)
          </p>
        </div>
      ) : (
        <div className="text-center py-8">
          <input
            type="file"
            onChange={(e) => onFileSelect(e.target.files[0])}
            className="hidden"
            id="file-upload"
          />
          <label
            htmlFor="file-upload"
            className="cursor-pointer text-primary hover:underline"
          >
            Click to select a file
          </label>
        </div>
      )}
    </div>
  );
}
```

#### Option 3: Drag & Drop with Progress

```jsx
// src/components/FileDropZone.jsx
import { useState } from 'react';
import { Upload, Loader2, Check } from 'lucide-react';
import { Progress } from '@/components/ui/progress';

function FileDropZone({
  onFileSelect,
  isUploading,
  uploadProgress,
  uploadMessage,
  acceptedTypes = '.xlsx,.xls,.csv'
}) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) onFileSelect(file);
  };

  if (isUploading) {
    return (
      <div className="border-2 border-dashed border-primary/50 rounded-lg p-8 text-center bg-primary/5">
        {uploadProgress < 100 ? (
          <>
            <Loader2 className="w-12 h-12 animate-spin mx-auto mb-4 text-primary" />
            <Progress value={uploadProgress} className="h-2 max-w-xs mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">
              {uploadMessage} ({uploadProgress}%)
            </p>
          </>
        ) : (
          <>
            <div className="w-12 h-12 bg-green-500 text-white rounded-full flex items-center justify-center mx-auto mb-4">
              <Check className="w-6 h-6" />
            </div>
            <p className="text-sm font-medium text-green-600">{uploadMessage}</p>
          </>
        )}
      </div>
    );
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`
        border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer
        ${isDragging
          ? 'border-primary bg-primary/5'
          : 'border-muted-foreground/25 hover:border-primary/50'
        }
      `}
    >
      <input
        type="file"
        onChange={(e) => onFileSelect(e.target.files[0])}
        accept={acceptedTypes}
        className="hidden"
        id="file-drop-input"
      />
      <label htmlFor="file-drop-input" className="cursor-pointer">
        <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
        <p className="text-lg font-medium mb-1">
          {isDragging ? 'Drop file here' : 'Drag & drop your file here'}
        </p>
        <p className="text-sm text-muted-foreground">
          or click to browse
        </p>
        <p className="text-xs text-muted-foreground mt-2">
          Supported formats: {acceptedTypes}
        </p>
      </label>
    </div>
  );
}

export default FileDropZone;
```

---

## Backend Implementation

### FastAPI Endpoint

```python
# backend/app/routes/files.py
from fastapi import APIRouter, UploadFile, File, Depends, HTTPException
from fastapi.responses import JSONResponse
import pandas as pd
import io

from app.core.security import get_current_user
from app.models.user import CurrentUser

router = APIRouter(prefix="/files", tags=["files"])

ALLOWED_EXTENSIONS = {'.xlsx', '.xls', '.csv'}
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB

@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(get_current_user)
):
    """
    Upload and parse a file.
    Returns file metadata and parsed data.
    """
    # Validate file extension
    file_ext = '.' + file.filename.split('.')[-1].lower() if '.' in file.filename else ''
    if file_ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type. Allowed: {', '.join(ALLOWED_EXTENSIONS)}"
        )

    # Read file contents
    contents = await file.read()

    # Validate file size
    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"File too large. Maximum size: {MAX_FILE_SIZE // (1024*1024)}MB"
        )

    try:
        # Parse the file based on extension
        if file_ext == '.csv':
            df = pd.read_csv(io.BytesIO(contents))
        else:
            df = pd.read_excel(io.BytesIO(contents))

        return {
            "success": True,
            "filename": file.filename,
            "file_ext": file_ext,
            "rows": len(df),
            "columns": list(df.columns),
            "sample_data": df.head(5).to_dict(orient='records')
        }

    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"Failed to parse file: {str(e)}"
        )
```

### Flask Endpoint

```python
# backend/routes/files.py
from flask import Blueprint, request, jsonify
from werkzeug.utils import secure_filename
import pandas as pd
import io

files_bp = Blueprint('files', __name__, url_prefix='/files')

ALLOWED_EXTENSIONS = {'xlsx', 'xls', 'csv'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@files_bp.route('/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400

    file = request.files['file']

    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400

    if not allowed_file(file.filename):
        return jsonify({'error': 'Invalid file type'}), 400

    try:
        filename = secure_filename(file.filename)
        file_ext = filename.rsplit('.', 1)[1].lower()

        # Parse the file
        if file_ext == 'csv':
            df = pd.read_csv(file)
        else:
            df = pd.read_excel(file)

        return jsonify({
            'success': True,
            'filename': filename,
            'file_ext': f'.{file_ext}',
            'rows': len(df),
            'columns': list(df.columns),
            'sample_data': df.head(5).to_dict(orient='records')
        })

    except Exception as e:
        return jsonify({'error': f'Failed to parse file: {str(e)}'}), 400
```

---

## Customization

### Custom Progress Messages

Modify the server processing message based on file type:

```javascript
// In ApiService.js
async uploadFileWithProgress(file, endpoint, getAccessToken, onProgress, additionalData = {}) {
  // Determine processing message based on file type
  const ext = file.name.split('.').pop().toLowerCase();
  const processingMessage = ext === 'xlsx' || ext === 'xls'
    ? 'Server is parsing Excel file...'
    : ext === 'csv'
    ? 'Server is parsing CSV file...'
    : 'Server is processing file...';

  // ... in xhr.upload.onload:
  xhr.upload.onload = () => {
    if (onProgress) onProgress(71, processingMessage);
    // ... rest of code
  };
}
```

### Adjustable Progress Speed

For larger files, you may want slower simulated progress:

```javascript
// Slower progress for large files
const progressInterval = file.size > 10 * 1024 * 1024 ? 1200 : 800; // 1.2s for large, 0.8s for small

serverWaitTimer = setInterval(() => {
  if (serverProgress < 90) {
    serverProgress++;
    if (onProgress) onProgress(serverProgress, processingMessage);
  }
}, progressInterval);
```

### Multiple File Upload

For uploading multiple files with aggregate progress:

```javascript
const uploadMultipleFiles = async (files, onOverallProgress) => {
  const totalFiles = files.length;
  let completedFiles = 0;

  for (const file of files) {
    await apiService.uploadFileWithProgress(
      file,
      '/files/upload',
      getAccessToken,
      (pct, msg) => {
        // Calculate overall progress across all files
        const fileProgress = pct / 100;
        const overallProgress = Math.round(
          ((completedFiles + fileProgress) / totalFiles) * 100
        );
        onOverallProgress(overallProgress, `${msg} (${completedFiles + 1}/${totalFiles})`);
      }
    );
    completedFiles++;
  }
};
```

---

## Checklist

### Frontend
- [ ] Added upload state variables (`isUploading`, `uploadProgress`, `uploadMessage`, `uploadError`)
- [ ] Created `ApiService.js` with `uploadFileWithProgress` method
- [ ] Implemented file upload handler with progress callback
- [ ] Created progress UI component (overlay, inline, or drop zone)
- [ ] Handled success state (100% complete)
- [ ] Handled error state with retry option
- [ ] Tested with various file sizes

### Backend
- [ ] Created file upload endpoint
- [ ] Validated file extensions
- [ ] Validated file size limits
- [ ] Parsed file and returned metadata
- [ ] Handled errors with descriptive messages
- [ ] Added authentication if required

### Testing
- [ ] Small files upload correctly (< 1MB)
- [ ] Large files show progress during upload (> 5MB)
- [ ] Progress bar fills smoothly from 0-100%
- [ ] Server processing phase shows simulated progress
- [ ] Error messages display correctly
- [ ] Network errors handled gracefully
- [ ] Authentication errors handled (401/403)
