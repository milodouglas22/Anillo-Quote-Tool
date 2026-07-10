# Azure Fabric Integration Guide

How to connect an Arcline application to Microsoft Fabric Warehouse via the GraphQL API, based on patterns proven in the contract-review application.

---

## Architecture Overview

```
Frontend (React / Vite)
    │  MSAL Bearer Token
    ▼
Backend (FastAPI / Python)
    ├── Validates user JWT (Azure AD JWKS)
    ├── Extracts user identity (OID, email, groups)
    └── Calls Fabric via GraphQL
            │  Service Principal Token
            ▼
Fabric Warehouse
    ├── GraphQL API endpoint
    └── SQL Warehouse
            ├── Tables
            ├── Views
            └── Stored Procedures
```

There are **two separate authentication flows**:

1. **User authentication** — MSAL tokens issued by Azure AD, validated by the backend.
2. **App-to-Fabric authentication** — a Service Principal acquires a token scoped to `https://api.fabric.microsoft.com/.default` and uses it for all GraphQL calls.

---

## 1. Environment Variables

### Backend `.env`

```env
# ── Azure AD (user authentication) ──
AZURE_CLIENT_ID=<app-registration-client-id>
AZURE_TENANT_ID=<tenant-id>
ALLOWED_GROUPS=<comma-separated-group-ids>          # optional

# ── Service Principal (Fabric access) ──
FABRIC_CLIENT_ID=<service-principal-client-id>
FABRIC_CLIENT_SECRET=<service-principal-client-secret>

# ── Fabric GraphQL endpoint ──
GRAPHQL_ENDPOINT=https://api.fabric.microsoft.com/v1/workspaces/<workspace-id>/graphqlapis/<api-id>/graphql

# ── CORS ──
CORS_ORIGINS=http://localhost:3000,http://localhost:5173
```

### Frontend `.env`

```env
VITE_AZURE_CLIENT_ID=<app-registration-client-id>
VITE_AZURE_TENANT_ID=<tenant-id>
VITE_REDIRECT_URI=http://localhost:5173
VITE_API_BASE_URL=http://localhost:8000
```

---

## 2. Dependencies

Add these to your backend `requirements.txt`:

```
azure-identity          # Service Principal / Managed Identity auth
httpx                   # Async-friendly HTTP client with connection pooling
PyJWT                   # JWT validation for user tokens
cryptography            # Required by PyJWT for RS256
fastapi
uvicorn
```

Frontend:

```
@azure/msal-browser
@azure/msal-react
```

---

## 3. Fabric GraphQL Client

The client authenticates as a Service Principal, caches tokens, and sends GraphQL queries over HTTP.

### `app/core/fabric_client.py`

