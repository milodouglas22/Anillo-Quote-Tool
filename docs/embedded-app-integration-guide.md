# Embedded App Integration Guide

## Overview

Your app is being embedded in the **Arcline App Store** via iframe. This guide explains how to eliminate the double-login issue that occurs when your app runs inside the App Store.

## The Problem

When your app loads in an iframe within the App Store:

1. User logs into App Store
2. User clicks your app → iframe loads
3. Your app's MSAL sees no token → triggers another login
4. User has to log in twice (bad UX)

This happens because each app has its own MSAL instance with separate token storage.

## The Solution

**Token Relay**: The App Store sends its auth token to your app via `postMessage`. Your app receives it and skips MSAL login.

```
┌─────────────────────────────────────────────────┐
│  App Store (parent window)                      │
│                                                 │
│  ┌──────────────────────────────────────────┐  │
│  │  Your App (iframe)                       │  │
│  │                                          │  │
│  │  1. Detects running in iframe            │  │
│  │  2. Waits for token from parent          │  │
│  │  3. Uses received token (no MSAL login)  │  │
│  └──────────────────────────────────────────┘  │
│                      ▲                          │
│                      │ postMessage              │
│                      │ {type: 'ARCLINE_AUTH_TOKEN', token: '...'}
│                      │                          │
└─────────────────────────────────────────────────┘
```

**Behavior:**
- **In iframe**: Receives token from parent → no login prompt
- **Direct access**: Normal MSAL login (unchanged)

## Implementation

### Step 0: Allow Iframe Embedding (Server Configuration)

By default, many apps block being embedded in iframes via `X-Frame-Options` or `Content-Security-Policy`. You must configure your server to allow embedding from the App Store origins.

**Required Origins:**
```
https://internal.arcline.com                        # Production (primary)
https://zealous-tree-0db5a9610.1.azurestaticapps.net  # Production (Azure Static Web App URL)
https://internal-aaefbcckb7aseqgg.z02.azurefd.net   # Production (Azure Front Door URL)
http://localhost:5173                               # Local development
```

#### Configure Content-Security-Policy

Add the `frame-ancestors` directive to your `staticwebapp.config.json`:

```json
{
  "globalHeaders": {
    "Content-Security-Policy": "frame-ancestors 'self' https://zealous-tree-0db5a9610.1.azurestaticapps.net https://internal.arcline.com https://internal-aaefbcckb7aseqgg.z02.azurefd.net http://localhost:5173"
  }
}
```

If your app already has a `Content-Security-Policy` header, add the `frame-ancestors` directive to it.

#### Remove X-Frame-Options (If Present)

If your `staticwebapp.config.json` sets `X-Frame-Options`, remove it. The `frame-ancestors` directive supersedes it and supports multiple origins.

#### Verify Configuration

After configuring, test by:
1. Opening your app directly → should work normally
2. Opening in App Store iframe → should load without "refused to connect" errors

Check browser DevTools console for CSP errors if embedding fails.

---

### Step 1: Copy the Hook

Copy the file `useEmbeddedAuth.ts` (provided below) to your app's hooks folder:

```
src/hooks/useEmbeddedAuth.ts
```

### Step 2: Update Your Auth Logic

Replace your existing auth initialization with `useEmbeddedAuth`:

**Before:**
```tsx
function App() {
  const { instance, accounts } = useMsal();
  const isAuthenticated = accounts.length > 0;

  if (!isAuthenticated) {
    return <button onClick={() => instance.loginRedirect()}>Login</button>;
  }

  return <YourApp />;
}
```

**After:**
```tsx
import { useEmbeddedAuth } from './hooks/useEmbeddedAuth';

function App() {
  const { instance } = useMsal();

  const { isAuthenticated, isLoading, login, getAccessToken } = useEmbeddedAuth({
    // Option A: loginRedirect - navigates away, page reloads after auth
    // Note: This navigates away from the page; the promise won't resolve.
    // After redirect back, MSAL handles the response on page load.
    msalLogin: () => instance.loginRedirect(loginRequest),

    // Option B: loginPopup - opens popup, stays on page (better for iframes)
    // msalLogin: async () => { await instance.loginPopup(loginRequest); },

    msalGetToken: async () => {
      const accounts = instance.getAllAccounts();
      if (accounts.length === 0) return null;
      const result = await instance.acquireTokenSilent({
        ...tokenRequest,
        account: accounts[0]
      });
      return result.accessToken;
    },
    allowedOrigins: [
      'https://internal.arcline.com',                         // Production (primary)
      'https://zealous-tree-0db5a9610.1.azurestaticapps.net', // Production (SWA URL)
      'https://internal-aaefbcckb7aseqgg.z02.azurefd.net',    // Production (Front Door)
      'http://localhost:5173',                                // Local development
    ],
  });

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (!isAuthenticated) {
    return <button onClick={login}>Login</button>;
  }

  return <YourApp getAccessToken={getAccessToken} />;
}
```

### Step 3: Use the Token for API Calls

When making API calls, use `getAccessToken()` from the hook:

