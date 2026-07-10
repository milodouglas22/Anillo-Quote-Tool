# React Frontend + FastAPI Backend Architecture

This guide establishes the standard architecture for all Arcline applications. Every application must use a **React frontend** with a **FastAPI backend**. No standalone HTML files, no mixed frameworks.

---

## Quick Start for Claude

When a user asks you to create a new application or transform an existing one:

1. Create the folder structure below
2. Initialize the frontend with Vite + React
3. Initialize the backend with FastAPI
4. Install all dependencies
5. Create the configuration files
6. Set up the development environment

If transforming an existing non-React/FastAPI application:
1. Analyze the existing functionality
2. Create the new folder structure
3. Migrate logic to the appropriate layer
4. Remove old files once migration is complete

---

## Table of Contents

- [Folder Structure](#folder-structure)
- [Frontend Setup](#frontend-setup)
- [Backend Setup](#backend-setup)
- [Branding Assets Setup](#branding-assets-setup)
- [Development Workflow](#development-workflow)
- [Environment Variables](#environment-variables)
- [Migration Guide](#migration-guide)

---

## Folder Structure

Every Arcline application must follow this exact structure:

```
project-name/
├── frontend/                      # React application
│   ├── public/
│   │   ├── Arcline-Logo-Black.svg  # Logo for light mode
│   │   ├── Arcline-Logo-White.svg  # Logo for dark mode
│   │   └── favicon.svg             # SVG favicon
│   ├── src/
│   │   ├── assets/               # Static assets (images, fonts)
│   │   ├── components/
│   │   │   ├── ui/               # Reusable UI components (button, card, etc.)
│   │   │   └── ...               # Feature-specific components
│   │   ├── config/
│   │   │   ├── authConfig.js     # MSAL authentication config
│   │   │   └── apiConfig.js      # API endpoints config
│   │   ├── hooks/
│   │   │   └── useAuth.js        # Authentication hook
│   │   ├── lib/
│   │   │   └── utils.js          # Utility functions (cn, etc.)
│   │   ├── services/
│   │   │   └── ApiService.js     # API client with authentication
│   │   ├── App.jsx               # Main application component
│   │   ├── main.jsx              # Entry point
│   │   └── index.css             # Global styles + Tailwind
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   ├── tailwind.config.js
│   ├── jsconfig.json             # Path aliases
│   └── .env                      # Frontend environment variables
│
├── backend/                       # FastAPI application
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py               # FastAPI app entry point
│   │   ├── core/
│   │   │   ├── __init__.py
│   │   │   ├── config.py         # Settings from environment
│   │   │   └── security.py       # JWT authentication
│   │   ├── models/
│   │   │   ├── __init__.py
│   │   │   ├── user.py           # CurrentUser model
│   │   │   └── ...               # Domain models
│   │   └── routers/
│   │       ├── __init__.py
│   │       ├── health.py         # Health check endpoint
│   │       └── ...               # Feature routers
│   ├── uploads/                  # Temporary file storage (gitignored)
│   ├── requirements.txt          # Python dependencies
│   ├── .env                      # Backend environment variables
│   └── .gitignore
│
├── .gitignore                    # Root gitignore
└── README.md                     # Project documentation
```

---

## Frontend Setup

### Step 1: Create Frontend Directory and Initialize Vite

```bash
# Create and navigate to frontend directory
mkdir frontend
cd frontend

# Initialize Vite with React template
npm create vite@latest . -- --template react

# Install dependencies
npm install
```

### Step 2: Install Required Dependencies

```bash
# Core Tailwind CSS v4 (CRITICAL: Use v4, not v3)
npm install tailwindcss@^4.0.0 @tailwindcss/vite

# Styling utilities for shadcn/ui
npm install tailwind-merge clsx class-variance-authority

# UI components and icons
npm install lucide-react @radix-ui/react-icons

# Theme management
npm install next-themes

# Tailwind plugins
npm install @tailwindcss/typography tailwindcss-animate

# MSAL for authentication
npm install @azure/msal-browser @azure/msal-react

# Excel handling (if needed)
npm install xlsx

# Dev dependencies
npm install -D @types/node
```

### Step 3: Configure Vite

Create/replace `frontend/vite.config.js`:

```javascript
import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    tailwindcss(),  // MUST come before react()
    react(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    // CRITICAL: Must be 3000 or 5173 for Azure AD authentication to work
    // These are the only redirect URIs registered in the dev app registration
    port: 3000,
    strictPort: true,  // Fail if port is already in use (don't auto-increment)
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
```

### Step 4: Configure Path Aliases

Create `frontend/jsconfig.json`:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src/**/*"]
}
```

### Step 5: Configure Tailwind

Create `frontend/tailwind.config.js`:

```javascript
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: [
    './index.html',
    './src/**/*.{ts,tsx,js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        border: 'var(--color-border)',
        input: 'var(--color-input)',
        ring: 'var(--color-ring)',
        background: 'var(--color-background)',
        foreground: 'var(--color-foreground)',
        primary: {
          DEFAULT: 'var(--color-primary)',
          foreground: 'var(--color-primary-foreground)',
        },
        secondary: {
          DEFAULT: 'var(--color-secondary)',
          foreground: 'var(--color-secondary-foreground)',
        },
        destructive: {
          DEFAULT: 'var(--color-destructive)',
          foreground: 'var(--color-destructive-foreground)',
        },
        muted: {
          DEFAULT: 'var(--color-muted)',
          foreground: 'var(--color-muted-foreground)',
        },
        accent: {
          DEFAULT: 'var(--color-accent)',
          foreground: 'var(--color-accent-foreground)',
        },
        success: {
          DEFAULT: 'var(--color-success)',
          foreground: 'var(--color-success-foreground)',
        },
        warning: {
          DEFAULT: 'var(--color-warning)',
          foreground: 'var(--color-warning-foreground)',
        },
        popover: {
          DEFAULT: 'var(--color-popover)',
          foreground: 'var(--color-popover-foreground)',
        },
        card: {
          DEFAULT: 'var(--color-card)',
          foreground: 'var(--color-card-foreground)',
        },
      },
      borderRadius: {
        lg: 'var(--radius-lg)',
        md: 'var(--radius-md)',
        sm: 'var(--radius-sm)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [
    require('tailwindcss-animate'),
    require('@tailwindcss/typography'),
  ],
}
```

### Step 6: Set Up Global Styles

Replace `frontend/src/index.css` with the styles from [UX-Design.md](./UX-Design.md#css-variables-indexcss).

### Step 7: Create Core Files

**Create `frontend/src/lib/utils.js`:**

```javascript
import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}
```

**Create `frontend/src/components/theme-provider.jsx`:**

```jsx
import { ThemeProvider as NextThemesProvider } from "next-themes"

export function ThemeProvider({ children, ...props }) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>
}
```

**Create `frontend/src/config/apiConfig.js`:**

```javascript
export const API_CONFIG = {
  baseUrl: import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000',
  endpoints: {
    health: '/health',
    // Add your endpoints here
  },
};
```

**Create `frontend/src/services/ApiService.js`:**

```javascript
import { API_CONFIG } from '../config/apiConfig';

class ApiService {
  constructor() {
    this.baseUrl = API_CONFIG.baseUrl;
  }

  async fetchWithAuth(endpoint, options = {}, getAccessToken) {
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

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
      const error = await response.text();
      throw new Error(`API Error: ${response.status} - ${error}`);
    }

    return response;
  }

  // Health check (no auth required)
  async healthCheck() {
    const response = await fetch(`${this.baseUrl}/health`);
    return response.json();
  }

  // Add your API methods here
}

export const apiService = new ApiService();
```

**Update `frontend/src/main.jsx`:**

```jsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from './components/theme-provider'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
      <App />
    </ThemeProvider>
  </StrictMode>,
)
```

### Step 8: Create UI Components

Create the following components from [UX-Design.md](./UX-Design.md#core-components):
- `frontend/src/components/ui/button.jsx`
- `frontend/src/components/ui/card.jsx`
- `frontend/src/components/ui/alert.jsx`
- `frontend/src/components/ui/badge.jsx`
- `frontend/src/components/ui/input.jsx`
- `frontend/src/components/ui/progress.jsx`

---

## Backend Setup

### Step 1: Create Backend Directory Structure

```bash
# Create backend directories
mkdir -p backend/app/core
mkdir -p backend/app/models
mkdir -p backend/app/routers
mkdir backend/uploads

# Create __init__.py files
touch backend/app/__init__.py
touch backend/app/core/__init__.py
touch backend/app/models/__init__.py
touch backend/app/routers/__init__.py
```

### Step 2: Create Python Virtual Environment

```bash
cd backend

# Create virtual environment
python -m venv venv

# Activate virtual environment
# On Windows:
venv\Scripts\activate
# On macOS/Linux:
source venv/bin/activate

# Install dependencies (create requirements.txt first - see Python-Packages.md)
pip install -r requirements.txt
```

### Step 3: Create Core Configuration

**Create `backend/app/core/config.py`:**

```python
"""
Application configuration using Pydantic Settings.
Loads configuration from environment variables and .env file.
"""

from pydantic_settings import BaseSettings
from typing import List
import os


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # Environment
    environment: str = "development"

    # Server
    api_version: str = "1.0.0"
    upload_folder: str = "./uploads"
    max_content_length: int = 500 * 1024 * 1024  # 500MB

    # CORS - comma-separated list of allowed origins
    allowed_origins: str = "http://localhost:3000,http://localhost:5173"

    @property
    def allowed_origins_list(self) -> List[str]:
        """Parse comma-separated origins into a list."""
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]

    # Azure AD Authentication
    auth_tenant_id: str = ""
    auth_client_id: str = ""
    allowed_groups: str = ""

    @property
    def allowed_groups_list(self) -> List[str]:
        """Parse comma-separated group IDs into a list."""
        if not self.allowed_groups:
            return []
        return [g.strip() for g in self.allowed_groups.split(",") if g.strip()]

    @property
    def is_auth_enabled(self) -> bool:
        """Check if authentication is enabled (tenant ID is configured)."""
        return bool(self.auth_tenant_id)

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"