```python
import os, time, hashlib, json, logging
from azure.identity import ClientSecretCredential
import httpx

logger = logging.getLogger(__name__)


class FabricGraphQLClient:
    """Authenticated GraphQL client for Microsoft Fabric."""

    def __init__(self):
        self.endpoint = os.environ["GRAPHQL_ENDPOINT"]
        self.credential = ClientSecretCredential(
            tenant_id=os.environ["AZURE_TENANT_ID"],
            client_id=os.environ["FABRIC_CLIENT_ID"],
            client_secret=os.environ["FABRIC_CLIENT_SECRET"],
        )
        self._token_cache = {"token": None, "expires_at": 0}
        self._query_cache = {}
        self._http = httpx.Client(
            timeout=60.0,
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
        )

    # ── Token management ─────────────────────────────────────────
    def _get_token(self) -> str:
        now = time.time()
        if self._token_cache["token"] and now < self._token_cache["expires_at"] - 300:
            return self._token_cache["token"]

        token = self.credential.get_token("https://api.fabric.microsoft.com/.default")
        self._token_cache = {"token": token.token, "expires_at": token.expires_on}
        return token.token

    # ── Query execution ──────────────────────────────────────────
    def execute(self, query: str, variables: dict | None = None, use_cache: bool = False, cache_ttl: int = 5) -> dict:
        """
        Execute a GraphQL query/mutation against Fabric.

        Args:
            query:      GraphQL query or mutation string.
            variables:  Variable dict (all values must be strings or None).
            use_cache:  Enable in-memory TTL cache for read queries.
            cache_ttl:  Cache lifetime in seconds (default 5).
        """
        # Optional caching for read queries
        cache_key = None
        if use_cache:
            raw = json.dumps({"q": query, "v": variables}, sort_keys=True)
            cache_key = hashlib.md5(raw.encode()).hexdigest()
            cached = self._query_cache.get(cache_key)
            if cached and time.time() < cached["expires_at"]:
                return cached["data"]

        payload = {"query": query}
        if variables:
            payload["variables"] = variables

        resp = self._http.post(
            self.endpoint,
            json=payload,
            headers={
                "Authorization": f"Bearer {self._get_token()}",
                "Content-Type": "application/json",
            },
        )
        resp.raise_for_status()
        result = resp.json()

        if "errors" in result:
            logger.error("GraphQL errors: %s", result["errors"])
            raise Exception(result["errors"][0].get("message", "GraphQL error"))

        data = result.get("data", {})

        if cache_key is not None:
            self._query_cache[cache_key] = {"data": data, "expires_at": time.time() + cache_ttl}
            # Evict old entries
            if len(self._query_cache) > 100:
                sorted_keys = sorted(self._query_cache, key=lambda k: self._query_cache[k]["expires_at"])
                for k in sorted_keys[:50]:
                    del self._query_cache[k]

        return data


# Singleton
fabric_client = FabricGraphQLClient()
```

---

## 4. Writing the Fabric Schema

Fabric Warehouse has significant SQL limitations. Follow these rules when writing your `schema.sql`:

### Data-type rules

| Use this | Not this | Why |
|----------|----------|-----|
| `VARCHAR(n)` or `NVARCHAR(MAX)` | `NVARCHAR(n)` | Fabric does not support `NVARCHAR` with a length — only `MAX` |
| `DATETIME2(6)` | `DATETIME2` | A precision value **must** be specified |
| `VARCHAR(50)` for decimals | `DECIMAL(10,2)` | GraphQL serialization breaks on `DECIMAL` |
| `BIT` | `BOOLEAN` | Fabric uses SQL Server types |
| `CHAR(36)` | `UNIQUEIDENTIFIER` | Safer for UUIDs across GraphQL |

### Constraint rules

Fabric Warehouse does **not** support:

- `PRIMARY KEY`, `FOREIGN KEY`, `UNIQUE`, `CHECK` constraints
- `DEFAULT` values on columns
- `ALTER TABLE` to change column types (must drop & recreate)
- `INDEX` creation
- Cursor operations (`@@FETCH_STATUS`)

All referential integrity and cascading logic must live in **stored procedures** or application code.

### Example table

```sql
CREATE TABLE my_schema.items (
    id              CHAR(36)        NOT NULL,
    name            VARCHAR(255)    NOT NULL,
    description     VARCHAR(MAX)    NULL,
    price           VARCHAR(50)     NULL,       -- stored as string, cast in app
    is_active       BIT             NOT NULL,
    created_at      DATETIME2(6)    NOT NULL,
    created_by      VARCHAR(255)    NOT NULL
);
```

### Views

Use views to pre-join tables and aggregate counts. This keeps GraphQL queries simple and reduces round-trips.

```sql
CREATE VIEW my_schema.vw_item_list AS
SELECT
    i.id,
    i.name,
    i.is_active,
    i.created_at,
    COUNT(d.id) AS detail_count
FROM my_schema.items i
LEFT JOIN my_schema.item_details d ON i.id = d.item_id
GROUP BY i.id, i.name, i.is_active, i.created_at;
```

### Stored Procedures

All write operations should go through stored procedures. Since there are no constraints, the procedure is responsible for cascading deletes, validation, and maintaining data consistency.