```tsx
const response = await fetch('/api/data', {
  headers: {
    'Authorization': `Bearer ${await getAccessToken()}`
  }
});
```

### Step 4: Test

1. **Direct access**: Go to your app's URL directly → should show normal MSAL login
2. **Via App Store**: Open App Store → click your app → should load WITHOUT login prompt
3. **Check console**: Look for `[EmbeddedAuth] Token received from parent`

## The Hook

Copy this entire file to `src/hooks/useEmbeddedAuth.ts`:

```typescript
import { useState, useEffect, useCallback, useRef } from 'react';

interface EmbeddedAuthOptions {
  /** Your existing MSAL login function */
  msalLogin: () => Promise<void>;
  /** Your existing MSAL token acquisition function */
  msalGetToken: () => Promise<string | null>;
  /** Allowed parent origins for token relay */
  allowedOrigins?: string[];
  /** Timeout in ms to wait for parent token (default: 2000) */
  tokenWaitTimeout?: number;
}

interface EmbeddedAuthState {
  isAuthenticated: boolean;
  token: string | null;
  isLoading: boolean;
  isEmbedded: boolean;
  login: () => Promise<void>;
  getAccessToken: () => Promise<string | null>;
}

function isInIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export function useEmbeddedAuth(options: EmbeddedAuthOptions): EmbeddedAuthState {
  const {
    msalLogin,
    msalGetToken,
    allowedOrigins = [],
    tokenWaitTimeout = 2000,
  } = options;

  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isEmbedded] = useState(() => isInIframe());
  const tokenReceivedRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const requestTokenFromParent = useCallback(() => {
    if (!isEmbedded) return;
    console.log('[EmbeddedAuth] Requesting token from parent');
    window.parent.postMessage({ type: 'ARCLINE_REQUEST_TOKEN' }, '*');
  }, [isEmbedded]);

  useEffect(() => {
    if (!isEmbedded) {
      // Not in iframe - use MSAL directly
      console.log('[EmbeddedAuth] Not embedded, using MSAL');
      msalGetToken()
        .then(t => {
          setToken(t);
          setIsLoading(false);
        })
        .catch(() => setIsLoading(false));
      return;
    }

    console.log('[EmbeddedAuth] Running in iframe, waiting for token');

    const handleMessage = (event: MessageEvent) => {
      // Validate origin
      if (allowedOrigins.length > 0 && !allowedOrigins.includes(event.origin)) {
        return;
      }

      if (event.data?.type === 'ARCLINE_AUTH_TOKEN' && event.data?.token) {
        console.log('[EmbeddedAuth] Token received from parent');
        tokenReceivedRef.current = true;
        setToken(event.data.token);
        setIsLoading(false);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
      }
    };

    window.addEventListener('message', handleMessage);
    requestTokenFromParent();

    // Fallback to MSAL if no token received
    timeoutRef.current = setTimeout(() => {
      if (!tokenReceivedRef.current) {
        console.log('[EmbeddedAuth] No token received, falling back to MSAL');
        msalGetToken()
          .then(t => {
            if (!tokenReceivedRef.current) {
              setToken(t);
              setIsLoading(false);
            }
          })
          .catch(() => {
            if (!tokenReceivedRef.current) setIsLoading(false);
          });
      }
    }, tokenWaitTimeout);

    return () => {
      window.removeEventListener('message', handleMessage);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [isEmbedded, msalGetToken, allowedOrigins, tokenWaitTimeout, requestTokenFromParent]);

  const login = useCallback(async () => {
    if (isEmbedded) {
      requestTokenFromParent();
      await new Promise(resolve => setTimeout(resolve, 500));
      if (!tokenReceivedRef.current) await msalLogin();
    } else {
      await msalLogin();
    }
  }, [isEmbedded, msalLogin, requestTokenFromParent]);

  const getAccessToken = useCallback(async (): Promise<string | null> => {
    if (token) return token;
    return msalGetToken();
  }, [token, msalGetToken]);

  return {
    isAuthenticated: !!token,
    token,
    isLoading,
    isEmbedded,
    login,
    getAccessToken,
  };
}
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `msalLogin` | `() => Promise<void>` | required | Your MSAL login function (see note below) |
| `msalGetToken` | `() => Promise<string \| null>` | required | Your MSAL token acquisition function |
| `allowedOrigins` | `string[]` | `[]` | Parent origins allowed to send tokens |
| `tokenWaitTimeout` | `number` | `2000` | Ms to wait for parent token before MSAL fallback |

**Note on `msalLogin`:**
- `loginRedirect()` navigates away from the page. The promise returned by MSAL doesn't resolve in a useful way since the page reloads. After redirect back, MSAL's `handleRedirectPromise()` processes the auth response.
- `loginPopup()` opens a popup window and returns a promise that resolves when auth completes. This is often better for iframe scenarios but requires popup blockers to be disabled.

## Token Refresh

The token received from the App Store has a limited lifetime (typically 1 hour). When it expires, API calls will return 401 errors. To handle this:

**Option 1: Request fresh token on 401 (Recommended)**
```tsx
async function fetchWithRefresh(url: string, getAccessToken: () => Promise<string | null>) {
  let token = await getAccessToken();
  let response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` }
  });

  if (response.status === 401) {
    // Token expired - request fresh one from parent
    window.parent.postMessage({ type: 'ARCLINE_REQUEST_TOKEN' }, '*');

    // Wait for new token (the hook will update via message listener)
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Retry with new token
    token = await getAccessToken();
    response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
  }

  return response;
}
```

**Option 2: Proactive refresh**

Set up an interval to request a fresh token before expiration:
```tsx
useEffect(() => {
  if (!isEmbedded) return;

  // Request fresh token every 45 minutes (before 1-hour expiry)
  const interval = setInterval(() => {
    window.parent.postMessage({ type: 'ARCLINE_REQUEST_TOKEN' }, '*');
  }, 45 * 60 * 1000);

  return () => clearInterval(interval);
}, [isEmbedded]);
```

The App Store parent listens for `ARCLINE_REQUEST_TOKEN` and responds with a fresh `ARCLINE_AUTH_TOKEN`.

---

## Backend Configuration

If your app has a backend API that validates tokens, you need to configure two things:

### 1. CORS: Allow App Store Origins

Your backend must accept requests from the App Store. Add the App Store URL to your `ALLOWED_ORIGINS` environment variable:

```
ALLOWED_ORIGINS=https://existing-entries, https://internal.arcline.com
```

For local development, you may also need:
```
ALLOWED_ORIGINS=https://internal.arcline.com,http://localhost:5173
```

### 2. Token Audience: Azure AD App Registration

When your app runs inside the App Store, tokens are acquired by the App Store on behalf of your app. Your backend must accept tokens with the correct audience.

**The Problem:**
- Your backend validates the `aud` (audience) claim in tokens
- By default, the App Store acquires tokens for itself, not your API
- Your backend rejects these tokens with "Invalid token audience"

**The Solution:**

#### Step A: Find or Create Your API Scope

1. Go to **Azure Portal** → **App registrations** → Your app
2. Go to **Expose an API**
3. Check if a scope already exists (e.g., `api://<your-client-id>/access_as_user`)
   - If yes, note the full scope URI and skip to Step B
   - If no, continue to create one:
4. Set the **Application ID URI** (if not set): `api://<your-client-id>`
5. Click **Add a scope**:
   - Scope name: `access_as_user` (or `user_impersonation`)
   - Who can consent: Admins and users
   - Admin consent display name: "Access [Your App Name]"
   - Admin consent description: "Allows the App Store to access this API on behalf of the user"
6. Note your full scope: `api://<your-client-id>/access_as_user`

#### Step B: Grant Permission to the App Store

Contact the App Store team with:
- Your app's **client ID**
- Your **scope name** (e.g., `api://8e1e5e34-0985-4fa8-9401-2451dfde9a13/access_as_user`)

The App Store team will:
1. Add your API as a permission on the App Store app registration (Azure Portal)
2. Grant admin consent

#### Step C: Configure API Scope in the App Store

Once the App Store has permission to call your API, the scope must be configured in the App Store:

1. Go to the **App Store Admin UI** (`https://internal.arcline.com/admin`)
2. Find your app and click **Edit**
3. In the **API Scope** field, enter your full scope:
   ```
   api://<your-client-id>/access_as_user
   ```
4. Save the changes

This tells the App Store to acquire a token with your API's audience when loading your app in the iframe.

#### Step D: Verify Your Backend Accepts the Audience

Your backend token validation should accept tokens with audience matching your client ID. If you're using a pattern like this, it should work automatically:

```typescript
// Example: Your auth validation code
jwt.verify(token, getKey, {
  audience: [
    process.env.AUTH_CLIENT_ID,                    // e.g., "8e1e5e34-..."
    `api://${process.env.AUTH_CLIENT_ID}`,         // e.g., "api://8e1e5e34-..."
  ],
  // ... other options
});
```

If your backend hardcodes an audience or uses a different environment variable, update it to match your Application ID URI.

---

## Security Notes

1. **Always specify `allowedOrigins`** in production to prevent token injection from malicious parents
2. The token is sent via `postMessage` which is secure for same-origin communication

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Refused to display in frame" error | Configure `Content-Security-Policy: frame-ancestors` (see Step 0) |
| "X-Frame-Options" blocking | Remove `X-Frame-Options` header or use CSP instead |
| Still seeing login prompt | Check console for `[EmbeddedAuth]` logs |
| "Token received" but not working | Verify token has correct scopes for your API |
| "Invalid token audience" error | See Backend Configuration section - your API scope needs to be configured |
| CORS errors from backend | Add `https://internal.arcline.com` to your backend's `ALLOWED_ORIGINS` |
| Timeout before token received | Increase `tokenWaitTimeout` option |
| Works locally but not in prod | Add all production URLs to `allowedOrigins` |
| Works in some environments | Ensure all App Store origins are in both CSP and `allowedOrigins` |

## Questions?

Contact the App Store team or open an issue in the app-store repository.