# Global settings instance
settings = Settings()

# Ensure upload folder exists
os.makedirs(settings.upload_folder, exist_ok=True)
```

**Create `backend/app/models/user.py`:**

```python
"""User model for authenticated requests."""

from pydantic import BaseModel
from typing import Optional, List


class CurrentUser(BaseModel):
    """Represents the currently authenticated user."""
    oid: str  # Azure AD Object ID
    username: Optional[str] = None
    name: Optional[str] = None
    email: Optional[str] = None
    groups: List[str] = []
```

**Create `backend/app/core/security.py`:**

```python
"""
Security layer for FastAPI with Azure AD JWT authentication.
"""

import logging
from typing import Optional

import jwt
from jwt import PyJWKClient
from fastapi import HTTPException, Security, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from ..models.user import CurrentUser
from .config import settings

logger = logging.getLogger(__name__)

security = HTTPBearer(auto_error=False)
_jwks_client: Optional[PyJWKClient] = None


def get_jwks_client() -> Optional[PyJWKClient]:
    """Get or create the JWKS client for token validation."""
    global _jwks_client
    if _jwks_client is None and settings.auth_tenant_id:
        jwks_uri = f"https://login.microsoftonline.com/{settings.auth_tenant_id}/discovery/v2.0/keys"
        _jwks_client = PyJWKClient(jwks_uri)
    return _jwks_client


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Security(security),
) -> CurrentUser:
    """Dependency to get current authenticated user from JWT token."""

    # Skip auth in development mode
    if not settings.is_auth_enabled:
        logger.info("Authentication skipped - development mode")
        return CurrentUser(
            oid="local-dev-user",
            username="local@dev.com",
            name="Local Development User",
            email="local@dev.com",
            groups=[]
        )

    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No authentication credentials provided",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = credentials.credentials

    try:
        jwks_client = get_jwks_client()
        if not jwks_client:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Authentication not properly configured"
            )

        signing_key = jwks_client.get_signing_key_from_jwt(token)

        decoded = jwt.decode(
            token,
            signing_key.key,
            algorithms=['RS256'],
            audience=[settings.auth_client_id, f'api://{settings.auth_client_id}'],
            issuer=[
                f'https://login.microsoftonline.com/{settings.auth_tenant_id}/v2.0',
                f'https://sts.windows.net/{settings.auth_tenant_id}/'
            ]
        )

        username = (
            decoded.get('preferred_username') or
            decoded.get('upn') or
            decoded.get('email')
        )
        email = decoded.get('email') or decoded.get('preferred_username')
        oid = decoded.get('oid') or decoded.get('sub')

        # Check group membership if configured
        if settings.allowed_groups_list:
            user_groups = decoded.get('groups', [])
            if not any(g in user_groups for g in settings.allowed_groups_list):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Access denied. User not in authorized group."
                )

        if not oid:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token missing required claims",
            )

        return CurrentUser(
            oid=oid,
            username=username,
            name=decoded.get('name'),
            email=email,
            groups=decoded.get('groups', [])
        )

    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired")
    except jwt.InvalidAudienceError:
        raise HTTPException(status_code=401, detail="Invalid token audience")
    except jwt.InvalidIssuerError:
        raise HTTPException(status_code=401, detail="Invalid token issuer")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {str(e)}")


