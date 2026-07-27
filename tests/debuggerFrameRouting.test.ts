import assert from "node:assert/strict";
import test from "node:test";
import {
  createOopifAutoAttachParams,
  frameOwnerContentOrigin,
  mapDebuggerFrameTree,
  matchUniqueNavigationFrameRoute,
  requireDebuggerFrameRoute,
  type CdpFrameTreeNode,
  type NavigationFrameNode,
} from "../src/background/debuggerFrameRouting";

test("OOPIF auto-attach is flat, recursive-ready, and iframe-only", () => {
  assert.deepEqual(createOopifAutoAttachParams(), {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: true,
    filter: [{ type: "iframe", exclude: false }],
  });
});

test("debugger frame routing maps unique nested frame paths", () => {
  const cdpTree: CdpFrameTreeNode = {
    frame: { id: "cdp-root", url: "https://host.test/app#top" },
    childFrames: [
      {
        frame: { id: "cdp-child", url: "https://child.test/form" },
        childFrames: [
          {
            frame: { id: "cdp-grandchild", url: "https://deep.test/editor" },
          },
        ],
      },
    ],
  };
  const navigationFrames: NavigationFrameNode[] = [
    navigationFrame(0, -1, "doc-root", "https://host.test/app"),
    navigationFrame(7, 0, "doc-child", "https://child.test/form#section"),
    navigationFrame(9, 7, "doc-grandchild", "https://deep.test/editor"),
  ];

  const routes = mapDebuggerFrameTree(cdpTree, navigationFrames);

  assert.deepEqual(routes.get("cdp-child"), {
    cdpFrameId: "cdp-child",
    frameId: 7,
    documentId: "doc-child",
    url: "https://child.test/form#section",
  });
  assert.equal(routes.get("cdp-grandchild")?.frameId, 9);
});

test("debugger frame routing rejects duplicate sibling URLs instead of guessing", () => {
  const cdpTree: CdpFrameTreeNode = {
    frame: { id: "cdp-root", url: "https://host.test/" },
    childFrames: [
      { frame: { id: "cdp-a", url: "https://child.test/form" } },
      { frame: { id: "cdp-b", url: "https://child.test/form" } },
    ],
  };
  const navigationFrames = [
    navigationFrame(0, -1, "doc-root", "https://host.test/"),
    navigationFrame(3, 0, "doc-a", "https://child.test/form"),
    navigationFrame(4, 0, "doc-b", "https://child.test/form"),
  ];

  const routes = mapDebuggerFrameTree(cdpTree, navigationFrames);

  assert.equal(routes.has("cdp-a"), false);
  assert.equal(routes.has("cdp-b"), false);
});

test("OOPIF root falls back to one unique active navigation URL", () => {
  const frame = { id: "oopif-frame", url: "http://localhost:8766/child.html" };
  assert.deepEqual(
    matchUniqueNavigationFrameRoute(frame, [
      navigationFrame(0, -1, "doc-root", "http://127.0.0.1:8765/"),
      navigationFrame(7, 0, "doc-child", "http://localhost:8766/child.html"),
    ]),
    {
      cdpFrameId: "oopif-frame",
      frameId: 7,
      documentId: "doc-child",
      url: "http://localhost:8766/child.html",
    },
  );
  assert.equal(
    matchUniqueNavigationFrameRoute(frame, [
      navigationFrame(7, 0, "doc-a", "http://localhost:8766/child.html"),
      navigationFrame(8, 0, "doc-b", "http://localhost:8766/child.html"),
    ]),
    undefined,
  );
});

test("debugger frame routing excludes stale lifecycle entries and mismatched roots", () => {
  const cdpTree: CdpFrameTreeNode = {
    frame: { id: "cdp-root", url: "https://host.test/" },
    childFrames: [
      { frame: { id: "cdp-child", url: "https://child.test/" } },
    ],
  };
  const staleFrames = [
    navigationFrame(0, -1, "doc-root", "https://host.test/"),
    {
      ...navigationFrame(2, 0, "doc-stale", "https://child.test/"),
      documentLifecycle: "cached",
    },
  ];

  assert.equal(mapDebuggerFrameTree(cdpTree, staleFrames).has("cdp-child"), false);
  assert.equal(
    mapDebuggerFrameTree(cdpTree, [
      navigationFrame(0, -1, "doc-other", "https://other.test/"),
    ]).size,
    0,
  );
});

test("debugger frame routing binds the selected document and fails closed", () => {
  const routes = new Map([
    [
      7,
      {
        cdpFrameId: "cdp-child",
        frameId: 7,
        documentId: "doc-current",
        url: "https://child.test/",
      },
    ],
  ]);

  assert.equal(
    requireDebuggerFrameRoute(routes, 7, "doc-current").cdpFrameId,
    "cdp-child",
  );
  assert.throws(
    () => requireDebuggerFrameRoute(routes, 7, "doc-stale"),
    /STALE_CONTEXT/,
  );
  assert.throws(
    () => requireDebuggerFrameRoute(routes, 8),
    /TRUSTED_INPUT_FRAME_UNSUPPORTED/,
  );
});

test("same-process frame input uses the iframe content-box origin", () => {
  assert.deepEqual(
    frameOwnerContentOrigin({
      content: [101, 52, 501, 52, 501, 352, 101, 352],
    }),
    { x: 101, y: 52 },
  );
  assert.throws(
    () => frameOwnerContentOrigin({ content: [0, 1] }),
    /invalid iframe content quad/,
  );
});

test("debugger frame routing fails closed above its bounded frame count", () => {
  const navigationFrames = [
    navigationFrame(0, -1, "doc-root", "https://host.test/"),
    ...Array.from({ length: 512 }, (_, index) =>
      navigationFrame(
        index + 1,
        0,
        `doc-${index}`,
        `https://child-${index}.test/`,
      ),
    ),
  ];

  assert.equal(
    mapDebuggerFrameTree(
      { frame: { id: "cdp-root", url: "https://host.test/" } },
      navigationFrames,
    ).size,
    0,
  );
});

function navigationFrame(
  frameId: number,
  parentFrameId: number,
  documentId: string,
  url: string,
): NavigationFrameNode {
  return {
    frameId,
    parentFrameId,
    documentId,
    url,
    documentLifecycle: "active",
  };
}
