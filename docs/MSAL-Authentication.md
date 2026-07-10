# MSAL Authentication Setup

This guide explains how to implement Microsoft Authentication Library (MSAL) authentication in Arcline applications. It covers both frontend (React) and backend (FastAPI) integration with Azure AD.

---

## Quick Start for Claude

When setting up authentication for a new application:

1. **Generate the `.env` files** with the development credentials below
2. **Install MSAL packages** on the frontend
3. **Copy the auth configuration files** to the appropriate locations
4. **Wrap the app with MsalProvider** in `main.jsx`
5. **Add the security layer** to the backend

For production, the user will need to register their own Azure AD app and update the credentials.

---

## Table of Contents

- [Development Credentials](#development-credentials)
- [Frontend Setup](#frontend-setup)
  - [Access Denied Page](#step-7-access-denied-page-group-based-authorization)
- [Backend Setup](#backend-setup)
- [Environment Files](#environment-files)
- [Authentication Flow](#authentication-flow)
- [Common Patterns](#common-patterns)
- [Troubleshooting](#troubleshooting)
- [Production Setup](#production-setup)

---

## Development Credentials

Use these credentials for local development and testing. They connect to the Arcline Development App Registration in Azure AD.

```
Client ID:     d8735fe7-83ab-4e0c-ae5c-e27f2a0c2936
Tenant ID:     ecb62b6d-1041-494a-8b76-7fa15aa9a737
Redirect URI:  http://localhost:3000 (primary) or http://localhost:5173 (alternate)
API Scope:     api://d8735fe7-83ab-4e0c-ae5c-e27f2a0c2936/access_as_user
```

---

## CRITICAL: Allowed Development Ports

The Azure AD app registration only has redirect URIs configured for these ports:

| Port | URL | Usage |
|------|-----|-------|
| **3000** | `http://localhost:3000` | Primary development port (recommended) |
| **5173** | `http://localhost:5173` | Alternate port (Vite default) |

**Authentication will FAIL if you run the frontend on any other port.**

### Handling Port Conflicts

If port 3000 or 5173 is already in use, you must kill the existing process before starting the dev server:

**Windows:**
```bash
# Find what's using port 3000
netstat -ano | findstr :3000

# Kill the process (replace PID with the number from above)
taskkill /PID <PID> /F

# Or use this one-liner to kill whatever is on port 3000
for /f "tokens=5" %a in ('netstat -ano ^| findstr :3000') do taskkill /PID %a /F
```

**macOS/Linux:**
```bash
# Find and kill whatever is on port 3000
lsof -ti:3000 | xargs kill -9

# Or for port 5173
lsof -ti:5173 | xargs kill -9
```

### For Claude: Port Conflict Resolution

When starting the frontend development server:

1. **Always attempt to use port 3000 first** (configured in vite.config.js)
2. **If port 3000 is in use**, kill the existing process before starting
3. **If port 3000 cannot be freed**, use port 5173 as fallback
4. **Never use any other port** - authentication will not work

```bash
# Standard startup sequence
cd frontend
npm run dev  # Will use port 3000 as configured
```

If you see "Port 3000 is already in use", run the kill command above first.

---

## Frontend Setup

### Step 1: Install MSAL Packages

```bash
cd frontend
npm install @azure/msal-browser @azure/msal-react
```

### Step 2: Create Auth Configuration

Create `frontend/src/config/authConfig.js`:

```javascript
/**
 * MSAL Authentication Configuration
 * Connects to Azure AD for user authentication
 */

import { LogLevel } from "@azure/msal-browser";

// MSAL configuration
export const msalConfig = {
  auth: {
    clientId: import.meta.env.VITE_AZURE_CLIENT_ID || "",
    authority: `https://login.microsoftonline.com/${import.meta.env.VITE_AZURE_TENANT_ID}`,
    redirectUri: import.meta.env.VITE_REDIRECT_URI || "http://localhost:3000",
  },
  cache: {
    cacheLocation: "localStorage", // Use localStorage for single-page apps
    storeAuthStateInCookie: false, // Set to true for IE11/Edge legacy
  },
  system: {
    loggerOptions: {
      loggerCallback: (level, message, containsPii) => {
        if (containsPii) return; // Never log PII
        switch (level) {
          case LogLevel.Error:
            console.error(message);
            break;
          case LogLevel.Warning:
            console.warn(message);
            break;
          case LogLevel.Info:
            // Uncomment for debugging:
            // console.info(message);
            break;
          case LogLevel.Verbose:
            // Uncomment for debugging:
            // console.debug(message);
            break;
        }
      },
    },
  },
};

// Scopes for login request (basic profile)
export const loginRequest = {
  scopes: ["User.Read"],
};

// Scopes for API access token
export const apiRequest = {
  scopes: [`api://${import.meta.env.VITE_AZURE_CLIENT_ID}/access_as_user`],
};
```

### Step 3: Create Auth Hook

Create `frontend/src/hooks/useAuth.js`:

```javascript
/**
 * Custom hook for MSAL authentication
 * Provides login, logout, and token acquisition
 */

import { useMsal, useAccount } from "@azure/msal-react";
import { loginRequest, apiRequest } from "../config/authConfig";

export function useAuth() {
  const { instance, accounts } = useMsal();
  const account = useAccount(accounts[0] || {});

  /**
   * Check if user is authenticated
   */
  const isAuthenticated = !!account;

  /**
   * Initiate login redirect
   */
  const login = async () => {
    try {
      await instance.loginRedirect(loginRequest);
    } catch (error) {
      console.error("Login failed:", error);
      throw error;
    }
  };

  /**
   * Initiate logout redirect
   */
  const logout = () => {
    instance.logoutRedirect({
      postLogoutRedirectUri: window.location.origin,
    });
  };

  /**
   * Get access token for API calls
   * Attempts silent acquisition first, falls back to popup
   */
  const getAccessToken = async () => {
    if (!account) return null;

    try {
      // Try silent token acquisition first
      const response = await instance.acquireTokenSilent({
        ...apiRequest,
        account,
      });
      return response.accessToken;
    } catch (error) {
      // Silent acquisition failed, try popup
      try {
        const response = await instance.acquireTokenPopup(apiRequest);
        return response.accessToken;
      } catch (popupError) {
        console.error("Token acquisition failed:", popupError);
        return null;
      }
    }
  };

  /**
   * Get current user information
   */
  const getUser = () => {
    if (!account) return null;

    return {
      id: account.localAccountId,
      name: account.name,
      email: account.username,
      tenantId: account.tenantId,
    };
  };

  return {
    isAuthenticated,
    account,
    login,
    logout,
    getAccessToken,
    getUser,
  };
}
```

### Step 4: Update Main Entry Point

Update `frontend/src/main.jsx`:

```jsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PublicClientApplication } from '@azure/msal-browser'
import { MsalProvider } from '@azure/msal-react'
import { ThemeProvider } from './components/theme-provider'
import { msalConfig } from './config/authConfig'
import App from './App'
import './index.css'

// Create MSAL instance
const msalInstance = new PublicClientApplication(msalConfig);

// Initialize MSAL before rendering
msalInstance.initialize().then(() => {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <MsalProvider instance={msalInstance}>
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
          <App />
        </ThemeProvider>
      </MsalProvider>
    </StrictMode>,
  )
});
```

### Step 5: Create Login Page / Component

```jsx
// src/components/LoginCard.jsx
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '../hooks/useAuth';

export function LoginCard() {
  const { login } = useAuth();

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Welcome</CardTitle>
        <CardDescription>
          Sign in with your Microsoft account to continue
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={login} className="w-full" size="lg">
          Sign in with Microsoft
        </Button>
      </CardContent>
    </Card>
  );
}
```

### Step 6: Conditional Rendering Based on Auth State

```jsx
// src/App.jsx
import { useAuth } from './hooks/useAuth';
import { LoginCard } from './components/LoginCard';
import { MainApp } from './components/MainApp';

function App() {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <LoginCard />
      </div>
    );
  }

  return <MainApp />;
}

export default App;
```

### Step 7: Access Denied Page (Group-Based Authorization)

When users authenticate successfully but are not members of the allowed security groups, they should be redirected to an Access Denied page. This happens when `ALLOWED_GROUPS` is configured on the backend and returns a 403 response.

#### Create Auth Utilities

Create `src/utils/authUtils.js` to handle authenticated requests and 403 errors:

```javascript
/**
 * Authentication Utilities
 * Provides authenticated fetch wrapper and access denied error handling
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

/**
 * Custom error class for access denied (403) responses
 */
export class AccessDeniedError extends Error {
  constructor(message = 'Access denied - user not in authorized security group') {
    super(message);
    this.name = 'AccessDeniedError';
  }
}

/**
 * Fetch wrapper that handles authentication and access denied errors
 *
 * @param {string} endpoint - API endpoint (e.g., '/auth/verify')
 * @param {Function} getAccessToken - Async function to get auth token
 * @param {Object} options - Fetch options
 * @returns {Promise<Response>} - Fetch response
 * @throws {AccessDeniedError} - When user is authenticated but not authorized (403)
 */
export async function authenticatedFetch(endpoint, getAccessToken, options = {}) {
  const headers = {
    ...options.headers,
  };

  // Add Content-Type for JSON bodies (not for FormData)
  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  // Add Bearer token if getAccessToken is provided
  if (getAccessToken) {
    try {
      const token = await getAccessToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    } catch (error) {
      console.error('Failed to get access token:', error);
      throw new Error('Authentication failed. Please log in again.');
    }
  }

  const url = `${API_BASE_URL}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers,
  });

  // Check for 403 Forbidden (access denied due to security group)
  if (response.status === 403) {
    throw new AccessDeniedError();
  }

  // Check for 401 Unauthorized
  if (response.status === 401) {
    throw new Error('Authentication failed. Please log in again.');
  }

  return response;
}

/**
 * Check if user has access to the application by calling the verify endpoint
 *
 * @param {Function} getAccessToken - Async function to get auth token
 * @returns {Promise<boolean>} - True if user has access, throws AccessDeniedError if not
 */
export async function checkUserAccess(getAccessToken) {
  try {
    const response = await authenticatedFetch('/auth/verify', getAccessToken);
    return response.ok;
  } catch (error) {
    if (error instanceof AccessDeniedError) {
      throw error;
    }
    // For other errors, we might still have access - let main app handle it
    console.error('Access check failed:', error);
    return true;
  }
}
```

#### Add Backend Verification Endpoint

Add the `/auth/verify` endpoint to your FastAPI backend:

```python
# backend/app/main.py (or routes/auth.py)
from fastapi import APIRouter, Depends
from app.core.security import get_current_user
from app.models.user import CurrentUser

router = APIRouter(prefix="/auth", tags=["auth"])

@router.get("/verify")
async def verify_access(current_user: CurrentUser = Depends(get_current_user)):
    """
    Verify the user has access to the application.
    Returns 200 if authorized, 403 if not in allowed groups (handled by get_current_user).
    """
    return {
        "status": "authorized",
        "user": {
            "oid": current_user.oid,
            "name": current_user.name,
            "email": current_user.email
        }
    }
```

#### Create Access Denied Component

Create `src/components/AccessDenied.jsx`:

```jsx
/**
 * Access Denied Component
 * Displayed when a user is authenticated but not authorized (not in allowed security groups)
 */

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ShieldX, RefreshCw, LogOut } from 'lucide-react';

function AccessDenied({ onLogout, onRetry, userEmail }) {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-destructive/10 flex items-center justify-center">
            <ShieldX className="w-8 h-8 text-destructive" />
          </div>
          <CardTitle className="text-2xl">Access Denied</CardTitle>
          <CardDescription className="space-y-2">
            <p>You don't have permission to access this application.</p>
            {userEmail && (
              <p className="text-sm font-medium mt-2">
                Signed in as: {userEmail}
              </p>
            )}
            <p className="text-sm mt-2">
              Please contact your administrator to request access.
            </p>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button className="w-full" variant="outline" onClick={onRetry}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Try Again
          </Button>
          <Button className="w-full" variant="secondary" onClick={onLogout}>
            <LogOut className="mr-2 h-4 w-4" />
            Sign Out & Use Different Account
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default AccessDenied;
```

#### Update App with Access Verification Flow

Update `src/App.jsx` to verify access after login using a dedicated endpoint. Uses a ref to prevent multiple auth checks per session:

```jsx
// src/App.jsx
import { useState, useEffect, useRef } from 'react';
import { useTheme } from 'next-themes';
import { useAuth } from './hooks/useAuth';
import { AccessDeniedError, checkUserAccess } from './utils/authUtils';
import AccessDenied from './components/AccessDenied';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';
import { Loader2, Moon, Sun } from 'lucide-react';

function App() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const { isAuthenticated, login, logout, getAccessToken, getUser } = useAuth();
  const user = getUser();

  // Access control state
  const [isAccessDenied, setIsAccessDenied] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(false);
  const hasCheckedAuth = useRef(false);

  // Reset auth check flag when user logs out
  useEffect(() => {
    if (!isAuthenticated) {
      hasCheckedAuth.current = false;
      setIsAccessDenied(false);
    }
  }, [isAuthenticated]);

  // Check authorization after login
  useEffect(() => {
    const checkAuthorization = async () => {
      // Only check once per authentication session
      if (!isAuthenticated || isAccessDenied || hasCheckedAuth.current) return;

      hasCheckedAuth.current = true;
      setIsCheckingAuth(true);
      try {
        await checkUserAccess(getAccessToken);
        // If we get here, user has access
      } catch (error) {
        if (error instanceof AccessDeniedError) {
          setIsAccessDenied(true);
        } else {
          console.error('Auth check failed:', error);
        }
      } finally {
        setIsCheckingAuth(false);
      }
    };

    checkAuthorization();
  }, [isAuthenticated, isAccessDenied]);

  // Handle retry access check
  const handleRetryAccess = () => {
    hasCheckedAuth.current = false;
    setIsAccessDenied(false);
    // The useEffect above will re-run the authorization check
  };

  // --- LOGIN PAGE ---
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex justify-center items-center px-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-8 pb-8 text-center space-y-6">
            <div className="flex justify-center">
              <img
                src={resolvedTheme === 'dark' ? '/Arcline-Logo-White.svg' : '/Arcline-Logo-Black.svg'}
                alt="Arcline"
                className="h-12"
              />
            </div>
            <div>
              <CardTitle className="text-2xl text-primary">App Name</CardTitle>
              <CardDescription className="mt-2">Sign in to continue</CardDescription>
            </div>
            <Button onClick={login} size="lg" className="w-full">
              Sign in with Microsoft
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // --- CHECKING AUTHORIZATION ---
  if (isCheckingAuth) {
    return (
      <div className="min-h-screen bg-background flex justify-center items-center px-4">
        <Card className="w-full max-w-md">
          <CardContent className="py-12 text-center space-y-4">
            <div className="flex justify-center">
              <img
                src={resolvedTheme === 'dark' ? '/Arcline-Logo-White.svg' : '/Arcline-Logo-Black.svg'}
                alt="Arcline"
                className="h-10"
              />
            </div>
            <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
            <div>
              <CardTitle className="text-xl">Verifying Access...</CardTitle>
              <CardDescription className="mt-2">
                Please wait while we check your permissions
              </CardDescription>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // --- ACCESS DENIED ---
  if (isAccessDenied) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        {/* Header */}
        <header className="sticky top-0 z-50 w-full border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/60">
          <div className="container mx-auto flex h-14 items-center justify-between px-4">
            <div className="flex items-center gap-3">
              <img
                src={resolvedTheme === 'dark' ? '/Arcline-Logo-White.svg' : '/Arcline-Logo-Black.svg'}
                alt="Arcline"
                className="h-8"
              />
              <div className="h-8 w-px bg-border"></div>
              <h1 className="text-xl font-semibold text-foreground">App Name</h1>
            </div>
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
              >
                <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
                <span className="sr-only">Toggle theme</span>
              </Button>
            </div>
          </div>
        </header>
        <main className="flex-1 w-full">
          <div className="container mx-auto px-4 py-8">
            <AccessDenied
              onLogout={logout}
              onRetry={handleRetryAccess}
              userEmail={user?.email}
            />
          </div>
        </main>
      </div>
    );
  }

  // --- MAIN APPLICATION ---
  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/60">
        <div className="container mx-auto flex h-14 items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <img
              src={resolvedTheme === 'dark' ? '/Arcline-Logo-White.svg' : '/Arcline-Logo-Black.svg'}
              alt="Arcline"
              className="h-8"
            />
            <div className="h-8 w-px bg-border"></div>
            <h1 className="text-xl font-semibold text-foreground">App Name</h1>
          </div>
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            >
              <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
              <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
              <span className="sr-only">Toggle theme</span>
            </Button>
            {user && (
              <span className="text-sm text-muted-foreground hidden md:block">{user.name}</span>
            )}
            <Button variant="outline" size="sm" onClick={logout}>
              Logout
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full">
        <div className="container mx-auto px-4 py-8">
          {/* Your app content here */}
        </div>
      </main>
    </div>
  );
}

export default App;
```

---

## Backend Setup

### Step 1: Install Required Packages

```bash
pip install PyJWT cryptography
```

### Step 2: Create Security Module

Create `backend/app/core/security.py`:

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

# HTTP Bearer security scheme
security = HTTPBearer(auto_error=False)

# JWKS client for Azure AD key fetching (initialized lazily)
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
    """
    Dependency to get current authenticated user from JWT token.

    In development mode (AUTH_TENANT_ID not set), returns a mock user.
    In production, validates the JWT token against Azure AD.
    """
    # Development mode - skip auth if tenant ID not configured
    if not settings.is_auth_enabled:
        logger.info("Auth skipped - development mode (AUTH_TENANT_ID not set)")
        return CurrentUser(
            oid="local-dev-user",
            username="local@dev.com",
            name="Local Development User",
            email="local@dev.com",
            groups=[]
        )

    # Production mode - require valid token
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No authentication credentials provided",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = credentials.credentials

    try:
        # Get the JWKS client
        jwks_client = get_jwks_client()
        if not jwks_client:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Authentication not properly configured"
            )

        # Get the signing key from JWKS
        signing_key = jwks_client.get_signing_key_from_jwt(token)

        # Verify and decode token
        decoded = jwt.decode(
            token,
            signing_key.key,
            algorithms=['RS256'],
            audience=[
                settings.auth_client_id,
                f'api://{settings.auth_client_id}'
            ],
            issuer=[
                f'https://login.microsoftonline.com/{settings.auth_tenant_id}/v2.0',
                f'https://sts.windows.net/{settings.auth_tenant_id}/'
            ]
        )

        # Extract user identifier from various possible claims
        username = (
            decoded.get('preferred_username') or
            decoded.get('upn') or
            decoded.get('unique_name') or
            decoded.get('email')
        )
        email = (
            decoded.get('email') or
            decoded.get('preferred_username') or
            decoded.get('upn')
        )
        oid = decoded.get('oid') or decoded.get('sub')

        logger.info(f"Token validated for user: {username or oid or 'unknown'}")

        # Check group membership if ALLOWED_GROUPS is configured
        if settings.allowed_groups_list:
            user_groups = decoded.get('groups', [])
            if not any(g in user_groups for g in settings.allowed_groups_list):
                logger.warning(f"Access denied for user {username} - not in required groups")
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Access denied. User not in authorized group."
                )

        if not oid:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token missing required 'oid' or 'sub' claim",
                headers={"WWW-Authenticate": "Bearer"},
            )

        return CurrentUser(
            oid=oid,
            username=username,
            name=decoded.get('name'),
            email=email,
            groups=decoded.get('groups', [])
        )

    except jwt.ExpiredSignatureError:
        logger.warning("Token has expired")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.InvalidAudienceError:
        logger.warning("Invalid token audience")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token audience",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.InvalidIssuerError:
        logger.warning("Invalid token issuer")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token issuer",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Token validation failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {str(e)}",
            headers={"WWW-Authenticate": "Bearer"},
        )


