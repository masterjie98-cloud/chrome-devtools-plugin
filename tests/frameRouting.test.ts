import assert from "node:assert/strict";
import test from "node:test";
import {
  clearContentFrames,
  getContentFrameSnapshot,
  getSelectedContentFrame,
  getSelectedContentFrameSnapshot,
  listRegisteredContentFrames,
  registerContentFrame,
  selectRegisteredContentFrame,
  waitForRegisteredContentFrames,
} from "../src/background/chromeApi";

function sender(
  tabId: number,
  frameId: number,
  documentId: string,
): chrome.runtime.MessageSender {
  return {
    tab: { id: tabId } as chrome.tabs.Tab,
    frameId,
    documentId,
  };
}

test("frame routing defaults to the current top-level document", () => {
  clearContentFrames(71);
  registerContentFrame(sender(71, 0, "doc-top"), {
    url: "https://example.test/",
    title: "Top",
  });
  registerContentFrame(sender(71, 5, "doc-child"), {
    url: "https://child.test/frame",
    title: "Child",
  });

  assert.deepEqual(getSelectedContentFrame(71), {
    frameId: 0,
    documentId: "doc-top",
  });
  assert.equal(getSelectedContentFrameSnapshot(71)?.url, "https://example.test/");
});

test("explicit frame selection is document-bound and rejects stale reuse", () => {
  clearContentFrames(72);
  registerContentFrame(sender(72, 0, "doc-top"), {
    url: "https://example.test/",
    title: "Top",
  });
  registerContentFrame(sender(72, 8, "doc-child-a"), {
    url: "https://child.test/a",
    title: "Child A",
  });

  selectRegisteredContentFrame(72, {
    frameId: 8,
    documentId: "doc-child-a",
  });
  assert.deepEqual(getSelectedContentFrame(72), {
    frameId: 8,
    documentId: "doc-child-a",
  });

  registerContentFrame(sender(72, 8, "doc-child-b"), {
    url: "https://child.test/b",
    title: "Child B",
  });
  assert.equal(getSelectedContentFrameSnapshot(72), undefined);
  assert.throws(
    () =>
      selectRegisteredContentFrame(72, {
        frameId: 8,
        documentId: "doc-child-a",
      }),
    /document changed/i,
  );
});

test("multi-frame reads keep the selected frame first without changing selection", () => {
  clearContentFrames(73);
  registerContentFrame(sender(73, 0, "doc-top"), {
    url: "https://example.test/",
    title: "Top",
  });
  registerContentFrame(sender(73, 9, "doc-child-b"), {
    url: "https://child.test/b",
    title: "Child B",
  });
  registerContentFrame(sender(73, 4, "doc-child-a"), {
    url: "https://child.test/a",
    title: "Child A",
  });
  selectRegisteredContentFrame(73, {
    frameId: 9,
    documentId: "doc-child-b",
  });

  const frames = listRegisteredContentFrames(73);
  assert.deepEqual(
    frames.map((frame) => [frame.frameId, frame.selected]),
    [
      [9, true],
      [0, false],
      [4, false],
    ],
  );
  assert.deepEqual(getSelectedContentFrame(73), {
    frameId: 9,
    documentId: "doc-child-b",
  });
  assert.equal(
    getContentFrameSnapshot(73, {
      frameId: 4,
      documentId: "stale-child-document",
    }),
    undefined,
  );
});

test("frame readiness wait resolves when a newly loaded document registers", async () => {
  clearContentFrames(74);
  const registration = setTimeout(() => {
    registerContentFrame(sender(74, 0, "doc-ready"), {
      url: "https://example.test/ready",
      title: "Ready",
    });
  }, 15);

  try {
    const frames = await waitForRegisteredContentFrames(74, {
      timeoutMs: 200,
      pollIntervalMs: 5,
    });
    assert.equal(frames.length, 1);
    assert.equal(frames[0]?.documentId, "doc-ready");
  } finally {
    clearTimeout(registration);
    clearContentFrames(74);
  }
});

test("frame readiness wait remains bounded when no document registers", async () => {
  clearContentFrames(75);
  const startedAt = Date.now();
  const frames = await waitForRegisteredContentFrames(75, {
    timeoutMs: 20,
    pollIntervalMs: 5,
  });
  assert.deepEqual(frames, []);
  assert.ok(Date.now() - startedAt < 250);
});
