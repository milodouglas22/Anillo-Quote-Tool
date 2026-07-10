# Entity Mapping Pattern

A standardized pattern for mapping multiple source entity systems (headcount, OneStream, etc.) to a canonical Arclake hierarchy. Enables consistent entity resolution across applications that consume data from different upstream systems.

---

## Quick Start for Claude

When an application needs to resolve entities from different source systems to a common hierarchy:

1. Determine consumption approach: **Direct GraphQL** (single-app) or **Data Steward API** (multi-app) — see [Consumption Approaches](#consumption-approaches)
2. Create a GraphQL client method that fetches from `vw_entity_mapping` — see [Fetching Mappings](#fetching-mappings)
3. Build lookup dictionaries for each source system — see [Building Lookup Dictionaries](#building-lookup-dictionaries)
4. Wire up caching with APScheduler for periodic refresh — see [Caching & Sync](#caching--sync)
5. Use lookups to enrich domain objects with arclake hierarchy fields

---

## Table of Contents

- [The Arclake Hierarchy](#the-arclake-hierarchy)
- [Data Source](#data-source)
- [Consumption Approaches](#consumption-approaches)
  - [Option A: Direct GraphQL](#option-a-direct-graphql)
  - [Option B: Via Data Steward API (Recommended for Multi-App)](#option-b-via-data-steward-api)
- [Fetching Mappings](#fetching-mappings)
- [Building Lookup Dictionaries](#building-lookup-dictionaries)
- [Enriching Domain Objects](#enriching-domain-objects)
- [Caching & Sync](#caching--sync)
- [Data Steward Changes Required](#data-steward-changes-required)
- [Complete Example](#complete-example)
- [Checklist](#checklist)

---

## The Arclake Hierarchy

Arclake defines a 4-level canonical entity hierarchy. Multiple upstream systems map into it:

```
Source Systems                          Arclake Hierarchy
                                        (canonical)
┌─────────────────┐
│ Headcount Data  │──┐                 ┌──────────────────┐
│ (hc_entity,     │  │                 │  arclake_rollup   │  ← Top level (e.g., "Fund III")
│  hc_company)    │  │                 │    └─ arclake_entity │  ← Portfolio company
└─────────────────┘  ├──── maps to ───>│        └─ arclake_block │  ← Business segment
                     │                 │            └─ arclake_bu │  ← Business unit
┌─────────────────┐  │                 └──────────────────┘
│ OneStream Data  │──┘
│ (os_portco,     │
│  os_entity)     │
└─────────────────┘
```

**Why this matters:** Different systems refer to the same company by different names. The entity mapping table provides the Rosetta Stone that lets any application translate its source entities into the shared arclake hierarchy.

---

## Data Source

The mapping lives in the `vw_entity_mapping` view in the Fabric Data Warehouse, exposed via Azure Data API Builder (GraphQL).

### Fields

| Field | Description |
|-------|-------------|
| `row_key` | Unique row identifier |
| `hc_entity` | Headcount system entity name |
| `hc_company` | Headcount system company name |
| `os_portco` | OneStream portfolio company |
| `os_entity` | OneStream entity |
| `arclake_rollup` | Arclake Level 1 — rollup/fund |
| `arclake_entity` | Arclake Level 2 — portfolio company |
| `arclake_block` | Arclake Level 3 — business segment |
| `arclake_bu` | Arclake Level 4 — business unit |
| `portco_id` | Portfolio company ID |
| `linked_portco_name` | Display name for portfolio company |
| `business_unit_key` | Business unit key |
| `linked_bu_name` | Display name for business unit |
| `linked_block_name` | Display name for block |
| `rollup_id` | Rollup ID |
| `linked_rollup_name` | Display name for rollup |

---

## Consumption Approaches

### Option A: Direct GraphQL

The application queries the Fabric GraphQL endpoint directly. Best for **single applications** that need full control over query filtering and pagination.

```
Your App  ──GraphQL──>  Fabric Data Warehouse (vw_entity_mapping)
```

**When to use:** Your app is the only consumer, or you need custom filters/pagination.

### Option B: Via Data Steward API

The data-steward application exposes entity mappings through REST endpoints. Other applications call the data-steward API instead of querying Fabric directly.

```
Your App  ──REST──>  Data Steward API  ──GraphQL──>  Fabric Data Warehouse
```

**When to use:** Multiple applications need entity mappings. Centralizes access control, caching, and avoids duplicating GraphQL client code across apps.

> **Note:** The data-steward does not currently expose entity mapping endpoints. See [Data Steward Changes Required](#data-steward-changes-required) for what needs to be added.

---

## Fetching Mappings

### GraphQL Query

```python
# backend/app/services/graphql_client.py

def get_entity_mappings(self) -> list[dict]:
    """
    Fetch entity mappings from vw_entity_mapping.
    Uses cursor-based pagination to retrieve all records.
    """
    all_mappings = []
    cursor = None
    has_next = True

    while has_next:
        after_arg = f'after: "{cursor}"' if cursor else ''

        query = f"""
        query GetEntityMappings {{
          vw_entity_mappings(
            first: 100000
            {after_arg}
            orderBy: {{ hc_entity: ASC }}
          ) {{
            items {{
              row_key
              hc_entity
              hc_company
              os_portco
              os_entity
              arclake_rollup
              arclake_entity
              arclake_block
              arclake_bu
              portco_id
              linked_portco_name
              business_unit_key
              linked_bu_name
              linked_block_name
              rollup_id
              linked_rollup_name
            }}
            endCursor
            hasNextPage
          }}
        }}
        """

        result = self.execute_query(query)
        data = result['vw_entity_mappings']

        all_mappings.extend(data['items'])
        cursor = data['endCursor']
        has_next = data['hasNextPage']

    logger.info(f"Total entity mappings fetched: {len(all_mappings)}")
    return all_mappings
```

---

## Building Lookup Dictionaries

The core pattern builds 4 lookup dictionaries from the raw mapping records. Each lookup serves a different use case.

```python
# backend/app/services/entity_mapping.py

from typing import Dict, Set, Tuple

def build_arclake_lookup(
    raw_mappings: list[dict],
) -> tuple[dict, dict, dict, dict]:
    """
    Build lookups from entity mapping records.

    Returns:
        - employee_lookup:      (hc_entity, hc_company) -> arclake level dict
        - portco_to_entity:     os_portco -> arclake_entity name
        - os_entity_to_arclake: os_entity -> {arclake_entity, arclake_block, arclake_bu}
        - hierarchy_tree:       rollup -> {entity -> {block -> set(bu)}}
    """
    employee_lookup: Dict[Tuple[str, str], Dict[str, str]] = {}
    portco_to_entity: Dict[str, str] = {}
    os_entity_to_arclake: Dict[str, Dict[str, str]] = {}
    hierarchy_tree: Dict[str, Dict[str, Dict[str, Set[str]]]] = {}

    for m in raw_mappings:
        hc_entity  = m.get('hc_entity') or ''
        hc_company = m.get('hc_company') or ''
        os_portco  = m.get('os_portco') or ''
        os_entity  = m.get('os_entity') or ''
        rollup     = m.get('arclake_rollup') or ''
        entity     = m.get('arclake_entity') or ''
        block      = m.get('arclake_block') or ''
        bu         = m.get('arclake_bu') or ''

        # 1. Employee lookup: (hc_entity, hc_company) -> arclake levels
        if hc_entity and hc_company:
            key = (hc_entity, hc_company)
            if key not in employee_lookup:
                employee_lookup[key] = {
                    'arclake_rollup': rollup,
                    'arclake_entity': entity,
                    'arclake_block': block,
                    'arclake_bu': bu,
                }

        # 2. Financial lookup: os_portco -> arclake_entity
        if os_portco and os_portco != 'No Match' and entity:
            if os_portco not in portco_to_entity:
                portco_to_entity[os_portco] = entity

        # 3. Financial detail: os_entity -> arclake block/BU
        if os_entity and os_entity != 'No Match' and entity and block:
            if os_entity not in os_entity_to_arclake:
                os_entity_to_arclake[os_entity] = {
                    'arclake_entity': entity,
                    'arclake_block': block,
                    'arclake_bu': bu,
                }

        # 4. Hierarchy tree: rollup -> entity -> block -> {bu, ...}
        if rollup and entity and entity != 'No Match' and rollup != 'No Match':
            if rollup not in hierarchy_tree:
                hierarchy_tree[rollup] = {}
            if entity not in hierarchy_tree[rollup]:
                hierarchy_tree[rollup][entity] = {}
            if block:
                if block not in hierarchy_tree[rollup][entity]:
                    hierarchy_tree[rollup][entity][block] = set()
                if bu:
                    hierarchy_tree[rollup][entity][block].add(bu)

    return employee_lookup, portco_to_entity, os_entity_to_arclake, hierarchy_tree
```

### Lookup Usage Summary

| Lookup | Key | Value | Use Case |
|--------|-----|-------|----------|
| `employee_lookup` | `(hc_entity, hc_company)` | `{arclake_rollup, entity, block, bu}` | Enrich headcount/HR records |
| `portco_to_entity` | `os_portco` | `arclake_entity` | Map financial rollups to entity |
| `os_entity_to_arclake` | `os_entity` | `{arclake_entity, block, bu}` | Map financial detail to hierarchy |
| `hierarchy_tree` | `rollup` | Nested dict: entity → block → {bu} | Build navigation trees, dropdowns |

---

## Enriching Domain Objects

Use the lookups to add arclake fields to your domain objects:

```python
# backend/app/services/your_service.py

def enrich_employees(employees: list[dict], employee_lookup: dict) -> list[dict]:
    """Add arclake hierarchy fields to employee records."""
    unmatched = set()

    for emp in employees:
        hc_entity = emp.get('entity') or ''
        hc_company = emp.get('company') or ''
        arclake = employee_lookup.get((hc_entity, hc_company), {})

        emp['arclake_rollup'] = arclake.get('arclake_rollup', '')
        emp['arclake_entity'] = arclake.get('arclake_entity', '')
        emp['arclake_block']  = arclake.get('arclake_block', '')
        emp['arclake_bu']     = arclake.get('arclake_bu', '')

        if not arclake and hc_entity:
            unmatched.add(hc_entity)

    if unmatched:
        logger.warning(f"Unmatched entities (no arclake mapping): {unmatched}")

    return employees
```

---

## Caching & Sync

For applications that need entity mappings frequently, cache locally and refresh on a schedule.

```python
# backend/app/services/sync_service.py

import json
import threading
from pathlib import Path
from apscheduler.schedulers.background import BackgroundScheduler

CACHE_DIR = Path(__file__).parent.parent / "data_cache"
CACHE_FILE = CACHE_DIR / "entity_mappings.json"

class EntityMappingSyncService:
    """Singleton service that syncs entity mappings hourly."""

    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._initialized = True
        CACHE_DIR.mkdir(parents=True, exist_ok=True)

    def sync_now(self) -> dict:
        """Fetch fresh mappings and rebuild lookups."""
        raw_mappings = self.client.get_entity_mappings()
        employee_lookup, portco_to_entity, os_entity_to_arclake, hierarchy_tree = (
            build_arclake_lookup(raw_mappings)
        )

        # Cache raw mappings to disk
        with open(CACHE_FILE, "w") as f:
            json.dump(raw_mappings, f)

        return {
            "employee_lookup": employee_lookup,
            "portco_to_entity": portco_to_entity,
            "os_entity_to_arclake": os_entity_to_arclake,
            "hierarchy_tree": hierarchy_tree,
        }

    def get_cached_mappings(self) -> list[dict]:
        """Load mappings from local cache."""
        if CACHE_FILE.exists():
            with open(CACHE_FILE) as f:
                return json.load(f)
        return []

    def start_scheduler(self):
        """Start hourly background sync."""
        scheduler = BackgroundScheduler()
        scheduler.add_job(self.sync_now, "interval", hours=1)
        scheduler.start()
```

---

## Data Steward Changes Required

To expose entity mappings as a centralized service for other applications, the following changes need to be made to the `data-steward` app.

### 1. Add GraphQL Endpoint Function

Add to `data-steward/backend/src/utils/database.ts`:

```typescript
/**
 * GraphQL query function for Entity Mappings (uses ENTITY_MAPPING_GRAPHQL_ENDPOINT)
 * Separate endpoint for security isolation between modules
 */
export async function entityMappingGraphql<T = any>(
  query: string,
  variables?: Record<string, any>
): Promise<T> {
  const endpoint = process.env.ENTITY_MAPPING_GRAPHQL_ENDPOINT;
  if (!endpoint) {
    throw new Error("ENTITY_MAPPING_GRAPHQL_ENDPOINT environment variable not set");
  }
  return client.executeQuery<T>(query, variables, endpoint);
}
```

### 2. Create Entity Mappings Azure Function

Create `data-steward/backend/src/functions/entity-mappings.ts`:

```typescript
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { authenticateRequest } from "../utils/auth";
import { entityMappingGraphql } from "../utils/database";

// Types
interface EntityMapping {
  row_key: string;
  hc_entity: string | null;
  hc_company: string | null;
  os_portco: string | null;
  os_entity: string | null;
  arclake_rollup: string | null;
  arclake_entity: string | null;
  arclake_block: string | null;
  arclake_bu: string | null;
  portco_id: string | null;
  linked_portco_name: string | null;
  business_unit_key: string | null;
  linked_bu_name: string | null;
  linked_block_name: string | null;
  rollup_id: string | null;
  linked_rollup_name: string | null;
}

interface PaginatedResponse<T> {
  items: T[];
  hasNextPage: boolean;
  endCursor: string | null;
}

// GET /api/entity-mappings — Paginated list with optional filters
async function getEntityMappings(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const user = await authenticateRequest(request, context);
  if (!user) return { status: 401, jsonBody: { error: "Unauthorized" } };

  try {
    const first = parseInt(request.query.get("first") || "1000");
    const after = request.query.get("after") || null;
    const arclakeEntity = request.query.get("arclake_entity") || null;
    const arclakeRollup = request.query.get("arclake_rollup") || null;

    const filterConditions: string[] = [];
    if (arclakeEntity) {
      filterConditions.push(`{ arclake_entity: { eq: "${arclakeEntity}" } }`);
    }
    if (arclakeRollup) {
      filterConditions.push(`{ arclake_rollup: { eq: "${arclakeRollup}" } }`);
    }

    const filterArg = filterConditions.length > 0
      ? `filter: { and: [${filterConditions.join(", ")}] }`
      : "";

    const query = `
      query GetEntityMappings($first: Int, $after: String) {
        vw_entity_mappings(
          first: $first
          after: $after
          ${filterArg}
          orderBy: { arclake_entity: ASC }
        ) {
          items {
            row_key hc_entity hc_company os_portco os_entity
            arclake_rollup arclake_entity arclake_block arclake_bu
            portco_id linked_portco_name business_unit_key
            linked_bu_name linked_block_name rollup_id linked_rollup_name
          }
          endCursor
          hasNextPage
        }
      }
    `;

    const result = await entityMappingGraphql<any>(query, {
      first,
      after,
    });

    const data = result.vw_entity_mappings;
    return {
      jsonBody: {
        items: data.items,
        hasNextPage: data.hasNextPage,
        endCursor: data.endCursor,
      },
    };
  } catch (error) {
    context.error("[entity-mappings] Error:", error);
    return { status: 500, jsonBody: { error: "Failed to fetch entity mappings" } };
  }
}

// GET /api/entity-mappings/hierarchy — Returns rollup → entity → block → BU tree
async function getHierarchy(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const user = await authenticateRequest(request, context);
  if (!user) return { status: 401, jsonBody: { error: "Unauthorized" } };

  try {
    // Fetch all mappings (paginate through)
    let allItems: EntityMapping[] = [];
    let cursor: string | null = null;
    let hasNext = true;

    while (hasNext) {
      const afterArg = cursor ? `after: "${cursor}"` : "";
      const query = `
        query {
          vw_entity_mappings(first: 100000 ${afterArg} orderBy: { arclake_rollup: ASC }) {
            items {
              arclake_rollup arclake_entity arclake_block arclake_bu
              linked_rollup_name linked_portco_name linked_block_name linked_bu_name
            }
            endCursor
            hasNextPage
          }
        }
      `;
      const result = await entityMappingGraphql<any>(query);
      const data = result.vw_entity_mappings;
      allItems.push(...data.items);
      cursor = data.endCursor;
      hasNext = data.hasNextPage;
    }

    // Build hierarchy tree
    const hierarchy: Record<string, Record<string, Record<string, string[]>>> = {};
    for (const m of allItems) {
      const rollup = m.arclake_rollup || "";
      const entity = m.arclake_entity || "";
      const block = m.arclake_block || "";
      const bu = m.arclake_bu || "";
      if (!rollup || !entity || entity === "No Match") continue;

      if (!hierarchy[rollup]) hierarchy[rollup] = {};
      if (!hierarchy[rollup][entity]) hierarchy[rollup][entity] = {};
      if (block) {
        if (!hierarchy[rollup][entity][block]) hierarchy[rollup][entity][block] = [];
        if (bu && !hierarchy[rollup][entity][block].includes(bu)) {
          hierarchy[rollup][entity][block].push(bu);
        }
      }
    }

    return { jsonBody: hierarchy };
  } catch (error) {
    context.error("[entity-mappings] Hierarchy error:", error);
    return { status: 500, jsonBody: { error: "Failed to build hierarchy" } };
  }
}

// Register HTTP triggers
app.http("getEntityMappings", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "entity-mappings",
  handler: getEntityMappings,
});

app.http("getEntityMappingsHierarchy", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "entity-mappings/hierarchy",
  handler: getHierarchy,
});
```

### 3. Environment Configuration

Add to the Azure Function App settings (and local `.env`):

```
ENTITY_MAPPING_GRAPHQL_ENDPOINT=https://<your-fabric-workspace>.datamart.fabric.microsoft.com/graphql
```

### 4. Consuming from Another App

Once the data-steward exposes entity mappings, other apps fetch via REST:

```python
# In your app's service layer
import requests

DATA_STEWARD_URL = os.getenv("DATA_STEWARD_URL")

def fetch_entity_mappings(token: str) -> list[dict]:
    """Fetch entity mappings from the data-steward API."""
    headers = {"Authorization": f"Bearer {token}"}
    all_items = []
    cursor = None

    while True:
        params = {"first": 1000}
        if cursor:
            params["after"] = cursor
        resp = requests.get(
            f"{DATA_STEWARD_URL}/api/entity-mappings",
            headers=headers,
            params=params,
        )
        resp.raise_for_status()
        data = resp.json()
        all_items.extend(data["items"])
        if not data["hasNextPage"]:
            break
        cursor = data["endCursor"]

    return all_items


def fetch_hierarchy(token: str) -> dict:
    """Fetch the pre-built hierarchy tree from data-steward."""
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.get(
        f"{DATA_STEWARD_URL}/api/entity-mappings/hierarchy",
        headers=headers,
    )
    resp.raise_for_status()
    return resp.json()
```

---

## Complete Example

Minimal end-to-end example: fetch mappings, build lookups, enrich records.

```python
# backend/app/services/example_usage.py

import logging
from typing import Dict, List, Tuple, Set

logger = logging.getLogger(__name__)


def build_arclake_lookup(raw_mappings: list[dict]) -> tuple[dict, dict, dict, dict]:
    """Build 4 lookup dictionaries from raw entity mapping records."""
    employee_lookup: Dict[Tuple[str, str], Dict[str, str]] = {}
    portco_to_entity: Dict[str, str] = {}
    os_entity_to_arclake: Dict[str, Dict[str, str]] = {}
    hierarchy_tree: Dict[str, Dict[str, Dict[str, Set[str]]]] = {}

    for m in raw_mappings:
        hc_entity  = m.get('hc_entity') or ''
        hc_company = m.get('hc_company') or ''
        os_portco  = m.get('os_portco') or ''
        os_entity  = m.get('os_entity') or ''
        rollup     = m.get('arclake_rollup') or ''
        entity     = m.get('arclake_entity') or ''
        block      = m.get('arclake_block') or ''
        bu         = m.get('arclake_bu') or ''

        if hc_entity and hc_company:
            employee_lookup.setdefault((hc_entity, hc_company), {
                'arclake_rollup': rollup, 'arclake_entity': entity,
                'arclake_block': block, 'arclake_bu': bu,
            })

        if os_portco and os_portco != 'No Match' and entity:
            portco_to_entity.setdefault(os_portco, entity)

        if os_entity and os_entity != 'No Match' and entity and block:
            os_entity_to_arclake.setdefault(os_entity, {
                'arclake_entity': entity, 'arclake_block': block, 'arclake_bu': bu,
            })

        if rollup and entity and entity != 'No Match' and rollup != 'No Match':
            hierarchy_tree.setdefault(rollup, {}).setdefault(entity, {})
            if block:
                hierarchy_tree[rollup][entity].setdefault(block, set())
                if bu:
                    hierarchy_tree[rollup][entity][block].add(bu)

    return employee_lookup, portco_to_entity, os_entity_to_arclake, hierarchy_tree


# Usage
mappings = fetch_entity_mappings(token)  # or client.get_entity_mappings()
emp_lookup, portco_lookup, os_lookup, tree = build_arclake_lookup(mappings)

# Enrich an employee record
emp = {"entity": "Acme Corp", "company": "Acme Holdings"}
arclake = emp_lookup.get((emp["entity"], emp["company"]), {})
emp["arclake_entity"] = arclake.get("arclake_entity", "")

# Enrich a financial record
fin = {"os_portco": "ACME"}
fin["arclake_entity"] = portco_lookup.get(fin["os_portco"], "")
```

---

## Checklist

### Backend - Entity Mapping
- [ ] GraphQL client method fetches `vw_entity_mapping` with pagination
- [ ] `build_arclake_lookup()` builds all 4 lookup dictionaries
- [ ] Unmatched entities are logged as warnings
- [ ] Lookups handle `None` and `"No Match"` values gracefully

### Backend - Caching (if applicable)
- [ ] Sync service caches mappings to local JSON
- [ ] APScheduler runs sync hourly
- [ ] Singleton pattern prevents concurrent syncs
- [ ] Fallback to cached data if GraphQL is unavailable

### Data Steward (if centralizing)
- [ ] `entityMappingGraphql()` added to `database.ts`
- [ ] `entity-mappings.ts` Azure Function created with GET endpoints
- [ ] `ENTITY_MAPPING_GRAPHQL_ENDPOINT` env var configured
- [ ] Endpoints support pagination and filtering
- [ ] Hierarchy endpoint returns rollup → entity → block → BU tree
