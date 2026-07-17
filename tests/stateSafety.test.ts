import assert from "node:assert/strict";
import test from "node:test";
import { BrowserStateHub } from "../src/mcp/browserStateHub";
import { sanitizeUrl } from "../src/shared/sanitize";

test("session activity, state updates, and artifact capture keep distinct clocks", () => {
  let now = Date.parse("2026-07-13T03:00:00.000Z");
  const hub = new BrowserStateHub(() => now);
  const sessionId = "profile-time-semantics";

  hub.connect("browser", sessionId);
  const connected = hub.snapshot(sessionId);
  assert.equal(connected.lastSeenAt, "2026-07-13T03:00:00.000Z");
  assert.equal(connected.stateUpdatedAt, "2026-07-13T03:00:00.000Z");

  now += 1_000;
  hub.touch(sessionId);
  const heartbeat = hub.snapshot(sessionId);
  assert.equal(heartbeat.lastSeenAt, "2026-07-13T03:00:01.000Z");
  assert.equal(heartbeat.stateUpdatedAt, connected.stateUpdatedAt);

  now += 1_000;
  hub.setCurrentTab(
    { url: "https://example.test/fresh", title: "Fresh" },
    sessionId,
  );
  const stateChanged = hub.snapshot(sessionId);
  assert.equal(stateChanged.lastSeenAt, "2026-07-13T03:00:02.000Z");
  assert.equal(stateChanged.stateUpdatedAt, "2026-07-13T03:00:02.000Z");

  now += 1_000;
  hub.setLastScreenshot(
    {
      capturedAt: "2026-07-13T02:59:30.000Z",
      mimeType: "image/png",
      dataUrl: "data:image/png;base64,AA==",
      method: "visibleTab",
      fullPage: false,
    },
    sessionId,
  );
  const artifactAdded = hub.snapshot(sessionId);
  assert.equal(artifactAdded.lastSeenAt, "2026-07-13T03:00:03.000Z");
  assert.equal(artifactAdded.stateUpdatedAt, "2026-07-13T03:00:03.000Z");
  assert.equal(artifactAdded.updatedAt, artifactAdded.stateUpdatedAt);
  assert.equal(artifactAdded.artifactCapturedAt, "2026-07-13T02:59:30.000Z");

  now += 1_000;
  hub.setCurrentTab(
    {
      url: "https://example.test/current",
      title: "Current",
      targetId: "tab-time",
      documentId: "document-current",
    },
    sessionId,
  );
  const beforeStaleRead = hub.snapshot(sessionId);
  now += 1_000;
  const accepted = hub.setPageContext(
    { url: "https://example.test/stale", title: "Stale" },
    {
      url: "https://example.test/stale",
      title: "Stale",
      origin: "https://example.test",
      capturedAt: "2026-07-13T02:58:00.000Z",
      visibleText: "stale",
      domSummary: [],
      nodeCount: 0,
      truncated: false,
      provenance: {
        source: "chrome-content-script",
        observedAt: "2026-07-13T02:58:00.010Z",
        target: {
          url: "https://example.test/stale",
          title: "Stale",
          targetId: "tab-time",
          tabId: 12,
          frameId: 0,
          documentId: "document-stale",
          navigationId: "navigation-stale",
          revision: 1,
        },
      },
    },
    sessionId,
  );
  const afterStaleRead = hub.snapshot(sessionId);
  assert.equal(accepted, false);
  assert.equal(afterStaleRead.lastSeenAt, "2026-07-13T03:00:05.000Z");
  assert.equal(afterStaleRead.stateUpdatedAt, beforeStaleRead.stateUpdatedAt);
});

test("authoritative active-tab updates clear stale optional routing fields", () => {
  const hub = new BrowserStateHub();
  const sessionId = "profile-authoritative-target";

  hub.setCurrentTab(
    {
      url: "https://example.test/current",
      title: "Current",
      targetId: "1234567890",
      tabId: 12,
      windowId: 3,
      frameId: 0,
      documentId: "stale-document",
      navigationId: "navigation-current",
      revision: 4,
    },
    sessionId,
  );
  hub.setCurrentTab(
    {
      url: "https://example.test/current",
      title: "Current",
      targetId: "1234567890",
      tabId: 12,
      windowId: 3,
      frameId: 0,
      navigationId: "navigation-current",
      revision: 4,
    },
    sessionId,
  );

  const currentTab = hub.snapshot(sessionId).currentTab;
  assert.equal(currentTab?.documentId, undefined);
  assert.equal(currentTab?.navigationId, "navigation-current");
});

