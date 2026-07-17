import assert from "node:assert/strict";
import test from "node:test";
import {
  debuggerAttachFailureMessage,
  selectPageTargetInfo,
  topLevelDebuggerTarget,
  type BrowserDebuggerTargetInfo,
} from "../src/background/debuggerTargetRouting";

test("top-level debugger attachment uses tabId even when target metadata is polluted", () => {
  const targets: BrowserDebuggerTargetInfo[] = [
    {
      id: "other-extension",
      type: "page",
      url: "chrome-extension://other-id/sidepanel.html",
      attached: true,
    },
    {
      id: "fixture-target",
      tabId: 42,
      type: "page",
      url: "http://127.0.0.1:8765/index.html",
      attached: false,
    },
  ];

  const metadata = selectPageTargetInfo(
    targets,
    42,
    "http://127.0.0.1:8765/index.html",
  );

  assert.equal(metadata?.id, "fixture-target");
  assert.deepEqual(topLevelDebuggerTarget(42), { tabId: 42 });
  assert.equal("targetId" in topLevelDebuggerTarget(42), false);
});

test("target metadata rejects extension URLs and targets from another tab", () => {
  const targets: BrowserDebuggerTargetInfo[] = [
    {
      id: "same-tab-extension",
      tabId: 42,
      type: "page",
      url: "chrome-extension://other-id/page.html",
      attached: false,
    },
    {
      id: "other-tab-page",
      tabId: 7,
      type: "page",
      url: "https://example.test/",
      attached: false,
    },
  ];

  assert.equal(selectPageTargetInfo(targets, 42, "https://example.test/"), undefined);
});

test("attach failures distinguish injected extension frames from debugger conflicts", () => {
  assert.match(
    debuggerAttachFailureMessage(
      "Cannot access a chrome-extension:// URL of different extension",
    ),
    /frame injected by another Chrome extension/,
  );
  assert.match(
    debuggerAttachFailureMessage(
      "Another debugger is already attached to the tab with id: 42.",
    ),
    /Another debugger client is attached/,
  );
});
