# Local Executable Packaging Guide

How to package a React + FastAPI application as a single `.exe` file that runs without Python, Node.js, or Docker installed. Intended for distributing internal tools to users who just need to double-click and go.

---

## How to Use This Guide

1. **Share this file with Claude** along with your application code
2. **Describe your app** — what the FastAPI backend does and what the React frontend looks like
3. **Claude will modify your code** to support local executable mode with auth bypass
4. **Build the exe** using the commands in this guide
5. **Distribute the single file** to your end user

---

## Overview

The approach:

1. Build the React frontend into static files
2. Serve those static files directly from FastAPI (one app, not two)
3. Disable MSAL authentication (no Azure AD available locally)
4. Bundle everything into a single `.exe` with PyInstaller

```
┌──────────────────────────────────────────┐
│              my-app.exe                  │
│                                          │
│  ┌──────────────────────────────────┐    │
│  │  FastAPI Server (Python)         │    │
│  │  - API routes (/api/...)         │    │
│  │  - Serves React static files     │    │
│  │  - Auth bypassed in local mode   │    │
│  └──────────────────────────────────┘    │
│                                          │
│  ┌──────────────────────────────────┐    │
│  │  React Build (static files)      │    │
│  │  - dist/index.html               │    │
│  │  - dist/assets/*.js, *.css       │    │
│  │  - MSAL disabled via env flag    │    │
│  └──────────────────────────────────┘    │
│                                          │
└──────────────────────────────────────────┘
        ↓ User double-clicks
        ↓ Browser opens to http://localhost:8000
```

---

## Instructions for Claude

When a user asks you to package their app as a local executable using this guide, follow these steps:

### Step 1: Gather Requirements

Ask the user:
- Where is their FastAPI backend code? (e.g., `backend/main.py`)
- Where is their React frontend code? (e.g., `frontend/`)
- Does the app use MSAL / Azure AD authentication?
- Does the app connect to external services (database, APIs) that may not be available locally?
- Should the exe auto-open the browser on launch?

### Step 2: Add Local Mode to the Backend

Modify the FastAPI backend to support a `LOCAL_MODE` flag that bypasses authentication and serves the React build.

---

## Backend Changes

### 2.1 — Resource Path Helper

PyInstaller extracts bundled files to a temporary directory at runtime. All file references need to use this helper:

```python
# utils/local_mode.py
import sys
import os

def get_resource_path(relative_path: str) -> str:
    """Resolve path to a bundled resource.
    Works in both development (files on disk) and PyInstaller (temp directory).
    """
    if hasattr(sys, '_MEIPASS'):
        return os.path.join(sys._MEIPASS, relative_path)
    return os.path.join(os.path.dirname(__file__), '..', relative_path)

def is_local_mode() -> bool:
    """Check if running as a PyInstaller bundle or LOCAL_MODE is set."""
    return hasattr(sys, '_MEIPASS') or os.environ.get('LOCAL_MODE', '').lower() == 'true'
```

### 2.2 — Bypass MSAL Authentication

Wrap your existing auth logic to skip token validation in local mode and inject a mock user:

```python
# utils/auth.py (modify existing)
from utils.local_mode import is_local_mode

# Your existing DecodedToken interface / class stays the same

LOCAL_USER = DecodedToken(
    oid="00000000-0000-0000-0000-000000000000",
    groups=["local-admin"],
    preferred_username="local-user@localhost",
    name="Local User",
)

async def authenticateRequest(request, context):
    # In local mode, skip token validation entirely
    if is_local_mode():
        return LOCAL_USER

    # --- existing MSAL validation logic below ---
    token = extractToken(request)
    if not token:
        raise Exception("Invalid authentication token")
    return await validateToken(token)


def checkUserGroups(user, requiredGroups=None):
    # In local mode, always grant access
    if is_local_mode():
        return True

    # --- existing group check logic below ---
    ...
```

> **Why bypass auth?** MSAL authentication requires network access to Azure AD, a registered app, and a valid tenant. None of these exist when someone runs an `.exe` on their laptop disconnected from your Azure environment. The mock user ensures all downstream code that references `user.oid` or `user.name` still works.

### 2.3 — Serve React Static Files from FastAPI

Add static file serving to your main FastAPI app. This replaces the separate Vite dev server / nginx setup:

```python
# main.py
import os
import uvicorn
import webbrowser
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from utils.local_mode import get_resource_path, is_local_mode

app = FastAPI()

# --- Register your API routes first ---
# app.include_router(my_api_router, prefix="/api")

# --- Serve React build (only needed in local/bundled mode) ---
dist_path = get_resource_path("dist")

if os.path.isdir(dist_path):
    # Serve static assets (JS, CSS, images)
    assets_path = os.path.join(dist_path, "assets")
    if os.path.isdir(assets_path):
        app.mount("/assets", StaticFiles(directory=assets_path), name="assets")

    # Catch-all: serve index.html for any non-API route (React Router support)
    @app.get("/{full_path:path}")
    async def serve_react(full_path: str):
        # Don't intercept API routes
        if full_path.startswith("api/"):
            return {"error": "Not found"}, 404
        return FileResponse(os.path.join(dist_path, "index.html"))

# --- Auto-open browser and start server ---
if __name__ == "__main__":
    if is_local_mode():
        webbrowser.open("http://localhost:8000")
    uvicorn.run(app, host="127.0.0.1", port=8000)
```

> **Route order matters.** Mount your API routes _before_ the React catch-all, otherwise `/api/*` requests will return `index.html`.

---

## Frontend Changes

### 3.1 — Disable MSAL in Local Mode

