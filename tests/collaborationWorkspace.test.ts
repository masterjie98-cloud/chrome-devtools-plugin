import assert from "node:assert/strict";
import test from "node:test";
import {
  collaborationWorkspaceForMcp,
  createEmptyCollaborationWorkspace,
  MAX_COLLABORATION_CONTENT_BYTES,
  MAX_COLLABORATION_WORKSPACE_BYTES,
  sanitizeCollaborationWorkspace,
  toCollaborationTargetBinding,
  upsertCollaborationItem,
} from "../src/shared/collaborationWorkspace";

const NOW = "2026-07-14T08:00:00.000Z";

test("collaboration target projection strips page-only metadata", () => {
  const target = toCollaborationTargetBinding({
    url: "https://example.test/form",
    title: "Form title must not leak into the strict binding",
    targetId: "target-a",
    tabId: 7,
    windowId: 3,
    frameId: 0,
    documentId: "document-a",
    navigationId: "navigation-a",
    revision: 12,
  });

  assert.deepEqual(target, {
    url: "https://example.test/form",
    targetId: "target-a",
    tabId: 7,
    windowId: 3,
    frameId: 0,
    documentId: "document-a",
    navigationId: "navigation-a",
    revision: 12,
  });
  assert.equal("title" in target, false);
});

test("collaboration target preserves opaque routing IDs without PII redaction", () => {
  const target = toCollaborationTargetBinding({
    targetId: "1201862947",
    tabId: 1201862947,
    windowId: 1201862568,
    frameId: 0,
    documentId: "D4CC567CAF21FCB52D16769194997E99",
    navigationId: "7e899402-3037-47af-a9c8-5916b90d4c7c",
    revision: 3513,
  });

  assert.equal(target.targetId, "1201862947");
  assert.equal(target.documentId, "D4CC567CAF21FCB52D16769194997E99");
  assert.equal(
    target.navigationId,
    "7e899402-3037-47af-a9c8-5916b90d4c7c",
  );

  const persisted = upsertCollaborationItem(
    createEmptyCollaborationWorkspace(),
    {
      id: "ctx_opaque_target",
      kind: "task.request",
      title: "Opaque target",
      summary: "Routing identity must remain exact.",
      target,
    },
    { actor: "mcp_agent" },
    NOW,
  );
  assert.equal(persisted.item.target?.targetId, target.targetId);
  assert.equal(persisted.item.target?.navigationId, target.navigationId);
});

test("collaboration workspace publishes only the selected bounded context", () => {
  const first = upsertCollaborationItem(
    createEmptyCollaborationWorkspace(),
    {
      kind: "page.style",
      title: "Selected button styles",
      summary: "Computed style needed for layout analysis.",
      sensitivity: "page_content",
      content: {
        selector: "#save",
        computedStyle: {
          display: "flex",
          authorization: "Bearer should-not-survive",
        },
      },
    },
    { actor: "extension_agent", clientId: "sidepanel" },
    NOW,
  );

  assert.equal(first.workspace.revision, 1);
  assert.equal(first.item.kind, "page.style");
  assert.match(first.item.id, /^ctx_/);
  assert.doesNotMatch(JSON.stringify(first.item), /should-not-survive/);
  assert.match(JSON.stringify(first.item), /redacted/i);
});

test("MCP workspace omits private items and sensitive item content", () => {
  const shared = upsertCollaborationItem(
    createEmptyCollaborationWorkspace(),
    {
      id: "ctx_shared_item",
      kind: "code.finding",
      title: "Source finding",
      summary: "The component uses a stale selector.",
      sensitivity: "safe",
      content: { file: "src/view.tsx" },
    },
    { actor: "mcp_agent" },
    NOW,
  );
  const sensitive = upsertCollaborationItem(
    shared.workspace,
    {
      id: "ctx_sensitive_item",
      kind: "network.trace",
      title: "project-codename-orchid",
      summary: "Contains protected request details.",
      sensitivity: "sensitive",
      content: { responseBody: "private response" },
      target: { url: "https://internal.example.test/orchid" },
    },
    { actor: "extension_agent" },
    "2026-07-14T08:00:01.000Z",
  );
  const privateItem = upsertCollaborationItem(
    sensitive.workspace,
    {
      id: "ctx_private_item",
      kind: "note",
      title: "Internal note",
      summary: "Extension-only reasoning state.",
      visibility: "private",
      sensitivity: "safe",
    },
    { actor: "extension_agent" },
    "2026-07-14T08:00:02.000Z",
  );

  const exposed = collaborationWorkspaceForMcp(privateItem.workspace);
  assert.deepEqual(
    exposed.items.map((item) => item.id),
    ["ctx_shared_item", "ctx_sensitive_item"],
  );
  assert.deepEqual(exposed.items[0]?.content, { file: "src/view.tsx" });
  assert.equal(exposed.items[1]?.content, undefined);
  assert.match(exposed.items[1]?.summary ?? "", /not exposed/);
  assert.equal(exposed.items[1]?.title, "Sensitive collaboration item");
  assert.deepEqual(exposed.items[1]?.tags, []);
  assert.equal(exposed.items[1]?.target, undefined);
  assert.doesNotMatch(JSON.stringify(exposed.items[1]), /orchid/);
});

