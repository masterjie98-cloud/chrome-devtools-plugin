import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_AI_CONFIG } from "../src/sidepanel/services/aiConfig";
import {
  EMPTY_ASSISTANT_CONTENT_FALLBACK,
  getAssistantDisplayContent,
  stripAssistantToolMarkup,
} from "../src/sidepanel/services/assistantContent";
import {
  streamAiChat,
  streamAiChatAfterTools,
} from "../src/sidepanel/services/aiClient";

const TOOL_MARKUP =
  '<tool_call>{"name":"browser_click","arguments":{"selector":"#danger"}}</tool_call>';

test("assistant tool markup strips provider control tokens without hiding prose", () => {
  const content = [
    "我会先读取当前页面。",
    "<|tool_calls_section_begin|><|tool_call_begin|>functions.browser_snapshot:0",
    '<|tool_call_argument_begin|>{"limit":2,"cursor":"next"}',
    "<|tool_call_end|><|tool_calls_section_end|>",
    "页面读取完成。",
  ].join("\n");

  assert.equal(
    stripAssistantToolMarkup(content),
    "我会先读取当前页面。\n\n页面读取完成。",
  );
});

test("assistant tool markup removes an incomplete trailing provider tool block", () => {
  assert.equal(
    stripAssistantToolMarkup(
      "正在定位按钮。\n<|tool_calls_section_begin|><|tool_call_begin|>functions.browser_click:0\n<|tool_call_argument_begin|>{\"selector\":\"#save\"}",
    ),
    "正在定位按钮。",
  );
});

test("assistant display content replaces marker-only history without affecting streaming placeholders", () => {
  const markerOnly =
    '<|tool_calls_section_begin|><|tool_call_begin|>functions.browser_click:0\n<|tool_call_argument_begin|>{"selector":"#save"}<|tool_call_end|><|tool_calls_section_end|>';

  assert.equal(
    getAssistantDisplayContent(markerOnly),
    EMPTY_ASSISTANT_CONTENT_FALLBACK,
  );
  assert.equal(
    getAssistantDisplayContent(markerOnly, { allowEmpty: true }),
    "",
  );
  assert.equal(
    getAssistantDisplayContent(`\u200B\uFEFF${markerOnly}\u2060`),
    EMPTY_ASSISTANT_CONTENT_FALLBACK,
  );
});

test("long Agent runs keep recent tool exchanges exact and compact older rounds", async () => {
  const requestBodies: Array<Record<string, unknown>> = [];
  const restore = installBrowserGlobals(requestBodies, {
    choices: [{ message: { content: "done" } }],
  });
  const exchanges = Array.from({ length: 14 }, (_, index) => ({
    assistantContent: `assistant-${index}`,
    toolCalls: [
      {
        id: `call-${index}`,
        name: "browser_snapshot",
        arguments: { cursor: `cursor-${index}` },
        rawArguments: JSON.stringify({ cursor: `cursor-${index}` }),
      },
    ],
    toolResults: [
      {
        toolCallId: `call-${index}`,
        name: "browser_snapshot",
        content: `result-${index}-${"x".repeat(1400)}`,
      },
    ],
  }));

  try {
    await streamAiChatAfterTools({
      config: DEFAULT_AI_CONFIG,
      messages: [],
      input: "continue",
      attachments: [],
      context: {},
      toolExchanges: exchanges,
      enableTools: true,
      tools: [],
      onDelta: () => undefined,
    });

    const messages = requestBodies[0]?.messages as Array<{
      role?: string;
      content?: string;
      tool_call_id?: string;
    }>;
    const compacted = messages.find(
      (message) =>
        message.role === "user" &&
        message.content?.includes("Earlier tool rounds 1-2"),
    );
    assert.ok(compacted);
    assert.match(compacted.content ?? "", /Tool round 1/);
    assert.match(compacted.content ?? "", /result-0-/);
    assert.match(compacted.content ?? "", /truncated 209 chars/);

    const exactToolMessages = messages.filter(
      (message) => message.role === "tool",
    );
    assert.equal(exactToolMessages.length, 12);
    assert.equal(exactToolMessages[0]?.tool_call_id, "call-2");
    assert.equal(exactToolMessages.at(-1)?.tool_call_id, "call-13");
  } finally {
    restore();
  }
});

