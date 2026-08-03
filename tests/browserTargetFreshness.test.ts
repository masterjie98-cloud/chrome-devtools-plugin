import assert from "node:assert/strict";
import test from "node:test";
import { BrowserStateHub } from "../src/mcp/browserStateHub";

test("target freshness waits for the live browser update after reconnect", async () => {
  let now = 1_000;
  const hub = new BrowserStateHub(() => now);
  const sessionId = "profile-reconnect";
  hub.setCurrentTab(
    {
      url: "https://stale.example/",
      title: "Stale",
      tabId: 1,
      targetId: "1",
      navigationId: "old-navigation",
    },
    sessionId,
  );
  now = 2_000;
  hub.connect("browser", sessionId);

  const waiting = hub.waitForCurrentTabAfterBrowserConnect(sessionId, {
    timeoutMs: 200,
  });
  setTimeout(() => {
    now = 2_010;
    hub.setCurrentTab(
      {
        url: "https://live.example/",
        title: "Live",
        tabId: 2,
        targetId: "2",
        navigationId: "live-navigation",
      },
      sessionId,
    );
  }, 20);

  assert.equal(await waiting, true);
  assert.equal(hub.snapshot(sessionId).currentTab?.tabId, 2);
});

test("task target context survives UI selection changes in the same Profile", async () => {
  const hub = new BrowserStateHub();
  const sessionId = "profile-multi-window";
  const taskTarget = {
    url: "https://fixture.test/a",
    title: "Task A",
    tabId: 11,
    targetId: "11",
    documentId: "document-a",
    navigationId: "navigation-a",
  };
  hub.setCurrentTab(taskTarget, sessionId);
  hub.setCurrentTab(
    {
      url: "https://fixture.test/b",
      title: "UI B",
      tabId: 22,
      targetId: "22",
      documentId: "document-b",
      navigationId: "navigation-b",
    },
    sessionId,
  );

  assert.equal(hub.snapshot(sessionId).currentTab?.tabId, 22);
  await hub.runWithTaskTarget(sessionId, taskTarget, async () => {
    assert.equal(hub.snapshot(sessionId).currentTab?.tabId, 11);
    await Promise.resolve();
    assert.equal(hub.snapshot(sessionId).currentTab?.documentId, "document-a");
  });
  assert.equal(hub.snapshot(sessionId).currentTab?.tabId, 22);
});
