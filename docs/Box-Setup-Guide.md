# Box Integration Setup Guide

This document helps you set up your application to use files from Box. Box files are synced to a Fabric Lakehouse through the **Data Steward** application. Your app queries file metadata via the Fabric GraphQL API and reads file content from OneLake.

---

## How It Works

```
┌─────────────────────┐       ┌─────────────────────┐
│   Box.com           │       │   Data Steward      │
│                     │       │   (Box Integration) │
│   Source folders    │ ───►  │   Folder Mappings   │
│   with documents    │       │   configure sync    │
└─────────────────────┘       └──────────┬──────────┘
                                         │
                              ┌──────────▼──────────┐
                              │  Fabric Lakehouse   │
                              │                     │
                              │  Files/             │  ◄── File content stored here
                              │    {files_root}/    │
                              │      document.pdf   │
                              │                     │
                              │  Warehouse Tables:  │  ◄── Metadata stored here
                              │    box_document_    │
                              │      index          │
                              │    box_folder_      │
                              │      load_log       │
                              └──────────┬──────────┘
                                         │
                              ┌──────────▼──────────┐
                              │   YOUR APP          │
                              │                     │
                              │   GraphQL queries   │  ◄── List/search files
                              │   for metadata      │
                              │                     │
                              │   OneLake reads     │  ◄── Download file content
                              │   for file content  │
                              └─────────────────────┘
```

**Your app does NOT connect to Box directly.** Instead:
1. A user configures a folder mapping in **Data Steward → Box Integration**
2. A scheduled sync copies files from Box into the Fabric Lakehouse
3. Your app queries file metadata via the Fabric GraphQL API
4. Your app reads file content from OneLake when needed

---

## Instructions for Claude

When setting up an application to use Box files:

### Step 1: Determine What the App Needs

Ask the user:
- What Box folder(s) contain the files they need?
- What will the app do with these files? (display, process, search, etc.)
- Do they need to list/search files, or just access specific files by path?
- What is the Fabric workspace and lakehouse where files will land?

### Step 2: Set Up the GraphQL Client for Document Queries

The document index lives in the Fabric Warehouse and is exposed via GraphQL. Configure a dedicated GraphQL client for querying Box file metadata.

**Add environment variable:**

```env
# Fabric GraphQL API endpoint for querying Box document index
BOX_GRAPHQL_ENDPOINT=https://api.fabric.microsoft.com/v1/workspaces/{workspace_id}/graphqlapis/{api_id}/graphql
```

**GraphQL client (in database utility):**

```typescript
/**
 * GraphQL client for Box document queries
 * Uses a separate endpoint for security isolation between modules
 */
export async function boxGraphql<T = any>(
  query: string,
  variables?: Record<string, any>
): Promise<T> {
  const endpoint = process.env.BOX_GRAPHQL_ENDPOINT;
  if (!endpoint) {
    throw new Error("BOX_GRAPHQL_ENDPOINT environment variable not set");
  }
  return client.executeQuery<T>(query, variables, endpoint);
}
```

### Step 3: Query the Document Index

The `box_document_index` view contains metadata for every synced file. Use GraphQL to list, search, and filter documents.

```typescript
const DOCUMENT_FIELDS = `
  box_file_id
  box_folder_id
  box_folder_name
  box_file_name
  box_file_size
  box_sha1
  onelake_path
  target_workspace
  target_lakehouse
  target_files_root
  last_seen_run_id
  last_seen_ts