test("persisted browser state migrates the legacy updatedAt clock", () => {
  const now = Date.parse("2026-07-13T04:00:00.000Z");
  const hub = new BrowserStateHub(() => now);
  hub.setCurrentTab(
    { url: "https://example.test/legacy", title: "Legacy" },
    "profile-legacy-time",
  );
  const persisted = hub.toPersistentState();
  const legacyState = {
    ...persisted,
    sessions: persisted.sessions.map((session) => {
      const { lastSeenAt: _lastSeenAt, stateUpdatedAt, ...legacy } = session;
      return { ...legacy, updatedAt: stateUpdatedAt };
    }),
  };

  const restarted = new BrowserStateHub(() => now + 10_000);
  restarted.restorePersistentState(legacyState);
  const snapshot = restarted.snapshot("profile-legacy-time");
  assert.equal(snapshot.lastSeenAt, "2026-07-13T04:00:00.000Z");
  assert.equal(snapshot.stateUpdatedAt, "2026-07-13T04:00:00.000Z");
  assert.equal("updatedAt" in persisted.sessions[0]!, false);
});

test("changing the current URL invalidates document-scoped cached state", () => {
  const hub = new BrowserStateHub();
  const firstTab = { url: "https://example.test/a", title: "A" };

  hub.setPageContext(firstTab, {
    url: firstTab.url,
    title: firstTab.title,
    origin: "https://example.test",
    capturedAt: "2026-07-10T00:00:00.000Z",
    visibleText: "old document",
    domSummary: [],
    nodeCount: 0,
    truncated: false,
  });
  hub.setElementSelected({
    activeTab: firstTab,
    selectedElement: {
      selector: "#old",
      tagName: "DIV",
      outerHTML: '<div id="old">old</div>',
      attributes: { id: "old" },
      computedStyle: {},
      rect: {
        x: 0,
        y: 0,
        top: 0,
        right: 10,
        bottom: 10,
        left: 0,
        width: 10,
        height: 10,
      },
    },
  });
  hub.setLastScreenshot({
    capturedAt: "2026-07-10T00:00:01.000Z",
    mimeType: "image/png",
    dataUrl: "data:image/png;base64,AA==",
    method: "visibleTab",
    fullPage: false,
  });

  hub.setCurrentTab({ url: "https://example.test/b", title: "B" });
  const snapshot = hub.snapshot();

  assert.equal(snapshot.currentTab?.url, "https://example.test/b");
  assert.equal(snapshot.selectedElement, undefined);
  assert.equal(snapshot.pageContext, undefined);
  assert.equal(snapshot.domSnapshot, undefined);
  assert.equal(snapshot.lastScreenshot, undefined);
  assert.deepEqual(snapshot.screenshots, []);
});

test("a new navigation ID invalidates cached state even when URL is unchanged", () => {
  const hub = new BrowserStateHub();
  const firstDocument = {
    url: "https://example.test/same",
    title: "Same URL",
    targetId: "7",
    tabId: 7,
    navigationId: "navigation-1",
  };
  hub.setPageContext(firstDocument, {
    url: firstDocument.url,
    title: firstDocument.title,
    origin: "https://example.test",
    capturedAt: "2026-07-10T00:00:00.000Z",
    visibleText: "old document",
    domSummary: [],
    nodeCount: 0,
    truncated: false,
  });

  hub.setCurrentTab({
    ...firstDocument,
    navigationId: "navigation-2",
  });
  const snapshot = hub.snapshot();

  assert.equal(snapshot.revision, 1);
  assert.equal(snapshot.pageContext, undefined);
  assert.equal(snapshot.currentTab?.navigationId, "navigation-2");
});

