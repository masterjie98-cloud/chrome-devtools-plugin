import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import { DaemonStateStore, type RedactedAuditEvent } from "../src/daemon/store/stateStore";
import { BrowserStateHub } from "../src/mcp/browserStateHub";
import { createTestDataDirectory } from "./helpers/tempDataDir";

test("DaemonStateStore restores sanitized session metadata and current conversation", async () => {
  const dataDir = await createTestDataDirectory("ai-devtools-state-");
  const store = new DaemonStateStore({ statePath: dataDir.statePath });
  const hub = new BrowserStateHub();

  try {
    assert.equal(await store.load(), undefined);
    hub.setCurrentTab(
      {
        url: "https://example.test/page?access_token=secret",
        title: "Persistent page",
        targetId: "target-1",
      },
      "profile-persistent",
    );
    hub.startPluginConversation("conversation-old", "profile-persistent");
    hub.addPluginMessage(
      {
        id: "old-message",
        conversationId: "conversation-old",
        role: "user",
        content: "old content",
        createdAt: "2026-07-10T00:00:00.000Z",
      },
      "profile-persistent",
    );
    hub.startPluginConversation("conversation-current", "profile-persistent");
    hub.addPluginMessage(
      {
        id: "current-message",
        conversationId: "conversation-current",
        role: "assistant",
        content: "current content",
        createdAt: "2026-07-10T00:00:01.000Z",
      },
      "profile-persistent",
    );
    hub.setLastScreenshot(
      {
        capturedAt: "2026-07-10T00:00:02.000Z",
        mimeType: "image/png",
        dataUrl: "data:image/png;base64,c2VjcmV0LWltYWdl",
        artifact: {
          id: "art_0123456789abcdef0123456789abcdef",
          uri: "ai-devtools://artifact/art_0123456789abcdef0123456789abcdef",
          kind: "screenshot",
          mimeType: "image/png",
          byteLength: 12,
          sha256: "a".repeat(64),
          createdAt: "2026-07-10T00:00:02.000Z",
          expiresAt: "2026-07-11T00:00:02.000Z",
        },
      },
      "profile-persistent",
    );
    hub.upsertCollaborationItem(
      {
        id: "ctx_persisted_style",
        kind: "page.style",
        title: "Selected element style",
        summary: "Share only the computed layout values.",
        sensitivity: "page_content",
        content: {
          selector: "#save",
          computedStyle: { display: "flex" },
          token: "must-not-persist",
        },
      },
      { actor: "extension_agent" },
      "profile-persistent",
    );

    store.scheduleBrowserState(hub.toPersistentState());
    await store.appendAudit(auditEvent());
    await store.flush();

    const raw = await readFile(dataDir.statePath, "utf8");
    assert.equal(raw.includes("c2VjcmV0LWltYWdl"), false);
    assert.equal(raw.includes("access_token=secret"), false);
    assert.equal(raw.includes("old content"), false);
    assert.equal(raw.includes("current content"), true);
    assert.equal(raw.includes("must-not-persist"), false);
    assert.equal(raw.includes("ctx_persisted_style"), true);

    const restartedStore = new DaemonStateStore({ statePath: dataDir.statePath });
    const restoredState = await restartedStore.load();
    const restartedHub = new BrowserStateHub();
    restartedHub.restorePersistentState(restoredState);
    const snapshot = restartedHub.snapshot("profile-persistent");
    assert.equal(snapshot.browserConnected, false);
    assert.equal(snapshot.currentConversationId, "conversation-current");
    assert.deepEqual(
      snapshot.pluginConversation.map((message) => message.id),
      ["current-message"],
    );
    assert.equal(snapshot.lastScreenshot?.dataUrl, "data:image/png;base64,");
    assert.deepEqual(
      snapshot.collaborationWorkspace.items.map((item) => item.id),
      ["ctx_persisted_style"],
    );
    assert.deepEqual(snapshot.collaborationWorkspace.items[0]?.content, {
      selector: "#save",
      computedStyle: { display: "flex" },
      token: "[redacted]",
    });
    assert.equal((await restartedStore.listAuditEvents()).length, 1);
    assert.equal((await stat(dataDir.rootDir)).mode & 0o777, 0o700);
    assert.equal((await stat(dataDir.statePath)).mode & 0o777, 0o600);
  } finally {
    await dataDir.cleanup();
  }
});

test("DaemonStateStore rejects audit records with unapproved fields", async () => {
  const dataDir = await createTestDataDirectory("ai-devtools-state-");
  const store = new DaemonStateStore({ statePath: dataDir.statePath });

  try {
    await store.load();
    const unsafe = {
      ...auditEvent(),
      arguments: { authorization: "Bearer secret" },
    } as RedactedAuditEvent;
    await assert.rejects(store.appendAudit(unsafe), /unredacted audit event/);
  } finally {
    await dataDir.cleanup();
  }
});

test("DaemonStateStore requires complete bounded egress metrics", async () => {
  const dataDir = await createTestDataDirectory("ai-devtools-state-egress-");
  const store = new DaemonStateStore({ statePath: dataDir.statePath });

  try {
    await store.load();
    const incomplete = {
      ...auditEvent(),
      eventType: "tool.completed",
      outcome: "completed",
      egressBytes: 42,
    } as RedactedAuditEvent;
    await assert.rejects(
      store.appendAudit(incomplete),
      /unredacted audit event/,
    );

    const complete: RedactedAuditEvent = {
      ...incomplete,
      egressClass: "screenshot",
      egressDestination: "mcp_adapter",
    };
    await store.appendAudit(complete);
    assert.deepEqual((await store.listAuditEvents())[0], complete);
  } finally {
    await dataDir.cleanup();
  }
});

function auditEvent(): RedactedAuditEvent {
  return {
    id: "audit-1",
    eventType: "approval.approved",
    timestamp: "2026-07-10T00:00:03.000Z",
    requestId: "request-1",
    sessionId: "profile-persistent",
    toolName: "browser_take_screenshot",
    policyClass: "sensitive_read",
    argumentsSha256: "b".repeat(64),
    revision: 0,
    outcome: "approved",
  };
}