`;

/**
 * Get all documents for a specific Box folder
 */
async function getDocumentsForFolder(folderId: string) {
  const query = `
    query GetDocuments($filter: box_document_indexFilterInput) {
      box_document_indices(filter: $filter, orderBy: { box_file_name: ASC }) {
        items { ${DOCUMENT_FIELDS} }
      }
    }
  `;

  const result = await boxGraphql(query, {
    filter: { box_folder_id: { eq: folderId } }
  });

  return result.box_document_indices.items;
}

/**
 * Search documents by filename
 */
async function searchDocuments(searchTerm: string) {
  const query = `
    query SearchDocuments($filter: box_document_indexFilterInput) {
      box_document_indices(filter: $filter, first: 100) {
        items { ${DOCUMENT_FIELDS} }
      }
    }
  `;

  const result = await boxGraphql(query, {
    filter: { box_file_name: { contains: searchTerm } }
  });

  return result.box_document_indices.items;
}

/**
 * Get a single document by file ID
 */
async function getDocumentById(fileId: string) {
  const query = `
    query GetDocument($filter: box_document_indexFilterInput) {
      box_document_indices(filter: $filter, first: 1) {
        items { ${DOCUMENT_FIELDS} }
      }
    }
  `;

  const result = await boxGraphql(query, {
    filter: { box_file_id: { eq: fileId } }
  });

  const items = result.box_document_indices.items;
  return items.length > 0 ? items[0] : null;
}

/**
 * Get recently synced files (useful for processing pipelines)
 */
async function getRecentlySyncedFiles(sinceTimestamp: string) {
  const query = `
    query GetRecentFiles($filter: box_document_indexFilterInput) {
      box_document_indices(filter: $filter, orderBy: { last_seen_ts: DESC }) {
        items { ${DOCUMENT_FIELDS} }
      }
    }
  `;

  const result = await boxGraphql(query, {
    filter: { last_seen_ts: { gt: sinceTimestamp } }
  });

  return result.box_document_indices.items;
}
```

### Step 4: Set Up OneLake File Access

When your app needs the actual file content (to display, download, or process), read it from OneLake using the Azure Blob SDK. The `onelake_path` from the document index tells you where the file lives.

**Add environment variables:**

```env
# Azure AD credentials (for OneLake access via service principal)
AZURE_TENANT_ID=<tenant-id>
AZURE_CLIENT_ID=<app-client-id>
AZURE_CLIENT_SECRET=<app-client-secret>

# OneLake container = Fabric workspace GUID
ONELAKE_CONTAINER=<workspace-guid>
```

**OneLake utility:**

```typescript
import { BlobServiceClient } from "@azure/storage-blob";
import { ClientSecretCredential } from "@azure/identity";

/**
 * Get a blob client for reading files from OneLake
 * OneLake uses the Azure Blob protocol with ABFSS path format
 */
function getOneLakeBlobClient(container: string, blobPath: string) {
  const credential = new ClientSecretCredential(
    process.env.AZURE_TENANT_ID!,
    process.env.AZURE_CLIENT_ID!,
    process.env.AZURE_CLIENT_SECRET!
  );

  const blobService = new BlobServiceClient(
    "https://onelake.dfs.fabric.microsoft.com",
    credential
  );

  return blobService
    .getContainerClient(container)
    .getBlobClient(blobPath);
}

/**
 * Stream a file from OneLake
 * Use the onelake_path from the document index
 *
 * @param container - Workspace GUID (ONELAKE_CONTAINER env var)
 * @param lakehousePath - Full path: "{lakehouse_id}/Files/{files_root}/{filename}"
 */
export async function streamFileFromOneLake(
  container: string,
  lakehousePath: string
): Promise<{ stream: NodeJS.ReadableStream; contentLength: number; contentType: string }> {
  const blobClient = getOneLakeBlobClient(container, lakehousePath);
  const response = await blobClient.download();

  if (!response.readableStreamBody) {
    throw new Error("Failed to get readable stream from OneLake");
  }

  return {
    stream: response.readableStreamBody,
    contentLength: response.contentLength ?? 0,
    contentType: response.contentType ?? "application/octet-stream",
  };
}

/**
 * Read a file fully into a Buffer
 * Use for smaller files or when you need the full content at once
 */
export async function readFileFromOneLake(
  container: string,
  lakehousePath: string
): Promise<Buffer> {
  const blobClient = getOneLakeBlobClient(container, lakehousePath);
  const response = await blobClient.download();

  if (!response.readableStreamBody) {
    throw new Error("Failed to get readable stream from OneLake");
  }

  const chunks: Buffer[] = [];
  for await (const chunk of response.readableStreamBody) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
```

### Step 5: Build the OneLake Path

The document index gives you `onelake_path` (e.g., `Files/documents/contracts/agreement.pdf`), but OneLake needs the full blob path including the lakehouse ID:

```typescript
/**
 * Build full OneLake blob path from document index fields
 *
 * Document index has:
 *   onelake_path: "Files/documents/contracts/agreement.pdf"
 *   target_lakehouse_id: "d0f7c9b1-f327-4935-82c2-3ad60ad149a4" (from folder mapping)
 *
 * Full blob path:
 *   "d0f7c9b1-f327-4935-82c2-3ad60ad149a4/Files/documents/contracts/agreement.pdf"
 */
function buildOneLakePath(lakehouseId: string, onelakePath: string): string {
  return `${lakehouseId}/${onelakePath}`;
}
```

### Step 6: Add Environment Variables

```env
# Fabric GraphQL API for document index queries
BOX_GRAPHQL_ENDPOINT=https://api.fabric.microsoft.com/v1/workspaces/{workspace_id}/graphqlapis/{api_id}/graphql

# Azure AD credentials (service principal for OneLake access)
AZURE_TENANT_ID=<tenant-id>
AZURE_CLIENT_ID=<app-client-id>
AZURE_CLIENT_SECRET=<app-client-secret>

# OneLake container (Fabric workspace GUID)
ONELAKE_CONTAINER=<workspace-guid>

# Lakehouse ID (for building file paths)
FABRIC_LAKEHOUSE_ID=<lakehouse-guid>
```

### Step 7: Instruct User to Configure Box Mapping

After setting up the app code, tell the user to configure the folder sync:

---

## User Setup Instructions

To connect a Box folder to this application:

1. **Get the Box Folder ID** from the Box URL:
   - Navigate to the folder in Box
   - URL: `https://app.box.com/folder/354163648178`
   - Folder ID: `354163648178`

2. **Go to Data Steward** → Box Integration → Folder Mappings

3. **Click "Add Mapping"** and fill in:

   | Field | Value | Where to Find It |
   |-------|-------|-------------------|
   | **Box Folder ID** | `354163648178` | From Box URL |
   | **Box Folder Name** | A friendly name | Your choice |
   | **Target Workspace** | Fabric workspace name | Fabric portal |
   | **Target Workspace ID** | Workspace GUID | Fabric URL: `/groups/{id}/...` |
   | **Target Lakehouse** | Lakehouse name | Fabric portal |
   | **Target Lakehouse ID** | Lakehouse GUID | Lakehouse URL |
   | **Files Root** | Path under Files/ | e.g., `Files/documents/contracts` |

4. **Click "Create Mapping"**

5. Files will sync automatically on the next scheduled run (typically every 30 minutes)

6. Check sync status in **Data Steward → Box Integration → Sync Logs**

---

## Common Patterns

### Pattern 1: List Files Endpoint

Backend endpoint that returns files from a Box folder via GraphQL:

```typescript
app.http("getBoxFiles", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "box-files",
  handler: async (request, context) => {
    const user = await authenticateRequest(request, context);
    const folderId = request.query.get("folder_id");

    if (!folderId) {
      return { status: 400, body: "Missing folder_id parameter" };
    }

    const documents = await getDocumentsForFolder(folderId);
    return { status: 200, jsonBody: documents };
  },
});
```

Frontend hook:

```typescript
export const useBoxFiles = (folderId: string) => {
  return useQuery({
    queryKey: ["box-files", folderId],
    queryFn: () => apiClient<BoxDocument[]>(`/box-files?folder_id=${folderId}`),
    enabled: !!folderId,
  });
};
```

### Pattern 2: Download/Stream a File

Backend endpoint that looks up a file in the document index and streams it from OneLake:

```typescript
app.http("downloadBoxFile", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "box-files/{fileId}/download",
  handler: async (request, context) => {
    const user = await authenticateRequest(request, context);
    const fileId = request.params.fileId;

    // Look up file in document index via GraphQL
    const doc = await getDocumentById(fileId);
    if (!doc) {
      return { status: 404, body: "File not found in document index" };
    }

    // Build OneLake path and stream
    const lakehousePath = buildOneLakePath(
      process.env.FABRIC_LAKEHOUSE_ID!,
      doc.onelake_path
    );

    const { stream, contentLength, contentType } = await streamFileFromOneLake(
      process.env.ONELAKE_CONTAINER!,
      lakehousePath
    );

    return {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": contentLength.toString(),
        "Content-Disposition": `inline; filename="${doc.box_file_name}"`,
      },
      body: stream,
    };
  },
});
```

### Pattern 3: Process Newly Synced Files

If your app needs to process files after they sync (e.g., extract text, generate embeddings):