test("collaboration updates require owner and exact item revision", () => {
  const created = upsertCollaborationItem(
    createEmptyCollaborationWorkspace(),
    {
      id: "ctx_task_state",
      kind: "task.state",
      title: "Create service",
      summary: "Planning",
      sensitivity: "safe",
    },
    { actor: "extension_agent" },
    NOW,
  );

  assert.throws(
    () =>
      upsertCollaborationItem(
        created.workspace,
        {
          id: created.item.id,
          expectedRevision: 0,
          kind: "task.state",
          title: "Create service",
          summary: "Executing",
          sensitivity: "safe",
        },
        { actor: "extension_agent" },
        "2026-07-14T08:00:01.000Z",
      ),
    /COLLABORATION_REVISION_CONFLICT/,
  );
  assert.throws(
    () =>
      upsertCollaborationItem(
        created.workspace,
        {
          id: created.item.id,
          expectedRevision: 1,
          kind: "task.state",
          title: "Overwrite task",
          summary: "MCP tries to replace extension state.",
          sensitivity: "safe",
        },
        { actor: "mcp_agent" },
        "2026-07-14T08:00:01.000Z",
      ),
    /COLLABORATION_OWNER_MISMATCH/,
  );

  const updated = upsertCollaborationItem(
    created.workspace,
    {
      id: created.item.id,
      expectedRevision: 1,
      kind: "task.state",
      title: "Create service",
      summary: "Executing",
      sensitivity: "safe",
    },
    { actor: "extension_agent" },
    "2026-07-14T08:00:01.000Z",
  );
  assert.equal(updated.item.revision, 2);
  assert.equal(updated.workspace.revision, 2);
});

test("serialized extension state stream may replace its own item without an ack revision", () => {
  const created = upsertCollaborationItem(
    createEmptyCollaborationWorkspace(),
    {
      id: "ctx_stream_state",
      kind: "task.state",
      title: "Long running task",
      summary: "Observe",
      sensitivity: "page_content",
    },
    { actor: "extension_agent" },
    NOW,
  );
  const updated = upsertCollaborationItem(
    created.workspace,
    {
      id: created.item.id,
      kind: "task.state",
      title: "Long running task",
      summary: "Verify",
      sensitivity: "page_content",
    },
    { actor: "extension_agent" },
    "2026-07-14T08:00:01.000Z",
    { allowOwnerLastWriteWithoutRevision: true },
  );

  assert.equal(updated.item.revision, 2);
  assert.equal(updated.item.summary, "Verify");
});

test("persisted collaboration workspace rejects duplicate IDs and expired items", () => {
  const created = upsertCollaborationItem(
    createEmptyCollaborationWorkspace(),
    {
      id: "ctx_expiring_item",
      kind: "note",
      title: "Short-lived evidence",
      summary: "Only valid for the current page state.",
      sensitivity: "safe",
      expiresAt: "2026-07-14T08:00:01.000Z",
    },
    { actor: "system" },
    NOW,
  );
  const expired = sanitizeCollaborationWorkspace(
    created.workspace,
    "2026-07-14T08:00:02.000Z",
  );
  assert.deepEqual(expired.items, []);

  assert.throws(
    () =>
      sanitizeCollaborationWorkspace({
        ...created.workspace,
        items: [created.item, created.item],
      }),
    /duplicate item IDs/,
  );
});

test("workspace compacts older items before aggregate persistence is exhausted", () => {
  let workspace = createEmptyCollaborationWorkspace();
  const largeContent = {
    chunks: Array.from({ length: 7 }, () => "x".repeat(4000)),
  };

  for (let index = 0; index < 20; index += 1) {
    workspace = upsertCollaborationItem(
      workspace,
      {
        id: `ctx_large_${String(index).padStart(8, "0")}`,
        kind: "note",
        title: `Large item ${index}`,
        summary: "Aggregate workspace budget fixture.",
        content: largeContent,
        sensitivity: "safe",
        status: "resolved",
      },
      { actor: "extension_agent" },
      timestampAfter(index),
    ).workspace;
  }

  assert.ok(workspace.items.length < 20);
  assert.ok(workspaceByteLength(workspace) <= MAX_COLLABORATION_WORKSPACE_BYTES);

  const delegated = upsertCollaborationItem(
    workspace,
    {
      id: "ctx_delegate_capacity_regression",
      kind: "task.request",
      title: "Capacity regression",
      summary: "A new delegated task must displace old terminal history.",
      content: largeContent,
      sensitivity: "safe",
      status: "active",
    },
    { actor: "mcp_agent" },
    timestampAfter(21),
  );

  assert.ok(
    delegated.workspace.items.some((item) => item.id === delegated.item.id),
  );
  assert.ok(
    workspaceByteLength(delegated.workspace) <=
      MAX_COLLABORATION_WORKSPACE_BYTES,
  );
});