```sql
CREATE PROCEDURE my_schema.sp_create_item
    @id         CHAR(36),
    @name       VARCHAR(255),
    @created_by VARCHAR(255)
AS
BEGIN
    INSERT INTO my_schema.items (id, name, is_active, created_at, created_by)
    VALUES (@id, @name, 1, GETUTCDATE(), @created_by);

    SELECT @id AS id;
END;
```

```sql
-- Cascade delete example
CREATE PROCEDURE my_schema.sp_delete_item
    @id CHAR(36)
AS
BEGIN
    DELETE FROM my_schema.item_details WHERE item_id = @id;
    DELETE FROM my_schema.items WHERE id = @id;
    SELECT @id AS id;
END;
```

---

## 5. Querying Fabric via GraphQL

### Reading data (queries)

Fabric's GraphQL API exposes tables and views. Use `filter` for WHERE clauses:

```python
# Fetch a single item by ID
query = """
query GetItem($id: String!) {
    items(filter: { id: { eq: $id } }) {
        items {
            id
            name
            description
            price
            is_active
            created_at
        }
    }
}
"""
result = fabric_client.execute(query, {"id": item_id}, use_cache=True)
items = result.get("items", {}).get("items", [])
item = items[0] if items else None
```

**Filter operators**: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `isNull`, `contains`

### Writing data (mutations via stored procedures)

Stored procedure mutations return **arrays**, not dicts:

```python
mutation = """
mutation CreateItem($id: String!, $name: String!, $created_by: String!) {
    executesp_create_item(id: $id, name: $name, created_by: $created_by) {
        id
    }
}
"""
result = fabric_client.execute(mutation, {
    "id": str(uuid.uuid4()),
    "name": "New Item",
    "created_by": current_user.oid,
})
# IMPORTANT: stored procedures return a list
new_id = result.get("executesp_create_item", [])[0].get("id")
```

> **Key convention**: the mutation name is `execute` + the stored procedure name (no space). All parameters must be passed — even optional ones as `None`.

### Batch queries (preventing N+1)

When you need related data for multiple parent records, use the `in` filter:

```python
query = """
query GetDetailsForItems($item_ids: [String!]!) {
    item_details(filter: { item_id: { in: $item_ids } }) {
        items {
            id
            item_id
            detail_value
        }
    }
}
"""
result = fabric_client.execute(query, {"item_ids": list_of_ids})
```

### Light-mode queries

For list/table views, skip large text fields (descriptions, blobs) to reduce payload by 50-80%:

```python
# Full query — for detail view
ITEM_FULL = "id name description price is_active created_at"

# Light query — for table/list view
ITEM_LIGHT = "id name is_active created_at"
```

---

## 6. Data Access Layer

Wrap all GraphQL calls behind a clean Python module. One function per operation:

### `app/core/fabric_db.py`

```python
import uuid
from app.core.fabric_client import fabric_client


def get_items(created_by: str | None = None, is_active: bool | None = None) -> list[dict]:
    """Fetch items with optional filters."""
    filters = []
    variables = {}

    if created_by:
        filters.append("created_by: { eq: $created_by }")
        variables["created_by"] = created_by
    if is_active is not None:
        filters.append("is_active: { eq: $is_active }")
        variables["is_active"] = str(int(is_active))

    filter_clause = f"filter: {{ {', '.join(filters)} }}" if filters else ""
    var_defs = ", ".join(f"${k}: String!" for k in variables)
    if var_defs:
        var_defs = f"({var_defs})"

    query = f"""
    query GetItems{var_defs} {{
        vw_item_list({filter_clause}) {{
            items {{ id name is_active created_at detail_count }}
        }}
    }}
    """
    result = fabric_client.execute(query, variables or None, use_cache=True)
    return result.get("vw_item_list", {}).get("items", [])


def create_item(name: str, created_by: str) -> str:
    """Create an item. Returns the new ID."""
    new_id = str(uuid.uuid4())
    mutation = """
    mutation CreateItem($id: String!, $name: String!, $created_by: String!) {
        executesp_create_item(id: $id, name: $name, created_by: $created_by) {
            id
        }
    }
    """
    result = fabric_client.execute(mutation, {
        "id": new_id,
        "name": name,
        "created_by": created_by,
    })
    return result.get("executesp_create_item", [])[0].get("id")


def delete_item(item_id: str) -> None:
    """Delete an item and its related details."""
    mutation = """
    mutation DeleteItem($id: String!) {
        executesp_delete_item(id: $id) { id }
    }
    """
    fabric_client.execute(mutation, {"id": item_id})
```

