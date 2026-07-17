import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_AI_CONFIG } from "../src/sidepanel/services/aiConfig";
import { runAutonomousAgentSession } from "../src/sidepanel/services/autonomousAgent";

test("an abort before context preparation finalizes the Agent as cancelled", async () => {
  const controller = new AbortController();
  controller.abort();
  const sessionStatuses: string[] = [];

  const result = await runAutonomousAgentSession({
    config: DEFAULT_AI_CONFIG,
    messages: [],
    input: "stop now",
    attachments: [],
    context: {},
    assistantMessageId: "assistant-1",
    abortSignal: controller.signal,
    prepareContext: async (context) => context,
    executeToolCalls: async () => [],
    onVisibleContent: () => undefined,
    onSessionUpdate: (session) => {
      sessionStatuses.push(session.status);
    },
  });

  assert.equal(result.status, "cancelled");
  assert.equal(result.session.status, "cancelled");
  assert.equal(result.session.events.at(-1)?.type, "cancelled");
  assert.deepEqual(sessionStatuses, ["running", "cancelled"]);
});

test("an abort releases an Agent that is waiting on a stuck tool executor", async () => {
  const responsePayload = {
    choices: [
      {
        message: {
          content: "",
          tool_calls: [
            {
              id: "call-stuck-read",
              type: "function",
              function: {
                name: "browser_query_dom",
                arguments: '{"selector":"button"}',
              },
            },
          ],
        },
      },
    ],
  };
  const restore = installBrowserGlobals(responsePayload);
  const controller = new AbortController();
  let toolExecutionStarted = false;

  try {
    const resultPromise = runAutonomousAgentSession({
      config: { ...DEFAULT_AI_CONFIG, autoReadPage: false },
      messages: [],
      input: "Inspect the buttons.",
      attachments: [],
      context: {},
      tools: [
        {
          type: "function",
          function: {
            name: "browser_query_dom",
            description: "Query page DOM.",
            parameters: {
              type: "object",
              properties: { selector: { type: "string" } },
              required: ["selector"],
              additionalProperties: false,
            },
          },
        },
      ],
      assistantMessageId: "assistant-stuck-tool",
      abortSignal: controller.signal,
      executeToolCalls: async () => {
        toolExecutionStarted = true;
        window.setTimeout(() => controller.abort(), 0);
        return new Promise(() => undefined);
      },
      onVisibleContent: () => undefined,
    });

    const result = await Promise.race([
      resultPromise,
      new Promise<never>((_resolve, reject) => {
        window.setTimeout(
          () => reject(new Error("Agent did not settle after cancellation.")),
          250,
        );
      }),
    ]);

    assert.equal(toolExecutionStarted, true);
    assert.equal(result.status, "cancelled");
    assert.equal(result.session.status, "cancelled");
  } finally {
    restore();
  }
});

function installBrowserGlobals(
  responsePayload: Record<string, unknown>,
): () => void {
  const originalFetch = globalThis.fetch;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: globalThis,
  });
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(responsePayload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;

  return () => {
    globalThis.fetch = originalFetch;
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  };
}
