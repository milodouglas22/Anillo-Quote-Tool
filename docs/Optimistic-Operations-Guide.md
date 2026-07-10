# Optimistic Operations Guide

This document teaches Claude how to implement optimistic operations in a React frontend to mask backend processing time. The user sees immediate feedback while the backend catches up.

---

## How to Use This Guide

1. **Share this file with Claude** when building a frontend that talks to a slow or async backend
2. **Claude will implement** optimistic patterns that make the UI feel instant
3. The core idea: **update the UI first, then call the API, and roll back if it fails**

---

## Instructions for Claude

When implementing mutations (create, update, delete, status changes) in a React frontend:

1. **Always update local state before the API call** - the user should see the result immediately
2. **Choose the right rollback strategy** based on the operation type (see table below)
3. **Handle the gap between optimistic state and server state** - especially with polling or refetching

### When to Use Each Rollback Strategy

| Operation Type | Rollback Strategy | Why |
|----------------|-------------------|-----|
| Delete | None (fire-and-forget) or re-fetch | Deletes rarely fail; if they do, next poll catches it |
| Create | Remove temp item + show error | User needs to know creation failed |
| Rename / Edit | Re-fetch to restore original | Simple and reliable |
| Toggle (archive, active) | Re-fetch to restore original | Simple and reliable |
| Status change (cancel, restart) | Re-fetch to restore original | Server is source of truth for status |
| Inline edit (close editor on save) | Reopen editor on failure | Preserves user's work |

---

## Pattern 1: Optimistic Delete

Remove the item from the UI immediately. Don't wait for the API.

```jsx
const [items, setItems] = useState([]);

const handleDelete = (id) => {
  // Optimistic: remove from list immediately
  setItems((prev) => prev.filter((item) => item.id !== id));

  apiService.deleteItem(id, getAccessToken).catch((err) => {
    console.error("Delete failed:", err);
    // Option A: silent fail (item is already gone from UI)
    // Option B: re-fetch to restore
    // fetchItems();
  });
};
```

### Preventing Deleted Items from Reappearing During Polling

If your app polls for updates (e.g., during background processing), deleted items can reappear because the server still returns them briefly. Track deleted IDs locally:

```jsx
const deletedIds = useRef(new Set());

const handleDelete = (id) => {
  deletedIds.current.add(id);
  setItems((prev) => prev.filter((item) => item.id !== id));

  apiService.deleteItem(id, getAccessToken).catch((err) => {
    console.error("Delete failed:", err);
  });
};

// When polling/refetching, filter out locally deleted items
const fetchItems = async () => {
  const data = await apiService.listItems(getAccessToken);
  setItems(data.filter((item) => !deletedIds.current.has(item.id)));
};
```

---

## Pattern 2: Optimistic Create with Temp ID

Add the item to the UI immediately with a temporary ID, then swap in the real ID when the server responds.

```jsx
const handleCreate = async (name) => {
  const tempId = `temp-${Date.now()}`;
  const optimisticItem = { id: tempId, name, status: "new" };

  // Optimistic: add to list immediately
  setItems((prev) => [optimisticItem, ...prev]);

  // Close dialog / give feedback immediately
  setDialogOpen(false);

  try {
    const result = await apiService.createItem(name, getAccessToken);

    // Replace temp item with real item
    setItems((prev) =>
      prev.map((item) => (item.id === tempId ? { ...item, id: result.id } : item))
    );
  } catch (err) {
    // Rollback: remove the temp item
    setItems((prev) => prev.filter((item) => item.id !== tempId));
    setError(err.message || "Failed to create item");
  }
};
```

---

## Pattern 3: Optimistic Toggle / Status Change

Flip the value in the UI immediately, revert on failure.

```jsx
const handleToggleArchive = async (itemId) => {
  // Optimistic: toggle immediately
  setItems((prev) =>
    prev.map((item) =>
      item.id === itemId ? { ...item, is_archived: !item.is_archived } : item
    )
  );

  try {
    await apiService.toggleArchive(itemId, getAccessToken);
  } catch (err) {
    console.error("Toggle failed:", err);
    await fetchItems(); // Revert by re-fetching
  }
};
```

### Bulk Status Changes

