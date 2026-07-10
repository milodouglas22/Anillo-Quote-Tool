# Microsoft Fabric Warehouse Setup Guide

This document is designed to be dropped into Claude to help you set up a Microsoft Fabric Warehouse backend with GraphQL API for your application. Claude will read this guide and generate the necessary SQL scripts for your specific use case.

---

## How to Use This Guide

1. **Share this file with Claude** along with your application requirements
2. **Describe your data model** - what entities you need (e.g., users, projects, documents)
3. **Claude will generate** complete SQL scripts following Fabric's requirements
4. **Copy the SQL** into your Fabric Warehouse query editor and execute
5. **Refresh your GraphQL API** in Fabric to expose the new schema

---

## Instructions for Claude

When a user asks you to set up a Fabric backend using this guide, follow these steps:

### Step 1: Gather Requirements

Ask the user:
- What entities/tables do they need?
- What fields should each entity have?
- What are the relationships between entities?
- Do they need any specific queries or operations?

### Step 2: Generate SQL Scripts

Generate SQL scripts that:
1. Create all tables following Fabric's syntax requirements
2. Create views for common query patterns
3. Create stored procedures for all CRUD operations
4. Handle relationships through stored procedures (since foreign keys aren't supported)

### Step 3: Output Format

Provide the SQL in clearly labeled sections:
1. **Tables** - All CREATE TABLE statements
2. **Views** - All CREATE VIEW statements
3. **Stored Procedures** - All CREATE PROCEDURE statements
4. **Migration Scripts** (if updating existing schema)

### Step 4: Generate GraphQL Examples

After the SQL, provide Python code examples showing how to call the stored procedures via GraphQL.

---

## Fabric SQL Syntax Requirements

### Constraints NOT Supported

Fabric Warehouse does **NOT** support:

```sql
-- These will ALL fail in Fabric:
PRIMARY KEY
FOREIGN KEY
CREATE INDEX
DEFAULT constraints
UNIQUE constraints
```

**Workaround:** Handle these in application logic or stored procedures.

```sql
-- WRONG (will fail):
CREATE TABLE my_table (
    id CHAR(36) PRIMARY KEY,
    name VARCHAR(100) NOT NULL DEFAULT 'unknown'
);

-- CORRECT:
CREATE TABLE my_table (
    id CHAR(36) NOT NULL,
    name VARCHAR(100) NOT NULL
);
```

### ALTER TABLE Limitations

Cannot alter column data types:

```sql
-- This will FAIL:
ALTER TABLE my_table ALTER COLUMN my_column VARCHAR(100);
-- Error: "The specified ALTER TABLE statement is not supported in this edition of SQL Server."
```

**Workaround:** Drop and recreate the table:

```sql
-- 1. Drop dependent objects (stored procedures, views)
DROP PROCEDURE IF EXISTS schema.sp_my_proc;
DROP VIEW IF EXISTS schema.my_view;

-- 2. Drop and recreate table
DROP TABLE IF EXISTS schema.my_table;
CREATE TABLE schema.my_table (
    -- new schema here
);

-- 3. Recreate dependent objects
```

### Cursors NOT Supported

Fabric does not support cursors or `@@FETCH_STATUS`:

```sql
-- This will FAIL:
DECLARE my_cursor CURSOR FOR SELECT id FROM my_table;
OPEN my_cursor;
FETCH NEXT FROM my_cursor INTO @id;
WHILE @@FETCH_STATUS = 0
BEGIN
    -- do something
    FETCH NEXT FROM my_cursor INTO @id;
END
-- Error: "'@@FETCH_STATUS' is not supported."
```

**Workaround:** Use set-based operations with JOINs:

```sql
-- CORRECT: Set-based delete with JOIN
DELETE t FROM schema.child_table t
INNER JOIN schema.parent_table p ON t.parent_id = p.id
WHERE p.some_column = @value;
```

---

## Data Type Requirements

### VARCHAR vs NVARCHAR

- `VARCHAR(n)` - Supported (n = 1 to 8000)
- `NVARCHAR(MAX)` - Supported
- `NVARCHAR(n)` - **NOT supported**

```sql
-- WRONG:
filename NVARCHAR(500) NOT NULL
-- Error: "The data type 'nvarchar(500)' is not supported"

-- CORRECT:
filename VARCHAR(500) NOT NULL
-- or
filename NVARCHAR(MAX) NOT NULL
```

### DATETIME2 Requires Precision

Must specify precision between 0-6:

```sql
-- WRONG:
created_at DATETIME2 NOT NULL
-- Error: "An integer precision value between 0 and 6 must be specified."

-- CORRECT:
created_at DATETIME2(6) NOT NULL
```

### DECIMAL Type and GraphQL

**Critical:** Fabric GraphQL API has issues serializing/deserializing `DECIMAL` types.

```sql
-- Using DECIMAL causes GraphQL errors:
confidence DECIMAL(5,2)
-- Error: "Decimal cannot parse the given value of type `System.Double`"
-- Error: "Decimal cannot deserialize the given value"
```

**Workaround:** Use `VARCHAR` for decimal values:

```sql
-- CORRECT: Store as string, convert in application
confidence VARCHAR(20),
processing_time_seconds VARCHAR(20)
```

In Python, convert to string before sending:
```python
"confidence": str(confidence) if confidence is not None else None
```

### Complete Data Type Reference

| Use Case | Correct Type | Incorrect Type |
|----------|--------------|----------------|
| UUID/ID | `CHAR(36) NOT NULL` | `UNIQUEIDENTIFIER` |
| Short text | `VARCHAR(255) NOT NULL` | `NVARCHAR(255)` |
| Long text | `VARCHAR(MAX)` or `NVARCHAR(MAX)` | - |
| Integer | `INT` | - |
| Decimal/Money | `VARCHAR(20)` | `DECIMAL(x,y)` |
| Boolean | `BIT NOT NULL` | `BOOLEAN` |
| Timestamp | `DATETIME2(6) NOT NULL` | `DATETIME2` |
| Nullable timestamp | `DATETIME2(6)` | - |

---

## Standard Table Template

Use this template for all tables:

```sql
CREATE TABLE dbo.my_table (
    id CHAR(36) NOT NULL,                    -- UUID as string (generate in app)
    -- your fields here
    created_at DATETIME2(6) NOT NULL,        -- Always include
    updated_at DATETIME2(6)                  -- Nullable, updated by SPs
);
GO
```

### Example: Complete Table Definition

```sql
CREATE TABLE dbo.projects (
    id CHAR(36) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description VARCHAR(MAX),
    owner_id VARCHAR(255) NOT NULL,          -- User ID from auth system
    status VARCHAR(50) NOT NULL,             -- 'active', 'archived', etc.
    is_archived BIT NOT NULL,
    metadata VARCHAR(MAX),                   -- JSON stored as string
    created_at DATETIME2(6) NOT NULL,
    updated_at DATETIME2(6)
);
GO
```

---

## Standard View Template

Create views for common query patterns:

```sql
CREATE VIEW dbo.vw_my_table
AS
SELECT
    id,
    -- select fields
    created_at,
    updated_at
FROM dbo.my_table;
GO
```

### Example: View with Aggregations

```sql
CREATE VIEW dbo.vw_project_summary
AS
SELECT
    p.id,
    p.name,
    p.owner_id,
    p.status,
    p.created_at,
    COUNT(d.id) AS document_count,
    MAX(d.created_at) AS last_document_at
FROM dbo.projects p
LEFT JOIN dbo.documents d ON d.project_id = p.id
GROUP BY p.id, p.name, p.owner_id, p.status, p.created_at;
GO
```

---

## Stored Procedure Templates

### Create (Insert) Procedure

```sql
CREATE PROCEDURE dbo.sp_create_my_entity
    @id CHAR(36),
    @name VARCHAR(255),
    @optional_field VARCHAR(100) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    INSERT INTO dbo.my_table (id, name, optional_field, created_at)
    VALUES (@id, @name, @optional_field, SYSUTCDATETIME());

    SELECT @id AS id;
END;
GO
```

### Update Procedure (with Optional Fields)

Use `COALESCE` to only update provided fields:

```sql
CREATE PROCEDURE dbo.sp_update_my_entity
    @id CHAR(36),
    @name VARCHAR(255) = NULL,
    @status VARCHAR(50) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE dbo.my_table
    SET name = COALESCE(@name, name),
        status = COALESCE(@status, status),
        updated_at = SYSUTCDATETIME()
    WHERE id = @id;

    SELECT @id AS id;
END;
GO
```

### Delete Procedure (with Cascade)

Since foreign keys aren't supported, handle cascades manually:

```sql
CREATE PROCEDURE dbo.sp_delete_project
    @id CHAR(36)
AS
BEGIN
    SET NOCOUNT ON;

    -- Delete grandchildren first (use JOINs, no cursors!)
    DELETE c FROM dbo.comments c
    INNER JOIN dbo.documents d ON c.document_id = d.id
    WHERE d.project_id = @id;

    -- Delete children
    DELETE FROM dbo.documents WHERE project_id = @id;

    -- Delete parent
    DELETE FROM dbo.projects WHERE id = @id;

    SELECT 'deleted' AS result;
END;
GO
```

### Get Single Entity Procedure

```sql
CREATE PROCEDURE dbo.sp_get_my_entity
    @id CHAR(36)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT id, name, status, created_at, updated_at
    FROM dbo.my_table
    WHERE id = @id;
END;
GO
```

### List with Filters Procedure

```sql
CREATE PROCEDURE dbo.sp_list_projects
    @owner_id VARCHAR(255) = NULL,
    @status VARCHAR(50) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    SELECT id, name, owner_id, status, created_at
    FROM dbo.projects
    WHERE (@owner_id IS NULL OR owner_id = @owner_id)
      AND (@status IS NULL OR status = @status)
    ORDER BY created_at DESC;
END;
GO
```

---

## GraphQL API Behaviors

### No `_by_pk` Queries

Fabric GraphQL does **NOT** generate `_by_pk` queries like Hasura:

```python
# WRONG - This doesn't exist:
query = """
    query GetItem($id: String!) {
        my_table_by_pk(id: $id) { id, name }
    }
"""

# CORRECT - Use filter:
query = """
    query GetItem($id: String!) {
        my_table(filter: { id: { eq: $id } }) {
            items { id, name }
        }
    }
"""
result = graphql(query, {"id": item_id})
items = result.get("my_table", {}).get("items", [])
return items[0] if items else None
```

### Stored Procedures Return Arrays

Stored procedure mutations return **arrays**, not single objects:

```python
# Response format:
{'executesp_my_procedure': [{'id': '123', 'result': 'success'}]}
#                          ^ Note: This is a LIST

# WRONG:
result.get("executesp_my_procedure", {}).get("id")
# Error: "'list' object has no attribute 'get'"

# CORRECT:
sp_result = result.get("executesp_my_procedure", [])
if sp_result and isinstance(sp_result, list):
    return sp_result[0].get("id")
```

### Variable Types Must Match

GraphQL enforces strict type matching with stored procedure parameters:

```python
# If stored procedure expects DECIMAL but you declare String:
# Error: "The variable `confidence` is not compatible with the type of the current location"

# Solution: Change the SQL column to VARCHAR (see Data Types section)
```

### Passing All Parameters

When calling stored procedures, pass all parameters (even NULL ones):

```python
# Some stored procedures require all params to be present:
mutation = """
    mutation Update($id: String!, $field1: Int, $field2: String) {
        executesp_update(id: $id, field1: $field1, field2: $field2) { id }
    }
"""
graphql(mutation, {
    "id": item_id,
    "field1": None,      # Pass None, not omit
    "field2": "value"
})
```

---

## Common Errors and Solutions

| Error | Cause | Solution |
|-------|-------|----------|
| "not supported in this edition of SQL Server" | Using PRIMARY KEY, FOREIGN KEY, ALTER TABLE type change | See SQL Syntax Limitations |
| "The data type 'nvarchar(n)' is not supported" | Using `NVARCHAR` with length | Use `VARCHAR(n)` or `NVARCHAR(MAX)` |
| "An integer precision value between 0 and 6 must be specified" | `DATETIME2` without precision | Use `DATETIME2(6)` |
| "'@@FETCH_STATUS' is not supported" | Using cursors | Rewrite with set-based JOINs |
| "Decimal cannot parse/deserialize the given value" | `DECIMAL` type in GraphQL | Use `VARCHAR` for decimals |
| "The field `xxx_by_pk` does not exist" | Using Hasura-style queries | Use filter queries with `.items[]` |
| "'list' object has no attribute 'get'" | Treating SP result as dict | Access as `result[0]` |
| "The variable with the name `xxx` does not exist" | Mutation variable mismatch | Match variable names to SP params |
| "The request failed in data source" (BadRequest) | SP execution failed | Check NULL handling, pass all params |

---

## Refreshing the GraphQL API

After any schema changes (tables, views, stored procedures), you **must** refresh the GraphQL API in Fabric:

1. Go to your Fabric workspace
2. Find your GraphQL API item
3. Click "Refresh" or recreate the connection to the warehouse

**Without refreshing, new/modified stored procedures won't be available.**

---

## Python GraphQL Client Pattern

### Base Client Setup

```python
import requests
from typing import Any, Dict, Optional
from uuid import uuid4

class FabricGraphQLClient:
    def __init__(self, endpoint: str, get_token_func):
        self.endpoint = endpoint
        self.get_token = get_token_func

    def execute(self, query: str, variables: Dict[str, Any] = None) -> Dict[str, Any]:
        headers = {
            "Authorization": f"Bearer {self.get_token()}",
            "Content-Type": "application/json"
        }
        response = requests.post(
            self.endpoint,
            json={"query": query, "variables": variables or {}},
            headers=headers
        )
        response.raise_for_status()
        result = response.json()
        if "errors" in result:
            raise Exception(f"GraphQL errors: {result['errors']}")
        return result.get("data", {})
```

### Query Pattern (Get Single Item)

```python
def get_item(client: FabricGraphQLClient, item_id: str) -> Optional[Dict]:
    query = """
    query GetItem($id: String!) {
        my_table(filter: { id: { eq: $id } }) {
            items {
                id
                name
                status
                created_at
            }
        }
    }
    """
    result = client.execute(query, {"id": item_id})
    items = result.get("my_table", {}).get("items", [])
    return items[0] if items else None
```

### Query Pattern (List with Filters)

```python
def list_items(client: FabricGraphQLClient, status: str = None) -> list:
    query = """
    query ListItems($status: String) {
        my_table(filter: { status: { eq: $status } }) {
            items {
                id
                name
                status
            }
        }
    }
    """
    # For no filter, pass None
    variables = {"status": status} if status else {}
    result = client.execute(query, variables)
    return result.get("my_table", {}).get("items", [])
```

### Mutation Pattern (Create via Stored Procedure)

```python
def create_item(client: FabricGraphQLClient, name: str) -> str:
    mutation = """
    mutation CreateItem($id: String!, $name: String!) {
        executesp_create_my_entity(id: $id, name: $name) {
            id
        }
    }
    """
    item_id = str(uuid4())
    result = client.execute(mutation, {"id": item_id, "name": name})

    # SP returns array - extract first item
    sp_result = result.get("executesp_create_my_entity", [])
    if sp_result and isinstance(sp_result, list):
        return sp_result[0].get("id")
    return item_id
```

### Mutation Pattern (Update via Stored Procedure)

```python
def update_item(client: FabricGraphQLClient, item_id: str, name: str = None, status: str = None) -> bool:
    mutation = """
    mutation UpdateItem($id: String!, $name: String, $status: String) {
        executesp_update_my_entity(id: $id, name: $name, status: $status) {
            id
        }
    }
    """
    # Pass all params, even if None
    result = client.execute(mutation, {
        "id": item_id,
        "name": name,
        "status": status
    })
    return bool(result.get("executesp_update_my_entity"))
```

### Mutation Pattern (Delete via Stored Procedure)

```python
def delete_item(client: FabricGraphQLClient, item_id: str) -> bool:
    mutation = """
    mutation DeleteItem($id: String!) {
        executesp_delete_my_entity(id: $id) {
            result
        }
    }
    """
    result = client.execute(mutation, {"id": item_id})
    sp_result = result.get("executesp_delete_my_entity", [])
    return bool(sp_result)
```

---

## Complete Example: Task Management Schema

Here's a complete example for a task management system:

### Tables

```sql
-- Users table (if not using external auth)
CREATE TABLE dbo.users (
    id CHAR(36) NOT NULL,
    email VARCHAR(255) NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    created_at DATETIME2(6) NOT NULL
);
GO

-- Projects table
CREATE TABLE dbo.projects (
    id CHAR(36) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description VARCHAR(MAX),
    owner_id CHAR(36) NOT NULL,
    is_archived BIT NOT NULL,
    created_at DATETIME2(6) NOT NULL,
    updated_at DATETIME2(6)
);
GO

-- Tasks table
CREATE TABLE dbo.tasks (
    id CHAR(36) NOT NULL,
    project_id CHAR(36) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description VARCHAR(MAX),
    status VARCHAR(50) NOT NULL,              -- 'todo', 'in_progress', 'done'
    priority VARCHAR(20) NOT NULL,            -- 'low', 'medium', 'high'
    assignee_id CHAR(36),
    due_date DATETIME2(6),
    created_at DATETIME2(6) NOT NULL,
    updated_at DATETIME2(6)
);
GO

-- Comments table
CREATE TABLE dbo.comments (
    id CHAR(36) NOT NULL,
    task_id CHAR(36) NOT NULL,
    author_id CHAR(36) NOT NULL,
    content VARCHAR(MAX) NOT NULL,
    created_at DATETIME2(6) NOT NULL
);
GO
```

### Views

```sql
CREATE VIEW dbo.vw_projects
AS
SELECT
    p.id,
    p.name,
    p.description,
    p.owner_id,
    p.is_archived,
    p.created_at,
    p.updated_at,
    COUNT(t.id) AS task_count,
    SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS completed_count
FROM dbo.projects p
LEFT JOIN dbo.tasks t ON t.project_id = p.id
GROUP BY p.id, p.name, p.description, p.owner_id, p.is_archived, p.created_at, p.updated_at;
GO

CREATE VIEW dbo.vw_tasks
AS
SELECT
    t.id,
    t.project_id,
    t.title,
    t.description,
    t.status,
    t.priority,
    t.assignee_id,
    t.due_date,
    t.created_at,
    t.updated_at,
    p.name AS project_name,
    COUNT(c.id) AS comment_count
FROM dbo.tasks t
INNER JOIN dbo.projects p ON t.project_id = p.id
LEFT JOIN dbo.comments c ON c.task_id = t.id
GROUP BY t.id, t.project_id, t.title, t.description, t.status, t.priority,
         t.assignee_id, t.due_date, t.created_at, t.updated_at, p.name;
GO
```

### Stored Procedures

```sql
-- Create Project
CREATE PROCEDURE dbo.sp_create_project
    @id CHAR(36),
    @name VARCHAR(255),
    @description VARCHAR(MAX) = NULL,
    @owner_id CHAR(36)
AS
BEGIN
    SET NOCOUNT ON;

    INSERT INTO dbo.projects (id, name, description, owner_id, is_archived, created_at)
    VALUES (@id, @name, @description, @owner_id, 0, SYSUTCDATETIME());

    SELECT @id AS id;
END;
GO

-- Update Project
CREATE PROCEDURE dbo.sp_update_project
    @id CHAR(36),
    @name VARCHAR(255) = NULL,
    @description VARCHAR(MAX) = NULL,
    @is_archived BIT = NULL
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE dbo.projects
    SET name = COALESCE(@name, name),
        description = COALESCE(@description, description),
        is_archived = COALESCE(@is_archived, is_archived),
        updated_at = SYSUTCDATETIME()
    WHERE id = @id;

    SELECT @id AS id;
END;
GO

-- Delete Project (cascades to tasks and comments)
CREATE PROCEDURE dbo.sp_delete_project
    @id CHAR(36)
AS
BEGIN
    SET NOCOUNT ON;

    -- Delete comments on tasks in this project
    DELETE c FROM dbo.comments c
    INNER JOIN dbo.tasks t ON c.task_id = t.id
    WHERE t.project_id = @id;

    -- Delete tasks
    DELETE FROM dbo.tasks WHERE project_id = @id;

    -- Delete project
    DELETE FROM dbo.projects WHERE id = @id;

    SELECT 'deleted' AS result;
END;
GO

-- Create Task
CREATE PROCEDURE dbo.sp_create_task
    @id CHAR(36),
    @project_id CHAR(36),
    @title VARCHAR(255),
    @description VARCHAR(MAX) = NULL,
    @status VARCHAR(50) = 'todo',
    @priority VARCHAR(20) = 'medium',
    @assignee_id CHAR(36) = NULL,
    @due_date DATETIME2(6) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    INSERT INTO dbo.tasks (id, project_id, title, description, status, priority, assignee_id, due_date, created_at)
    VALUES (@id, @project_id, @title, @description, @status, @priority, @assignee_id, @due_date, SYSUTCDATETIME());

    SELECT @id AS id;
END;
GO

-- Update Task
CREATE PROCEDURE dbo.sp_update_task
    @id CHAR(36),
    @title VARCHAR(255) = NULL,
    @description VARCHAR(MAX) = NULL,
    @status VARCHAR(50) = NULL,
    @priority VARCHAR(20) = NULL,
    @assignee_id CHAR(36) = NULL,
    @due_date DATETIME2(6) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE dbo.tasks
    SET title = COALESCE(@title, title),
        description = COALESCE(@description, description),
        status = COALESCE(@status, status),
        priority = COALESCE(@priority, priority),
        assignee_id = COALESCE(@assignee_id, assignee_id),
        due_date = COALESCE(@due_date, due_date),
        updated_at = SYSUTCDATETIME()
    WHERE id = @id;

    SELECT @id AS id;
END;
GO

-- Delete Task (cascades to comments)
CREATE PROCEDURE dbo.sp_delete_task
    @id CHAR(36)
AS
BEGIN
    SET NOCOUNT ON;

    DELETE FROM dbo.comments WHERE task_id = @id;
    DELETE FROM dbo.tasks WHERE id = @id;

    SELECT 'deleted' AS result;
END;
GO

-- Create Comment
CREATE PROCEDURE dbo.sp_create_comment
    @id CHAR(36),
    @task_id CHAR(36),
    @author_id CHAR(36),
    @content VARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;

    INSERT INTO dbo.comments (id, task_id, author_id, content, created_at)
    VALUES (@id, @task_id, @author_id, @content, SYSUTCDATETIME());

    -- Update task's updated_at timestamp
    UPDATE dbo.tasks SET updated_at = SYSUTCDATETIME() WHERE id = @task_id;

    SELECT @id AS id;
END;
GO

-- Delete Comment
CREATE PROCEDURE dbo.sp_delete_comment
    @id CHAR(36)
AS
BEGIN
    SET NOCOUNT ON;

    DELETE FROM dbo.comments WHERE id = @id;

    SELECT 'deleted' AS result;
END;
GO
```

---

## Checklist for Claude

When generating a Fabric schema, ensure:

- [ ] All tables use `CHAR(36) NOT NULL` for ID fields
- [ ] All tables have `created_at DATETIME2(6) NOT NULL`
- [ ] All tables have `updated_at DATETIME2(6)` (nullable)
- [ ] No PRIMARY KEY, FOREIGN KEY, or INDEX constraints
- [ ] No DEFAULT constraints (handle in stored procedures)
- [ ] Use `VARCHAR(n)` not `NVARCHAR(n)`
- [ ] Use `VARCHAR` for decimal/money fields, not `DECIMAL`
- [ ] All DATETIME2 fields specify precision `(6)`
- [ ] Views are created for common query patterns
- [ ] Stored procedures exist for all CRUD operations
- [ ] Delete procedures handle cascading deletes via JOINs
- [ ] Update procedures use COALESCE for optional fields
- [ ] All procedures end with `SELECT` to return result
- [ ] All procedures use `SET NOCOUNT ON`
- [ ] Python examples use `.items[]` array access for queries
- [ ] Python examples handle SP results as arrays `[0]`

---

## Environment Variables

Your application needs these environment variables to connect to Fabric. Add them to your `.env` file:

```bash
# =============================================================================
# Microsoft Fabric Configuration
# =============================================================================

# Azure Service Principal Authentication
AZURE_TENANT_ID=your-tenant-id-here
FABRIC_CLIENT_ID=your-service-principal-client-id
FABRIC_CLIENT_SECRET=your-service-principal-client-secret

# Fabric GraphQL Endpoint
# Format: https://<id>.z8e.graphql.fabric.microsoft.com/v1/workspaces/<workspace-id>/graphqlapis/<api-id>/graphql
FABRIC_GRAPHQL_ENDPOINT=https://xxxxx.z8e.graphql.fabric.microsoft.com/v1/workspaces/xxxxx/graphqlapis/xxxxx/graphql
```

### How to Get These Values

| Variable | Where to Find It |
|----------|------------------|
| `AZURE_TENANT_ID` | Azure Portal → Microsoft Entra ID → Overview → Tenant ID |
| `FABRIC_CLIENT_ID` | Azure Portal → App Registrations → Your App → Application (client) ID |
| `FABRIC_CLIENT_SECRET` | Azure Portal → App Registrations → Your App → Certificates & secrets → New client secret |
| `FABRIC_GRAPHQL_ENDPOINT` | Fabric Portal → Your Workspace → GraphQL API item → Copy endpoint URL |

---

## Fabric-Side Setup Steps

### Step 1: Create a Fabric Workspace

1. Go to [Microsoft Fabric Portal](https://app.fabric.microsoft.com)
2. Create a new workspace or use an existing one
3. Note the workspace name for later

### Step 2: Create a Fabric Warehouse

1. In your workspace, click **+ New** → **Warehouse**
2. Name your warehouse (e.g., `myapp-warehouse`)
3. Wait for provisioning to complete

### Step 3: Run SQL Scripts

1. Open your warehouse
2. Click **New SQL query**
3. Paste and execute the generated SQL scripts in order:
   - Tables first
   - Views second
   - Stored procedures third
4. Verify each script completes without errors

### Step 4: Create GraphQL API

1. In your workspace, click **+ New** → **GraphQL API**
2. Name it (e.g., `myapp-graphql`)
3. Select your warehouse as the data source
4. Select the tables, views, and stored procedures to expose
5. Click **Create**

### Step 5: Configure Service Principal Access

1. **Create Service Principal** (if not exists):
   - Azure Portal → Microsoft Entra ID → App registrations → New registration
   - Name it (e.g., `myapp-fabric-access`)
   - Create a client secret and save it securely

2. **Grant Fabric Workspace Access**:
   - Fabric Portal → Your Workspace → Manage access
   - Add the service principal with **Contributor** or **Member** role

3. **Grant Warehouse Permissions**:
   - Open your warehouse → Manage permissions
   - Add the service principal with appropriate permissions

### Step 6: Test the Connection

1. Copy your GraphQL endpoint URL from the GraphQL API item
2. Add all environment variables to your `.env` file
3. Run your test script to verify connectivity

### Important: Refreshing the GraphQL API

After **any** schema changes (adding/modifying tables, views, or stored procedures):

1. Go to your GraphQL API in Fabric
2. Click the **Refresh** button or re-select the schema objects
3. Wait for the refresh to complete

**Without refreshing, new stored procedures won't be available via GraphQL.**

---

## Testing Fabric Stored Procedures

Claude should generate integration tests for Fabric stored procedures following these patterns and best practices.

### Test File Structure

Create a test file in your backend folder (e.g., `test_fabric_procedures.py`):

```python
"""
Integration tests for Fabric stored procedures.

Run with: python test_fabric_procedures.py

These tests execute against the live Fabric GraphQL endpoint.
Ensure your .env file is configured before running.
"""

from uuid import uuid4
from app.core.fabric_client import graphql

# =============================================================================
# TEST DATA IDS - Unique per test run
# =============================================================================
TEST_PROJECT_ID = str(uuid4())
TEST_TASK_ID = str(uuid4())
TEST_COMMENT_ID = str(uuid4())

# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

def test_header(name: str):
    """Print formatted section header."""
    print(f"\n{'='*60}")
    print(f"  {name}")
    print(f"{'='*60}")

def test_result(name: str, success: bool, details: str = ""):
    """Print individual test result."""
    status = "[PASS]" if success else "[FAIL]"
    print(f"  {status}: {name}")
    if details and not success:
        print(f"         {details}")
```

### Test Pattern: Create Operations

```python
def test_sp_create_project():
    """Test sp_create_project stored procedure."""
    try:
        mutation = """
        mutation CreateProject($id: String!, $name: String!, $owner_id: String!) {
            executesp_create_project(id: $id, name: $name, owner_id: $owner_id) {
                id
            }
        }
        """
        result = graphql(mutation, {
            "id": TEST_PROJECT_ID,
            "name": "Test Project",
            "owner_id": "test-user@example.com"
        })

        # CRITICAL: Stored procedures return ARRAYS, not objects
        sp_result = result.get("executesp_create_project", [])
        success = (
            sp_result and
            len(sp_result) > 0 and
            sp_result[0].get("id") == TEST_PROJECT_ID
        )
        test_result("sp_create_project", success)
        return success
    except Exception as e:
        test_result("sp_create_project", False, str(e))
        return False
```

### Test Pattern: Query Tables and Views

```python
def test_projects_table():
    """Test direct table query."""
    try:
        query = """
        query GetProject($id: String!) {
            projects(filter: { id: { eq: $id } }) {
                items {
                    id
                    name
                    owner_id
                    created_at
                }
            }
        }
        """
        result = graphql(query, {"id": TEST_PROJECT_ID})
        items = result.get("projects", {}).get("items", [])
        success = len(items) > 0 and items[0].get("id") == TEST_PROJECT_ID
        test_result("projects table query", success)
        return success
    except Exception as e:
        test_result("projects table query", False, str(e))
        return False

def test_vw_projects_view():
    """Test view with aggregations."""
    try:
        query = """
        query GetProjectView($id: String!) {
            vw_projects(filter: { id: { eq: $id } }) {
                items {
                    id
                    name
                    task_count
                    completed_count
                }
            }
        }
        """
        result = graphql(query, {"id": TEST_PROJECT_ID})
        items = result.get("vw_projects", {}).get("items", [])
        success = len(items) > 0
        test_result("vw_projects view query", success)
        return success
    except Exception as e:
        test_result("vw_projects view query", False, str(e))
        return False
```

### Test Pattern: Update Operations

```python
def test_sp_update_project():
    """Test sp_update_project stored procedure."""
    try:
        mutation = """
        mutation UpdateProject($id: String!, $name: String, $is_archived: Boolean) {
            executesp_update_project(id: $id, name: $name, is_archived: $is_archived) {
                id
            }
        }
        """
        result = graphql(mutation, {
            "id": TEST_PROJECT_ID,
            "name": "Updated Project Name",
            "is_archived": None  # Pass None for optional params, don't omit
        })

        sp_result = result.get("executesp_update_project", [])
        success = sp_result and len(sp_result) > 0
        test_result("sp_update_project", success)
        return success
    except Exception as e:
        test_result("sp_update_project", False, str(e))
        return False
```

### Test Pattern: Delete Operations (with Cascade Verification)

```python
def test_sp_delete_project():
    """Test sp_delete_project stored procedure (cascades to tasks/comments)."""
    try:
        mutation = """
        mutation DeleteProject($id: String!) {
            executesp_delete_project(id: $id) {
                result
            }
        }
        """
        result = graphql(mutation, {"id": TEST_PROJECT_ID})

        sp_result = result.get("executesp_delete_project", [])
        success = (
            sp_result and
            len(sp_result) > 0 and
            sp_result[0].get("result") == "deleted"
        )
        test_result("sp_delete_project", success)
        return success
    except Exception as e:
        test_result("sp_delete_project", False, str(e))
        return False
```

### Test Pattern: Bulk Operations with JSON

```python
import json

def test_sp_bulk_create_items():
    """Test bulk insert stored procedure with JSON input."""
    try:
        # Pass data as JSON string
        items_json = json.dumps([
            {"name": "Item 1", "value": "100"},
            {"name": "Item 2", "value": "200"},
            {"name": "Item 3", "value": "300"}
        ])

        mutation = """
        mutation BulkCreate($parent_id: String!, $items: String!) {
            executesp_bulk_create_items(parent_id: $parent_id, items: $items) {
                items_created
            }
        }
        """
        result = graphql(mutation, {
            "parent_id": TEST_PROJECT_ID,
            "items": items_json
        })

        sp_result = result.get("executesp_bulk_create_items", [])
        success = sp_result and sp_result[0].get("items_created", 0) == 3
        test_result("sp_bulk_create_items", success)
        return success
    except Exception as e:
        test_result("sp_bulk_create_items", False, str(e))
        return False
```

### Complete Test Runner

```python
def main():
    """Run all tests and print summary."""
    print("\n" + "="*60)
    print("  FABRIC STORED PROCEDURE TESTS")
    print("="*60)

    results = []

    # Test in order: Create → Query → Update → Delete
    test_header("PROJECT TESTS")
    results.append(("sp_create_project", test_sp_create_project()))
    results.append(("projects table", test_projects_table()))
    results.append(("vw_projects view", test_vw_projects_view()))
    results.append(("sp_update_project", test_sp_update_project()))

    test_header("TASK TESTS")
    results.append(("sp_create_task", test_sp_create_task()))
    results.append(("tasks table", test_tasks_table()))
    results.append(("sp_update_task", test_sp_update_task()))

    test_header("CLEANUP TESTS")
    results.append(("sp_delete_task", test_sp_delete_task()))
    results.append(("sp_delete_project", test_sp_delete_project()))

    # Summary
    test_header("SUMMARY")
    passed = sum(1 for _, success in results if success)
    failed = sum(1 for _, success in results if not success)

    print(f"\n  Total:  {len(results)}")
    print(f"  Passed: {passed}")
    print(f"  Failed: {failed}")

    if failed > 0:
        print(f"\n  Failed tests:")
        for name, success in results:
            if not success:
                print(f"    - {name}")

    print("\n" + "="*60)

if __name__ == "__main__":
    main()
```

### Testing Best Practices

| Practice | Description |
|----------|-------------|
| **Use UUIDs for test data** | Generate unique IDs per test run to avoid conflicts |
| **Test CRUD lifecycle** | Create → Read → Update → Read → Delete → Verify deletion |
| **Handle SP array responses** | Always use `result.get("executesp_xxx", [])[0]` pattern |
| **Pass all parameters** | Include optional params as `None`, don't omit them |
| **Test cascade deletes** | Verify child records are deleted when parent is deleted |
| **Test views separately** | Views may have different data than base tables |
| **Run against live endpoint** | These are integration tests, not unit tests with mocks |
| **Clean up test data** | Delete tests should run last to clean up created data |

### Test Execution

```bash
# Run from your backend directory
cd backend
python test_fabric_procedures.py
```

### Expected Output

```
============================================================
  FABRIC STORED PROCEDURE TESTS
============================================================

============================================================
  PROJECT TESTS
============================================================
  [PASS]: sp_create_project
  [PASS]: projects table
  [PASS]: vw_projects view
  [PASS]: sp_update_project

============================================================
  TASK TESTS
============================================================
  [PASS]: sp_create_task
  [PASS]: tasks table
  [PASS]: sp_update_task

============================================================
  CLEANUP TESTS
============================================================
  [PASS]: sp_delete_task
  [PASS]: sp_delete_project

============================================================
  SUMMARY
============================================================

  Total:  9
  Passed: 9
  Failed: 0

============================================================
```

### Cleanup Utility Script

Create a `cleanup_fabric.py` for manual data cleanup during development:

```python
"""
Utility script to clean up all test data from Fabric.
Run with: python cleanup_fabric.py
"""

from app.core.fabric_client import graphql

def cleanup_all():
    """Delete all records from all tables."""
    print("Cleaning up Fabric data...")

    # Delete in reverse dependency order
    tables = [
        ("comments", "sp_delete_comment"),
        ("tasks", "sp_delete_task"),
        ("projects", "sp_delete_project"),
    ]

    for table, sp_name in tables:
        query = f"query {{ {table} {{ items {{ id }} }} }}"
        result = graphql(query)
        items = result.get(table, {}).get("items", [])

        for item in items:
            mutation = f"""
                mutation Delete($id: String!) {{
                    execute{sp_name}(id: $id) {{ result }}
                }}
            """
            graphql(mutation, {"id": item["id"]})

        print(f"  Deleted {len(items)} records from {table}")

    print("Cleanup complete!")

if __name__ == "__main__":
    cleanup_all()
```

---

## Checklist for Claude: Testing

When generating tests for a Fabric implementation, ensure:

- [ ] Test file uses standalone execution (no pytest/unittest framework required)
- [ ] UUIDs generated for all test data IDs
- [ ] Helper functions for formatted output (`test_header`, `test_result`)
- [ ] Tests organized by domain (Projects, Tasks, etc.)
- [ ] Tests follow CRUD lifecycle order: Create → Read → Update → Delete
- [ ] All stored procedure results handled as arrays `[0]`
- [ ] Table queries use `.items[]` pattern
- [ ] View queries tested separately from base tables
- [ ] Cascade deletes verified (child records deleted with parent)
- [ ] Bulk operations use JSON string parameters
- [ ] All optional parameters passed (as `None` if not used)
- [ ] Summary statistics printed at end
- [ ] Cleanup utility script provided for development

---

## Post-Setup Steps

After running the SQL scripts in Fabric:

1. **Refresh GraphQL API** - Required after any schema change
2. **Test stored procedures** - Run the generated test script to verify
3. **Update application code** - Use the Python patterns above
4. **Configure authentication** - Set up service principal in `.env`
5. **Test end-to-end** - Verify GraphQL queries work from your app