test("tools-off keeps pseudo tool markup as text and never returns a tool call", async () => {
  const requestBodies: Array<Record<string, unknown>> = [];
  const restore = installBrowserGlobals(requestBodies, {
    choices: [{ message: { content: TOOL_MARKUP } }],
  });

  try {
    const result = await streamAiChat({
      config: {
        ...DEFAULT_AI_CONFIG,
        enableTools: false,
        allowPseudoToolCalls: true,
        supportsWebSearch: true,
        enableWebSearch: true,
      },
      messages: [],
      input: "Explain the page.",
      attachments: [],
      context: {},
      onDelta: () => undefined,
    });

    assert.deepEqual(result.toolCalls, []);
    assert.equal(result.content, TOOL_MARKUP);
    assert.equal(requestBodies.length, 1);
    assert.equal(requestBodies[0]?.tools, undefined);
  } finally {
    restore();
  }
});

test("pseudo tool compatibility is disabled by default even when formal tools are enabled", async () => {
  const requestBodies: Array<Record<string, unknown>> = [];
  const restore = installBrowserGlobals(requestBodies, {
    choices: [{ message: { content: TOOL_MARKUP } }],
  });

  try {
    const result = await streamAiChat({
      config: {
        ...DEFAULT_AI_CONFIG,
        enableTools: true,
        allowPseudoToolCalls: false,
      },
      messages: [],
      input: "Explain the page.",
      attachments: [],
      context: {},
      tools: [],
      onDelta: () => undefined,
    });

    assert.deepEqual(result.toolCalls, []);
  } finally {
    restore();
  }
});

test("tools-off rejects JSON-block, inline, and formal tool calls", async () => {
  const cases: Array<{ name: string; response: Record<string, unknown> }> = [
    {
      name: "JSON block",
      response: {
        choices: [
          {
            message: {
              content:
                '```json\n{"name":"browser_click","arguments":{"selector":"#danger"}}\n```',
            },
          },
        ],
      },
    },
    {
      name: "inline call",
      response: {
        choices: [
          {
            message: {
              content: '`browser_click({"selector":"#danger"})`',
            },
          },
        ],
      },
    },
    {
      name: "formal call",
      response: {
        choices: [
          {
            message: {
              content: "No action taken.",
              tool_calls: [
                {
                  id: "call-danger",
                  type: "function",
                  function: {
                    name: "browser_click",
                    arguments: '{"selector":"#danger"}',
                  },
                },
              ],
            },
          },
        ],
      },
    },
  ];

  for (const entry of cases) {
    const requestBodies: Array<Record<string, unknown>> = [];
    const restore = installBrowserGlobals(requestBodies, entry.response);
    try {
      const result = await streamAiChat({
        config: {
          ...DEFAULT_AI_CONFIG,
          enableTools: false,
          allowPseudoToolCalls: true,
        },
        messages: [],
        input: entry.name,
        attachments: [],
        context: {},
        onDelta: () => undefined,
      });
      assert.deepEqual(result.toolCalls, [], entry.name);
      assert.equal(requestBodies[0]?.tools, undefined, entry.name);
    } finally {
      restore();
    }
  }
});

test("pseudo compatibility accepts only tools advertised for the current request", async () => {
  const requestBodies: Array<Record<string, unknown>> = [];
  const restore = installBrowserGlobals(requestBodies, {
    choices: [{ message: { content: TOOL_MARKUP } }],
  });

  try {
    const result = await streamAiChat({
      config: {
        ...DEFAULT_AI_CONFIG,
        enableTools: true,
        allowPseudoToolCalls: true,
      },
      messages: [],
      input: "Read the page without clicking.",
      attachments: [],
      context: {},
      tools: [
        {
          type: "function",
          function: {
            name: "browser_snapshot",
            description: "Read the current semantic snapshot.",
            parameters: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
          },
        },
      ],
      onDelta: () => undefined,
    });

    assert.deepEqual(result.toolCalls, []);
    const advertised = requestBodies[0]?.tools as
      | Array<{ function?: { name?: string } }>
      | undefined;
    assert.deepEqual(
      advertised?.map((tool) => tool.function?.name),
      ["browser_snapshot"],
    );
  } finally {
    restore();
  }
});