async def get_current_user_optional(
    credentials: HTTPAuthorizationCredentials = Security(security),
) -> Optional[CurrentUser]:
    """
    Optional auth dependency - returns None if no token provided.
    Useful for endpoints that work for both authenticated and anonymous users.
    """
    if not credentials:
        return None
    return await get_current_user(credentials)
```

### Step 3: Create User Model

Create `backend/app/models/user.py`:

```python
"""User model for authenticated requests."""

from pydantic import BaseModel
from typing import Optional, List


class CurrentUser(BaseModel):
    """Represents the currently authenticated user."""
    oid: str  # Azure AD Object ID (unique identifier)
    username: Optional[str] = None
    name: Optional[str] = None
    email: Optional[str] = None
    groups: List[str] = []
```

### Step 4: Update Configuration

Update `backend/app/core/config.py`:

```python
"""Application configuration."""

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

    # CORS
    allowed_origins: str = "http://localhost:3000,http://localhost:5173"

    @property
    def allowed_origins_list(self) -> List[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]

    # Azure AD Authentication
    auth_tenant_id: str = ""
    auth_client_id: str = ""
    allowed_groups: str = ""

    @property
    def allowed_groups_list(self) -> List[str]:
        if not self.allowed_groups:
            return []
        return [g.strip() for g in self.allowed_groups.split(",") if g.strip()]

    @property
    def is_auth_enabled(self) -> bool:
        """Auth is enabled when tenant ID is configured."""
        return bool(self.auth_tenant_id)

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"


