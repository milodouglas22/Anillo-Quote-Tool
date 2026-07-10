# Role-Based Security Guide

How to implement coarse-grain (module-level) and fine-grain (row-level / route-level) security so different users see different things within the same application state.

This pattern is based on the executive-recruiting module in the data-steward project, which uses Azure AD security groups to define two access tiers — **Full User** and **Contributor** — with data filtering, route restriction, and admin impersonation.

---

## Architecture Overview

```
Azure AD Token
  └── groups claim: ["<FULL_GROUP_UUID>", "<CONTRIB_GROUP_UUID>", ...]
         │
         ├── Frontend (visibility)
         │     ├── Module access (can you see this app at all?)
         │     ├── Route access (which pages can you navigate to?)
         │     └── Nav items (which sidebar links appear?)
         │
         └── Backend (data security)
               ├── Endpoint access (403 if no group match)
               └── Row-level filtering (contributors only see assigned data)
```

Security is enforced at **both layers**. The frontend hides UI elements for a clean UX; the backend is the source of truth and rejects unauthorized requests regardless of what the frontend shows.

---

## 1. Define Security Groups in Azure AD

Create two security groups per module in the Azure Portal:

| Group | Purpose | Example Env Var |
|:------|:--------|:----------------|
| **Full User** | Admin-level access — sees all data, all pages, can manage contributors | `EXEC_RECRUIT_ALLOWED_GROUPS` |
| **Contributor** | Limited access — sees only assigned data, restricted pages | `EXEC_RECRUIT_CONTRIBUTOR_GROUPS` |

Both groups are standard **Entra Security Groups**. Users are assigned to one or both in the Azure Portal. The group UUIDs are stored as environment variables — never hardcoded.

> **Rule:** A user in the Full User group is always treated as a Full User, even if they are also in the Contributor group. Full access supersedes contributor access.

---

## 2. Module Definition (Frontend)

Each module declares both group sets and provides separate routes/nav for each role.

```typescript
// frontend/src/modules/my-module/index.ts
export const myModule: ModuleDefinition = {
  id: "my-module",
  name: "My Module",
  icon: MyIcon,

  // Full User group IDs (from env var, comma-separated)
  requiredGroups:
    import.meta.env.VITE_MY_MODULE_GROUPS?.split(",").filter(Boolean) || [],

  // Contributor group IDs (from env var, comma-separated)
  contributorGroups:
    import.meta.env.VITE_MY_MODULE_CONTRIBUTOR_GROUPS?.split(",").filter(Boolean) || [],

  basePath: "/my-module",
  defaultRoute: "/my-module",
  contributorDefaultRoute: "/my-module/items", // Contributors land here instead

  // Full user routes — all pages
  routes: [
    { path: "/my-module", component: Dashboard },
    { path: "/my-module/items", component: Items },
    { path: "/my-module/settings", component: Settings },
    { path: "/my-module/admin", component: Admin },
  ],

  // Contributor routes — limited pages
  contributorRoutes: [
    { path: "/my-module/items", component: Items },
  ],

  // Full user nav — all sidebar links
  navItems: [
    { name: "Dashboard", path: "/my-module", icon: LayoutDashboard },
    { name: "Items", path: "/my-module/items", icon: List },
    { name: "Settings", path: "/my-module/settings", icon: Settings },
    { name: "Admin", path: "/my-module/admin", icon: Shield },
  ],

  // Contributor nav — only what they can access
  contributorNavItems: [
    { name: "Items", path: "/my-module/items", icon: List },
  ],
};
```

### ModuleDefinition Type Extensions

Add these optional fields to your `ModuleDefinition` interface:

```typescript
export interface ModuleDefinition {
  // ... existing fields ...

  /** Azure AD group IDs for contributor role (limited access) */
  contributorGroups?: string[];
  /** Routes accessible to contributors */
  contributorRoutes?: ModuleRoute[];
  /** Nav items visible to contributors */
  contributorNavItems?: ModuleNavItem[];
  /** Default route for contributors (they may not have access to the main default) */
  contributorDefaultRoute?: string;
}
```

---

## 3. Role Detection (Frontend — ModuleProvider)

The `ModuleProvider` context determines the user's role and exposes the effective routes/nav:

```typescript
// Determine role for the active module
function isModuleFullUser(module: ModuleDefinition | null, userGroups: string[]): boolean {
  if (!module) return false;
  if (module.requiredGroups.length === 0) return true;
  return module.requiredGroups.some((g) =>
    userGroups.map((ug) => ug.toLowerCase()).includes(g.toLowerCase())
  );
}

function isModuleContributor(module: ModuleDefinition | null, userGroups: string[]): boolean {
  if (!module) return false;
  if (isModuleFullUser(module, userGroups)) return false; // Full user supersedes
  const contributorGroups = module.contributorGroups || [];
  if (contributorGroups.length === 0) return false;
  return contributorGroups.some((g) =>
    userGroups.map((ug) => ug.toLowerCase()).includes(g.toLowerCase())
  );
}
```

The provider exposes these via context:

```typescript
// In any component:
const { isFullUser, isContributor, effectiveNavItems, effectiveRoutes } = useModules();
```

- `effectiveNavItems` → Full nav if Full User, contributor nav if Contributor
- `effectiveRoutes` → Full routes if Full User, contributor routes if Contributor

---

## 4. Backend Auth Helpers

Create helper functions per module in `backend/src/utils/auth.ts`:

```typescript
// Get group IDs from environment
export function getMyModuleAllowedGroups(): string[] {
  return (process.env.MY_MODULE_ALLOWED_GROUPS || "")
    .split(",").map((g) => g.trim()).filter((g) => g);
}

export function getMyModuleContributorGroups(): string[] {
  return (process.env.MY_MODULE_CONTRIBUTOR_GROUPS || "")
    .split(",").map((g) => g.trim()).filter((g) => g);
}

// Role checks
export function isMyModuleFullUser(user: DecodedToken): boolean {
  return checkUserGroups(user, getMyModuleAllowedGroups());
}

export function isMyModuleContributor(user: DecodedToken): boolean {
  const isContributor = checkUserGroups(user, getMyModuleContributorGroups());
  const isFullUser = checkUserGroups(user, getMyModuleAllowedGroups());
  return isContributor && !isFullUser; // Contributor ONLY if not also Full User
}

export function hasMyModuleAccess(user: DecodedToken): boolean {
  return isMyModuleFullUser(user) || isMyModuleContributor(user);
}
```

---

## 5. Endpoint-Level Security (Coarse Grain)

Every endpoint checks for access and behaves differently based on role:

```typescript
export async function getItems(request: HttpRequest, context: InvocationContext) {
  const user = await authenticateRequest(request, context);

  const isFullUser = isMyModuleFullUser(user);
  const isContributor = isMyModuleContributor(user);

  // Gate: must have SOME access
  if (!isFullUser && !isContributor) {
    return { status: 403, body: "Insufficient permissions" };
  }

  // Full users see everything; contributors see filtered data
  if (isContributor) {
    const allowedItemIds = await getContributorItemIds(user.oid);
    if (allowedItemIds.length === 0) {
      return { status: 200, jsonBody: { items: [] } };
    }
    // Add filter to query
    filterConditions.push({ item_id: { in: allowedItemIds } });
  }

  // ... execute query with filterConditions ...
}
```

### Admin-Only Endpoints

Some endpoints should only be accessible to Full Users:

```typescript
export async function manageContributors(request: HttpRequest, context: InvocationContext) {
  const user = await authenticateRequest(request, context);

  // Strict: Full Users only
  if (!isMyModuleFullUser(user)) {
    return { status: 403, body: "Insufficient permissions" };
  }

  // ... admin logic ...
}
```

---

## 6. Row-Level Filtering (Fine Grain)

The key pattern: **Contributors only see data they are assigned to.** This is enforced via database views that map users to their allowed records.

### Database Setup

Create an assignment table and filtering views:

```sql
-- Assignment table: which contributor can see which parent record
CREATE TABLE my_schema.item_contributors (
  item_contributor_id  UNIQUEIDENTIFIER PRIMARY KEY,
  item_id              UNIQUEIDENTIFIER NOT NULL,  -- FK to parent record
  user_id              NVARCHAR(255) NOT NULL,      -- Azure AD Object ID (OID)
  user_email           NVARCHAR(255) NOT NULL,
  user_display_name    NVARCHAR(255) NOT NULL,
  created_at           DATETIME2 DEFAULT GETUTCDATE(),
  CONSTRAINT UQ_item_contributor_user UNIQUE (item_id, user_id)
);

-- View: which items can a contributor access?
CREATE VIEW my_schema.vw_contributor_items AS
SELECT DISTINCT ic.user_id, ic.item_id
FROM my_schema.item_contributors ic;

-- View: which child records can a contributor see? (via parent assignment)
CREATE VIEW my_schema.vw_contributor_children AS
SELECT DISTINCT ic.user_id, c.child_id
FROM my_schema.item_contributors ic
INNER JOIN my_schema.children c ON c.item_id = ic.item_id;
```