Add an environment variable to skip MSAL initialization in the React app:

```env
# frontend/.env.local-build
VITE_LOCAL_MODE=true
VITE_API_URL=http://localhost:8000/api
```

### 3.2 — Conditional Auth in the App

Modify your auth flow to skip MSAL when the local mode flag is set:

```typescript
// auth/useAuth.ts (modify existing)
const isLocalMode = import.meta.env.VITE_LOCAL_MODE === 'true';

export function useAuth() {
  // In local mode, return a mock authenticated state
  if (isLocalMode) {
    return {
      login: () => {},
      logout: () => {},
      getAccessToken: async () => 'local-mode-token',
      getUserGroups: () => ['local-admin'],
      userGroups: ['local-admin'],
      hasGroup: () => true,
      user: {
        name: 'Local User',
        username: 'local-user@localhost',
        localAccountId: '00000000-0000-0000-0000-000000000000',
        homeAccountId: '00000000-0000-0000-0000-000000000000',
      },
      isAuthenticated: true,
      isEmbedded: false,
      isEmbeddedLoading: false,
    };
  }

  // --- existing MSAL auth logic below ---
  ...
}
```

### 3.3 — Skip MsalProvider Wrapping

If your `App.tsx` or `main.tsx` wraps the app in `<MsalProvider>`, conditionally skip it:

```typescript
// main.tsx
const isLocalMode = import.meta.env.VITE_LOCAL_MODE === 'true';

if (isLocalMode) {
  // Render without MSAL provider
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <App />
  );
} else {
  // Existing MSAL-wrapped render
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <MsalProvider instance={msalInstance}>
      <App />
    </MsalProvider>
  );
}
```

### 3.4 — Skip AuthenticatedTemplate / UnauthenticatedTemplate

If your `App.tsx` uses MSAL template components, bypass them in local mode:

```typescript
// App.tsx
const isLocalMode = import.meta.env.VITE_LOCAL_MODE === 'true';

function AuthWrapper() {
  if (isLocalMode) {
    // Skip MSAL templates — always show the authenticated app
    return <AuthenticatedApp />;
  }

  // Existing MSAL flow
  return (
    <>
      <AuthenticatedTemplate>
        <AuthenticatedApp />
      </AuthenticatedTemplate>
      <UnauthenticatedTemplate>
        <Login onLogin={login} />
      </UnauthenticatedTemplate>
    </>
  );
}
```

---

## Build Process

### Step 1 — Build the React Frontend

```bash
cd frontend
npm run build -- --mode local-build
# This uses .env.local-build and outputs to frontend/dist/
```

### Step 2 — Copy the Build to Backend

```bash
# Copy the React build output next to your backend code
cp -r frontend/dist backend/dist
```

### Step 3 — Install PyInstaller

```bash
cd backend
pip install pyinstaller
```

### Step 4 — Create the Executable

```bash
pyinstaller --onefile \
  --add-data "dist;dist" \
  --name my-app \
  --icon=dist/favicon.ico \
  main.py
```

> **Platform note:** The `--add-data` separator is `;` on Windows and `:` on macOS/Linux. The command above is Windows syntax.

The `.exe` will be in `backend/dist/my-app.exe` (PyInstaller outputs to a `dist/` folder — don't confuse this with the React `dist/`). Rename the output folder or use `--distpath` to avoid collision:

```bash
pyinstaller --onefile \
  --add-data "dist;dist" \
  --name my-app \
  --distpath build \
  main.py
```

### Step 5 — Test It

```bash
./build/my-app.exe
# Browser should open to http://localhost:8000
```

---

## What the End User Gets

A single file: `my-app.exe`

1. Double-click it
2. A console window opens (the FastAPI server)
3. Browser opens to `http://localhost:8000`
4. The app works — no Python, Node.js, npm, or Docker needed
5. Close the console window to stop the server

---

## Build Script (Optional)

Automate the full build with a single script:

```bash
#!/bin/bash
# build-exe.sh — Build the local executable

set -e

echo "Building React frontend..."
cd frontend
npm run build -- --mode local-build
cd ..

echo "Copying build to backend..."
rm -rf backend/dist
cp -r frontend/dist backend/dist

echo "Building executable..."
cd backend
pip install pyinstaller
pyinstaller --onefile \
  --add-data "dist;dist" \
  --name my-app \
  --distpath ../build \
  main.py

echo "Done! Executable is at build/my-app.exe"
```

---

## Gotchas

| Issue | Solution |
|:------|:---------|
| **Antivirus flags the exe** | PyInstaller exes are commonly flagged as false positives. Sign the exe with a code signing certificate, or have users add an exception. |
| **Large file size** (100MB+) | Normal for PyInstaller `--onefile`. Use `--exclude-module` to trim unused packages (e.g., `--exclude-module tkinter`). |
| **Slow first launch** | `--onefile` extracts to a temp dir on each run. Use `--onedir` instead for faster startup (distributes a folder instead of a single file). |
| **"Failed to execute script"** | Usually a missing dependency. Test with `--onefile --console` to see the error output. |
| **Static files not found** | Make sure you're using `get_resource_path()` for all file references, not hardcoded relative paths. |
| **API routes return index.html** | The React catch-all route is intercepting API calls. Make sure API routers are registered _before_ the catch-all `/{full_path:path}` route. |
| **CORS errors in browser** | Not needed — frontend and backend are served from the same origin (`localhost:8000`). Remove any CORS middleware in local mode. |
| **App uses external database** | If the app needs a database, either bundle SQLite (works locally) or document the connection string setup the user needs. |