settings = Settings()
os.makedirs(settings.upload_folder, exist_ok=True)
```

---

## Environment Files

### Frontend Environment File

Create `frontend/.env`:

```env
# API Configuration
VITE_API_BASE_URL=http://localhost:8000

# Azure AD Authentication - Arcline Dev App
VITE_AZURE_CLIENT_ID=d8735fe7-83ab-4e0c-ae5c-e27f2a0c2936
VITE_AZURE_TENANT_ID=ecb62b6d-1041-494a-8b76-7fa15aa9a737
VITE_REDIRECT_URI=http://localhost:3000
```

### Backend Environment File

Create `backend/.env`:

```env
# Environment
ENVIRONMENT=development

# Server
API_VERSION=1.0.0
UPLOAD_FOLDER=./uploads

# CORS (comma-separated origins)
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173

# Azure AD Authentication - Arcline Dev App
# Leave AUTH_TENANT_ID empty to disable auth for local development
AUTH_TENANT_ID=ecb62b6d-1041-494a-8b76-7fa15aa9a737
AUTH_CLIENT_ID=d8735fe7-83ab-4e0c-ae5c-e27f2a0c2936

# Optional: Restrict access to specific security groups (comma-separated group IDs)
ALLOWED_GROUPS=
```

### Development Mode (No Auth)

To run without authentication during development, simply leave the `AUTH_TENANT_ID` empty in the backend `.env`:

```env
# Leave empty to disable authentication
AUTH_TENANT_ID=
AUTH_CLIENT_ID=
```

The backend will return a mock user for all requests.

---

## Authentication Flow

### Login Flow

```
1. User clicks "Sign In" button
2. Frontend calls instance.loginRedirect(loginRequest)
3. Browser redirects to Microsoft login page
4. User enters Microsoft credentials
5. Microsoft validates credentials
6. Browser redirects back to app with tokens
7. MSAL stores tokens in localStorage
8. App renders authenticated content
```

### API Request Flow

```
1. Frontend needs to call API
2. Frontend calls getAccessToken()
3. MSAL checks for cached token
4. If valid cached token exists → return it
5. If token expired → silently refresh
6. If refresh fails → popup for re-auth
7. Frontend adds token to Authorization header
8. Backend receives request
9. Backend extracts token from header
10. Backend validates token with Azure AD JWKS
11. Backend extracts user info from token claims
12. Backend processes request
13. Response returned to frontend
```

### Token Claims

The JWT token contains these useful claims:

| Claim | Description |
|-------|-------------|
| `oid` | User's unique Object ID |
| `preferred_username` | User's email/UPN |
| `name` | User's display name |
| `email` | User's email address |
| `groups` | Security group IDs (if configured) |
| `exp` | Token expiration timestamp |
| `aud` | Token audience (your app's client ID) |
| `iss` | Token issuer (Azure AD) |

---

## Common Patterns

### Protected Component

```jsx
import { useAuth } from '../hooks/useAuth';

