import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_AI_CONFIG } from "../src/sidepanel/services/aiConfig";
import {
  EMPTY_ASSISTANT_CONTENT_FALLBACK,
  getAssistantDisplayContent,
  stripAssistantToolMarkup,
} from "../src/sidepanel/services/assistantContent";
import {
  buildEvidenceReportPrompt,
  buildPostToolEvidencePrompt,
  buildSystemPrompt,
  streamAiChat,
  streamAiChatAfterTools,
  isProviderToolSchemaCompatibilityError,
  toConservativeProviderToolSchema,
  toProviderCompatibleToolSchema,
  stripToolClientMetadata,
} from "../src/sidepanel/services/aiClient";

test("external-only chats omit browser-agent tool instructions", () => {
  const prompt = buildSystemPrompt(DEFAULT_AI_CONFIG, {
    toolScope: "external_only",
  });
  assert.match(prompt, /selected an external MCP server as the only tool source/);
  assert.match(prompt, /untrusted capability metadata/);
  assert.doesNotMatch(prompt, /browser_verify/);
  assert.doesNotMatch(prompt, /browser_observe/);
  assert.doesNotMatch(prompt, /full DOM/);
});

test("evidence-report guidance requires structured detail without invented facts", () => {
  const prompt = buildEvidenceReportPrompt();
  assert.match(prompt, /GitHub-Flavored Markdown tables/);
  assert.match(prompt, /exact source names, environments, counts, statuses/);
  assert.match(prompt, /Never invent a table column/);
  assert.match(prompt, /one aggregate result as an initial lead/);
  assert.doesNotMatch(prompt, /Keep answers concise and actionable/);
  assert.match(prompt, /beginning with a verified conclusion/);
  assert.match(prompt, /leave out drafting commentary/);
  assert.doesNotMatch(prompt, /only report body the user can rely on/);
  assert.match(prompt, /self-contained Markdown report/);
  assert.doesNotMatch(prompt, /报告如上所示/);
  assert.doesNotMatch(prompt, /see above/);
  assert.match(prompt, /Never append trend arrows/);
  assert.match(prompt, /restart total, not a count of containers/);
  assert.match(prompt, /end with one short direct question/);
});

test("Chinese user input adds an explicit Simplified Chinese response contract", () => {
  const prompt = Reflect.apply(buildSystemPrompt, undefined, [
    DEFAULT_AI_CONFIG,
    {},
    "请检查当前页面为什么没有用量数据。",
  ]);

  assert.match(prompt, /Response language for this turn: Simplified Chinese/);
  assert.match(prompt, /Do not switch to English/);
});

test("general questions treat missing automatic page context as optional", async () => {
  const prompt = buildSystemPrompt(
    DEFAULT_AI_CONFIG,
    {},
    "解释一下 JavaScript 事件循环。",
  );
  assert.match(prompt, /Page context is optional/);
  assert.match(prompt, /unrelated to the current page/);

  const requestBodies: Array<Record<string, unknown>> = [];
  const restore = installBrowserGlobals(requestBodies, {
    choices: [{ message: { content: "事件循环负责协调任务队列。" } }],
  });
  try {
    await streamAiChat({
      config: { ...DEFAULT_AI_CONFIG, enableTools: false },
      messages: [],
      input: "解释一下 JavaScript 事件循环。",
      attachments: [],
      context: {
        contextReadError: "NO_TASK_CONTEXT: no browser target is bound",
      },
      onDelta: () => undefined,
    });

    const serializedMessages = JSON.stringify(requestBodies[0]?.messages);
    assert.doesNotMatch(serializedMessages, /NO_TASK_CONTEXT/);
    assert.doesNotMatch(serializedMessages, /Page context read failed/);
  } finally {
    restore();
  }
});