test("formal tool calls outside the advertised subset are ignored", async () => {
  const requestBodies: Array<Record<string, unknown>> = [];
  const restore = installBrowserGlobals(requestBodies, {
    choices: [
      {
        message: {
          content: "",
          tool_calls: [
            {
              id: "unadvertised-click",
              type: "function",
              function: {
                name: "browser_click",
                arguments: '{"selector":"#danger"}',
              },
            },
          ],
        },
      },
    ],
  });

  try {
    const result = await streamAiChat({
      config: {
        ...DEFAULT_AI_CONFIG,
        enableTools: true,
      },
      messages: [],
      input: "Read only.",
      attachments: [],
      context: {},
      tools: [
        {
          type: "function",
          function: {
            name: "browser_snapshot",
            description: "Read the current semantic snapshot.",
            parameters: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
          },
        },
      ],
      onDelta: () => undefined,
    });

    assert.deepEqual(result.toolCalls, []);
  } finally {
    restore();
  }
});

test("browser_snapshot keeps model-provided cursor pagination arguments", async () => {
  const requestBodies: Array<Record<string, unknown>> = [];
  const restore = installBrowserGlobals(requestBodies, {
    choices: [
      {
        message: {
          content: "",
          tool_calls: [
            {
              id: "snapshot-page-2",
              type: "function",
              function: {
                name: "browser_snapshot",
                arguments: '{"cursor":"ss1_1234abcd_2","limit":2}',
              },
            },
          ],
        },
      },
    ],
  });

  try {
    const result = await streamAiChat({
      config: {
        ...DEFAULT_AI_CONFIG,
        enableTools: true,
      },
      messages: [],
      input: "Read the second snapshot page.",
      attachments: [],
      context: {},
      tools: [
        {
          type: "function",
          function: {
            name: "browser_snapshot",
            description: "Read a semantic snapshot page.",
            parameters: {
              type: "object",
              properties: {
                cursor: { type: "string" },
                limit: { type: "number" },
              },
              additionalProperties: false,
            },
          },
        },
      ],
      onDelta: () => undefined,
    });

    assert.deepEqual(result.toolCalls[0]?.arguments, {
      cursor: "ss1_1234abcd_2",
      limit: 2,
    });
  } finally {
    restore();
  }
});

test("page context is sent as untrusted user data and never placed in the system message", async () => {
  const requestBodies: Array<Record<string, unknown>> = [];
  const restore = installBrowserGlobals(requestBodies, {
    choices: [{ message: { content: "Done" } }],
  });
  const sentinel = "PAGE_SENTINEL_DO_NOT_EXECUTE";

  try {
    await streamAiChat({
      config: {
        ...DEFAULT_AI_CONFIG,
        fastAgentMode: false,
        enableTools: false,
      },
      messages: [],
      input: "Explain the page.",
      attachments: [],
      context: {
        pageSnapshot: {
          url: "https://example.test/",
          title: "Example",
          origin: "https://example.test",
          capturedAt: "2026-07-10T00:00:00.000Z",
          visibleText: sentinel,
          domSummary: [],
          nodeCount: 0,
          truncated: false,
          provenance: {
            source: "chrome-content-script",
            observedAt: "2026-07-10T00:00:00.050Z",
            target: {
              url: "https://example.test/",
              title: "Example",
              targetId: "tab-17",
              tabId: 17,
              windowId: 4,
              frameId: 2,
              documentId: "document-child",
              navigationId: "navigation-3",
              revision: 3,
            },
          },
        },
      },
      onDelta: () => undefined,
    });

    const messages = requestBodies[0]?.messages as
      | Array<{ role?: string; content?: unknown }>
      | undefined;
    assert.ok(messages);

    const systemContent = messages
      .filter((message) => message.role === "system")
      .map((message) => String(message.content ?? ""))
      .join("\n");
    const untrustedContext = messages.find(
      (message) =>
        message.role === "user" &&
        String(message.content ?? "").includes("UNTRUSTED_PAGE_CONTEXT"),
    );

    assert.equal(systemContent.includes(sentinel), false);
    assert.match(
      systemContent,
      /Goal-Evidence-Action-Barrier-Verify-Replan/,
    );
    assert.match(systemContent, /forms are only one possible task shape/);
    assert.ok(untrustedContext);
    assert.equal(
      String(untrustedContext.content ?? "").includes(sentinel),
      true,
    );
    const envelope = readUntrustedContextEnvelope(
      String(untrustedContext.content ?? ""),
    );
    assert.equal(envelope.type, "untrusted_page_context_v1");
    assert.equal(envelope.source, "chrome-content-script");
    assert.equal(envelope.targetKnown, true);
    assert.equal(envelope.capturedAt, "2026-07-10T00:00:00.000Z");
    assert.equal(envelope.observedAt, "2026-07-10T00:00:00.050Z");
    assert.equal(
      (envelope.target as Record<string, unknown>).documentId,
      "document-child",
    );
    assert.equal(
      (envelope.target as Record<string, unknown>).revision,
      3,
    );
    const payload = envelope.payload as Record<string, unknown>;
    assert.equal(payload.executionMap, undefined);
    assert.equal(
      envelope.payloadByteCount,
      new TextEncoder().encode(JSON.stringify(payload)).byteLength,
    );
    assert.equal(envelope.truncated, false);
  } finally {
    restore();
  }
});