function ProtectedContent() {
  const { isAuthenticated, getUser } = useAuth();
  const user = getUser();

  if (!isAuthenticated) {
    return <div>Please sign in to view this content.</div>;
  }

  return (
    <div>
      <h1>Welcome, {user.name}!</h1>
      <p>Email: {user.email}</p>
    </div>
  );
}
```

### API Call with Authentication

```jsx
import { useAuth } from '../hooks/useAuth';
import { apiService } from '../services/ApiService';

function DataComponent() {
  const { getAccessToken } = useAuth();
  const [data, setData] = useState(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const result = await apiService.getData(getAccessToken);
        setData(result);
      } catch (error) {
        console.error('Failed to fetch data:', error);
      }
    }
    fetchData();
  }, [getAccessToken]);

  return <div>{data ? JSON.stringify(data) : 'Loading...'}</div>;
}
```

### Header with User Info and Logout

```jsx
import { useAuth } from '../hooks/useAuth';
import { User, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';

function Header() {
  const { isAuthenticated, getUser, logout } = useAuth();
  const user = getUser();

  return (
    <header className="border-b bg-card">
      <div className="container mx-auto px-4 py-3 flex justify-between items-center">
        <h1 className="text-lg font-semibold">My App</h1>

        {isAuthenticated && (
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm">
              <User className="h-4 w-4" />
              <span>{user?.name}</span>
            </div>
            <Button variant="ghost" size="sm" onClick={logout}>
              <LogOut className="h-4 w-4 mr-2" />
              Sign Out
            </Button>
          </div>
        )}
      </div>
    </header>
  );
}
```

---

## Troubleshooting

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `AADSTS65001` | Admin consent required | Have admin grant consent in Azure portal |
| `AADSTS700016` | App not found | Verify client ID is correct |
| `AADSTS50011` | Redirect URI mismatch | Add correct URI in Azure portal |
| `Token has expired` | Token TTL exceeded | Token will auto-refresh on next call |
| `Invalid audience` | Wrong client ID | Check VITE_AZURE_CLIENT_ID matches |
| `groups claim missing` | Token config not set | Enable groups claim in Azure AD |

### Debug Token Contents

Use [jwt.ms](https://jwt.ms) to decode and inspect tokens during development.

```javascript
// Log decoded token in browser console
const token = await getAccessToken();
const decoded = JSON.parse(atob(token.split('.')[1]));
console.log('Token claims:', decoded);
```

### Check Authentication Status

```javascript
// In browser console
const accounts = msalInstance.getAllAccounts();
console.log('Logged in accounts:', accounts);

// Check token cache
console.log('Token cache:', msalInstance.getTokenCache());
```

---

## Production Setup

When deploying to production, you'll need to:

### 1. Create Your Own App Registration

1. Go to **Azure Portal** > **Azure Active Directory** > **App registrations**
2. Click **New registration**
3. Fill in:
   - Name: `Your App Name`
   - Supported account types: Single tenant
   - Redirect URI: Your production URL (e.g., `https://your-app.azurestaticapps.net`)

### 2. Configure Token Claims

1. Go to **Token configuration**
2. Add **groups claim** if needed

### 3. Expose an API

1. Go to **Expose an API**
2. Set Application ID URI
3. Add scope: `access_as_user`

### 4. Update Environment Variables

```env
# Production frontend/.env
VITE_AZURE_CLIENT_ID=your-production-client-id
VITE_AZURE_TENANT_ID=your-production-tenant-id
VITE_REDIRECT_URI=https://your-app.azurestaticapps.net
```

```env
# Production backend/.env
AUTH_TENANT_ID=your-production-tenant-id
AUTH_CLIENT_ID=your-production-client-id
ALLOWED_GROUPS=your-security-group-id
```

### 5. Add Production Redirect URIs

In Azure AD App Registration:
1. Go to **Authentication**
2. Add redirect URI: `https://your-production-domain.com`
3. Add any staging URIs as well

---

## Checklist for Authentication Setup

### Frontend
- [ ] Installed `@azure/msal-browser` and `@azure/msal-react`
- [ ] Created `src/config/authConfig.js`
- [ ] Created `src/hooks/useAuth.js`
- [ ] Created `src/utils/authUtils.js` with `AccessDeniedError`, `authenticatedFetch`, and `checkUserAccess`
- [ ] Created `frontend/.env` with credentials
- [ ] Updated `main.jsx` with MsalProvider
- [ ] Created login UI component with Arcline logo
- [ ] Created Access Denied component (if using group-based authorization)
- [ ] Created verification loading page with Arcline logo
- [ ] Updated App.jsx with `isAccessDenied`, `isCheckingAuth`, and `hasCheckedAuth` ref
- [ ] Tested login flow

### Backend
- [ ] Installed `PyJWT` and `cryptography`
- [ ] Created `app/core/security.py`
- [ ] Created `app/models/user.py`
- [ ] Updated `app/core/config.py` with auth settings
- [ ] Created `backend/.env` with credentials
- [ ] Added `/auth/verify` endpoint for access verification
- [ ] Added `get_current_user` to protected routes
- [ ] Tested token validation

### Testing
- [ ] Can log in successfully
- [ ] Can log out successfully
- [ ] API calls include Bearer token
- [ ] Backend validates token correctly
- [ ] User info displays correctly
- [ ] Token refresh works silently
- [ ] Access Denied page shows for unauthorized users (if using ALLOWED_GROUPS)
- [ ] Can sign out from Access Denied page and try different account