async def get_current_user_optional(
    credentials: HTTPAuthorizationCredentials = Security(security),
) -> Optional[CurrentUser]:
    """Optional auth - returns None if no token provided."""
    if not credentials:
        return None
    return await get_current_user(credentials)
```

### Step 4: Create Health Check Router

**Create `backend/app/routers/health.py`:**

```python
"""Health check endpoint."""

from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
async def health_check():
    """Health check endpoint - returns API status."""
    return {"status": "healthy", "message": "API is running"}
```

### Step 5: Create Main Application

**Create `backend/app/main.py`:**

```python
"""
FastAPI Application Entry Point
"""

import os
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .core.config import settings
from .routers import health

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    logger.info("Starting API...")
    logger.info(f"Allowed origins: {settings.allowed_origins_list}")
    logger.info(f"Auth enabled: {settings.is_auth_enabled}")
    yield
    logger.info("Shutting down API...")


# Create FastAPI application
app = FastAPI(
    title="Arcline Application API",
    description="REST API for Arcline Application",
    version=settings.api_version,
    lifespan=lifespan,
)

# CORS Configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)

# Register routers
app.include_router(health.router, tags=["health"])

# Add your routers here:
# app.include_router(your_router.router, prefix="/api/your-feature", tags=["your-feature"])