test("workspace retains delegated task groups atomically through completion", () => {
  let workspace = createEmptyCollaborationWorkspace();
  const largeContent = {
    chunks: Array.from({ length: 7 }, () => "x".repeat(4000)),
  };

  for (let index = 0; index < 6; index += 1) {
    workspace = upsertCollaborationItem(
      workspace,
      {
        id: `ctx_history_${String(index).padStart(8, "0")}`,
        kind: "note",
        title: `Terminal history ${index}`,
        summary: "Old terminal history may be compacted.",
        content: largeContent,
        sensitivity: "safe",
        status: "resolved",
      },
      { actor: "extension_agent" },
      timestampAfter(index),
    ).workspace;
  }

  const request = upsertCollaborationItem(
    workspace,
    {
      id: "ctx_delegate_atomic_capacity",
      kind: "task.request",
      title: "Atomic delegated task",
      summary: "The request and its child state must stay together.",
      content: largeContent,
      sensitivity: "safe",
      status: "active",
    },
    { actor: "mcp_agent" },
    timestampAfter(10),
  );
  const claim = upsertCollaborationItem(
    request.workspace,
    {
      id: "ctx_claim_atomic_capacity",
      kind: "task.state",
      title: "Claimed delegated task",
      summary: "The task is bound to a plugin conversation.",
      content: largeContent,
      sensitivity: "safe",
      status: "active",
      parentId: request.item.id,
    },
    { actor: "extension_agent" },
    timestampAfter(11),
  );
  const result = upsertCollaborationItem(
    claim.workspace,
    {
      id: "ctx_result_atomic_capacity",
      kind: "task.result",
      title: "Delegated task result",
      summary: "The terminal result must remain observable after publication.",
      content: largeContent,
      sensitivity: "safe",
      status: "resolved",
      parentId: request.item.id,
    },
    { actor: "extension_agent" },
    timestampAfter(12),
  );

  for (const id of [request.item.id, claim.item.id, result.item.id]) {
    assert.ok(result.workspace.items.some((item) => item.id === id));
  }
  for (const item of result.workspace.items) {
    if (item.parentId) {
      assert.ok(
        result.workspace.items.some((candidate) => candidate.id === item.parentId),
        `retained child ${item.id} must keep parent ${item.parentId}`,
      );
    }
  }
  assert.ok(
    workspaceByteLength(result.workspace) <= MAX_COLLABORATION_WORKSPACE_BYTES,
  );
});

test("workspace drops orphaned child records during persisted-state recovery", () => {
  const parent = upsertCollaborationItem(
    createEmptyCollaborationWorkspace(),
    {
      id: "ctx_orphaned_parent_record",
      kind: "task.request",
      title: "Parent task",
      summary: "This parent will be absent from the persisted fixture.",
      sensitivity: "safe",
    },
    { actor: "mcp_agent" },
    NOW,
  );
  const child = upsertCollaborationItem(
    parent.workspace,
    {
      id: "ctx_orphaned_child_record",
      kind: "task.state",
      title: "Orphaned child",
      summary: "The referenced parent no longer exists.",
      sensitivity: "safe",
      parentId: parent.item.id,
    },
    { actor: "extension_agent" },
    timestampAfter(1),
  );

  const recovered = sanitizeCollaborationWorkspace(
    {
      ...child.workspace,
      items: [child.item],
    },
    timestampAfter(2),
  );
  assert.deepEqual(recovered.items, []);
});

test("workspace still rejects one oversized inline item", () => {
  assert.throws(
    () =>
      upsertCollaborationItem(
        createEmptyCollaborationWorkspace(),
        {
          id: "ctx_oversized_inline_item",
          kind: "note",
          title: "Oversized inline item",
          summary: "Large payloads must use artifact references.",
          content: {
            chunks: Array.from({ length: 10 }, () => "x".repeat(4000)),
          },
          sensitivity: "safe",
        },
        { actor: "mcp_agent" },
        NOW,
      ),
    new RegExp(`item content exceeds ${MAX_COLLABORATION_CONTENT_BYTES}`),
  );
});

function timestampAfter(seconds: number): string {
  return new Date(Date.parse(NOW) + seconds * 1000).toISOString();
}

function workspaceByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