test("post-tool guidance requests minimum sufficient evidence without query exhaustion", () => {
  const prompt = buildPostToolEvidencePrompt();
  assert.match(prompt, /minimum sufficient evidence/);
  assert.match(prompt, /one distinct unresolved requirement/);
  assert.match(prompt, /Finish once the requested scope is supported/);
  assert.match(prompt, /evidence-based next checks/);
  assert.match(prompt, /one focused clarification/);
  assert.match(prompt, /self-contained report/);
  assert.match(prompt, /emit the final answer directly/);
  assert.match(prompt, /marked isError is an unresolved operation/);
  assert.match(prompt, /missing namespace, scope, selector, or resource identity/);
  assert.doesNotMatch(prompt, /shown above|see above|报告如上所示/i);
});

test("client-only tool metadata is stripped before provider serialization", () => {
  const tool = {
    type: "function",
    function: {
      name: "external_query",
      parameters: { type: "object" },
    },
    clientMetadata: {
      source: "external_mcp",
      externalMcpServerName: "Prometheus Infra MCP",
    },
  };

  assert.deepEqual(stripToolClientMetadata(tool), {
    type: "function",
    function: tool.function,
  });
  assert.equal("clientMetadata" in tool, true);
});

const TOOL_MARKUP =
  '<tool_call>{"name":"browser_click","arguments":{"selector":"#danger"}}</tool_call>';

test("provider tool schemas omit nested uniqueItems without mutating MCP schemas", () => {
  const schema = {
    type: "object",
    properties: {
      names: {
        type: "array",
        uniqueItems: true,
        items: {
          anyOf: [
            { type: "string" },
            {
              type: "array",
              uniqueItems: false,
              items: { type: "number" },
            },
          ],
        },
      },
    },
  };

  assert.deepEqual(toProviderCompatibleToolSchema(schema), {
    type: "object",
    properties: {
      names: {
        type: "array",
        items: {
          anyOf: [
            { type: "string" },
            {
              type: "array",
              items: { type: "number" },
            },
          ],
        },
      },
    },
  });
  assert.equal(schema.properties.names.uniqueItems, true);
  assert.equal(
    schema.properties.names.items.anyOf[1]?.uniqueItems,
    false,
  );
});