@app.get("/")
async def root():
    """Root endpoint with API information."""
    return {
        "name": "Arcline Application API",
        "version": settings.api_version,
        "docs": "/docs",
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
```

---

## Branding Assets Setup

When you have access to the Arcline branding assets in this repository, copy them to your new project:

### Step 1: Copy Logo Files

From the framework repository, copy:
- `assets/arcline-logo.png` → `frontend/public/arcline-logo.png`
- `assets/arcline-logo-dark.png` → `frontend/public/arcline-logo-dark.png`
- `assets/favicon.ico` → `frontend/public/favicon.ico`

### Step 2: Update index.html

Ensure `frontend/index.html` references the favicon:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/x-icon" href="/favicon.ico" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>App Name | Arcline</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

---

## Development Workflow

### CRITICAL: Allowed Frontend Ports

The Azure AD dev app registration only allows these redirect URIs:

| Port | URL | Status |
|------|-----|--------|
| **3000** | `http://localhost:3000` | **Primary (use this)** |
| **5173** | `http://localhost:5173` | Alternate |

**Authentication will FAIL on any other port.** The `vite.config.js` is configured with `strictPort: true` to prevent auto-incrementing to an invalid port.

### Handling Port Conflicts

If port 3000 is already in use, kill the existing process:

**Windows:**
```bash
# Kill whatever is using port 3000
for /f "tokens=5" %a in ('netstat -ano ^| findstr :3000') do taskkill /PID %a /F
```

**macOS/Linux:**
```bash
# Kill whatever is using port 3000
lsof -ti:3000 | xargs kill -9
```

### Starting the Development Servers

**Terminal 1 - Backend:**
```bash
cd backend
# Activate virtual environment
venv\Scripts\activate  # Windows
source venv/bin/activate  # macOS/Linux

# Run FastAPI with hot reload
uvicorn app.main:app --reload --port 8000
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev
```

If you see "Port 3000 is already in use", run the kill command above first.

### Accessing the Application

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:8000
- **API Documentation**: http://localhost:8000/docs (Swagger UI)
- **Alternative API Docs**: http://localhost:8000/redoc (ReDoc)

---

## Environment Variables

### Frontend (`frontend/.env`)

```env
# API Configuration
VITE_API_BASE_URL=http://localhost:8000

# Azure AD Authentication - Arcline Dev App
VITE_AZURE_CLIENT_ID=d8735fe7-83ab-4e0c-ae5c-e27f2a0c2936
VITE_AZURE_TENANT_ID=ecb62b6d-1041-494a-8b76-7fa15aa9a737
VITE_REDIRECT_URI=http://localhost:3000
```

### Backend (`backend/.env`)

```env
# Environment
ENVIRONMENT=development

# Server
API_VERSION=1.0.0
UPLOAD_FOLDER=./uploads

# CORS (comma-separated origins)
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173

# Azure AD Authentication - Arcline Dev App
AUTH_TENANT_ID=ecb62b6d-1041-494a-8b76-7fa15aa9a737
AUTH_CLIENT_ID=d8735fe7-83ab-4e0c-ae5c-e27f2a0c2936
ALLOWED_GROUPS=
```

### Create .env.example Files

Always create `.env.example` files with placeholder values for documentation:

```env
# Copy this file to .env and fill in your values
VITE_API_BASE_URL=http://localhost:8000
VITE_AZURE_CLIENT_ID=your-client-id-here
VITE_AZURE_TENANT_ID=your-tenant-id-here
VITE_REDIRECT_URI=http://localhost:3000
```

---

## Migration Guide

### Migrating from Plain HTML/CSS/JS

1. **Analyze existing functionality**
   - List all HTML pages and their purposes
   - Identify JavaScript logic that needs to be preserved
   - Note any backend API calls

2. **Create new folder structure** (as shown above)

3. **Convert HTML pages to React components**
   ```jsx
   // Old: index.html
   // New: src/App.jsx or src/pages/HomePage.jsx
   ```

4. **Convert CSS to Tailwind classes**
   ```css
   /* Old CSS */
   .header { background-color: #234948; padding: 16px; }
   ```
   ```jsx
   // New Tailwind
   <header className="bg-primary p-4">
   ```

5. **Move JavaScript logic to React hooks/services**

6. **Remove old files** once migration is verified

### Migrating from Flask to FastAPI

1. **Keep existing business logic** (data processing, etc.)

2. **Convert Flask routes to FastAPI routers:**
   ```python
   # Old Flask
   @app.route('/api/data', methods=['POST'])
   def get_data():
       return jsonify({"data": data})

   # New FastAPI
   @router.post("/data")
   async def get_data():
       return {"data": data}
   ```

3. **Convert request handling:**
   ```python
   # Old Flask
   file = request.files['file']
   data = request.json

   # New FastAPI
   async def upload(file: UploadFile = File(...)):
   async def create(data: DataModel):
   ```

4. **Update authentication** to use the security.py module

---

## Git Configuration

Create `project-root/.gitignore`:

```gitignore
# Dependencies
node_modules/
venv/
__pycache__/
*.pyc

# Environment files
.env
.env.local
.env.*.local

# Build outputs
dist/
build/
*.egg-info/

# IDE
.vscode/
.idea/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Application specific
uploads/
*.log
```

---

## Checklist for New Projects

### Initial Setup
- [ ] Created `frontend/` and `backend/` directories
- [ ] Initialized Vite React app in frontend
- [ ] Created Python virtual environment in backend
- [ ] Installed all frontend npm packages
- [ ] Installed all backend pip packages

### Frontend Configuration
- [ ] Configured `vite.config.js` with Tailwind plugin
- [ ] Created `tailwind.config.js` with Arcline theme
- [ ] Added Arcline colors to `index.css`
- [ ] Created `lib/utils.js` with `cn` function
- [ ] Set up `theme-provider.jsx`
- [ ] Created core UI components (button, card, etc.)
- [ ] Configured path aliases in `jsconfig.json`

### Backend Configuration
- [ ] Created `app/core/config.py` with Settings
- [ ] Created `app/core/security.py` with auth
- [ ] Created `app/models/user.py`
- [ ] Created `app/routers/health.py`
- [ ] Created `app/main.py` with FastAPI app
- [ ] Configured CORS

### Branding
- [ ] Copied Arcline logos to `public/`
- [ ] Set up favicon in `index.html`

### Environment
- [ ] Created `frontend/.env` with config
- [ ] Created `backend/.env` with config
- [ ] Created `.env.example` files for documentation

### Testing
- [ ] Backend starts without errors (`uvicorn app.main:app --reload`)
- [ ] Frontend starts without errors (`npm run dev`)
- [ ] Health endpoint returns 200 (`/health`)
- [ ] Frontend can reach backend API
- [ ] Dark mode toggle works