```typescript
/**
 * Check for new files since last processing run
 * Call this on a schedule (timer trigger) or on demand
 */
async function processNewFiles(lastRunTimestamp: string) {
  const newFiles = await getRecentlySyncedFiles(lastRunTimestamp);

  for (const doc of newFiles) {
    // Read file content from OneLake
    const content = await readFileFromOneLake(
      process.env.ONELAKE_CONTAINER!,
      buildOneLakePath(process.env.FABRIC_LAKEHOUSE_ID!, doc.onelake_path)
    );

    // Process the file (extract text, generate embeddings, etc.)
    await processFile(doc.box_file_id, doc.box_file_name, content);
  }
}
```

---

## Document Index Schema Reference

The `box_document_index` table contains metadata for all synced files. Query it via GraphQL using the `box_document_indices` type.

| Column | Type | Description |
|--------|------|-------------|
| `box_file_id` | VARCHAR(50) | Box file ID |
| `box_folder_id` | VARCHAR(50) | Parent Box folder ID |
| `box_folder_name` | VARCHAR(500) | Parent folder name |
| `box_file_name` | VARCHAR(500) | File name |
| `box_file_size` | BIGINT | Size in bytes |
| `box_sha1` | VARCHAR(50) | SHA1 hash for change detection |
| `onelake_path` | VARCHAR(1000) | Relative path in OneLake (e.g., `Files/docs/file.pdf`) |
| `target_workspace` | VARCHAR(255) | Fabric workspace name |
| `target_lakehouse` | VARCHAR(255) | Lakehouse name |
| `target_files_root` | VARCHAR(500) | Root path under Files/ |
| `last_seen_run_id` | VARCHAR(50) | Last sync run that saw this file |
| `last_seen_ts` | DATETIME2(6) | Timestamp of last sync |

---

## Checklist for Claude

When setting up Box file access in an app:

- [ ] GraphQL client configured for `BOX_GRAPHQL_ENDPOINT`
- [ ] Document index query functions created (list by folder, search, get by ID)
- [ ] OneLake read utility configured with service principal auth
- [ ] Path builder function maps `onelake_path` + lakehouse ID to full blob path
- [ ] Environment variables added (BOX_GRAPHQL_ENDPOINT, AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, ONELAKE_CONTAINER, FABRIC_LAKEHOUSE_ID)
- [ ] File list endpoint created (GraphQL query → response)
- [ ] File download/stream endpoint created (GraphQL lookup → OneLake stream)
- [ ] User instructions provided with specific workspace/lakehouse values to enter in Data Steward
- [ ] Told user to configure mapping in Data Steward → Box Integration → Folder Mappings

---

## Troubleshooting

### Files not appearing in document index queries

1. Check the mapping is set to **Active** in Data Steward → Box Integration
2. Check **Sync Logs** for errors on the most recent run
3. The sync runs on a schedule (~30 min) — wait for the next run after creating a mapping

### "Access denied" when reading from OneLake

The app's service principal needs Contributor access to the Fabric workspace:
1. Go to Fabric workspace → Settings → Manage Access
2. Add the app registration (by name or client ID)
3. Assign **Contributor** role

### GraphQL query returns empty results

1. Verify `BOX_GRAPHQL_ENDPOINT` is correct
2. Refresh the GraphQL API in Fabric if tables/views were recently created
3. Check that the folder mapping's target workspace matches your GraphQL API's workspace

### "File not found" when streaming from OneLake

1. Verify the `onelake_path` from the document index
2. Check that `ONELAKE_CONTAINER` matches the workspace GUID
3. Check that `FABRIC_LAKEHOUSE_ID` is correct
4. Confirm the file hasn't been deleted from Box (which would remove it on next sync)

---

## Quick Reference: Getting IDs

### Box Folder ID
From URL: `https://app.box.com/folder/354163648178` → `354163648178`

### Fabric Workspace ID (also used as ONELAKE_CONTAINER)
- Fabric URL: `https://app.fabric.microsoft.com/groups/{workspace_id}/...`
- Or: Workspace Settings → Details

### Fabric Lakehouse ID
- Open Lakehouse in Fabric, ID is in the URL
- Or: Lakehouse Settings → Properties

### GraphQL API Endpoint
- Open your GraphQL API item in Fabric
- Copy the endpoint URL from the API details page