test("fast Agent mode sends an execution map without auto-attaching a screenshot", async () => {
  const requestBodies: Array<Record<string, unknown>> = [];
  const restore = installBrowserGlobals(requestBodies, {
    choices: [{ message: { content: "Done" } }],
  });

  try {
    await streamAiChat({
      config: {
        ...DEFAULT_AI_CONFIG,
        fastAgentMode: true,
        supportsVision: true,
        enableTools: false,
      },
      messages: [],
      input: "填写姓名并保存。",
      attachments: [],
      context: {
        pageSnapshot: {
          url: "https://example.test/form",
          title: "Example form",
          origin: "https://example.test",
          capturedAt: "2026-07-15T00:00:00.000Z",
          visibleText: "姓名 保存",
          domSummary: [],
          nodeCount: 4,
          truncated: false,
          semanticSnapshot: {
            version: "semantic-snapshot-v1",
            fingerprint: "1234abcd",
            nodes: [
              semanticNode("s1", "heading", "创建用户", "h1"),
              semanticNode("s2", "textbox", "姓名", "#name", {
                required: true,
              }),
              semanticNode("s3", "combobox", "环境", "#environment"),
              semanticNode("s4", "button", "保存", "#save"),
            ],
            pagination: {
              offset: 0,
              limit: 100,
              returnedCount: 4,
              collectedCount: 4,
              totalKnown: true,
              hasMore: false,
            },
            stats: { sourceTruncated: false, outputChars: 800 },
          },
        },
      },
      onDelta: () => undefined,
    });

    const messages = requestBodies[0]?.messages as Array<{
      role?: string;
      content?: unknown;
    }>;
    const systemContent = messages
      .filter((message) => message.role === "system")
      .map((message) => String(message.content ?? ""))
      .join("\n");
    assert.match(systemContent, /Fast execution mode is enabled/);
    assert.match(systemContent, /No page screenshot is attached automatically/);
    assert.match(systemContent, /call browser_take_screenshot yourself/);
    assert.match(systemContent, /browser_execute_action_stage/);
    assert.match(systemContent, /independent fill\/select actions run as a local batch/);

    const contextMessage = messages.find(
      (message) =>
        message.role === "user" &&
        String(message.content ?? "").includes("UNTRUSTED_PAGE_CONTEXT"),
    );
    assert.ok(contextMessage);
    const envelope = readUntrustedContextEnvelope(
      String(contextMessage.content ?? ""),
    );
    const payload = envelope.payload as Record<string, unknown>;
    const executionMap = payload.executionMap as Array<Record<string, unknown>>;
    assert.deepEqual(
      executionMap.map((node) => [node.role, node.name, node.selector]),
      [
        ["textbox", "姓名", "#name"],
        ["combobox", "环境", "#environment"],
        ["button", "保存", "#save"],
      ],
    );

    assert.equal(
      messages.some(
        (message) =>
          Array.isArray(message.content) &&
          message.content.some(
            (part) =>
              typeof part === "object" &&
              part !== null &&
              "type" in part &&
              part.type === "image_url",
          ),
      ),
      false,
    );
  } finally {
    restore();
  }
});