---

## 7. MSAL Authentication (Frontend)

### `src/auth/msalConfig.js`

```javascript
export const msalConfig = {
  auth: {
    clientId: import.meta.env.VITE_AZURE_CLIENT_ID,
    authority: `https://login.microsoftonline.com/${import.meta.env.VITE_AZURE_TENANT_ID}`,
    redirectUri: import.meta.env.VITE_REDIRECT_URI,
  },
  cache: {
    cacheLocation: "localStorage",
    storeAuthStateInCookie: false,
  },
};

export const loginRequest = {
  scopes: [`api://${import.meta.env.VITE_AZURE_CLIENT_ID}/access_as_user`],
};
```

### `src/auth/AuthProvider.jsx`

```jsx
import { MsalProvider } from "@azure/msal-react";
import { PublicClientApplication } from "@azure/msal-browser";
import { msalConfig } from "./msalConfig";

const msalInstance = new PublicClientApplication(msalConfig);

export default function AuthProvider({ children }) {
  return <MsalProvider instance={msalInstance}>{children}</MsalProvider>;
}
```

### Getting a token for API calls

```javascript
import { msalInstance, loginRequest } from "../auth/msalConfig";

export async function getAccessToken() {
  const accounts = msalInstance.getAllAccounts();
  if (accounts.length === 0) throw new Error("No authenticated user");

  const response = await msalInstance.acquireTokenSilent({
    ...loginRequest,
    account: accounts[0],
  });
  return response.accessToken;
}
```

---

## 8. Backend JWT Validation

### `app/core/auth.py`

```python
import os, jwt, httpx
from functools import lru_cache
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

security = HTTPBearer()

TENANT_ID = os.environ["AZURE_TENANT_ID"]
CLIENT_ID = os.environ["AZURE_CLIENT_ID"]
JWKS_URL = f"https://login.microsoftonline.com/{TENANT_ID}/discovery/v2.0/keys"


@lru_cache(maxsize=1)
def _get_jwks():
    resp = httpx.get(JWKS_URL)
    return resp.json()


class CurrentUser:
    def __init__(self, oid: str, email: str, name: str, groups: list[str]):
        self.oid = oid
        self.email = email
        self.name = name
        self.groups = groups


def get_current_user(creds: HTTPAuthorizationCredentials = Depends(security)) -> CurrentUser:
    try:
        jwks = _get_jwks()
        unverified_header = jwt.get_unverified_header(creds.credentials)
        key = None
        for k in jwks["keys"]:
            if k["kid"] == unverified_header["kid"]:
                key = jwt.algorithms.RSAAlgorithm.from_jwk(k)
                break
        if not key:
            raise HTTPException(401, "Signing key not found")

        payload = jwt.decode(
            creds.credentials,
            key,
            algorithms=["RS256"],
            audience=CLIENT_ID,
            issuer=f"https://login.microsoftonline.com/{TENANT_ID}/v2.0",
        )
        return CurrentUser(
            oid=payload.get("oid", ""),
            email=payload.get("preferred_username", ""),
            name=payload.get("name", ""),
            groups=payload.get("groups", []),
        )
    except jwt.PyJWTError as e:
        raise HTTPException(401, f"Invalid token: {e}")
```

---

## 9. Putting It Together — API Route Example

```python
from fastapi import APIRouter, Depends
from app.core.auth import get_current_user, CurrentUser
from app.core import fabric_db