### Backend Helper

```typescript
async function getContributorItemIds(userId: string): Promise<string[]> {
  const query = `
    query GetContributorItems($filter: vw_contributor_itemsFilterInput) {
      vw_contributor_items(filter: $filter) {
        items { item_id }
      }
    }
  `;

  const result = await graphql(query, {
    filter: { user_id: { eq: userId } },
  });

  return result.vw_contributor_items?.items?.map((i) => i.item_id) || [];
}
```

---

## 7. Admin Impersonation (Optional)

Full Users can "see as" a Contributor to verify their view. This is useful for admins setting up permissions.

### Frontend — ImpersonationContext

```typescript
const ImpersonationContext = createContext<{
  impersonatedUserId: string | null;
  impersonatedUserName: string | null;
  setImpersonation: (userId: string | null, userName?: string | null) => void;
  isImpersonating: boolean;
} | null>(null);
```

When a Full User selects a contributor to impersonate:
1. The impersonated user's ID is stored in context
2. API client attaches `X-Impersonate-User-Id` header to requests
3. Relevant queries are invalidated to refetch with the contributor's filter

### Backend — Impersonation Logic

```typescript
function getEffectiveUserId(request: HttpRequest, user: DecodedToken): string {
  // Only Full Users can impersonate
  if (!isMyModuleFullUser(user)) {
    return user.oid;
  }
  const impersonateUserId = request.headers.get("X-Impersonate-User-Id");
  return impersonateUserId || user.oid;
}

function isImpersonating(request: HttpRequest, user: DecodedToken): boolean {
  if (!isMyModuleFullUser(user)) return false;
  return !!request.headers.get("X-Impersonate-User-Id");
}
```

In the endpoint:

```typescript
const effectiveUserId = getEffectiveUserId(request, user);
const shouldFilter = isContributor || isImpersonating(request, user);

if (shouldFilter) {
  const allowedIds = await getContributorItemIds(effectiveUserId);
  // ... apply filter ...
}
```

---

## 8. Environment Variable Configuration

### Frontend (`frontend/.env`)

```env
# Module access — Full Users
VITE_MY_MODULE_GROUPS=<full-user-group-uuid>

# Module access — Contributors
VITE_MY_MODULE_CONTRIBUTOR_GROUPS=<contributor-group-uuid>
```

### Backend (`backend/local.settings.json` / App Settings)

```json
{
  "MY_MODULE_ALLOWED_GROUPS": "<full-user-group-uuid>",
  "MY_MODULE_CONTRIBUTOR_GROUPS": "<contributor-group-uuid>"
}
```

---

## Security Checklist

| Layer | Check | Notes |
|:------|:------|:------|
| Azure AD | Group claims enabled in App Registration | Token must include `groups` claim |
| Azure AD | Users assigned to correct groups | Managed in Azure Portal |
| Frontend | `requiredGroups` and `contributorGroups` set | From env vars, never hardcoded |
| Frontend | `contributorRoutes` excludes admin pages | Contributors can't navigate to them |
| Frontend | `contributorNavItems` matches allowed routes | Don't show links to inaccessible pages |
| Backend | Every endpoint calls `authenticateRequest()` | No unauthenticated access |
| Backend | Every endpoint checks `isFullUser` / `isContributor` | 403 if neither |
| Backend | Contributor queries filtered by assignment view | Row-level security |
| Backend | Admin-only endpoints check `isFullUser` only | Contributors can't manage assignments |
| Backend | Impersonation only allowed for Full Users | `getEffectiveUserId` checks role first |
| Backend | Group comparison is case-insensitive | UUIDs may arrive in different cases |
| Backend | Empty `groups` claim = deny (not allow) | Token without groups = no access |

---

## Summary

| Concept | Where | How |
|:--------|:------|:----|
| **Coarse-grain (module access)** | Frontend + Backend | Security group membership gates entire module visibility and API access |
| **Route-level (page access)** | Frontend | `contributorRoutes` / `contributorNavItems` limit which pages a contributor can see |
| **Fine-grain (row-level)** | Backend + Database | Contributor assignment table + database views filter queries to only assigned records |
| **Impersonation** | Frontend + Backend | Full Users can view data as a specific contributor via `X-Impersonate-User-Id` header |

The pattern scales by adding more security groups (e.g., Reviewer, Approver) with their own route sets and data filters, following the same contributor pattern.
