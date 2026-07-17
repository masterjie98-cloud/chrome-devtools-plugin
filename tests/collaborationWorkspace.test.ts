import assert from "node:assert/strict";
import test from "node:test";
import {
  collaborationWorkspaceForMcp,
  createEmptyCollaborationWorkspace,
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

test("workspace rejects aggregate inline content beyond its persistence budget", () => {
  let workspace = createEmptyCollaborationWorkspace();
  const largeContent = {
    chunks: Array.from({ length: 7 }, () => "x".repeat(4000)),
  };

  assert.throws(() => {
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
        },
        { actor: "extension_agent" },
      ).workspace;
    }
  }, new RegExp(`workspace exceeds ${MAX_COLLABORATION_WORKSPACE_BYTES}`));
});
