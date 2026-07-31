import assert from "node:assert/strict";
import test from "node:test";

const tab = {
  id: 901,
  url: "https://example.test/",
  title: "Example",
  active: true,
  currentWindow: true,
} as unknown as chrome.tabs.Tab;
const sessionStorage: Record<string, unknown> = {};
let injectionDocumentId = "doc-current";
let lastInjectionTarget: chrome.scripting.InjectionTarget | undefined;

Object.assign(globalThis, {
  chrome: {
    runtime: {
      lastError: undefined,
    },
    tabs: {
      query: (
        _queryInfo: chrome.tabs.QueryInfo,
        callback: (tabs: chrome.tabs.Tab[]) => void,
      ) => callback([tab]),
      get: (
        _tabId: number,
        callback: (tab: chrome.tabs.Tab) => void,
      ) => callback(tab),
    },
    storage: {
      session: {
        get: (
          key: string,
          callback: (items: Record<string, unknown>) => void,
        ) => callback({ [key]: sessionStorage[key] }),
        set: (
          items: Record<string, unknown>,
          callback: () => void,
        ) => {
          Object.assign(sessionStorage, items);
          callback();
        },
      },
    },
    scripting: {
      executeScript: async (
        injection: chrome.scripting.ScriptInjection<
          [string, number],
          {
            matched: boolean;
            framework: "unknown";
            components: [];
            warnings: [];
          }
        >,
      ) => {
        lastInjectionTarget = injection.target;
        return [
          {
            frameId: 0,
            documentId: injectionDocumentId,
            result: {
              matched: true,
              framework: "unknown" as const,
              components: [] as [],
              warnings: [] as [],
            },
          },
        ];
      },
    },
  },
});

const {
  clearContentFrames,
  registerContentFrame,
} = await import("../src/background/chromeApi");
const { locateElementSource } = await import(
  "../src/background/sourceLocator"
);

function registerCurrentDocument(): void {
  clearContentFrames(tab.id!);
  registerContentFrame(
    {
      tab,
      frameId: 0,
      documentId: "doc-current",
    },
    {
      url: tab.url!,
      title: tab.title!,
    },
  );
}

test("source locator injects by frame and validates Chrome's result document", async () => {
  registerCurrentDocument();
  injectionDocumentId = "doc-current";

  const result = await locateElementSource({
    selector: "body",
    maxDepth: 2,
  });

  assert.deepEqual(lastInjectionTarget, {
    tabId: tab.id,
    frameIds: [0],
  });
  assert.equal(result.matched, true);
  assert.equal(result.target.documentId, "doc-current");
});

test("source locator rejects a result produced by a replaced document", async () => {
  registerCurrentDocument();
  injectionDocumentId = "doc-replaced";

  await assert.rejects(
    locateElementSource({
      selector: "body",
      maxDepth: 2,
    }),
    /STALE_FRAME: the frame document changed/,
  );
});