test("conservative provider schemas keep property names but omit grammar-only keywords", () => {
  const tool = {
    type: "function",
    function: {
      name: "example_tool",
      description: "Example",
      parameters: {
        type: "object",
        properties: {
          mode: {
            anyOf: [
              { type: "string", pattern: "^[a-z]+$" },
              { type: "number", minimum: 1 },
            ],
          },
          tags: {
            type: "array",
            uniqueItems: true,
            items: { type: "string" },
          },
        },
        required: ["mode"],
        additionalProperties: false,
      },
    },
  };

  assert.deepEqual(toConservativeProviderToolSchema(tool), {
    type: "function",
    function: {
      name: "example_tool",
      description: "Example",
      parameters: {
        type: "object",
        properties: {
          mode: {},
          tags: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["mode"],
        additionalProperties: false,
      },
    },
  });
  assert.equal(
    isProviderToolSchemaCompatibilityError(
      'Grammar error: Unimplemented keys: ["anyOf"]',
    ),
    true,
  );
  assert.equal(
    isProviderToolSchemaCompatibilityError("Invalid API key"),
    false,
  );
});

test("schema grammar rejection retries once with the conservative provider projection", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const requestBodies: Array<Record<string, unknown>> = [];
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: globalThis,
  });
  globalThis.fetch = (async (_input, init) => {
    requestBodies.push(
      JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    );
    if (requestBodies.length === 1) {
      return new Response(
        JSON.stringify({
          error: {
            message: 'Grammar error: Unimplemented keys: ["anyOf"]',
          },
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(
      'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    );
  }) as typeof fetch;

  try {
    await streamAiChat({
      config: { ...DEFAULT_AI_CONFIG, enableTools: true, maxToolRounds: 1 },
      messages: [],
      input: "test",
      attachments: [],
      context: {},
      tools: [
        {
          type: "function",
          function: {
            name: "example_tool",
            description: "Example",
            parameters: {
              type: "object",
              properties: {
                value: {
                  anyOf: [{ type: "string" }, { type: "number" }],
                },
              },
            },
          },
        },
      ],
      onDelta: () => undefined,
    });

    assert.equal(requestBodies.length, 2);
    assert.equal(requestBodies[0]?.max_tokens, 8192);
    assert.equal(requestBodies[1]?.max_tokens, 8192);
    assert.equal(JSON.stringify(requestBodies[0]?.tools).includes("anyOf"), true);
    assert.equal(JSON.stringify(requestBodies[1]?.tools).includes("anyOf"), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
});

test("degenerate repeated streamed output is stopped before it can occupy the daemon run forever", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: globalThis,
  });
  const repeatedInstruction =
    'Do not include a "report shown above" or "see above" style phrase. ';
  const payload = Array.from({ length: 96 }, () =>
    `data: ${JSON.stringify({
      choices: [{ delta: { content: repeatedInstruction } }],
    })}\n\n`,
  ).join("");
  globalThis.fetch = (async () =>
    new Response(`${payload}data: [DONE]\n\n`, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    })) as typeof fetch;

  try {
    await assert.rejects(
      streamAiChat({
        config: { ...DEFAULT_AI_CONFIG, enableTools: false },
        messages: [],
        input: "generate report",
        attachments: [],
        context: {},
        onDelta: () => undefined,
      }),
      /AI_REPETITIVE_OUTPUT/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
});

test("post-tool generation retries one provider repetition and returns the fresh result", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const requestBodies: Array<Record<string, unknown>> = [];
  let callCount = 0;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: globalThis,
  });
  const repeatedInstruction =
    'Do not include a "report shown above" or "see above" style phrase. ';
  const repeatedPayload = Array.from({ length: 96 }, () =>
    `data: ${JSON.stringify({
      choices: [{ delta: { content: repeatedInstruction } }],
    })}\n\n`,
  ).join("");
  globalThis.fetch = (async (_input, init) => {
    callCount += 1;
    requestBodies.push(
      JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    );
    if (callCount === 1) {
      return new Response(`${repeatedPayload}data: [DONE]\n\n`, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }
    return new Response(
      'data: {"choices":[{"delta":{"content":"Pod was not found in the current namespace; resolve its namespace first."},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    );
  }) as typeof fetch;

  try {
    const result = await streamAiChatAfterTools({
      config: { ...DEFAULT_AI_CONFIG, enableTools: true, maxToolRounds: 4 },
      messages: [],
      input: "analyze pod",
      attachments: [],
      context: {},
      toolExchanges: [
        {
          assistantContent: "",
          toolCalls: [
            {
              id: "pod-call",
              name: "pods_get",
              arguments: { name: "pod-a" },
              rawArguments: '{"name":"pod-a"}',
            },
          ],
          toolResults: [
            {
              toolCallId: "pod-call",
              name: "pods_get",
              content: JSON.stringify({ isError: true, error: "not found" }),
            },
          ],
        },
      ],
      enableTools: true,
      tools: [],
      onDelta: () => undefined,
    });

    assert.equal(callCount, 2);
    assert.match(result.content, /resolve its namespace first/);
    const retryMessages = requestBodies[1]?.messages as Array<{
      role?: string;
      content?: string;
    }>;
    assert.equal(
      retryMessages.some((message) =>
        message.content?.includes("previous generation was discarded"),
      ),
      true,
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
});

function emptyPrometheusExchange(id: string, query: string) {
  return {
    assistantContent: "",
    toolCalls: [
      {
        id,
        name: "prometheus_query",
        arguments: { query },
        rawArguments: JSON.stringify({ query }),
      },
    ],
    toolResults: [
      {
        toolCallId: id,
        name: "prometheus_query",
        content: JSON.stringify({
          content: [],
          structuredContent: {
            quality_status: "ok",
            result_type: "vector",
            series_count: 0,
            data: [],
            warnings: [],
            infos: [],
          },
        }),
      },
    ],
  };
}

test("post-tool generation recovers from a second repetition with compact evidence", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const requestBodies: Array<Record<string, unknown>> = [];
  let callCount = 0;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: globalThis,
  });
  const repeatedUnit =
    "The query returned no series, so I will inspect another metric. ";
  const repeatedPayload = Array.from({ length: 96 }, () =>
    `data: ${JSON.stringify({
      choices: [{ delta: { content: repeatedUnit } }],
    })}\n\n`,
  ).join("");
  globalThis.fetch = (async (_input, init) => {
    callCount += 1;
    requestBodies.push(
      JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    );
    if (callCount <= 2) {
      return new Response(`${repeatedPayload}data: [DONE]\n\n`, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }
    return new Response(
      'data: {"choices":[{"delta":{"content":"两个不同的 Prometheus 查询都成功执行，但都没有返回时间序列；当前证据无法从 Prometheus 确认容器退出原因。"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    );
  }) as typeof fetch;

  try {
    const result = await streamAiChatAfterTools({
      config: { ...DEFAULT_AI_CONFIG, enableTools: true, maxToolRounds: 4 },
      messages: [],
      input: "分析 fluent-bit 异常原因",
      attachments: [],
      context: {},
      toolExchanges: [
        emptyPrometheusExchange(
          "query-last-reason",
          'kube_pod_container_status_last_terminated_reason{namespace="ob",pod="fluent-bit-jmz5k"}',
        ),
        emptyPrometheusExchange(
          "query-restarts",
          'kube_pod_container_status_restarts_total{namespace="ob"}',
        ),
      ],
      enableTools: true,
      tools: [],
      onDelta: () => undefined,
    });

    assert.equal(callCount, 3);
    assert.match(result.content, /两个不同的 Prometheus 查询/);
    assert.equal(Object.hasOwn(requestBodies[2] ?? {}, "tools"), false);
    assert.match(
      JSON.stringify(requestBodies[2]?.messages),
      /compact tool evidence|压缩/i,
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
});

test("model history drops poisoned assistant output and retains bounded prior tool failures", async () => {
  const requestBodies: Array<Record<string, unknown>> = [];
  const restore = installBrowserGlobals(requestBodies, {
    choices: [{ message: { content: "Use a namespace discovery call." } }],
  });
  const repeatedInstruction =
    'Do not include a "report shown above" or "see above" style phrase. ';

  try {
    await streamAiChat({
      config: { ...DEFAULT_AI_CONFIG, maxHistory: 12 },
      messages: [
        {
          id: "user-1",
          role: "user",
          content: "Analyze pod-a",
          createdAt: "2026-08-06T00:00:00.000Z",
        },
        {
          id: "poisoned-assistant",
          role: "assistant",
          content: repeatedInstruction.repeat(96),
          createdAt: "2026-08-06T00:00:01.000Z",
        },
        {
          id: "failed-tool",
          role: "tool",
          toolName: "pods_get",
          content: JSON.stringify({
            content: [{ type: "text", text: "pod-a was not found" }],
            isError: true,
          }),
          createdAt: "2026-08-06T00:00:02.000Z",
        },
        {
          id: "runtime-error",
          role: "assistant",
          content: "AI 请求失败：AI_REPETITIVE_OUTPUT: stopped",
          createdAt: "2026-08-06T00:00:03.000Z",
        },
      ],
      input: "continue",
      attachments: [],
      context: {},
      onDelta: () => undefined,
    });

    const serializedMessages = JSON.stringify(requestBodies[0]?.messages);
    assert.doesNotMatch(serializedMessages, /report shown above/);
    assert.doesNotMatch(serializedMessages, /AI_REPETITIVE_OUTPUT/);
    assert.match(serializedMessages, /UNTRUSTED_PRIOR_TOOL_RESULT/);
    assert.match(serializedMessages, /pods_get/);
    assert.match(serializedMessages, /pod-a was not found/);
  } finally {
    restore();
  }
});

test("a completed tool run cannot overshadow the latest user request", async () => {
  const requestBodies: Array<Record<string, unknown>> = [];
  const restore = installBrowserGlobals(requestBodies, {
    choices: [{ message: { content: "回答当前的新问题。" } }],
  });
  const staleToolEvidence =
    "STALE_FLUENT_BIT_TOOL_EVIDENCE " + "node-status ".repeat(2_000);

  try {
    await streamAiChat({
      config: { ...DEFAULT_AI_CONFIG, maxHistory: 12 },
      messages: [
        {
          id: "old-user",
          role: "user",
          content: "查询 fluent-bit DaemonSet 的所有节点状态",
          createdAt: "2026-08-06T00:00:00.000Z",
        },
        {
          id: "old-tool",
          role: "tool",
          toolName: "pods_list_in_namespace",
          content: staleToolEvidence,
          createdAt: "2026-08-06T00:00:01.000Z",
        },
        {
          id: "old-assistant",
          role: "assistant",
          content: "fluent-bit 的状态报告已经完成。",
          createdAt: "2026-08-06T00:00:02.000Z",
        },
      ],
      input: "JavaScript 的事件循环是什么？",
      attachments: [],
      context: {},
      onDelta: () => undefined,
    });

    const serializedMessages = JSON.stringify(requestBodies[0]?.messages);
    assert.doesNotMatch(serializedMessages, /STALE_FLUENT_BIT_TOOL_EVIDENCE/);
    assert.doesNotMatch(serializedMessages, /UNTRUSTED_PRIOR_TOOL_RESULT/);
    assert.match(serializedMessages, /fluent-bit 的状态报告已经完成/);
    assert.match(serializedMessages, /CURRENT_USER_REQUEST/);
    assert.match(serializedMessages, /JavaScript 的事件循环是什么/);
    assert.match(
      serializedMessages,
      /only active request|唯一需要执行的请求/i,
    );
  } finally {
    restore();
  }
});

test("long structured reports with repeated status values are not mistaken for provider repetition", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: globalThis,
  });
  const report = [
    "# Pod 状态",
    "",
    "| Pod | 状态 |",
    "| --- | --- |",
    ...Array.from(
      { length: 160 },
      (_, index) => `| workload-${index + 1} | ✅ Running |`,
    ),
  ].join("\n");
  const payload = Array.from({ length: Math.ceil(report.length / 180) }, (_, index) => {
    const content = report.slice(index * 180, (index + 1) * 180);
    return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
  }).join("");
  globalThis.fetch = (async () =>
    new Response(`${payload}data: [DONE]\n\n`, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    })) as typeof fetch;

  try {
    const result = await streamAiChat({
      config: { ...DEFAULT_AI_CONFIG, enableTools: false },
      messages: [],
      input: "summarize pods",
      attachments: [],
      context: {},
      onDelta: () => undefined,
    });
    assert.match(result.content, /workload-160/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
});

test("empty SSE heartbeats do not reset the model progress timeout", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  let scheduledTimeouts = 0;

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: globalThis,
  });
  globalThis.setTimeout = ((() => {
    scheduledTimeouts += 1;
    return scheduledTimeouts;
  }) as unknown) as typeof setTimeout;
  globalThis.clearTimeout = (() => undefined) as typeof clearTimeout;
  globalThis.fetch = (async () =>
    new Response(
      'data: {}\n\ndata: {"choices":[{"delta":{"content":"done"}}]}\n\ndata: [DONE]\n\n',
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    )) as typeof fetch;

  try {
    const result = await streamAiChat({
      config: { ...DEFAULT_AI_CONFIG, enableTools: false },
      messages: [],
      input: "test heartbeat handling",
      attachments: [],
      context: {},
      onDelta: () => undefined,
    });

    assert.equal(result.content, "done");
    assert.equal(scheduledTimeouts, 4);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
});

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
