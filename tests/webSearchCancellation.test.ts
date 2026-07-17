import assert from "node:assert/strict";
import test from "node:test";
import { runWebSearch } from "../src/sidepanel/services/webSearch";

test("standalone web search stops without falling back after Agent cancellation", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  let attempts = 0;
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });

  globalThis.fetch = ((_input, init) => {
    attempts += 1;
    markStarted();
    return new Promise<Response>((_resolve, reject) => {
      const rejectAbort = () =>
        reject(new DOMException("The operation was aborted.", "AbortError"));
      if (init?.signal?.aborted) {
        rejectAbort();
        return;
      }
      init?.signal?.addEventListener("abort", rejectAbort, { once: true });
    });
  }) as typeof fetch;

  try {
    const result = runWebSearch(
      { query: "cancel fixture" },
      { signal: controller.signal },
    );
    await started;
    controller.abort();
    await assert.rejects(result, /联网搜索已取消/);
    assert.equal(attempts, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