router = APIRouter(prefix="/api/items", tags=["items"])


@router.get("")
def list_items(user: CurrentUser = Depends(get_current_user)):
    items = fabric_db.get_items(created_by=user.oid)
    return {"items": items}


@router.post("")
def create_item(body: dict, user: CurrentUser = Depends(get_current_user)):
    new_id = fabric_db.create_item(name=body["name"], created_by=user.oid)
    return {"id": new_id}


@router.delete("/{item_id}")
def delete_item(item_id: str, user: CurrentUser = Depends(get_current_user)):
    fabric_db.delete_item(item_id)
    return {"deleted": item_id}
```

---

## 10. Performance Best Practices

| Technique | Where | Impact |
|-----------|-------|--------|
| **Token caching** | `FabricGraphQLClient` | Avoids re-auth on every request |
| **Query caching** (5s TTL) | `fabric_client.execute()` | Eliminates redundant reads for list views |
| **Light-mode queries** | Data access layer | 50-80% smaller payloads for tables |
| **Batch fetching** (N+1 prevention) | Data access layer | Single query for related child records |
| **Connection pooling** | `httpx.Client` | Reuses TCP connections (20 max, 10 keepalive) |
| **Optimistic UI updates** | Frontend | Instant feedback — remove/update before API confirms |
| **Conditional polling** | Frontend | Only poll when something is actively processing |
| **View pre-aggregation** | Fabric schema | Counts and joins computed once in SQL |

---

## 11. Common Errors and Fixes

| Error | Cause | Fix |
|-------|-------|-----|
| `The data type 'nvarchar(n)' is not supported` | Using `NVARCHAR` with a length | Use `VARCHAR(n)` or `NVARCHAR(MAX)` |
| `Decimal cannot parse the given value` | `DECIMAL` column in GraphQL | Store as `VARCHAR`, cast in application |
| `An integer precision value must be specified` | `DATETIME2` without precision | Use `DATETIME2(6)` |
| `'@@FETCH_STATUS' is not supported` | Cursor usage | Rewrite with set-based operations / JOINs |
| `The field 'xxx_by_pk' does not exist` | Hasura-style primary key lookup | Use `filter: { id: { eq: $id } }` with `.items[]` |
| `'list' object has no attribute 'get'` | Treating SP result as dict | SP mutations return arrays — access `result[0]` |
| `The variable 'xxx' is not compatible` | Type mismatch in variables | All GraphQL variables must be `String` or `String!` |

---

## 12. Deployment

| Component | Target | Notes |
|-----------|--------|-------|
| Backend | Azure App Service (Python 3.11) | Enable Managed Identity for Key Vault access |
| Frontend | Azure Static Web Apps | SPA mode, fallback to `index.html` |
| Database | Fabric Warehouse | GraphQL API auto-exposed by Fabric |
| Secrets | Azure Key Vault | Store `FABRIC_CLIENT_SECRET`, API keys |

### Startup command (App Service)

```bash
gunicorn app.main:app -w 4 -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000
```

---

## 13. Checklist for a New Application

1. **Azure AD App Registration** — register an app, configure redirect URIs, expose an API scope (`access_as_user`).
2. **Service Principal** — create one in the same tenant; grant it access to the Fabric workspace.
3. **Fabric Warehouse** — create a warehouse in a Fabric workspace; write your schema SQL (tables, views, stored procedures).
4. **Fabric GraphQL API** — Fabric auto-generates a GraphQL endpoint for the warehouse. Copy the endpoint URL.
5. **Backend** — copy the `fabric_client.py` and `auth.py` modules; build your `fabric_db.py` data layer; wire up routes.
6. **Frontend** — configure MSAL; attach Bearer tokens to every API call.
7. **Environment variables** — fill in both `.env` files.
8. **Test** — use the GraphQL playground in Fabric portal to validate queries before wiring them into code.
9. **Deploy** — push backend to App Service, frontend to Static Web Apps, secrets to Key Vault.