When changing status for multiple items at once (e.g., cancel all processing, restart failed):

```jsx
const handleCancelAll = async () => {
  setCancelling(true);

  // Optimistic: mark all processing items as cancelled immediately
  setItems((prev) =>
    prev.map((item) =>
      ["pending", "processing"].includes(item.status)
        ? { ...item, status: "cancelled" }
        : item
    )
  );

  try {
    await apiService.cancelAllProcessing(getAccessToken);
  } catch (err) {
    console.error("Cancel failed:", err);
    await fetchItems(); // Revert on error
  } finally {
    setCancelling(false);
  }
};

const handleRestartFailed = async () => {
  // Optimistic: mark failed items as pending immediately
  setItems((prev) =>
    prev.map((item) =>
      ["failed", "cancelled"].includes(item.status)
        ? { ...item, status: "pending" }
        : item
    )
  );

  try {
    await apiService.restartFailed(getAccessToken);
  } catch (err) {
    console.error("Restart failed:", err);
    await fetchItems();
  }
};
```

---

## Pattern 4: Optimistic Rename / Inline Edit

Update the display value immediately, re-fetch on failure.

```jsx
const handleRename = async (itemId, newName) => {
  // Optimistic: update name in list immediately
  setItems((prev) =>
    prev.map((item) =>
      item.id === itemId ? { ...item, name: newName } : item
    )
  );
  setEditingId(null); // Close inline editor

  try {
    await apiService.renameItem(itemId, newName, getAccessToken);
  } catch (err) {
    setError(err.message || "Rename failed");
    await fetchItems(); // Revert on error
  }
};
```

### Close-on-Save for Detail Editors

When editing fields in a detail view, close the editor immediately on save and reopen if it fails:

```jsx
const handleSave = async () => {
  // Optimistic: close editor immediately
  setEditing(false);

  try {
    await apiService.updateItem(itemId, { value: editValue }, getAccessToken);
    onUpdated(); // Notify parent to refresh
  } catch (err) {
    console.error("Failed to save:", err);
    setEditing(true); // Reopen editor so user can retry
  }
};
```

---

## Pattern 5: Streaming Responses with Optimistic Placeholder

For AI/LLM responses or long-running operations that stream results:

```jsx
const [messages, setMessages] = useState([]);
const streamIdx = useRef(null);

const handleSend = async (text) => {
  // Optimistic: show user message immediately
  setMessages((prev) => [...prev, { role: "user", content: text }]);

  // Add placeholder for assistant response
  setMessages((prev) => {
    streamIdx.current = prev.length;
    return [
      ...prev,
      { role: "assistant", content: "", streaming: true },
    ];
  });

  try {
    await apiService.streamResponse(
      text,
      getAccessToken,
      // onToken: append each chunk as it arrives
      (chunk) => {
        setMessages((prev) => {
          const updated = [...prev];
          if (streamIdx.current !== null) {
            updated[streamIdx.current] = {
              ...updated[streamIdx.current],
              content: updated[streamIdx.current].content + chunk,
            };
          }
          return updated;
        });
      },
      // onDone: finalize the message
      (fullResponse, metadata) => {
        setMessages((prev) => {
          const updated = [...prev];
          updated[streamIdx.current] = {
            ...updated[streamIdx.current],
            content: fullResponse,
            streaming: false,
          };
          return updated;
        });
      },
      // onError: show error in the placeholder
      (error) => {
        setMessages((prev) => {
          const updated = [...prev];
          updated[streamIdx.current] = {
            ...updated[streamIdx.current],
            content: "Something went wrong. Please try again.",
            streaming: false,
            error: true,
          };
          return updated;
        });
      }
    );
  } catch (err) {
    console.error("Stream failed:", err);
  }
};
```

---

## Pattern 6: Stale-While-Revalidate Cache

Show cached data immediately, then refresh in the background:

```jsx
const cache = { data: null, timestamp: 0 };
const CACHE_TTL = 30000; // 30 seconds
const STALE_THRESHOLD = 10000; // 10 seconds

export function invalidateCache(deletedId = null) {
  if (deletedId && cache.data) {
    // Partial invalidation: just remove the deleted item
    cache.data = cache.data.filter((item) => item.id !== deletedId);
  } else {
    // Full invalidation: force refetch next time
    cache.timestamp = 0;
  }
}

const fetchItems = useCallback(
  async (forceRefresh = false) => {
    const now = Date.now();

    // Use cache if fresh
    if (!forceRefresh && cache.data && now - cache.timestamp < CACHE_TTL) {
      setItems(cache.data);

      // Background refresh if stale
      if (now - cache.timestamp > STALE_THRESHOLD) {
        apiService.listItems(getAccessToken).then((data) => {
          cache.data = data;
          cache.timestamp = Date.now();
          setItems(data);
        });
      }
      return;
    }

    // Full fetch
    setLoading(true);
    try {
      const data = await apiService.listItems(getAccessToken);
      cache.data = data;
      cache.timestamp = Date.now();
      setItems(data);
    } finally {
      setLoading(false);
    }
  },
  [getAccessToken]
);
```

---

## Pattern 7: Auto-Polling During Processing

When items are being processed in the background, poll for updates:

```jsx
const hasProcessing = items.some((item) =>
  ["pending", "processing", "extracting"].includes(item.status)
);

useEffect(() => {
  if (!hasProcessing) return;

  const interval = setInterval(fetchItems, 3000); // Poll every 3 seconds
  return () => clearInterval(interval);
}, [hasProcessing, fetchItems]);
```

This creates a natural flow:
1. User triggers processing → optimistic status change to "pending"
2. Polling starts automatically (items have processing status)
3. Server updates statuses as processing completes
4. When all items are done, polling stops automatically

---

## Combining Patterns

A typical operation lifecycle combines multiple patterns:

```
User clicks "Process"
  → Pattern 3: Status changes to "pending" immediately
  → Pattern 7: Polling kicks in because hasProcessing = true
  → Server processes items over 30-60 seconds
  → Polling picks up status changes every 3 seconds
  → When all done, polling stops

User clicks "Cancel"
  → Pattern 3: All processing items change to "cancelled" immediately
  → Pattern 7: Polling stops because hasProcessing = false

User clicks "Delete" during processing
  → Pattern 1: Item removed from list immediately
  → Pattern 1 (deletedIds): Item won't reappear on next poll
```

---

## Checklist for Claude

When implementing mutations in a React frontend:

- [ ] State is updated BEFORE the API call, not after
- [ ] Dialogs/editors close immediately on submit (don't wait for API)
- [ ] Delete operations use `deletedIds` ref if the app polls for updates
- [ ] Create operations use temp IDs that get swapped with real IDs
- [ ] Error handling either re-fetches data or shows an error message
- [ ] Status changes map over the array and update matching items
- [ ] Streaming responses use a placeholder message that fills in progressively
- [ ] Cache has TTL with stale-while-revalidate for background refresh
- [ ] Polling activates automatically when items have processing statuses
- [ ] Polling deactivates automatically when processing completes

---

## Anti-Patterns to Avoid

**Don't wait for the API before updating the UI:**
```jsx
// BAD: User waits for server round-trip
const handleDelete = async (id) => {
  await apiService.deleteItem(id, getAccessToken); // User stares at spinner
  setItems((prev) => prev.filter((item) => item.id !== id));
};

// GOOD: Update immediately
const handleDelete = (id) => {
  setItems((prev) => prev.filter((item) => item.id !== id));
  apiService.deleteItem(id, getAccessToken).catch(console.error);
};
```

**Don't show a full-page spinner for inline operations:**
```jsx
// BAD: Loading overlay blocks the entire page
setLoading(true);
await apiService.renameItem(id, name);
setLoading(false);

// GOOD: Update inline, keep page interactive
setItems((prev) => prev.map((i) => (i.id === id ? { ...i, name } : i)));
apiService.renameItem(id, name).catch(() => fetchItems());
```

**Don't refetch the entire list after every mutation when you can update locally:**
```jsx
// BAD: Refetch everything after toggling one item
await apiService.toggleArchive(id);
await fetchItems(); // Unnecessary server round-trip

// GOOD: Update the one item locally
setItems((prev) => prev.map((i) => (i.id === id ? { ...i, is_archived: !i.is_archived } : i)));
apiService.toggleArchive(id).catch(() => fetchItems());
```