test("a new frame document invalidates cached state even when URL is unchanged", () => {
  const hub = new BrowserStateHub();
  hub.setPageContext(
    {
      url: "https://example.test/embedded",
      title: "Embedded",
      targetId: "tab-7",
      frameId: 4,
      documentId: "document-a",
      navigationId: "top-navigation-1",
    },
    {
      url: "https://example.test/embedded",
      title: "Embedded",
      origin: "https://example.test",
      capturedAt: "2026-07-13T00:00:00.000Z",
      visibleText: "old child document",
      domSummary: [],
      nodeCount: 0,
      truncated: false,
    },
  );

  hub.setCurrentTab(
    {
      url: "https://example.test/embedded",
      title: "Embedded",
      targetId: "tab-7",
      frameId: 4,
      documentId: "document-b",
      navigationId: "top-navigation-1",
    },
  );

  const snapshot = hub.snapshot();
  assert.equal(snapshot.pageContext, undefined);
  assert.equal(snapshot.currentTab?.documentId, "document-b");
  assert.equal(snapshot.revision, 1);
});

test("stale page provenance cannot roll the current target back", () => {
  const hub = new BrowserStateHub();
  hub.setCurrentTab({
    url: "https://example.test/new",
    title: "New target",
    targetId: "tab-9",
    tabId: 9,
    frameId: 0,
    documentId: "document-new",
    navigationId: "navigation-new",
  });

  const accepted = hub.setPageContext(
    { url: "https://example.test/old", title: "Old target" },
    {
      url: "https://example.test/old",
      title: "Old target",
      origin: "https://example.test",
      capturedAt: "2026-07-13T01:00:00.000Z",
      visibleText: "stale content",
      domSummary: [],
      nodeCount: 0,
      truncated: false,
      provenance: {
        source: "chrome-content-script",
        observedAt: "2026-07-13T01:00:00.010Z",
        target: {
          url: "https://example.test/old",
          title: "Old target",
          targetId: "tab-9",
          tabId: 9,
          frameId: 0,
          documentId: "document-old",
          navigationId: "navigation-old",
          revision: 0,
        },
      },
    },
  );

  assert.equal(accepted, false);
  assert.equal(hub.snapshot().currentTab?.documentId, "document-new");
  assert.equal(hub.snapshot().pageContext, undefined);
});

test("starting a new plugin conversation removes prior messages from current resources", () => {
  const hub = new BrowserStateHub();
  hub.startPluginConversation("conversation-one");
  hub.addPluginMessage({
    id: "message-one",
    conversationId: "conversation-one",
    role: "user",
    content: "old question",
    createdAt: "2026-07-10T00:00:00.000Z",
  });

  hub.startPluginConversation("conversation-two");
  let snapshot = hub.snapshot();
  assert.equal(snapshot.currentConversationId, "conversation-two");
  assert.deepEqual(snapshot.pluginConversation, []);
  assert.equal(snapshot.lastPluginMessage, undefined);

  hub.addPluginMessage({
    id: "message-two",
    conversationId: "conversation-two",
    role: "assistant",
    content: "new answer",
    createdAt: "2026-07-10T00:00:01.000Z",
  });
  snapshot = hub.snapshot();
  assert.deepEqual(
    snapshot.pluginConversation.map((message) => message.id),
    ["message-two"],
  );
});

test("restarting the same plugin conversation replaces its published snapshot", () => {
  const hub = new BrowserStateHub();
  hub.startPluginConversation("conversation-restart");
  hub.addPluginMessage({
    id: "message-before-restart",
    conversationId: "conversation-restart",
    role: "user",
    content: "stale local snapshot",
    createdAt: "2026-07-14T00:00:00.000Z",
  });

  hub.startPluginConversation("conversation-restart");

  const snapshot = hub.snapshot();
  assert.equal(snapshot.currentConversationId, "conversation-restart");
  assert.deepEqual(snapshot.pluginConversation, []);
  assert.equal(snapshot.lastPluginMessage, undefined);
});

test("URL sanitization redacts sensitive query and fragment parameters", () => {
  const sanitized = sanitizeUrl(
    "https://user:pass@example.test/callback?api_key=secret&view=ok#/done?access_token=token&state=public",
  );

  assert.equal(sanitized.includes("api_key=secret"), false);
  assert.equal(sanitized.includes("access_token=token"), false);
  assert.equal(sanitized.includes("pass"), false);
  assert.match(sanitized, /api_key=%5BREDACTED%5D/);
  assert.match(sanitized, /access_token=%5BREDACTED%5D/);
  assert.match(sanitized, /state=public/);
});