test("adaptive fast checkpoint is appended as the latest untrusted visual evidence", async () => {
  const requestBodies: Array<Record<string, unknown>> = [];
  const restore = installBrowserGlobals(requestBodies, {
    choices: [{ message: { content: "Done" } }],
  });

  try {
    await streamAiChatAfterTools({
      config: {
        ...DEFAULT_AI_CONFIG,
        fastAgentMode: true,
        supportsVision: true,
      },
      messages: [],
      input: "打开下一步。",
      attachments: [],
      context: {},
      toolExchanges: [
        {
          assistantContent: "",
          toolCalls: [
            {
              id: "click-next",
              name: "browser_click",
              arguments: { selector: "#next" },
              rawArguments: '{"selector":"#next"}',
            },
          ],
          toolResults: [
            {
              toolCallId: "click-next",
              name: "browser_click",
              content: JSON.stringify({ matched: true }),
            },
          ],
        },
      ],
      visualCheckpoint: {
        reason: "页面交互可能改变可视状态",
        attachment: {
          id: "checkpoint-latest",
          name: "checkpoint.png",
          mimeType: "image/png",
          dataUrl: "data:image/png;base64,bGF0ZXN0",
          createdAt: "2026-07-15T00:00:01.000Z",
          source: "screenshot",
          visualPurpose: "fast_checkpoint",
        },
      },
      enableTools: true,
      tools: [],
      onDelta: () => undefined,
    });

    const messages = requestBodies[0]?.messages as Array<{
      role?: string;
      content?: unknown;
    }>;
    const checkpointMessage = messages.find((message) => {
      if (message.role !== "user" || !Array.isArray(message.content)) {
        return false;
      }
      return message.content.some(
        (part) =>
          typeof part === "object" &&
          part !== null &&
          "text" in part &&
          String(part.text).includes("UNTRUSTED_VISUAL_CHECKPOINT"),
      );
    });
    assert.ok(checkpointMessage);
    const parts = checkpointMessage.content as Array<{
      type?: string;
      image_url?: { url?: string };
    }>;
    assert.deepEqual(
      parts
        .filter((part) => part.type === "image_url")
        .map((part) => part.image_url?.url),
      ["data:image/png;base64,bGF0ZXN0"],
    );
    assert.equal(messages.at(-2), checkpointMessage);
  } finally {
    restore();
  }
});

test("legacy page context is labeled with unknown target provenance", async () => {
  const requestBodies: Array<Record<string, unknown>> = [];
  const restore = installBrowserGlobals(requestBodies, {
    choices: [{ message: { content: "Done" } }],
  });

  try {
    await streamAiChat({
      config: { ...DEFAULT_AI_CONFIG, enableTools: false },
      messages: [],
      input: "Inspect cached context.",
      attachments: [],
      context: {
        pageSnapshot: {
          url: "https://legacy.example/",
          title: "Legacy",
          origin: "https://legacy.example",
          capturedAt: "2026-07-10T00:00:00.000Z",
          visibleText: "legacy cached page",
          domSummary: [],
          nodeCount: 0,
          truncated: true,
        },
      },
      onDelta: () => undefined,
    });

    const messages = requestBodies[0]?.messages as Array<{
      role?: string;
      content?: unknown;
    }>;
    const contextMessage = messages.find(
      (message) =>
        message.role === "user" &&
        String(message.content ?? "").includes("UNTRUSTED_PAGE_CONTEXT"),
    );
    assert.ok(contextMessage);
    const envelope = readUntrustedContextEnvelope(
      String(contextMessage.content ?? ""),
    );
    assert.equal(envelope.source, "unknown");
    assert.equal(envelope.targetKnown, false);
    assert.equal(envelope.target, null);
    assert.equal(envelope.truncated, true);
  } finally {
    restore();
  }
});

function readUntrustedContextEnvelope(content: string): Record<string, unknown> {
  const marker = "Untrusted page context envelope JSON: ";
  const markerIndex = content.indexOf(marker);
  assert.notEqual(markerIndex, -1);
  return JSON.parse(content.slice(markerIndex + marker.length)) as Record<
    string,
    unknown
  >;
}

function semanticNode(
  ref: string,
  role: string,
  name: string,
  selector: string,
  extra: Record<string, unknown> = {},
) {
  return {
    ref,
    targetRef: `sr1_1234abcd_${ref}`,
    role,
    name,
    selector,
    tagName: role === "textbox" ? "input" : role === "button" ? "button" : "div",
    bounds: { x: 10, y: 10, width: 120, height: 32 },
    ...extra,
  };
}

function installBrowserGlobals(
  requestBodies: Array<Record<string, unknown>>,
  responsePayload: Record<string, unknown>,
): () => void {
  const originalFetch = globalThis.fetch;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: globalThis,
  });

  globalThis.fetch = (async (_input, init) => {
    requestBodies.push(
      JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    );
    return new Response(JSON.stringify(responsePayload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  return () => {
    globalThis.fetch = originalFetch;
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  };
}
