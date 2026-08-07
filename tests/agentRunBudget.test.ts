import assert from "node:assert/strict";
import test from "node:test";
import {
  AgentRunBudget,
  AgentRunBudgetExceededError,
  DEFAULT_AGENT_RUN_BUDGET_LIMITS,
  describeAgentRunBudgetExceeded,
} from "../src/shared/agentRunBudget";
import { DEFAULT_AI_CONFIG } from "../src/sidepanel/services/aiConfig";
import { runAutonomousAgentSession } from "../src/sidepanel/services/autonomousAgent";

test("Agent run budget reserves a tool batch atomically", () => {
  const budget = new AgentRunBudget({
    maxModelRequests: 5,
    maxToolCalls: 2,
    maxEffectfulToolCalls: 2,
    maxSensitiveToolCalls: 2,
    maxDurationMs: 1_000,
  });

  budget.consumeToolCalls([
    { name: "browser_snapshot", arguments: {} },
  ]);

  assert.throws(
    () =>
      budget.consumeToolCalls([
        { name: "browser_snapshot", arguments: {} },
        { name: "browser_get_page_context", arguments: {} },
      ]),
    (error: unknown) => {
      assert.ok(error instanceof AgentRunBudgetExceededError);
      assert.equal(error.kind, "tool_calls");
      return true;
    },
  );
  assert.deepEqual(budget.snapshot().usage.toolCalls, 1);
});

test("Agent run budget classifies known mutations and unknown tools as effectful", () => {
  const budget = new AgentRunBudget({
    maxModelRequests: 5,
    maxToolCalls: 5,
    maxEffectfulToolCalls: 1,
    maxSensitiveToolCalls: 5,
    maxDurationMs: 1_000,
  });

  budget.consumeToolCalls([
    { name: "browser_click", arguments: { selector: "#submit" } },
  ]);

  assert.throws(
    () =>
      budget.consumeToolCalls([
        { name: "unknown_remote_tool", arguments: {} },
      ]),
    (error: unknown) => {
      assert.ok(error instanceof AgentRunBudgetExceededError);
      assert.equal(error.kind, "effectful_tool_calls");
      return true;
    },
  );
  assert.equal(budget.snapshot().usage.effectfulToolCalls, 1);
});

test("approval denial ends the Agent without another model request or transport recovery copy", async () => {
  let requestCount = 0;
  const restore = installBrowserGlobals(
    {
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: "call-denied-css",
                type: "function",
                function: {
                  name: "browser_apply_css_patch",
                  arguments: JSON.stringify({
                    selector: "body",
                    css: "outline: 1px solid red",
                  }),
                },
              },
            ],
          },
        },
      ],
    },
    () => {
      requestCount += 1;
    },
  );

  try {
    const result = await runAutonomousAgentSession({
      config: { ...DEFAULT_AI_CONFIG, maxToolRounds: 2 },
      messages: [],
      input: "Apply a temporary CSS outline.",
      attachments: [],
      context: {},
      assistantMessageId: "assistant-approval-denied",
      tools: [
        {
          type: "function",
          function: {
            name: "browser_apply_css_patch",
            description: "Apply a reversible CSS patch.",
            parameters: {
              type: "object",
              properties: {
                selector: { type: "string" },
                css: { type: "string" },
              },
              required: ["selector", "css"],
              additionalProperties: false,
            },
          },
        },
      ],
      executeToolCalls: async (calls) =>
        calls.map((call) => ({
          toolCallId: call.id,
          name: call.name,
          content: JSON.stringify({
            error:
              "APPROVAL_DENIED: user denied tool approval: browser_apply_css_patch",
          }),
        })),
      onVisibleContent: () => undefined,
    });

    assert.equal(requestCount, 1);
    assert.equal(result.status, "cancelled");
    assert.match(
      result.finalContent,
      /用户已拒绝工具 browser_apply_css_patch，.*操作未执行/,
    );
    assert.doesNotMatch(result.finalContent, /连接中断|恢复本地 daemon/);
  } finally {
    restore();
  }
});

test("activity data loss is always disclosed in the final Agent summary", async () => {
  let requestCount = 0;
  const restore = installBrowserGlobals(
    (requestIndex) =>
      requestIndex === 0
        ? {
            choices: [
              {
                message: {
                  content: "",
                  tool_calls: [
                    {
                      id: "call-activity-loss",
                      type: "function",
                      function: {
                        name: "browser_debug_activity",
                        arguments: JSON.stringify({
                          afterSequence: 0,
                          afterStreamId: "activity-loss",
                        }),
                      },
                    },
                  ],
                },
              },
            ],
          }
        : {
            choices: [
              {
                message: {
                  content: "仍保留的窗口内只看到登录页导航。",
                  tool_calls: [],
                },
              },
            ],
          },
    () => {
      requestCount += 1;
    },
  );

  try {
    const result = await runAutonomousAgentSession({
      config: { ...DEFAULT_AI_CONFIG, maxToolRounds: 2 },
      messages: [],
      input: "监听开始后发生了什么变化？",
      attachments: [],
      context: {
        activityCursor: {
          streamId: "activity-loss",
          sequence: 0,
        },
      },
      assistantMessageId: "assistant-activity-loss",
      tools: [
        {
          type: "function",
          function: {
            name: "browser_debug_activity",
            description: "Read incremental browser activity.",
            parameters: {
              type: "object",
              properties: {
                afterSequence: { type: "integer" },
                afterStreamId: { type: "string" },
              },
              additionalProperties: false,
            },
          },
        },
      ],
      executeToolCalls: async (calls) =>
        calls.map((call) => ({
          toolCallId: call.id,
          name: call.name,
          content: JSON.stringify({
            activity: {
              streamId: "activity-loss",
              cursorStatus: "events_dropped",
              missedEvents: 350,
              observedEvents: 200,
              nextCursor: {
                streamId: "activity-loss",
                sequence: 550,
              },
            },
          }),
        })),
      onVisibleContent: () => undefined,
    });

    assert.equal(requestCount, 2);
    assert.equal(result.status, "completed");
    assert.match(result.finalContent, /350 条事件未保留/);
    assert.match(result.finalContent, /不能声称覆盖完整历史/);
    assert.match(result.finalContent, /只看到登录页导航/);
  } finally {
    restore();
  }
});

test("Agent run budget independently caps approved sensitive reads", () => {
  const budget = new AgentRunBudget({
    maxModelRequests: 5,
    maxToolCalls: 5,
    maxEffectfulToolCalls: 5,
    maxSensitiveToolCalls: 1,
    maxDurationMs: 1_000,
  });
  budget.consumeToolCalls([
    { name: "browser_take_screenshot", arguments: {} },
  ]);

  assert.throws(
    () =>
      budget.consumeToolCalls([
        { name: "browser_cookie_list", arguments: { includeValues: true } },
      ]),
    (error: unknown) => {
      assert.ok(error instanceof AgentRunBudgetExceededError);
      assert.equal(error.kind, "sensitive_tool_calls");
      return true;
    },
  );
  assert.equal(budget.snapshot().usage.sensitiveToolCalls, 1);
});

test("Agent run budget enforces elapsed duration at operation boundaries", () => {
  let now = 100;
  const budget = new AgentRunBudget(
    {
      maxModelRequests: 5,
      maxToolCalls: 5,
    maxEffectfulToolCalls: 5,
    maxSensitiveToolCalls: 5,
      maxDurationMs: 50,
    },
    () => now,
  );
  now = 151;

  assert.throws(
    () => budget.consumeModelRequest(),
    (error: unknown) => {
      assert.ok(error instanceof AgentRunBudgetExceededError);
      assert.equal(error.kind, "duration");
      return true;
    },
  );
  assert.equal(budget.snapshot().usage.modelRequests, 0);
});

test("Agent run budget defaults to a 24-hour long-task window", () => {
  let now = 0;
  const budget = new AgentRunBudget({}, () => now);
  assert.equal(
    budget.limits.maxDurationMs,
    24 * 60 * 60_000,
  );
  assert.equal(
    budget.limits.maxDurationMs,
    DEFAULT_AGENT_RUN_BUDGET_LIMITS.maxDurationMs,
  );

  now = budget.limits.maxDurationMs + 1;
  assert.throws(
    () => budget.consumeModelRequest(),
    (error: unknown) => {
      assert.ok(error instanceof AgentRunBudgetExceededError);
      assert.equal(error.kind, "duration");
      const notice = describeAgentRunBudgetExceeded(error);
      assert.match(notice, /上限 24 小时/);
      assert.doesNotMatch(notice, /86400000|ms/);
      return true;
    },
  );
});

test("Agent run budget can extend only the exhausted dimension", () => {
  const budget = new AgentRunBudget({
    maxModelRequests: 2,
    maxToolCalls: 3,
    maxEffectfulToolCalls: 1,
    maxSensitiveToolCalls: 4,
    maxDurationMs: 1_000,
  });

  const snapshot = budget.extend("effectful_tool_calls", 50);
  assert.equal(snapshot.limits.maxEffectfulToolCalls, 51);
  assert.equal(snapshot.limits.maxToolCalls, 3);
  assert.equal(snapshot.usage.effectfulToolCalls, 0);
});

test("Agent waits at a budget boundary and resumes the same task after confirmation", async () => {
  const toolResponse = (id: string) => ({
    choices: [
      {
        message: {
          content: "",
          tool_calls: [
            {
              id,
              type: "function",
              function: {
                name: "browser_click",
                arguments: '{"selector":"#submit"}',
              },
            },
          ],
        },
      },
    ],
  });
  const restore = installBrowserGlobals((requestIndex) => {
    if (requestIndex < 2) {
      return toolResponse(`call-click-${requestIndex}`);
    }
    if (requestIndex === 2) {
      return {
        choices: [
          {
            message: {
              content: "",
              tool_calls: [
                {
                  id: "call-verify",
                  type: "function",
                  function: { name: "browser_snapshot", arguments: "{}" },
                },
              ],
            },
          },
        ],
      };
    }
    return { choices: [{ message: { content: "Done.", tool_calls: [] } }] };
  });
  const executedTools: string[] = [];
  let resolveBudgetDecision:
    | ((decision: "continue" | "summarize") => void)
    | undefined;
  let budgetRequestCount = 0;

  try {
    const runPromise = runAutonomousAgentSession({
      config: { ...DEFAULT_AI_CONFIG, maxToolRounds: 5 },
      messages: [],
      input: "Click twice.",
      attachments: [],
      context: {},
      assistantMessageId: "assistant-budget-resume",
      tools: [
        {
          type: "function",
          function: {
            name: "browser_click",
            description: "Click an element.",
            parameters: {
              type: "object",
              properties: { selector: { type: "string" } },
              required: ["selector"],
              additionalProperties: false,
            },
          },
        },
        {
          type: "function",
          function: {
            name: "browser_snapshot",
            description: "Read the page.",
            parameters: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
          },
        },
      ],
      runBudgetLimits: {
        maxModelRequests: 10,
        maxToolCalls: 10,
        maxEffectfulToolCalls: 1,
        maxSensitiveToolCalls: 10,
        maxDurationMs: 10_000,
      },
      requestBudgetExtension: async (request) => {
        budgetRequestCount += 1;
        assert.equal(request.kind, "effectful_tool_calls");
        assert.equal(request.increment, 50);
        return new Promise((resolve) => {
          resolveBudgetDecision = resolve;
        });
      },
      executeToolCalls: async (calls) => {
        executedTools.push(...calls.map((call) => call.name));
        return calls.map((call) => ({
          toolCallId: call.id,
          name: call.name,
          content: JSON.stringify({ ok: true }),
        }));
      },
      onVisibleContent: () => undefined,
    });

    while (!resolveBudgetDecision) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    let settled = false;
    void runPromise.finally(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(settled, false);
    assert.deepEqual(executedTools, ["browser_click"]);

    resolveBudgetDecision("continue");
    const result = await runPromise;
    assert.equal(budgetRequestCount, 1);
    assert.deepEqual(executedTools, [
      "browser_click",
      "browser_click",
      "browser_snapshot",
    ]);
    assert.equal(result.status, "completed");
    assert.match(result.finalContent, /Done/);
  } finally {
    restore();
  }
});

test("Agent summarizes current results when the user stops at a budget boundary", async () => {
  const restore = installBrowserGlobals((requestIndex) => {
    if (requestIndex < 2) {
      return {
        choices: [
          {
            message: {
              content: "",
              tool_calls: [
                {
                  id: `call-stop-${requestIndex}`,
                  type: "function",
                  function: {
                    name: "browser_click",
                    arguments: '{"selector":"#submit"}',
                  },
                },
              ],
            },
          },
        ],
      };
    }
    return {
      choices: [{ message: { content: "Current progress summary.", tool_calls: [] } }],
    };
  });
  let executedCalls = 0;

  try {
    const result = await runAutonomousAgentSession({
      config: { ...DEFAULT_AI_CONFIG, maxToolRounds: 5 },
      messages: [],
      input: "Click twice.",
      attachments: [],
      context: {},
      assistantMessageId: "assistant-budget-summarize",
      tools: [
        {
          type: "function",
          function: {
            name: "browser_click",
            description: "Click an element.",
            parameters: {
              type: "object",
              properties: { selector: { type: "string" } },
              required: ["selector"],
              additionalProperties: false,
            },
          },
        },
      ],
      runBudgetLimits: {
        maxModelRequests: 10,
        maxToolCalls: 10,
        maxEffectfulToolCalls: 1,
        maxSensitiveToolCalls: 10,
        maxDurationMs: 10_000,
      },
      requestBudgetExtension: async () => "summarize",
      executeToolCalls: async (calls) => {
        executedCalls += calls.length;
        return calls.map((call) => ({
          toolCallId: call.id,
          name: call.name,
          content: JSON.stringify({ ok: true }),
        }));
      },
      onVisibleContent: () => undefined,
    });

    assert.equal(executedCalls, 1);
    assert.equal(result.status, "blocked");
    assert.match(result.finalContent, /Current progress summary/);
    assert.match(result.finalContent, /你选择了停止继续执行/);
  } finally {
    restore();
  }
});

test("Agent stops before a second mutation when the effectful budget is exhausted", async () => {
  const responsePayload = {
    choices: [
      {
        message: {
          content: "",
          tool_calls: [
            {
              id: "call-click",
              type: "function",
              function: {
                name: "browser_click",
                arguments: '{"selector":"#submit"}',
              },
            },
          ],
        },
      },
    ],
  };
  const restore = installBrowserGlobals(responsePayload);
  let executedCalls = 0;

  try {
    const result = await runAutonomousAgentSession({
      config: { ...DEFAULT_AI_CONFIG, maxToolRounds: 5 },
      messages: [],
      input: "Click twice.",
      attachments: [],
      context: {},
      assistantMessageId: "assistant-budget",
      tools: [
        {
          type: "function",
          function: {
            name: "browser_click",
            description: "Click an element.",
            parameters: {
              type: "object",
              properties: { selector: { type: "string" } },
              required: ["selector"],
              additionalProperties: false,
            },
          },
        },
      ],
      runBudgetLimits: {
        maxModelRequests: 10,
        maxToolCalls: 10,
      maxEffectfulToolCalls: 1,
      maxSensitiveToolCalls: 10,
        maxDurationMs: 10_000,
      },
      executeToolCalls: async (calls) => {
        executedCalls += calls.length;
        return calls.map((call) => ({
          toolCallId: call.id,
          name: call.name,
          content: JSON.stringify({ ok: true }),
        }));
      },
      onVisibleContent: () => undefined,
    });

    assert.equal(executedCalls, 1);
    assert.equal(result.status, "blocked");
    assert.equal(result.session.taskState.phase, "blocked");
    assert.match(result.finalContent, /修改\/外部作用工具调用安全预算/);
    assert.match(result.session.events.at(-2)?.summary ?? "", /安全预算/);
  } finally {
    restore();
  }
});

test("Agent stops before another model request when the model budget is exhausted", async () => {
  const responsePayload = {
    choices: [
      {
        message: {
          content: "",
          tool_calls: [
            {
              id: "call-snapshot",
              type: "function",
              function: {
                name: "browser_snapshot",
                arguments: "{}",
              },
            },
          ],
        },
      },
    ],
  };
  let requestCount = 0;
  const restore = installBrowserGlobals(responsePayload, () => {
    requestCount += 1;
  });
  let executedCalls = 0;

  try {
    const result = await runAutonomousAgentSession({
      config: { ...DEFAULT_AI_CONFIG, maxToolRounds: 5 },
      messages: [],
      input: "Keep reading.",
      attachments: [],
      context: {},
      assistantMessageId: "assistant-model-budget",
      tools: [
        {
          type: "function",
          function: {
            name: "browser_snapshot",
            description: "Read the page.",
            parameters: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
          },
        },
      ],
      runBudgetLimits: {
        maxModelRequests: 1,
        maxToolCalls: 10,
      maxEffectfulToolCalls: 10,
      maxSensitiveToolCalls: 10,
        maxDurationMs: 10_000,
      },
      executeToolCalls: async (calls) => {
        executedCalls += calls.length;
        return calls.map((call) => ({
          toolCallId: call.id,
          name: call.name,
          content: JSON.stringify({ nodes: [] }),
        }));
      },
      onVisibleContent: () => undefined,
    });

    assert.equal(requestCount, 1);
    assert.equal(executedCalls, 1);
    assert.equal(result.status, "blocked");
    assert.equal(result.session.taskState.phase, "blocked");
    assert.match(result.finalContent, /模型请求安全预算/);
  } finally {
    restore();
  }
});

test("tool round limit executes the last batch and then requests a tools-off summary", async () => {
  const responses = [
    {
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: "call-last-snapshot",
                type: "function",
                function: {
                  name: "browser_snapshot",
                  arguments: "{}",
                },
              },
            ],
          },
        },
      ],
    },
    {
      choices: [
        {
          message: {
            content: "阶段性总结：页面读取已完成。",
          },
        },
      ],
    },
  ];
  let requestCount = 0;
  const restore = installBrowserGlobals(
    (index) => responses[index] ?? responses.at(-1)!,
    () => {
      requestCount += 1;
    },
  );
  let executedCalls = 0;

  try {
    const result = await runAutonomousAgentSession({
      config: {
        ...DEFAULT_AI_CONFIG,
        maxToolRounds: 1,
        autoContinueAfterToolRoundLimit: false,
      },
      messages: [],
      input: "读取页面并继续。",
      attachments: [],
      context: {},
      assistantMessageId: "assistant-round-limit",
      tools: [
        {
          type: "function",
          function: {
            name: "browser_snapshot",
            description: "Read the page.",
            parameters: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
          },
        },
      ],
      executeToolCalls: async (calls) => {
        executedCalls += calls.length;
        return calls.map((call) => ({
          toolCallId: call.id,
          name: call.name,
          content: JSON.stringify({ nodes: [] }),
        }));
      },
      onVisibleContent: () => undefined,
    });

    assert.equal(executedCalls, 1);
    assert.equal(requestCount, 2);
    assert.equal(result.status, "blocked");
    assert.equal(result.session.taskState.phase, "blocked");
    assert.match(result.finalContent, /达到本轮工具轮次上限/);
    assert.match(result.finalContent, /后续不会再执行新工具/);
    assert.match(result.finalContent, /阶段性总结：页面读取已完成/);
  } finally {
    restore();
  }
});

test("tool round boundary compacts context and continues by default", async () => {
  const responses = [
    {
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: "call-first-snapshot",
                type: "function",
                function: {
                  name: "browser_snapshot",
                  arguments: "{}",
                },
              },
            ],
          },
        },
      ],
    },
    {
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: "call-second-snapshot",
                type: "function",
                function: {
                  name: "browser_snapshot",
                  arguments: '{"cursor":"next"}',
                },
              },
            ],
          },
        },
      ],
    },
    {
      choices: [
        {
          message: {
            content: "任务已完成。",
          },
        },
      ],
    },
  ];
  let requestCount = 0;
  const restore = installBrowserGlobals(
    (index) => responses[index] ?? responses.at(-1)!,
    () => {
      requestCount += 1;
    },
  );
  const executedCallIds: string[] = [];
  const statusUpdates: string[] = [];

  try {
    const result = await runAutonomousAgentSession({
      config: {
        ...DEFAULT_AI_CONFIG,
        maxToolRounds: 1,
        autoContinueAfterToolRoundLimit: true,
      },
      messages: [],
      input: "读取两页后完成任务。",
      attachments: [],
      context: {},
      assistantMessageId: "assistant-round-continuation",
      tools: [
        {
          type: "function",
          function: {
            name: "browser_snapshot",
            description: "Read the page.",
            parameters: {
              type: "object",
              properties: { cursor: { type: "string" } },
              additionalProperties: false,
            },
          },
        },
      ],
      executeToolCalls: async (calls) => {
        executedCallIds.push(...calls.map((call) => call.id));
        return calls.map((call) => ({
          toolCallId: call.id,
          name: call.name,
          content: JSON.stringify({ nodes: [], nextCursor: null }),
        }));
      },
      onVisibleContent: () => undefined,
      onStatusUpdate: (status) => statusUpdates.push(status),
    });

    assert.deepEqual(executedCallIds, [
      "call-first-snapshot",
      "call-second-snapshot",
    ]);
    assert.equal(requestCount, 3);
    assert.equal(result.status, "completed");
    assert.match(result.finalContent, /任务已完成/);
    assert.doesNotMatch(result.finalContent, /后续不会再执行新工具/);
    assert.ok(
      statusUpdates.some((status) => /压缩后的工具上下文/.test(status)),
    );
  } finally {
    restore();
  }
});

test("Agent blocks a third identical read-only batch after two identical semantic results", async () => {
  const repeatedSnapshot = {
    page: {
      url: "https://example.test/",
      capturedAt: "2026-07-14T00:00:00.000Z",
    },
    freshness: {
      capturedAt: "2026-07-14T00:00:00.000Z",
      observedAt: "2026-07-14T00:00:00.010Z",
      revision: 7,
    },
    snapshot: {
      fingerprint: "1234abcd",
      nodes: [{ ref: "s1", role: "button", name: "Save" }],
      pagination: { hasMore: false },
    },
  };
  const responses = [
    ...Array.from({ length: 3 }, (_, index) => ({
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: `call-repeated-${index + 1}`,
                type: "function",
                function: {
                  name: "browser_snapshot",
                  arguments: "{}",
                },
              },
            ],
          },
        },
      ],
    })),
    {
      choices: [
        {
          message: {
            content: "已根据两次相同结果停止重复读取并完成总结。",
          },
        },
      ],
    },
  ];
  let requestCount = 0;
  const restore = installBrowserGlobals(
    (index) => responses[index] ?? responses.at(-1)!,
    () => {
      requestCount += 1;
    },
  );
  const executedCallIds: string[] = [];
  let resultIndex = 0;

  try {
    const result = await runAutonomousAgentSession({
      config: {
        ...DEFAULT_AI_CONFIG,
        maxToolRounds: 1,
        autoContinueAfterToolRoundLimit: true,
      },
      messages: [],
      input: "Keep reading the same page forever.",
      attachments: [],
      context: {},
      assistantMessageId: "assistant-no-progress",
      tools: [
        {
          type: "function",
          function: {
            name: "browser_snapshot",
            description: "Read the page.",
            parameters: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
          },
        },
      ],
      executeToolCalls: async (calls) => {
        executedCallIds.push(...calls.map((call) => call.id));
        resultIndex += 1;
        return calls.map((call) => ({
          toolCallId: call.id,
          name: call.name,
          content: JSON.stringify({
            ...repeatedSnapshot,
            page: {
              ...repeatedSnapshot.page,
              capturedAt: `2026-07-14T00:00:0${resultIndex}.000Z`,
            },
            freshness: {
              ...repeatedSnapshot.freshness,
              capturedAt: `2026-07-14T00:00:0${resultIndex}.000Z`,
              observedAt: `2026-07-14T00:00:0${resultIndex}.010Z`,
            },
          }),
        }));
      },
      onVisibleContent: () => undefined,
    });

    assert.deepEqual(executedCallIds, [
      "call-repeated-1",
      "call-repeated-2",
    ]);
    assert.equal(requestCount, 4);
    assert.equal(result.status, "blocked");
    assert.doesNotMatch(result.finalContent, /为避免无进展循环/);
    assert.match(result.finalContent, /停止重复读取并完成总结/);
    assert.ok(
      result.session.events.some((event) =>
        event.summary.includes("无进展循环"),
      ),
    );
  } finally {
    restore();
  }
});

test("Agent executes at most one incremental activity read per user turn", async () => {
  const responses = [
    {
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: "call-activity-first",
                type: "function",
                function: {
                  name: "browser_debug_activity",
                  arguments: JSON.stringify({ afterSequence: 0 }),
                },
              },
            ],
          },
        },
      ],
    },
    {
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: "call-activity-repeat",
                type: "function",
                function: {
                  name: "browser_debug_activity",
                  arguments: JSON.stringify({ afterSequence: 57 }),
                },
              },
            ],
          },
        },
      ],
    },
    {
      choices: [
        {
          message: {
            content: "已总结第一次增量窗口，并保存下一游标供用户下次查询。",
          },
        },
      ],
    },
  ];
  const restore = installBrowserGlobals(
    (index) => responses[index] ?? responses.at(-1)!,
  );
  const executedCallIds: string[] = [];

  try {
    const result = await runAutonomousAgentSession({
      config: {
        ...DEFAULT_AI_CONFIG,
        maxToolRounds: 4,
      },
      messages: [],
      input: "刚才页面发生了什么变化？",
      attachments: [],
      context: {},
      assistantMessageId: "assistant-incremental-activity",
      tools: [
        {
          type: "function",
          function: {
            name: "browser_debug_activity",
            description: "Read incremental page activity.",
            parameters: {
              type: "object",
              properties: {
                afterSequence: { type: "number" },
              },
              additionalProperties: false,
            },
          },
        },
      ],
      executeToolCalls: async (calls) => {
        executedCallIds.push(...calls.map((call) => call.id));
        return calls.map((call) => ({
          toolCallId: call.id,
          name: call.name,
          content: JSON.stringify({
            activity: {
              requestedAfterSequence: 0,
              nextSequence: 57,
              observedEvents: 57,
            },
          }),
        }));
      },
      onVisibleContent: () => undefined,
    });

    assert.deepEqual(executedCallIds, ["call-activity-first"]);
    assert.equal(result.status, "completed");
    assert.match(result.finalContent, /已总结第一次增量窗口/);
  } finally {
    restore();
  }
});

test("monitoring-only requests stop immediately after one successful activity start", async () => {
  const response = {
    choices: [
      {
        message: {
          content: "",
          tool_calls: [
            {
              id: "call-monitor-start",
              type: "function",
              function: {
                name: "browser_activity_start",
                arguments: "{}",
              },
            },
            {
              id: "call-monitor-status",
              type: "function",
              function: {
                name: "browser_status",
                arguments: "{}",
              },
            },
            {
              id: "call-monitor-observe",
              type: "function",
              function: {
                name: "browser_observe",
                arguments: "{}",
              },
            },
            {
              id: "call-monitor-reload",
              type: "function",
              function: {
                name: "browser_reload",
                arguments: "{}",
              },
            },
          ],
        },
      },
    ],
  };
  let requestCount = 0;
  const restore = installBrowserGlobals(response, () => {
    requestCount += 1;
  });
  const executedCallIds: string[] = [];

  try {
    const result = await runAutonomousAgentSession({
      config: {
        ...DEFAULT_AI_CONFIG,
        maxToolRounds: 4,
      },
      messages: [],
      input: "开始监听当前页面后续的 URL、Network、DOM 和 Console 变化。",
      attachments: [],
      context: {},
      assistantMessageId: "assistant-monitor-start",
      tools: [
        "browser_activity_start",
        "browser_status",
        "browser_observe",
        "browser_reload",
      ].map((name) => ({
        type: "function" as const,
        function: {
          name,
          description: name,
          parameters: {
            type: "object" as const,
            properties: {},
            additionalProperties: false,
          },
        },
      })),
      executeToolCalls: async (calls) => {
        executedCallIds.push(...calls.map((call) => call.id));
        return calls.map((call) => ({
          toolCallId: call.id,
          name: call.name,
          content: JSON.stringify({
            active: true,
            activityCursor: {
              streamId: "activity-budget",
              sequence: 0,
            },
          }),
        }));
      },
      onVisibleContent: () => undefined,
    });

    assert.deepEqual(executedCallIds, ["call-monitor-start"]);
    assert.equal(requestCount, 1);
    assert.equal(result.status, "completed");
    assert.match(result.finalContent, /监听已启动并固定/);
  } finally {
    restore();
  }
});

test("incremental monitoring follow-ups recover from planning prose and enforce the saved cursor", async () => {
  const restore = installBrowserGlobals((requestIndex) => {
    if (requestIndex === 0) {
      return {
        choices: [
          {
            message: {
              content: "当前上下文没有可用游标，请重新启动监听。",
              tool_calls: [],
            },
          },
        ],
      };
    }
    if (requestIndex === 1) {
      return {
        choices: [
          {
            message: {
              content: "",
              tool_calls: [
                {
                  id: "call-incremental-activity",
                  type: "function",
                  function: {
                    name: "browser_debug_activity",
                    arguments: "{}",
                  },
                },
              ],
            },
          },
        ],
      };
    }
    return {
      choices: [
        {
          message: {
            content: "监听窗口内发生了 24 个增量事件。",
            tool_calls: [],
          },
        },
      ],
    };
  });
  const executedArguments: Array<Record<string, unknown>> = [];

  try {
    const result = await runAutonomousAgentSession({
      config: {
        ...DEFAULT_AI_CONFIG,
        maxToolRounds: 4,
      },
      messages: [],
      input:
        "刚才这个页面发生了什么变化？只读取监听开始后保存游标之后的增量摘要，不要全量读取 Network。",
      attachments: [],
      context: {
        activityCursor: {
          streamId: "activity-incremental",
          sequence: 57,
        },
      },
      assistantMessageId: "assistant-incremental-activity",
      tools: [
        {
          type: "function",
          function: {
            name: "browser_debug_activity",
            description: "Read one bounded incremental activity window.",
            parameters: {
              type: "object",
              properties: {
                afterSequence: { type: "integer", minimum: 0 },
              },
              additionalProperties: false,
            },
          },
        },
      ],
      executeToolCalls: async (calls) => {
        executedArguments.push(...calls.map((call) => call.arguments));
        return calls.map((call) => ({
          toolCallId: call.id,
          name: call.name,
          content: JSON.stringify({
            version: "browser-debug-activity-v1",
            activity: {
              requestedAfterSequence: 57,
              nextSequence: 81,
              observedEvents: 24,
            },
          }),
        }));
      },
      onVisibleContent: () => undefined,
    });

    assert.deepEqual(executedArguments, [
      {
        afterSequence: 57,
        afterStreamId: "activity-incremental",
      },
    ]);
    assert.equal(result.status, "completed");
    assert.match(result.finalContent, /24 个增量事件/);
  } finally {
    restore();
  }
});

test("task binding stale errors stop before the Agent switches tools", async () => {
  const responses = [
    {
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: "call-stale-monitor",
                type: "function",
                function: {
                  name: "browser_activity_start",
                  arguments: "{}",
                },
              },
            ],
          },
        },
      ],
    },
    {
      choices: [
        {
          message: {
            content: "绑定尚未同步，已停止本轮，不会刷新或切换页面。",
          },
        },
      ],
    },
  ];
  let requestCount = 0;
  const restore = installBrowserGlobals(
    (index) => responses[index] ?? responses.at(-1)!,
    () => {
      requestCount += 1;
    },
  );
  const executedCallIds: string[] = [];

  try {
    const result = await runAutonomousAgentSession({
      config: {
        ...DEFAULT_AI_CONFIG,
        maxToolRounds: 4,
      },
      messages: [],
      input: "开始监听当前页面变化。",
      attachments: [],
      context: {},
      assistantMessageId: "assistant-stale-binding",
      tools: [
        {
          type: "function",
          function: {
            name: "browser_activity_start",
            description: "Start monitoring.",
            parameters: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
          },
        },
      ],
      executeToolCalls: async (calls) => {
        executedCallIds.push(...calls.map((call) => call.id));
        return calls.map((call) => ({
          toolCallId: call.id,
          name: call.name,
          content: JSON.stringify({
            error:
              "STALE_CONTEXT: Tool task binding no longer matches the active browser context (field=conversationId).",
          }),
        }));
      },
      onVisibleContent: () => undefined,
    });

    assert.deepEqual(executedCallIds, ["call-stale-monitor"]);
    assert.equal(requestCount, 2);
    assert.equal(result.status, "blocked");
    assert.match(result.finalContent, /已停止本轮/);
  } finally {
    restore();
  }
});

test("fixed-time waits do not count as repeated semantic observations", async () => {
  const responses = [
    ...Array.from({ length: 3 }, (_, index) => ({
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: `call-time-wait-${index + 1}`,
                type: "function",
                function: {
                  name: "browser_wait_for",
                  arguments: '{"time":2}',
                },
              },
            ],
          },
        },
      ],
    })),
    {
      choices: [
        {
          message: {
            content: "固定等待阶段已完成。",
          },
        },
      ],
    },
  ];
  let requestCount = 0;
  const restore = installBrowserGlobals(
    (index) => responses[index] ?? responses.at(-1)!,
    () => {
      requestCount += 1;
    },
  );
  const executedCallIds: string[] = [];

  try {
    const result = await runAutonomousAgentSession({
      config: {
        ...DEFAULT_AI_CONFIG,
        maxToolRounds: 10,
        autoContinueAfterToolRoundLimit: true,
      },
      messages: [],
      input: "按固定间隔等待页面后台任务。",
      attachments: [],
      context: {},
      assistantMessageId: "assistant-time-waits",
      tools: [
        {
          type: "function",
          function: {
            name: "browser_wait_for",
            description: "Wait for time or page state.",
            parameters: {
              type: "object",
              properties: { time: { type: "number" } },
              additionalProperties: false,
            },
          },
        },
      ],
      executeToolCalls: async (calls) => {
        executedCallIds.push(...calls.map((call) => call.id));
        return calls.map((call) => ({
          toolCallId: call.id,
          name: call.name,
          content: JSON.stringify({
            waited: true,
            reason: "time",
            elapsedMs: 2001,
          }),
        }));
      },
      onVisibleContent: () => undefined,
      onStatusUpdate: () => undefined,
    });

    assert.deepEqual(executedCallIds, [
      "call-time-wait-1",
      "call-time-wait-2",
      "call-time-wait-3",
    ]);
    assert.equal(requestCount, 4);
    assert.equal(result.status, "completed");
    assert.doesNotMatch(result.finalContent, /无进展循环/);
  } finally {
    restore();
  }
});

test("condition waits still stop a repeated cross-round observation loop", async () => {
  const toolResponse = (
    id: string,
    name: string,
    argumentsJson: string,
  ) => ({
    choices: [
      {
        message: {
          content: "",
          tool_calls: [
            {
              id,
              type: "function",
              function: {
                name,
                arguments: argumentsJson,
              },
            },
          ],
        },
      },
    ],
  });
  const responses = [
    toolResponse(
      "call-condition-wait-1",
      "browser_wait_for",
      '{"selector":"#ready"}',
    ),
    toolResponse(
      "call-condition-click-1",
      "browser_click",
      '{"selector":"#refresh"}',
    ),
    toolResponse(
      "call-condition-wait-2",
      "browser_wait_for",
      '{"selector":"#ready"}',
    ),
    toolResponse(
      "call-condition-click-2",
      "browser_click",
      '{"selector":"#refresh"}',
    ),
    toolResponse(
      "call-condition-wait-3",
      "browser_wait_for",
      '{"selector":"#ready"}',
    ),
    {
      choices: [
        {
          message: {
            content: "已停止重复等待，并基于现有结果总结。",
          },
        },
      ],
    },
  ];
  let requestCount = 0;
  const restore = installBrowserGlobals(
    (index) => responses[index] ?? responses.at(-1)!,
    () => {
      requestCount += 1;
    },
  );
  const executedCallIds: string[] = [];

  try {
    const result = await runAutonomousAgentSession({
      config: {
        ...DEFAULT_AI_CONFIG,
        maxToolRounds: 10,
        autoContinueAfterToolRoundLimit: true,
      },
      messages: [],
      input: "等待页面进入 ready 状态。",
      attachments: [],
      context: {},
      assistantMessageId: "assistant-condition-waits",
      tools: [
        {
          type: "function",
          function: {
            name: "browser_wait_for",
            description: "Wait for page state.",
            parameters: {
              type: "object",
              properties: { selector: { type: "string" } },
              additionalProperties: false,
            },
          },
        },
        {
          type: "function",
          function: {
            name: "browser_click",
            description: "Click a page element.",
            parameters: {
              type: "object",
              properties: { selector: { type: "string" } },
              additionalProperties: false,
            },
          },
        },
      ],
      executeToolCalls: async (calls) => {
        executedCallIds.push(...calls.map((call) => call.id));
        return calls.map((call) => ({
          toolCallId: call.id,
          name: call.name,
          content:
            call.name === "browser_wait_for"
              ? JSON.stringify({
                  waited: true,
                  reason: "selector",
                  elapsedMs: 0,
                  selector: "#ready",
                })
              : JSON.stringify({ matched: true, action: "click" }),
        }));
      },
      onVisibleContent: () => undefined,
      onStatusUpdate: () => undefined,
    });

    assert.deepEqual(executedCallIds, [
      "call-condition-wait-1",
      "call-condition-click-1",
      "call-condition-wait-2",
      "call-condition-click-2",
    ]);
    assert.equal(requestCount, 6);
    assert.equal(result.status, "blocked");
    assert.match(result.finalContent, /browser_wait_for/);
    assert.match(result.finalContent, /跨轮无进展循环/);
  } finally {
    restore();
  }
});

test("no-progress detection preserves business fields named updatedAt", async () => {
  const responses = [
    ...Array.from({ length: 3 }, (_, index) => ({
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: `call-changing-${index + 1}`,
                type: "function",
                function: {
                  name: "browser_snapshot",
                  arguments: "{}",
                },
              },
            ],
          },
        },
      ],
    })),
    {
      choices: [{ message: { content: "Observed all three changes." } }],
    },
  ];
  const restore = installBrowserGlobals((index) =>
    responses[index] ?? responses.at(-1)!,
  );
  const executedCallIds: string[] = [];
  let resultIndex = 0;

  try {
    const result = await runAutonomousAgentSession({
      config: {
        ...DEFAULT_AI_CONFIG,
        maxToolRounds: 1,
        autoContinueAfterToolRoundLimit: true,
      },
      messages: [],
      input: "Watch a changing business timestamp.",
      attachments: [],
      context: {},
      assistantMessageId: "assistant-changing-business-field",
      tools: [
        {
          type: "function",
          function: {
            name: "browser_snapshot",
            description: "Read the page.",
            parameters: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
          },
        },
      ],
      executeToolCalls: async (calls) => {
        resultIndex += 1;
        executedCallIds.push(...calls.map((call) => call.id));
        return calls.map((call) => ({
          toolCallId: call.id,
          name: call.name,
          content: JSON.stringify({
            updatedAt: `business-root-${resultIndex}`,
            page: { capturedAt: `capture-${resultIndex}` },
            freshness: { observedAt: `observed-${resultIndex}` },
            data: { updatedAt: `business-${resultIndex}` },
          }),
        }));
      },
      onVisibleContent: () => undefined,
    });

    assert.deepEqual(executedCallIds, [
      "call-changing-1",
      "call-changing-2",
      "call-changing-3",
    ]);
    assert.equal(result.status, "completed");
    assert.match(result.finalContent, /Observed all three changes/);
    assert.doesNotMatch(result.finalContent, /无进展循环/);
  } finally {
    restore();
  }
});

test("context digest heartbeat timestamps do not hide a repeated unsynced-state loop", async () => {
  const responses = [
    ...Array.from({ length: 3 }, (_, index) => ({
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: `call-unsynced-${index + 1}`,
                type: "function",
                function: {
                  name: "browser_get_context_digest",
                  arguments: "{}",
                },
              },
            ],
          },
        },
      ],
    })),
    {
      choices: [
        {
          message: {
            content: "页面上下文尚未同步，已停止重复读取。",
          },
        },
      ],
    },
  ];
  let requestCount = 0;
  let heartbeat = 0;
  const executedCallIds: string[] = [];
  const restore = installBrowserGlobals(
    (index) => responses[index] ?? responses.at(-1)!,
    () => {
      requestCount += 1;
    },
  );

  try {
    const result = await runAutonomousAgentSession({
      config: {
        ...DEFAULT_AI_CONFIG,
        maxToolRounds: 10,
        autoContinueAfterToolRoundLimit: true,
      },
      messages: [],
      input: "读取刚导航后的页面上下文。",
      attachments: [],
      context: {},
      assistantMessageId: "assistant-unsynced-context",
      tools: [
        {
          type: "function",
          function: {
            name: "browser_get_context_digest",
            description: "Read the current context digest.",
            parameters: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
          },
        },
      ],
      executeToolCalls: async (calls) => {
        heartbeat += 1;
        executedCallIds.push(...calls.map((call) => call.id));
        return calls.map((call) => ({
          toolCallId: call.id,
          name: call.name,
          content: JSON.stringify({
            browserConnected: true,
            pluginConnected: true,
            sessionId: "chrome-test-session",
            error: "Browser is connected, but page context has not been synced yet.",
            activeTab: {
              url: "http://localhost:3000/auth/authorize",
              title: "认证中心 - 登录",
              tabId: 7,
            },
            contextDigest: null,
            lastSeenAt: `heartbeat-${heartbeat}`,
            stateUpdatedAt: `state-${heartbeat}`,
            artifactCapturedAt: `artifact-${heartbeat}`,
            updatedAt: `state-${heartbeat}`,
          }),
        }));
      },
      onVisibleContent: () => undefined,
      onStatusUpdate: () => undefined,
    });

    assert.deepEqual(executedCallIds, [
      "call-unsynced-1",
      "call-unsynced-2",
    ]);
    assert.equal(requestCount, 4);
    assert.equal(result.status, "blocked");
    assert.doesNotMatch(result.finalContent, /相同只读工具|无进展循环/);
    assert.match(result.finalContent, /页面上下文尚未同步/);
  } finally {
    restore();
  }
});

test("failed clicks cannot hide a repeated context digest behind nested capture timestamps", async () => {
  const responses = [
    ...Array.from({ length: 3 }, (_, index) => ({
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: `call-invalid-click-${index + 1}`,
                type: "function",
                function: {
                  name: "browser_click",
                  arguments: JSON.stringify({
                    selector: [
                      'a:has-text("Service Account")',
                      "span:contains('Service Account')",
                      "aside a:not-found",
                    ][index],
                  }),
                },
              },
              {
                id: `call-live-digest-${index + 1}`,
                type: "function",
                function: {
                  name: "browser_get_context_digest",
                  arguments: "{}",
                },
              },
            ],
          },
        },
      ],
    })),
    {
      choices: [
        {
          message: {
            content: "重复读取已被拦截，页面未发生有效变化。",
          },
        },
      ],
    },
  ];
  let requestCount = 0;
  let digestIndex = 0;
  const executedCallIds: string[] = [];
  const restore = installBrowserGlobals(
    (index) => responses[index] ?? responses.at(-1)!,
    () => {
      requestCount += 1;
    },
  );

  try {
    const result = await runAutonomousAgentSession({
      config: {
        ...DEFAULT_AI_CONFIG,
        maxToolRounds: 10,
        autoContinueAfterToolRoundLimit: true,
      },
      messages: [],
      input: "重复尝试打开 Service Account 并读取上下文。",
      attachments: [],
      context: {},
      assistantMessageId: "assistant-live-digest-loop",
      tools: [
        {
          type: "function",
          function: {
            name: "browser_click",
            description: "Click a page element.",
            parameters: {
              type: "object",
              properties: { selector: { type: "string" } },
              required: ["selector"],
              additionalProperties: false,
            },
          },
        },
        {
          type: "function",
          function: {
            name: "browser_get_context_digest",
            description: "Read the current context digest.",
            parameters: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
          },
        },
      ],
      executeToolCalls: async (calls) => {
        executedCallIds.push(...calls.map((call) => call.id));
        return calls.map((call) => {
          if (call.name === "browser_click") {
            return {
              toolCallId: call.id,
              name: call.name,
              content: JSON.stringify({
                error:
                  "TOOL_FAILED: Failed to execute 'querySelectorAll' on 'Document': selector is not a valid selector.",
              }),
            };
          }
          digestIndex += 1;
          return {
            toolCallId: call.id,
            name: call.name,
            content: JSON.stringify({
              browserConnected: true,
              pluginConnected: true,
              sessionId: "chrome-live-session",
              activeTab: {
                url: "http://localhost:5333/projects/project-1",
                title: "应用平台",
                targetId: "target-1",
                tabId: 7,
                windowId: 3,
                frameId: 0,
                documentId: "document-1",
                navigationId: "navigation-1",
                revision: 3185,
              },
              contextDigest: {
                version: "page-context-digest-v1",
                generatedAt: `generated-${digestIndex}`,
                page: {
                  url: "http://localhost:5333/projects/project-1",
                  title: "应用平台",
                  origin: "http://localhost:5333",
                  capturedAt: `captured-${digestIndex}`,
                  nodeCount: 42,
                  truncated: false,
                },
                visibleTextExcerpt: "Service Account",
                outline: [],
                interactiveElements: [],
                stats: {
                  sourceVisibleTextChars: 15,
                  sourceDomNodeCount: 42,
                  outlineNodes: 0,
                  interactiveNodes: 0,
                  executionNodes: 0,
                  outputChars: 500,
                  truncated: false,
                },
              },
              lastSeenAt: `heartbeat-${digestIndex}`,
              stateUpdatedAt: `state-${digestIndex}`,
              artifactCapturedAt: `artifact-${digestIndex}`,
              updatedAt: `state-${digestIndex}`,
            }),
          };
        });
      },
      onVisibleContent: () => undefined,
      onStatusUpdate: () => undefined,
    });

    assert.deepEqual(
      executedCallIds.filter((id) => id.startsWith("call-live-digest")),
      ["call-live-digest-1", "call-live-digest-2"],
    );
    assert.deepEqual(
      executedCallIds.filter((id) => id.startsWith("call-invalid-click")),
      [
        "call-invalid-click-1",
        "call-invalid-click-2",
        "call-invalid-click-3",
      ],
    );
    assert.equal(requestCount, 4);
    assert.equal(result.status, "blocked");
    assert.match(result.finalContent, /交替执行中 2 次/);
    assert.match(result.finalContent, /重复读取已被拦截/);
  } finally {
    restore();
  }
});

test("Agent stops an alternating read-only loop when the same observations recur", async () => {
  const toolResponse = (
    id: string,
    name: string,
    argumentsJson: string,
    content: string,
  ) => ({
    choices: [
      {
        message: {
          content,
          tool_calls: [
            {
              id,
              type: "function",
              function: {
                name,
                arguments: argumentsJson,
              },
            },
          ],
        },
      },
    ],
  });
  const responses = [
    toolResponse(
      "call-query-1",
      "browser_query_dom",
      '{"query":"#namespace"}',
      "我先检查命名空间下拉框。",
    ),
    toolResponse(
      "call-wait-1",
      "browser_wait_for",
      '{"selector":"#namespace","state":"visible"}',
      "下拉框仍未变化，我再等待一次。",
    ),
    toolResponse(
      "call-query-2",
      "browser_query_dom",
      '{"query":"#namespace"}',
      "我重新检查同一个下拉框。",
    ),
    toolResponse(
      "call-wait-2",
      "browser_wait_for",
      '{"selector":"#namespace","state":"visible"}',
      "页面仍未变化，我继续等待。",
    ),
    toolResponse(
      "call-query-3",
      "browser_query_dom",
      '{"query":"#namespace"}',
      "我第三次检查同一个下拉框。",
    ),
    {
      choices: [
        {
          message: {
            content: "已停止无进展操作；当前下拉框仍没有可用选项。",
          },
        },
      ],
    },
  ];
  let requestCount = 0;
  const restore = installBrowserGlobals(
    (index) => responses[index] ?? responses.at(-1)!,
    () => {
      requestCount += 1;
    },
  );
  const executedCallIds: string[] = [];

  try {
    const result = await runAutonomousAgentSession({
      config: {
        ...DEFAULT_AI_CONFIG,
        maxToolRounds: 1,
        autoContinueAfterToolRoundLimit: true,
      },
      messages: [],
      input: "选择一个可用的 Service Account。",
      attachments: [],
      context: {},
      assistantMessageId: "assistant-alternating-no-progress",
      tools: [
        {
          type: "function",
          function: {
            name: "browser_query_dom",
            description: "Query the DOM.",
            parameters: {
              type: "object",
              properties: { query: { type: "string" } },
              required: ["query"],
              additionalProperties: false,
            },
          },
        },
        {
          type: "function",
          function: {
            name: "browser_wait_for",
            description: "Wait for an element state.",
            parameters: {
              type: "object",
              properties: {
                selector: { type: "string" },
                state: { type: "string" },
              },
              required: ["selector", "state"],
              additionalProperties: false,
            },
          },
        },
      ],
      executeToolCalls: async (calls) => {
        executedCallIds.push(...calls.map((call) => call.id));
        return calls.map((call) => ({
          toolCallId: call.id,
          name: call.name,
          content:
            call.name === "browser_query_dom"
              ? JSON.stringify({ count: 0, returnedCount: 0, matches: [] })
              : JSON.stringify({ matched: true, state: "visible" }),
        }));
      },
      onVisibleContent: () => undefined,
      onStatusUpdate: () => undefined,
    });

    assert.deepEqual(executedCallIds, [
      "call-query-1",
      "call-wait-1",
      "call-query-2",
      "call-wait-2",
    ]);
    assert.equal(requestCount, 6);
    assert.equal(result.status, "blocked");
    assert.match(result.finalContent, /跨轮无进展循环/);
    assert.match(result.finalContent, /已停止无进展操作/);
    assert.doesNotMatch(result.finalContent, /我第三次检查/);
  } finally {
    restore();
  }
});

test("tool-call narration is transient and is not committed to the final reply", async () => {
  const responses = [
    {
      choices: [
        {
          message: {
            content: "我先读取页面，再根据结果回答。",
            tool_calls: [
              {
                id: "call-transient-query",
                type: "function",
                function: {
                  name: "browser_query_dom",
                  arguments: '{"query":"main"}',
                },
              },
            ],
          },
        },
      ],
    },
    {
      choices: [
        {
          message: {
            content: "最终结论：页面主区域可用。",
          },
        },
      ],
    },
  ];
  const restore = installBrowserGlobals((index) =>
    responses[index] ?? responses.at(-1)!,
  );
  const visibleUpdates: string[] = [];

  try {
    const result = await runAutonomousAgentSession({
      config: { ...DEFAULT_AI_CONFIG, maxToolRounds: 3 },
      messages: [],
      input: "检查页面主区域。",
      attachments: [],
      context: {},
      assistantMessageId: "assistant-transient-narration",
      tools: [
        {
          type: "function",
          function: {
            name: "browser_query_dom",
            description: "Query the DOM.",
            parameters: {
              type: "object",
              properties: { query: { type: "string" } },
              required: ["query"],
              additionalProperties: false,
            },
          },
        },
      ],
      executeToolCalls: async (calls) =>
        calls.map((call) => ({
          toolCallId: call.id,
          name: call.name,
          content: JSON.stringify({ count: 1, returnedCount: 1 }),
        })),
      onVisibleContent: (content) => visibleUpdates.push(content),
      onStatusUpdate: () => undefined,
    });

    assert.equal(result.status, "completed");
    assert.equal(result.finalContent, "最终结论：页面主区域可用。");
    assert.equal(visibleUpdates.at(-1), "最终结论：页面主区域可用。");
    assert.ok(
      visibleUpdates.every(
        (content) => !content.includes("我先读取页面，再根据结果回答。"),
      ),
    );
  } finally {
    restore();
  }
});

test("marker-only completion after tools is blocked with a visible fallback", async () => {
  const markerOnly =
    '<|tool_calls_section_begin|><|tool_call_begin|>functions.browser_query_dom:0\n<|tool_call_argument_begin|>{"query":"#trusted-result"}<|tool_call_end|><|tool_calls_section_end|>';
  const responses = [
    {
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: "call-marker-only-query",
                type: "function",
                function: {
                  name: "browser_query_dom",
                  arguments: '{"query":"#trusted-result"}',
                },
              },
            ],
          },
        },
      ],
    },
    { choices: [{ message: { content: markerOnly } }] },
    { choices: [{ message: { content: markerOnly } }] },
  ];
  const restore = installBrowserGlobals((index) =>
    responses[index] ?? responses.at(-1)!,
  );
  const visibleUpdates: string[] = [];

  try {
    const result = await runAutonomousAgentSession({
      config: { ...DEFAULT_AI_CONFIG, maxToolRounds: 3 },
      messages: [],
      input: "读取可信点击结果。",
      attachments: [],
      context: {},
      assistantMessageId: "assistant-marker-only-final",
      tools: [
        {
          type: "function",
          function: {
            name: "browser_query_dom",
            description: "Query the DOM.",
            parameters: {
              type: "object",
              properties: { query: { type: "string" } },
              required: ["query"],
              additionalProperties: false,
            },
          },
        },
      ],
      executeToolCalls: async (calls) =>
        calls.map((call) => ({
          toolCallId: call.id,
          name: call.name,
          content: JSON.stringify({ count: 1, text: "trusted" }),
        })),
      onVisibleContent: (content) => visibleUpdates.push(content),
      onStatusUpdate: () => undefined,
    });

    assert.equal(result.status, "blocked");
    assert.match(result.finalContent, /AI 未返回可显示的最终内容/);
    assert.equal(visibleUpdates.at(-1), result.finalContent);
    assert.ok(visibleUpdates.every((content) => !content.includes("<|tool_")));
  } finally {
    restore();
  }
});

test("Agent rewrites a missing report body after tools without executing another tool", async () => {
  const responses = [
    {
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: "call-k8s-status",
                type: "function",
                function: {
                  name: "browser_status",
                  arguments: "{}",
                },
              },
            ],
          },
        },
      ],
    },
    {
      choices: [
        {
          message: {
            content:
              "Kubernetes 服务状态报告已完整生成，节点、Pod 和异常 Deployment 均已验证。报告如上所示。",
          },
        },
      ],
    },
    {
      choices: [
        {
          message: {
            content:
              "## Kubernetes 状态报告\n\n| 维度 | 状态 |\n| --- | --- |\n| 节点 | 8 个 Ready |\n| Pod | 26 个 Failed |\n\n覆盖范围：Prometheus test。",
          },
        },
      ],
    },
  ];
  let requestCount = 0;
  let toolExecutionCount = 0;
  const restore = installBrowserGlobals(
    (index) => responses[index] ?? responses.at(-1)!,
    () => {
      requestCount += 1;
    },
  );

  try {
    const result = await runAutonomousAgentSession({
      config: { ...DEFAULT_AI_CONFIG, maxToolRounds: 3 },
      messages: [],
      input:
        "生成 Kubernetes 服务状态报告，包含节点、Pod 和异常 Deployment。",
      attachments: [],
      context: {},
      assistantMessageId: "assistant-report-rewrite",
      tools: [
        {
          type: "function",
          function: {
            name: "browser_status",
            description: "Read browser status.",
            parameters: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
          },
        },
      ],
      executeToolCalls: async (calls) => {
        toolExecutionCount += calls.length;
        return calls.map((call) => ({
          toolCallId: call.id,
          name: call.name,
          content: JSON.stringify({
            source: "prometheus-infra-0",
            environment: "test",
            readyNodes: 8,
            failedPods: 26,
          }),
        }));
      },
      onVisibleContent: () => undefined,
      onStatusUpdate: () => undefined,
    });

    assert.equal(requestCount, 3);
    assert.equal(toolExecutionCount, 1);
    assert.equal(result.status, "completed");
    assert.match(result.finalContent, /## Kubernetes 状态报告/);
    assert.match(result.finalContent, /26 个 Failed/);
    assert.doesNotMatch(result.finalContent, /报告如上所示/);
  } finally {
    restore();
  }
});

test("external MCP results do not trigger current-page browser verification", async () => {
  const externalToolName =
    "extmcp__mcp_prometheus_inf__prometheus_query_0ed7db8";
  const responses = [
    {
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: "call-prometheus-status",
                type: "function",
                function: {
                  name: externalToolName,
                  arguments: '{"query":"up"}',
                },
              },
            ],
          },
        },
      ],
    },
    {
      choices: [
        {
          message: {
            content:
              "## Prometheus 状态\n\n数据源返回 8 个目标均为 up。\n\n你希望继续查看哪一项？",
          },
        },
      ],
    },
  ];
  let requestCount = 0;
  const requestBodies: Record<string, unknown>[] = [];
  const restore = installBrowserGlobals(
    (index) => responses[index] ?? responses.at(-1)!,
    () => {
      requestCount += 1;
    },
    (body) => requestBodies.push(body),
  );
  const executedTools: string[] = [];

  try {
    const result = await runAutonomousAgentSession({
      config: { ...DEFAULT_AI_CONFIG, maxToolRounds: 4 },
      messages: [],
      input: "查询 Prometheus 当前健康状态。",
      attachments: [],
      context: {},
      assistantMessageId: "assistant-external-mcp-report",
      tools: [
        {
          type: "function",
          function: {
            name: externalToolName,
            description: "Query Prometheus.",
            parameters: {
              type: "object",
              properties: { query: { type: "string" } },
              required: ["query"],
              additionalProperties: false,
            },
          },
        },
      ],
      executeToolCalls: async (calls) => {
        executedTools.push(...calls.map((call) => call.name));
        return calls.map((call) => ({
          toolCallId: call.id,
          name: call.name,
          content: JSON.stringify({ source: "prometheus-infra-0", up: 8 }),
        }));
      },
      onVisibleContent: () => undefined,
      onStatusUpdate: () => undefined,
    });

    assert.equal(requestCount, 2);
    assert.deepEqual(executedTools, [externalToolName]);
    assert.equal(result.status, "completed");
    assert.equal(result.session.taskState.verification.required, false);
    assert.match(
      JSON.stringify(requestBodies[0]),
      /Never call browser_verify to validate an external MCP query/,
    );
    assert.doesNotMatch(
      result.session.events.map((event) => event.summary).join("\n"),
      /修改后的页面尚未验证|browser_verify/,
    );
  } finally {
    restore();
  }
});

test("structured memory continues a delegated external MCP decision without reading the current page", async () => {
  const externalToolName =
    "extmcp__mcp_prometheus_inf__prometheus_query_0ed7db8";
  const responses = [
    {
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: "call-node-metrics",
                type: "function",
                function: {
                  name: externalToolName,
                  arguments:
                    '{"query":"node_filesystem_avail_bytes{instance=\\"rs-compute1\\"}"}',
                },
              },
            ],
          },
        },
      ],
    },
    {
      choices: [
        {
          message: {
            content: "已按推荐项继续查询 rs-compute1 节点磁盘指标。",
          },
        },
      ],
    },
  ];
  const requestBodies: Record<string, unknown>[] = [];
  const restore = installBrowserGlobals(
    (index) => responses[index] ?? responses.at(-1)!,
    () => undefined,
    (body) => requestBodies.push(body),
  );
  const executedTools: string[] = [];
  try {
    const result = await runAutonomousAgentSession({
      config: { ...DEFAULT_AI_CONFIG, maxToolRounds: 4 },
      messages: [
        {
          id: "previous-user",
          role: "user",
          content: "排查 fluent-bit-jmz5k SIGBUS",
          createdAt: "2026-08-06T10:00:00.000Z",
        },
        {
          id: "previous-assistant",
          role: "assistant",
          content: "可以查询节点磁盘指标或对比正常节点。要继续哪个？",
          createdAt: "2026-08-06T10:01:00.000Z",
        },
      ],
      input: "你自己决定",
      attachments: [],
      context: {
        memory: {
          version: "conversation-memory-v1",
          revision: 2,
          activeTask: {
            id: "task-fluent-bit",
            objective: "排查 fluent-bit-jmz5k SIGBUS",
            status: "waiting",
            affinity: "external_mcp",
            successCriteria: ["确认根因"],
            entities: ["fluent-bit-jmz5k", "rs-compute1"],
            nextActions: ["查询节点磁盘指标"],
            blockers: [],
            provenance: {
              messageIds: ["previous-user", "previous-assistant"],
              toolCallIds: [],
            },
            updatedAt: "2026-08-06T10:01:00.000Z",
          },
          pendingDecisions: [
            {
              id: "decision-next",
              question: "继续哪个检查？",
              options: [
                {
                  id: "node-metrics",
                  label: "查询节点磁盘指标",
                  recommended: true,
                },
              ],
              status: "pending",
              provenance: {
                messageIds: ["previous-assistant"],
                toolCallIds: [],
              },
              updatedAt: "2026-08-06T10:01:00.000Z",
            },
          ],
          constraints: [],
          facts: [],
          turnSummaries: [],
          updatedAt: "2026-08-06T10:01:00.000Z",
        },
        pageSnapshot: {
          url: "https://enterprise.example/dns",
          title: "DNS 管理",
          origin: "https://enterprise.example",
          capturedAt: "2026-08-06T10:02:00.000Z",
          visibleText: "DNS 管理 添加记录",
          domSummary: [],
          nodeCount: 2,
          truncated: false,
        },
      },
      assistantMessageId: "assistant-memory-follow-up",
      tools: [
        {
          type: "function",
          function: {
            name: externalToolName,
            description: "Query Prometheus node and pod metrics.",
            parameters: { type: "object", properties: {} },
          },
          clientMetadata: { source: "external_mcp" },
        },
        {
          type: "function",
          function: {
            name: "browser_observe",
            description: "Read the current page.",
            parameters: { type: "object", properties: {} },
          },
          clientMetadata: { source: "builtin" },
        },
      ],
      executeToolCalls: async (calls) => {
        executedTools.push(...calls.map((call) => call.name));
        return calls.map((call) => ({
          toolCallId: call.id,
          name: call.name,
          content: JSON.stringify({ series: [] }),
        }));
      },
      onVisibleContent: () => undefined,
    });

    assert.deepEqual(executedTools, [externalToolName]);
    assert.equal(result.session.taskState.objective, "排查 fluent-bit-jmz5k SIGBUS");
    const serialized = JSON.stringify(requestBodies[0]);
    assert.match(serialized, /CONVERSATION_MEMORY/);
    assert.doesNotMatch(serialized, /DNS 管理/);
  } finally {
    restore();
  }
});

test("an explicit new page objective overrides remembered external MCP work", async () => {
  const responses = [
    {
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: "call-dns-observe",
                type: "function",
                function: { name: "browser_observe", arguments: "{}" },
              },
            ],
          },
        },
      ],
    },
    {
      choices: [{ message: { content: "已切换为检查当前 DNS 页面。" } }],
    },
  ];
  const restore = installBrowserGlobals(
    (index) => responses[index] ?? responses.at(-1)!,
    () => undefined,
  );
  const executedTools: string[] = [];
  try {
    await runAutonomousAgentSession({
      config: { ...DEFAULT_AI_CONFIG, maxToolRounds: 4 },
      messages: [],
      input: "改为检查当前 DNS 页面",
      attachments: [],
      context: {
        memory: {
          version: "conversation-memory-v1",
          revision: 2,
          activeTask: {
            id: "task-fluent-bit",
            objective: "排查 fluent-bit SIGBUS",
            status: "waiting",
            affinity: "external_mcp",
            successCriteria: [],
            entities: ["fluent-bit"],
            nextActions: ["查询节点指标"],
            blockers: [],
            provenance: { messageIds: ["old-user"], toolCallIds: [] },
            updatedAt: "2026-08-06T10:00:00.000Z",
          },
          pendingDecisions: [],
          constraints: [],
          facts: [],
          turnSummaries: [],
          updatedAt: "2026-08-06T10:00:00.000Z",
        },
      },
      assistantMessageId: "assistant-new-page-task",
      tools: [
        {
          type: "function",
          function: {
            name: "browser_observe",
            description: "Observe the current DNS page.",
            parameters: { type: "object", properties: {} },
          },
          clientMetadata: { source: "builtin" },
        },
        {
          type: "function",
          function: {
            name: "external_prometheus_query",
            description: "Query old fluent-bit metrics.",
            parameters: { type: "object", properties: {} },
          },
          clientMetadata: { source: "external_mcp" },
        },
        ...Array.from({ length: 40 }, (_, index) => ({
          type: "function" as const,
          function: {
            name: `external_unrelated_${index}`,
            description: `Old external diagnostic capability ${index} ${"schema ".repeat(220)}`,
            parameters: { type: "object", properties: {} },
          },
          clientMetadata: { source: "external_mcp" as const },
        })),
      ],
      executeToolCalls: async (calls) => {
        executedTools.push(...calls.map((call) => call.name));
        return calls.map((call) => ({
          toolCallId: call.id,
          name: call.name,
          content: JSON.stringify({ title: "DNS 管理" }),
        }));
      },
      onVisibleContent: () => undefined,
    });

    assert.deepEqual(executedTools, ["browser_observe"]);
  } finally {
    restore();
  }
});

test("Agent continues when an external MCP diagnosis ends with a promised next inspection", async () => {
  const podToolName = "extmcp__k8s_dev__pods_get_a1b2c3";
  const logToolName = "extmcp__k8s_dev__pods_log_d4e5f6";
  const responses = [
    {
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: "call-pod-detail",
                type: "function",
                function: {
                  name: podToolName,
                  arguments:
                    '{"namespace":"ob","name":"fluent-bit-jmz5k"}',
                },
              },
            ],
          },
        },
      ],
    },
    {
      choices: [
        {
          message: {
            content:
              "已定位异常 Pod：fluent-bit-jmz5k，事件显示 readiness probe failed。现在查看该 Pod 的详细状态和容器日志：",
          },
        },
      ],
    },
    {
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: "call-pod-log",
                type: "function",
                function: {
                  name: logToolName,
                  arguments:
                    '{"namespace":"ob","name":"fluent-bit-jmz5k","tail":200}',
                },
              },
            ],
          },
        },
      ],
    },
    {
      choices: [
        {
          message: {
            content:
              "根因已确认：fluent-bit 容器无法连接上游服务，导致健康检查持续失败并触发重启退避。",
          },
        },
      ],
    },
  ];
  const requestBodies: Record<string, unknown>[] = [];
  const restore = installBrowserGlobals(
    (index) => responses[index] ?? responses.at(-1)!,
    () => undefined,
    (body) => requestBodies.push(body),
  );
  const executedTools: string[] = [];

  try {
    const result = await runAutonomousAgentSession({
      config: { ...DEFAULT_AI_CONFIG, maxToolRounds: 6 },
      messages: [],
      input: "定位这个异常 Pod 的具体原因。",
      attachments: [],
      context: {},
      assistantMessageId: "assistant-external-promised-inspection",
      tools: [
        {
          type: "function",
          function: {
            name: podToolName,
            description: "Read one Kubernetes Pod.",
            parameters: {
              type: "object",
              properties: {
                namespace: { type: "string" },
                name: { type: "string" },
              },
              required: ["namespace", "name"],
              additionalProperties: false,
            },
          },
        },
        {
          type: "function",
          function: {
            name: logToolName,
            description: "Read Kubernetes Pod logs.",
            parameters: {
              type: "object",
              properties: {
                namespace: { type: "string" },
                name: { type: "string" },
                tail: { type: "number" },
              },
              required: ["namespace", "name"],
              additionalProperties: false,
            },
          },
        },
      ],
      executeToolCalls: async (calls) => {
        executedTools.push(...calls.map((call) => call.name));
        return calls.map((call) => ({
          toolCallId: call.id,
          name: call.name,
          content:
            call.name === podToolName
              ? '{"phase":"Running","ready":false}'
              : '{"logs":"connect upstream: connection refused"}',
        }));
      },
      onVisibleContent: () => undefined,
      onStatusUpdate: () => undefined,
    });

    assert.deepEqual(executedTools, [podToolName, logToolName]);
    assert.equal(result.status, "completed");
    assert.match(result.finalContent, /根因已确认/);
    assert.match(JSON.stringify(requestBodies[2]), /"tool_choice":"required"/);
  } finally {
    restore();
  }
});

test("built-in browser_observe duplicate read is blocked before a second execution", async () => {
  const responses = [
    ...Array.from({ length: 2 }, (_, index) => ({
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: `call-browser-observe-${index + 1}`,
                type: "function",
                function: {
                  name: "browser_observe",
                  arguments: '{"mode":"interactive","limit":40}',
                },
              },
            ],
          },
        },
      ],
    })),
    {
      choices: [
        {
          message: {
            content: "已基于第一次页面快照完成总结。",
          },
        },
      ],
    },
  ];
  let requestCount = 0;
  const restore = installBrowserGlobals(
    (index) => responses[index] ?? responses.at(-1)!,
    () => {
      requestCount += 1;
    },
  );
  const executedCallIds: string[] = [];

  try {
    const result = await runAutonomousAgentSession({
      config: {
        ...DEFAULT_AI_CONFIG,
        maxToolRounds: 1,
        autoContinueAfterToolRoundLimit: true,
      },
      messages: [],
      input: "读取当前页面并总结。",
      attachments: [],
      context: {},
      assistantMessageId: "assistant-browser-observe-repeat",
      tools: [
        {
          type: "function",
          function: {
            name: "browser_observe",
            description: "Observe the current page.",
            parameters: {
              type: "object",
              properties: {
                mode: { type: "string" },
                limit: { type: "number" },
              },
              additionalProperties: false,
            },
          },
        },
      ],
      executeToolCalls: async (calls) => {
        executedCallIds.push(...calls.map((call) => call.id));
        return calls.map((call) => ({
          toolCallId: call.id,
          name: call.name,
          content: JSON.stringify({
            page: { url: "https://example.test/" },
            freshness: { revision: 7 },
            snapshot: {
              fingerprint: "f50667fb",
              nodes: [{ role: "button", name: "Submit" }],
            },
          }),
        }));
      },
      onVisibleContent: () => undefined,
    });

    assert.deepEqual(executedCallIds, ["call-browser-observe-1"]);
    assert.equal(requestCount, 3);
    assert.equal(result.status, "completed");
    assert.match(result.finalContent, /第一次页面快照/);
    assert.doesNotMatch(result.finalContent, /DUPLICATE_READ_ONLY_CALL/);
  } finally {
    restore();
  }
});

test("external MCP duplicate read is blocked before a second execution", async () => {
  const externalToolName =
    "extmcp__mcp_prometheus_inf__prometheus_query_0ed7db8";
  const responses = [
    ...Array.from({ length: 2 }, (_, index) => ({
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: `call-external-repeat-${index + 1}`,
                type: "function",
                function: {
                  name: externalToolName,
                  arguments: '{"query":"up"}',
                },
              },
            ],
          },
        },
      ],
    })),
    {
      choices: [
        {
          message: {
            content: "已根据两次相同的 MCP 证据停止重复查询。",
          },
        },
      ],
    },
  ];
  let requestCount = 0;
  const restore = installBrowserGlobals(
    (index) => responses[index] ?? responses.at(-1)!,
    () => {
      requestCount += 1;
    },
  );
  const executedCallIds: string[] = [];
  let executionCount = 0;
  let budgetExtensionRequests = 0;

  try {
    const result = await runAutonomousAgentSession({
      config: {
        ...DEFAULT_AI_CONFIG,
        maxToolRounds: 1,
        autoContinueAfterToolRoundLimit: true,
      },
      messages: [],
      input: "查询 Prometheus 健康状态。",
      attachments: [],
      context: {},
      assistantMessageId: "assistant-external-repeat",
      tools: [
        {
          ...externalReadOnlyToolDefinition(externalToolName),
          clientMetadata: {
            source: "external_mcp",
            displayName: "prometheus_query",
            externalMcpServerId: "mcp_prometheus_inf",
            externalMcpServerName: "Prometheus Infra MCP",
            externalMcpToolName: "prometheus_query",
          },
        },
      ],
      runBudgetLimits: {
        maxToolCalls: 2,
        maxEffectfulToolCalls: 2,
        maxSensitiveToolCalls: 2,
      },
      requestBudgetExtension: async () => {
        budgetExtensionRequests += 1;
        return "continue";
      },
      executeToolCalls: async (calls) => {
        executionCount += 1;
        executedCallIds.push(...calls.map((call) => call.id));
        return calls.map((call) => ({
          toolCallId: call.id,
          name: call.name,
          content: JSON.stringify({
            content: [],
            structuredContent: {
              source: {
                source_id: "prometheus-infra-0",
                environment: "test",
              },
              observed_at: `2026-08-05T03:00:0${executionCount}Z`,
              evidence_ref: `prometheus://prometheus-infra-0/query/${executionCount}`,
              quality_status: "ok",
              result_type: "vector",
              series_count: 1,
              data: [
                {
                  metric: {},
                  value: [1_785_983_450 + executionCount, "12"],
                },
              ],
            },
          }),
        }));
      },
      onVisibleContent: () => undefined,
    });

    assert.deepEqual(executedCallIds, ["call-external-repeat-1"]);
    assert.equal(budgetExtensionRequests, 0);
    assert.equal(requestCount, 3);
    assert.equal(result.status, "completed");
    assert.match(result.finalContent, /停止重复查询/);
    assert.doesNotMatch(result.finalContent, /DUPLICATE_READ_ONLY_CALL/);
  } finally {
    restore();
  }
});

test("external MCP observation loop protection preserves changed Prometheus values", async () => {
  const externalToolName =
    "extmcp__mcp_prometheus_inf__prometheus_query_0ed7db8";
  const responses = [
    ...Array.from({ length: 3 }, (_, index) => ({
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: `call-external-progress-${index + 1}`,
                type: "function",
                function: {
                  name: externalToolName,
                  arguments: '{"query":"up"}',
                },
              },
            ],
          },
        },
      ],
    })),
    {
      choices: [
        {
          message: {
            content: "Prometheus 指标连续变化，已完成三次采样。",
          },
        },
      ],
    },
  ];
  const restore = installBrowserGlobals(
    (index) => responses[index] ?? responses.at(-1)!,
    () => undefined,
  );
  const executedCallIds: string[] = [];

  try {
    const result = await runAutonomousAgentSession({
      config: {
        ...DEFAULT_AI_CONFIG,
        maxToolRounds: 1,
        autoContinueAfterToolRoundLimit: true,
      },
      messages: [],
      input: "连续采样 Prometheus 指标，直到值发生变化。",
      attachments: [],
      context: {},
      assistantMessageId: "assistant-external-progress",
      tools: [externalReadOnlyToolDefinition(externalToolName)],
      executeToolCalls: async (calls) => {
        const sampleNumber = executedCallIds.length + 1;
        executedCallIds.push(...calls.map((call) => call.id));
        return calls.map((call) => ({
          toolCallId: call.id,
          name: call.name,
          content: JSON.stringify({
            structuredContent: {
              observed_at: `2026-08-05T03:01:0${sampleNumber}Z`,
              evidence_ref: `prometheus://prometheus-infra-0/query/${sampleNumber}`,
              result_type: "vector",
              data: [
                {
                  metric: { instance: "prometheus-infra-0" },
                  value: [1_785_983_500 + sampleNumber, String(sampleNumber)],
                },
              ],
            },
          }),
        }));
      },
      onVisibleContent: () => undefined,
    });

    assert.deepEqual(executedCallIds, [
      "call-external-progress-1",
      "call-external-progress-2",
      "call-external-progress-3",
    ]);
    assert.equal(result.status, "completed");
    assert.match(result.finalContent, /连续变化/);
  } finally {
    restore();
  }
});

test("external MCP distinct evidence calls are not stopped by an arbitrary per-tool limit", async () => {
  const externalToolName =
    "extmcp__mcp_prometheus_inf__prometheus_query_0ed7db8";
  const callCount = 15;
  const responses = [
    ...Array.from({ length: callCount }, (_, index) => ({
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: `call-external-distinct-${index + 1}`,
                type: "function",
                function: {
                  name: externalToolName,
                  arguments: JSON.stringify({ query: `metric_${index + 1}` }),
                },
              },
            ],
          },
        },
      ],
    })),
    {
      choices: [
        {
          message: {
            content: "15 项不同证据均已按用户要求完成采集。",
          },
        },
      ],
    },
  ];
  const restore = installBrowserGlobals(
    (index) => responses[index] ?? responses.at(-1)!,
    () => undefined,
  );
  const executedCallIds: string[] = [];

  try {
    const result = await runAutonomousAgentSession({
      config: { ...DEFAULT_AI_CONFIG, maxToolRounds: 20 },
      messages: [],
      input: "依次采集这 15 项明确且不同的指标。",
      attachments: [],
      context: {},
      assistantMessageId: "assistant-external-distinct",
      tools: [externalReadOnlyToolDefinition(externalToolName)],
      runBudgetLimits: {
        maxToolCalls: 20,
        maxEffectfulToolCalls: 1,
        maxSensitiveToolCalls: 1,
      },
      executeToolCalls: async (calls) => {
        executedCallIds.push(...calls.map((call) => call.id));
        return calls.map((call) => ({
          toolCallId: call.id,
          name: call.name,
          content: JSON.stringify({
            query: call.arguments.query,
            value: executedCallIds.length,
          }),
        }));
      },
      onVisibleContent: () => undefined,
    });

    assert.equal(executedCallIds.length, callCount);
    assert.equal(result.status, "completed");
    assert.match(result.finalContent, /15 项不同证据/);
  } finally {
    restore();
  }
});

function externalReadOnlyToolDefinition(name: string) {
  return {
    type: "function" as const,
    function: {
      name,
      description: "Query Prometheus.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
        additionalProperties: false,
      },
    },
    clientMetadata: {
      source: "external_mcp" as const,
      displayName: "prometheus_query",
      externalMcpServerId: "mcp_prometheus_inf",
      externalMcpServerName: "Prometheus Infra MCP",
      externalMcpToolName: "prometheus_query",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
  };
}

test("automatic MCP mode blocks browser_verify after an external-only query", async () => {
  const externalToolName =
    "extmcp__mcp_prometheus_inf__prometheus_query_0ed7db8";
  const responses = [
    {
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: "call-prometheus-status-auto",
                type: "function",
                function: {
                  name: externalToolName,
                  arguments: '{"query":"up"}',
                },
              },
            ],
          },
        },
      ],
    },
    {
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: "call-unrelated-browser-verify",
                type: "function",
                function: {
                  name: "browser_verify",
                  arguments: '{"checks":[]}',
                },
              },
            ],
          },
        },
      ],
    },
    {
      choices: [
        {
          message: {
            content:
              "## Prometheus 状态\n\n数据源返回 8 个目标均为 up。\n\n你希望继续查看哪一项？",
          },
        },
      ],
    },
  ];
  const requestBodies: Record<string, unknown>[] = [];
  const restore = installBrowserGlobals(
    (index) => responses[index] ?? responses.at(-1)!,
    () => undefined,
    (body) => requestBodies.push(body),
  );
  const executedTools: string[] = [];

  try {
    const result = await runAutonomousAgentSession({
      config: { ...DEFAULT_AI_CONFIG, maxToolRounds: 4 },
      messages: [],
      input: "自动选择合适的 MCP，查询 Prometheus 当前健康状态。",
      attachments: [],
      context: {},
      assistantMessageId: "assistant-auto-external-mcp-report",
      tools: [
        {
          type: "function",
          function: {
            name: externalToolName,
            description: "Query Prometheus.",
            parameters: {
              type: "object",
              properties: { query: { type: "string" } },
              required: ["query"],
              additionalProperties: false,
            },
          },
        },
        {
          type: "function",
          function: {
            name: "browser_verify",
            description: "Verify a current-page mutation.",
            parameters: {
              type: "object",
              properties: { checks: { type: "array" } },
              required: ["checks"],
              additionalProperties: false,
            },
          },
        },
      ],
      executeToolCalls: async (calls) => {
        executedTools.push(...calls.map((call) => call.name));
        return calls.map((call) => ({
          toolCallId: call.id,
          name: call.name,
          content: JSON.stringify({ source: "prometheus-infra-0", up: 8 }),
        }));
      },
      onVisibleContent: () => undefined,
      onStatusUpdate: () => undefined,
    });

    assert.deepEqual(executedTools, [externalToolName]);
    assert.equal(result.status, "completed");
    assert.match(result.finalContent, /8 个目标均为 up/);
    assert.match(
      JSON.stringify(requestBodies.at(-1)),
      /UNRELATED_BROWSER_VERIFICATION/,
    );
  } finally {
    restore();
  }
});

test("Agent blocks browser_verify when no browser mutation requires verification", async () => {
  const responses = [
    {
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: "call-read-only-snapshot",
                type: "function",
                function: {
                  name: "browser_snapshot",
                  arguments: "{}",
                },
              },
            ],
          },
        },
      ],
    },
    {
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: "call-unneeded-browser-verify",
                type: "function",
                function: {
                  name: "browser_verify",
                  arguments:
                    '{"checks":[{"id":"usage","type":"text_contains","value":"用量"}]}',
                },
              },
            ],
          },
        },
      ],
    },
    {
      choices: [
        {
          message: {
            content: "页面只读检查已完成，没有执行任何页面修改。",
          },
        },
      ],
    },
  ];
  const requestBodies: Record<string, unknown>[] = [];
  const restore = installBrowserGlobals(
    (index) => responses[index] ?? responses.at(-1)!,
    () => undefined,
    (body) => requestBodies.push(body),
  );
  const executedTools: string[] = [];

  try {
    const result = await runAutonomousAgentSession({
      config: { ...DEFAULT_AI_CONFIG, maxToolRounds: 4 },
      messages: [],
      input: "检查当前页面为什么没有用量数据，不要修改页面。",
      attachments: [],
      context: {},
      assistantMessageId: "assistant-read-only-browser-investigation",
      tools: [
        {
          type: "function",
          function: {
            name: "browser_snapshot",
            description: "Read the current page.",
            parameters: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
          },
        },
        {
          type: "function",
          function: {
            name: "browser_verify",
            description: "Verify a current-page mutation.",
            parameters: {
              type: "object",
              properties: {
                checks: {
                  type: "array",
                  items: { type: "object" },
                },
              },
              required: ["checks"],
              additionalProperties: false,
            },
          },
        },
      ],
      executeToolCalls: async (calls) => {
        executedTools.push(...calls.map((call) => call.name));
        return calls.map((call) => ({
          toolCallId: call.id,
          name: call.name,
          content: JSON.stringify({
            page: { title: "DeepSeek 开放平台" },
            snapshot: { nodes: [{ role: "heading", name: "用量" }] },
          }),
        }));
      },
      onVisibleContent: () => undefined,
      onStatusUpdate: () => undefined,
    });

    assert.deepEqual(executedTools, ["browser_snapshot"]);
    assert.equal(result.status, "completed");
    assert.match(result.finalContent, /没有执行任何页面修改/);
    assert.match(
      JSON.stringify(requestBodies.at(-1)),
      /BROWSER_VERIFICATION_NOT_REQUIRED/,
    );
  } finally {
    restore();
  }
});

test("Agent cannot switch a bound task to another browser tab", async () => {
  const responses = [
    {
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: "call-cross-tab-switch",
                type: "function",
                function: {
                  name: "browser_set_target_tab",
                  arguments: '{"tabId":22}',
                },
              },
            ],
          },
        },
      ],
    },
    {
      choices: [
        {
          message: {
            content:
              "当前任务固定在原 Tab。请先由用户选择改绑当前 Tab 或创建新对话。",
          },
        },
      ],
    },
  ];
  const requestBodies: Record<string, unknown>[] = [];
  const restore = installBrowserGlobals(
    (index) => responses[index] ?? responses.at(-1)!,
    () => undefined,
    (body) => requestBodies.push(body),
  );
  const executedTools: string[] = [];

  try {
    const result = await runAutonomousAgentSession({
      config: { ...DEFAULT_AI_CONFIG, maxToolRounds: 4 },
      messages: [],
      input: "切换到我当前正在看的 Tab 并监听路由变化。",
      attachments: [],
      context: {},
      assistantMessageId: "assistant-cross-tab-switch",
      executionBinding: {
        taskId: "task-bound-tab-11",
        conversationId: "conversation-bound-tab-11",
        target: {
          tabId: 11,
          targetId: "11",
          title: "原页面",
          url: "https://old.example.test/",
        },
      },
      tools: [
        {
          type: "function",
          function: {
            name: "browser_set_target_tab",
            description: "Select a browser tab.",
            parameters: {
              type: "object",
              properties: {
                tabId: { type: "number" },
              },
              required: ["tabId"],
              additionalProperties: false,
            },
          },
        },
      ],
      executeToolCalls: async (calls) => {
        executedTools.push(...calls.map((call) => call.name));
        return calls.map((call) => ({
          toolCallId: call.id,
          name: call.name,
          content: JSON.stringify({ selectedTabId: call.arguments.tabId }),
        }));
      },
      onVisibleContent: () => undefined,
      onStatusUpdate: () => undefined,
    });

    assert.deepEqual(executedTools, []);
    assert.equal(result.status, "blocked");
    assert.match(result.finalContent, /用户选择|改绑当前 Tab|创建新对话/);
    assert.match(
      JSON.stringify(requestBodies.at(-1)),
      /TARGET_SWITCH_REQUIRES_USER/,
    );
  } finally {
    restore();
  }
});

test("Agent rewrites an English final draft for a Chinese user turn", async () => {
  const responses = [
    {
      choices: [
        {
          message: {
            content:
              "browser_verify checks the observable result of a browser mutation. It should not be used as a general read tool.",
          },
        },
      ],
    },
    {
      choices: [
        {
          message: {
            content:
              "browser_verify 用于检查浏览器修改后的可观察结果，不应当作为普通读取工具使用。",
          },
        },
      ],
    },
  ];
  const requestBodies: Record<string, unknown>[] = [];
  let requestCount = 0;
  const restore = installBrowserGlobals(
    (index) => responses[index] ?? responses.at(-1)!,
    () => {
      requestCount += 1;
    },
    (body) => requestBodies.push(body),
  );

  try {
    const result = await runAutonomousAgentSession({
      config: { ...DEFAULT_AI_CONFIG, maxToolRounds: 4 },
      messages: [],
      input: "解释一下 browser_verify 是做什么的。",
      attachments: [],
      context: {},
      assistantMessageId: "assistant-chinese-language-rewrite",
      tools: [],
      executeToolCalls: async () => [],
      onVisibleContent: () => undefined,
      onStatusUpdate: () => undefined,
    });

    assert.equal(requestCount, 2);
    assert.equal(result.status, "completed");
    assert.match(result.finalContent, /用于检查浏览器修改后的可观察结果/);
    assert.doesNotMatch(result.finalContent, /checks the observable result/);
    assert.match(
      JSON.stringify(requestBodies.at(-1)),
      /Rewrite the same answer in Simplified Chinese/,
    );
  } finally {
    restore();
  }
});

test("Agent repairs an exact completed-report replay for a different user turn", async () => {
  const repeatedReport =
    "## fluent-bit DaemonSet 所有节点状态\n\n" +
    "fluent-bit 作为 DaemonSet 部署在 ob 命名空间，当前 7 个节点中 6 个节点运行正常，1 个节点存在异常。" +
    "\n\n| 指标 | 值 | 状态 |\n| --- | --- | --- |\n" +
    "| desiredNumberScheduled | 7 | - |\n| numberAvailable | 6 | 警告 |\n" +
    "| numberUnavailable | 1 | 异常 |\n\n" +
    "需要进一步查询完整节点列表以及对应 Pod 状态。";
  const responses = [
    {
      choices: [{ message: { content: repeatedReport } }],
    },
    {
      choices: [
        {
          message: {
            content:
              "JavaScript 事件循环会依次执行同步任务，并在调用栈清空后处理微任务和后续宏任务。",
          },
        },
      ],
    },
  ];
  const requestBodies: Record<string, unknown>[] = [];
  let requestCount = 0;
  const restore = installBrowserGlobals(
    (index) => responses[index] ?? responses.at(-1)!,
    () => {
      requestCount += 1;
    },
    (body) => requestBodies.push(body),
  );

  try {
    const result = await runAutonomousAgentSession({
      config: { ...DEFAULT_AI_CONFIG, maxToolRounds: 4 },
      messages: [
        {
          id: "old-user",
          role: "user",
          content: "查询 fluent-bit DaemonSet 的所有节点状态。",
          createdAt: "2026-08-06T10:01:00.000Z",
        },
        {
          id: "old-tool",
          role: "tool",
          toolName: "pods_list_in_namespace",
          content: '{"items":[{"name":"fluent-bit-a"}]}',
          createdAt: "2026-08-06T10:01:01.000Z",
        },
        {
          id: "old-assistant",
          role: "assistant",
          content: repeatedReport,
          createdAt: "2026-08-06T10:02:00.000Z",
        },
      ],
      input: "JavaScript 的事件循环是什么？",
      attachments: [],
      context: {},
      assistantMessageId: "assistant-cross-turn-replay-repair",
      tools: [],
      executeToolCalls: async () => [],
      onVisibleContent: () => undefined,
      onStatusUpdate: () => undefined,
    });

    assert.equal(requestCount, 2);
    assert.equal(result.status, "completed");
    assert.match(result.finalContent, /JavaScript 事件循环/);
    assert.doesNotMatch(result.finalContent, /fluent-bit DaemonSet 所有节点状态/);
    assert.match(
      JSON.stringify(requestBodies.at(-1)),
      /duplicated the previous completed turn/i,
    );
  } finally {
    restore();
  }
});

test("Agent requires a read-only observation after a browser mutation", async () => {
  const responses = [
    {
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: "call-click-save",
                type: "function",
                function: {
                  name: "browser_click",
                  arguments: '{"selector":"#save"}',
                },
              },
            ],
          },
        },
      ],
    },
    {
      choices: [{ message: { content: "保存完成。" } }],
    },
    {
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: "call-verify-save",
                type: "function",
                function: {
                  name: "browser_snapshot",
                  arguments: "{}",
                },
              },
            ],
          },
        },
      ],
    },
    {
      choices: [{ message: { content: "已验证保存成功。" } }],
    },
    {
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: "call-verify-save-again",
                type: "function",
                function: {
                  name: "browser_snapshot",
                  arguments: "{}",
                },
              },
            ],
          },
        },
      ],
    },
    {
      choices: [{ message: { content: "已验证保存成功。" } }],
    },
  ];
  const restore = installBrowserGlobals((index) =>
    responses[index] ?? responses.at(-1)!,
  );
  const executedTools: string[] = [];

  try {
    const result = await runAutonomousAgentSession({
      config: { ...DEFAULT_AI_CONFIG, maxToolRounds: 5 },
      messages: [],
      input: "点击保存并确认成功。",
      attachments: [],
      context: {},
      assistantMessageId: "assistant-verify-mutation",
      tools: [
        {
          type: "function",
          function: {
            name: "browser_click",
            description: "Click an element.",
            parameters: {
              type: "object",
              properties: { selector: { type: "string" } },
              required: ["selector"],
              additionalProperties: false,
            },
          },
        },
        {
          type: "function",
          function: {
            name: "browser_snapshot",
            description: "Read the current page.",
            parameters: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
          },
        },
      ],
      executeToolCalls: async (calls) => {
        executedTools.push(...calls.map((call) => call.name));
        return calls.map((call) => ({
          toolCallId: call.id,
          name: call.name,
          content:
            call.name === "browser_snapshot"
              ? JSON.stringify({ ok: true, text: "Saved" })
              : JSON.stringify({ ok: true }),
        }));
      },
      onVisibleContent: () => undefined,
      onStatusUpdate: () => undefined,
    });

    assert.deepEqual(executedTools, [
      "browser_click",
      "browser_snapshot",
    ]);
    assert.equal(result.status, "completed");
    assert.equal(result.session.taskState.phase, "completed");
    assert.equal(result.session.taskState.verification.required, false);
    assert.match(
      result.session.taskState.verification.evidence.join("\n"),
      /browser_snapshot/,
    );
  } finally {
    restore();
  }
});

test("fixed-time waits do not verify a preceding browser mutation", async () => {
  const toolResponse = (id: string, name: string, args: string) => ({
    choices: [
      {
        message: {
          content: "",
          tool_calls: [
            {
              id,
              type: "function",
              function: { name, arguments: args },
            },
          ],
        },
      },
    ],
  });
  const finalResponse = {
    choices: [{ message: { content: "操作完成。" } }],
  };
  const responses = [
    toolResponse("call-click-before-wait", "browser_click", '{"selector":"#save"}'),
    finalResponse,
    toolResponse("call-time-wait-after-click", "browser_wait_for", '{"time":2}'),
    finalResponse,
    toolResponse("call-snapshot-after-wait", "browser_snapshot", "{}"),
    { choices: [{ message: { content: "已读取页面并验证保存成功。" } }] },
  ];
  const restore = installBrowserGlobals((index) =>
    responses[index] ?? responses.at(-1)!,
  );
  const executedTools: string[] = [];

  try {
    const result = await runAutonomousAgentSession({
      config: { ...DEFAULT_AI_CONFIG, maxToolRounds: 10 },
      messages: [],
      input: "点击保存，等待两秒，然后确认结果。",
      attachments: [],
      context: {},
      assistantMessageId: "assistant-time-wait-verification",
      tools: [
        {
          type: "function",
          function: {
            name: "browser_click",
            description: "Click an element.",
            parameters: {
              type: "object",
              properties: { selector: { type: "string" } },
              required: ["selector"],
              additionalProperties: false,
            },
          },
        },
        {
          type: "function",
          function: {
            name: "browser_wait_for",
            description: "Wait for time or page state.",
            parameters: {
              type: "object",
              properties: { time: { type: "number" } },
              additionalProperties: false,
            },
          },
        },
        {
          type: "function",
          function: {
            name: "browser_snapshot",
            description: "Read the current page.",
            parameters: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
          },
        },
      ],
      executeToolCalls: async (calls) => {
        executedTools.push(...calls.map((call) => call.name));
        return calls.map((call) => ({
          toolCallId: call.id,
          name: call.name,
          content:
            call.name === "browser_wait_for"
              ? JSON.stringify({ waited: true, reason: "time", elapsedMs: 2001 })
              : JSON.stringify({ ok: true }),
        }));
      },
      onVisibleContent: () => undefined,
      onStatusUpdate: () => undefined,
    });

    assert.deepEqual(executedTools, [
      "browser_click",
      "browser_wait_for",
      "browser_snapshot",
    ]);
    assert.equal(result.status, "completed");
    assert.equal(result.session.taskState.verification.required, false);
    assert.match(result.finalContent, /已读取页面并验证保存成功/);
  } finally {
    restore();
  }
});

test("Agent conservatively verifies a mutation that reports a partial failure", async () => {
  const responses = [
    {
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: "call-partial-click",
                type: "function",
                function: {
                  name: "browser_click",
                  arguments: '{"selector":"#save"}',
                },
              },
            ],
          },
        },
      ],
    },
    { choices: [{ message: { content: "点击失败，任务结束。" } }] },
    {
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: "call-check-partial-click",
                type: "function",
                function: {
                  name: "browser_snapshot",
                  arguments: "{}",
                },
              },
            ],
          },
        },
      ],
    },
    { choices: [{ message: { content: "已确认页面保持在当前步骤。" } }] },
  ];
  const restore = installBrowserGlobals((index) =>
    responses[index] ?? responses.at(-1)!,
  );
  const executedTools: string[] = [];

  try {
    const result = await runAutonomousAgentSession({
      config: { ...DEFAULT_AI_CONFIG, maxToolRounds: 3 },
      messages: [],
      input: "点击保存并确认页面状态。",
      attachments: [],
      context: {},
      assistantMessageId: "assistant-verify-partial-mutation",
      tools: [
        {
          type: "function",
          function: {
            name: "browser_click",
            description: "Click an element.",
            parameters: {
              type: "object",
              properties: { selector: { type: "string" } },
              required: ["selector"],
              additionalProperties: false,
            },
          },
        },
        {
          type: "function",
          function: {
            name: "browser_snapshot",
            description: "Read the current page.",
            parameters: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
          },
        },
      ],
      executeToolCalls: async (calls) => {
        executedTools.push(...calls.map((call) => call.name));
        return calls.map((call) => ({
          toolCallId: call.id,
          name: call.name,
          content:
            call.name === "browser_click"
              ? JSON.stringify({ error: "post-dispatch verification failed" })
              : JSON.stringify({ ok: true, text: "Current step" }),
        }));
      },
      onVisibleContent: () => undefined,
      onStatusUpdate: () => undefined,
    });

    assert.deepEqual(executedTools, ["browser_click", "browser_snapshot"]);
    assert.equal(result.status, "completed");
    assert.equal(result.session.taskState.verification.required, false);
  } finally {
    restore();
  }
});

test("fast Agent starts adaptive checkpoints only after the model requests a screenshot", async () => {
  const responses = [
    {
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: "call-observe-visual",
                type: "function",
                function: {
                  name: "browser_take_screenshot",
                  arguments: "{}",
                },
              },
            ],
          },
        },
      ],
    },
    {
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: "call-open",
                type: "function",
                function: {
                  name: "browser_click",
                  arguments: '{"selector":"#open"}',
                },
              },
            ],
          },
        },
      ],
    },
    {
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: "call-verify",
                type: "function",
                function: {
                  name: "browser_snapshot",
                  arguments: "{}",
                },
              },
            ],
          },
        },
      ],
    },
    { choices: [{ message: { content: "抽屉已打开并验证。" } }] },
  ];
  const requestBodies: Array<Record<string, unknown>> = [];
  const restore = installBrowserGlobals(
    (index) => responses[index] ?? responses.at(-1)!,
    () => undefined,
    (body) => requestBodies.push(body),
  );
  const checkpointReasons: string[] = [];

  try {
    const result = await runAutonomousAgentSession({
      config: {
        ...DEFAULT_AI_CONFIG,
        fastAgentMode: true,
        supportsVision: true,
        maxToolRounds: 5,
      },
      messages: [],
      input: "打开抽屉。",
      attachments: [],
      context: {},
      assistantMessageId: "assistant-visual-checkpoint",
      tools: [
        {
          type: "function",
          function: {
            name: "browser_take_screenshot",
            description: "Capture the current viewport.",
            parameters: { type: "object", properties: {} },
          },
        },
        {
          type: "function",
          function: {
            name: "browser_click",
            description: "Click a page element.",
            parameters: { type: "object", properties: {} },
          },
        },
        {
          type: "function",
          function: {
            name: "browser_snapshot",
            description: "Read the page.",
            parameters: { type: "object", properties: {} },
          },
        },
      ],
      executeToolCalls: async (calls) =>
        calls.map((call) =>
          call.name === "browser_take_screenshot"
            ? {
                toolCallId: call.id,
                name: call.name,
                content: JSON.stringify({ captured: true }),
                attachments: [
                  {
                    id: "model-requested",
                    name: "model-requested.png",
                    mimeType: "image/png",
                    dataUrl: "data:image/png;base64,bW9kZWw=",
                    createdAt: "2026-07-15T00:00:00.000Z",
                    source: "screenshot",
                  },
                ],
              }
            : {
                toolCallId: call.id,
                name: call.name,
                content: JSON.stringify(
                  call.name === "browser_click"
                    ? { matched: true, action: "click" }
                    : { returnedCount: 1, nodes: [{ role: "dialog" }] },
                ),
              },
        ),
      prepareVisualCheckpoint: async ({ reason, captureImage }) => {
        checkpointReasons.push(reason);
        assert.equal(captureImage, true);
        return {
          context: {},
          attachment: {
            id: "latest-fast",
            name: "latest.png",
            mimeType: "image/png",
            dataUrl: "data:image/png;base64,bGF0ZXN0",
            createdAt: "2026-07-15T00:00:01.000Z",
            source: "screenshot",
          },
        };
      },
      onVisibleContent: () => undefined,
    });

    assert.equal(result.status, "completed");
    assert.deepEqual(checkpointReasons, ["interaction_barrier"]);
    assert.equal(requestBodies.length, 4);
    assert.deepEqual(collectRequestImageUrls(requestBodies[0]!), []);
    assert.deepEqual(collectRequestImageUrls(requestBodies[1]!), [
      "data:image/png;base64,bW9kZWw=",
    ]);
    assert.ok(
      collectRequestImageUrls(requestBodies[2]!).includes(
        "data:image/png;base64,bGF0ZXN0",
      ),
    );
  } finally {
    restore();
  }
});

test("Agent blocks one unchanged invalid click retry and continues with corrected arguments", async () => {
  const toolCallResponse = (
    id: string,
    name: string,
    argumentsValue: Record<string, unknown>,
  ) => ({
    choices: [
      {
        message: {
          content: "",
          tool_calls: [
            {
              id,
              type: "function",
              function: {
                name,
                arguments: JSON.stringify(argumentsValue),
              },
            },
          ],
        },
      },
    ],
  });
  const responses = [
    toolCallResponse("click-invalid-1", "browser_click", {}),
    toolCallResponse("click-invalid-2", "browser_click", {}),
    toolCallResponse("click-corrected", "browser_click", {
      selector: "#save",
    }),
    { choices: [{ message: { content: "保存已完成。" } }] },
    toolCallResponse("verify-corrected-click", "browser_snapshot", {}),
    { choices: [{ message: { content: "保存已完成并验证。" } }] },
  ];
  const requestBodies: Record<string, unknown>[] = [];
  const restore = installBrowserGlobals(
    (index) => responses[index] ?? responses.at(-1)!,
    () => undefined,
    (body) => requestBodies.push(body),
  );
  const executedIds: string[] = [];

  try {
    const result = await runAutonomousAgentSession({
      config: {
        ...DEFAULT_AI_CONFIG,
        maxToolRounds: 10,
        autoContinueAfterToolRoundLimit: true,
      },
      messages: [],
      input: "点击保存并验证结果。",
      attachments: [],
      context: {},
      assistantMessageId: "assistant-invalid-click-recovery",
      tools: [
        {
          type: "function",
          function: {
            name: "browser_click",
            description: "Click a page element.",
            parameters: {
              type: "object",
              properties: { selector: { type: "string" } },
              required: ["selector"],
              additionalProperties: false,
            },
          },
        },
        {
          type: "function",
          function: {
            name: "browser_snapshot",
            description: "Read the current page.",
            parameters: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
          },
        },
      ],
      executeToolCalls: async (calls) => {
        executedIds.push(...calls.map((call) => call.id));
        return calls.map((call) => ({
          toolCallId: call.id,
          name: call.name,
          content:
            call.id === "click-invalid-1"
              ? JSON.stringify({
                  error:
                    "browser_click arguments invalid: selector or target is required.",
                })
              : JSON.stringify({ ok: true }),
        }));
      },
      onVisibleContent: () => undefined,
      onStatusUpdate: () => undefined,
    });

    assert.deepEqual(executedIds, [
      "click-invalid-1",
      "click-corrected",
      "verify-corrected-click",
    ]);
    assert.equal(result.status, "completed");
    assert.match(result.finalContent, /验证/);
    assert.match(JSON.stringify(requestBodies[2]), /Do not repeat/);
  } finally {
    restore();
  }
});

test("Agent blocks changed arguments that still violate the same max-length constraint", async () => {
  const toolCallResponse = (
    id: string,
    name: string,
    argumentsValue: Record<string, unknown>,
  ) => ({
    choices: [
      {
        message: {
          content: "",
          tool_calls: [
            {
              id,
              type: "function",
              function: {
                name,
                arguments: JSON.stringify(argumentsValue),
              },
            },
          ],
        },
      },
    ],
  });
  const responses = [
    toolCallResponse(
      "css-too-long-1",
      "browser_apply_css_patch",
      { patchId: "css-too-long-1", css: "a".repeat(11) },
    ),
    toolCallResponse(
      "css-too-long-2",
      "browser_apply_css_patch",
      { patchId: "css-too-long-2", css: "b".repeat(12) },
    ),
    toolCallResponse(
      "css-corrected",
      "browser_apply_css_patch",
      { patchId: "css-corrected", css: "body{}" },
    ),
    { choices: [{ message: { content: "样式已应用。" } }] },
    toolCallResponse("verify-css", "browser_snapshot", {}),
    { choices: [{ message: { content: "样式已应用并验证。" } }] },
  ];
  const requestBodies: Record<string, unknown>[] = [];
  const restore = installBrowserGlobals(
    (index) => responses[index] ?? responses.at(-1)!,
    () => undefined,
    (body) => requestBodies.push(body),
  );
  const executedIds: string[] = [];

  try {
    const result = await runAutonomousAgentSession({
      config: {
        ...DEFAULT_AI_CONFIG,
        maxToolRounds: 10,
        autoContinueAfterToolRoundLimit: true,
      },
      messages: [],
      input: "应用临时 CSS 并验证。",
      attachments: [],
      context: {},
      assistantMessageId: "assistant-css-length-recovery",
      tools: [
        {
          type: "function",
          function: {
            name: "browser_apply_css_patch",
            description: "Apply a reversible CSS patch.",
            parameters: {
              type: "object",
              properties: {
                patchId: { type: "string" },
                css: { type: "string", maxLength: 10 },
              },
              required: ["css"],
              additionalProperties: false,
            },
          },
        },
        {
          type: "function",
          function: {
            name: "browser_snapshot",
            description: "Read the current page.",
            parameters: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
          },
        },
      ],
      executeToolCalls: async (calls) => {
        executedIds.push(...calls.map((call) => call.id));
        return calls.map((call) => ({
          toolCallId: call.id,
          name: call.name,
          content:
            call.id === "css-too-long-1"
              ? JSON.stringify({
                  error:
                    "browser_apply_css_patch arguments invalid: css: string length 11 exceeds maximum 10 characters",
                })
              : JSON.stringify({ ok: true }),
        }));
      },
      onVisibleContent: () => undefined,
      onStatusUpdate: () => undefined,
    });

    assert.deepEqual(executedIds, [
      "css-too-long-1",
      "css-corrected",
      "verify-css",
    ]);
    assert.equal(result.status, "completed");
    assert.match(result.finalContent, /验证/);
    assert.match(JSON.stringify(requestBodies[2]), /maximum 10 characters/);
  } finally {
    restore();
  }
});

test("Agent terminates an unchanged invalid mutation branch after one corrective retry", async () => {
  const invalidClick = (id: string) => ({
    choices: [
      {
        message: {
          content: "",
          tool_calls: [
            {
              id,
              type: "function",
              function: {
                name: "browser_click",
                arguments: "{}",
              },
            },
          ],
        },
      },
    ],
  });
  const responses = [
    invalidClick("invalid-branch-1"),
    invalidClick("invalid-branch-2"),
    invalidClick("invalid-branch-3"),
    { choices: [{ message: { content: "无法在现有参数下继续点击。" } }] },
  ];
  const restore = installBrowserGlobals(
    (index) => responses[index] ?? responses.at(-1)!,
  );
  const executedIds: string[] = [];

  try {
    const result = await runAutonomousAgentSession({
      config: {
        ...DEFAULT_AI_CONFIG,
        maxToolRounds: 10,
        autoContinueAfterToolRoundLimit: true,
      },
      messages: [],
      input: "点击保存。",
      attachments: [],
      context: {},
      assistantMessageId: "assistant-invalid-click-terminal",
      tools: [
        {
          type: "function",
          function: {
            name: "browser_click",
            description: "Click a page element.",
            parameters: {
              type: "object",
              properties: { selector: { type: "string" } },
              required: ["selector"],
              additionalProperties: false,
            },
          },
        },
      ],
      executeToolCalls: async (calls) => {
        executedIds.push(...calls.map((call) => call.id));
        return calls.map((call) => ({
          toolCallId: call.id,
          name: call.name,
          content: JSON.stringify({
            error:
              "browser_click arguments invalid: selector or target is required.",
          }),
        }));
      },
      onVisibleContent: () => undefined,
      onStatusUpdate: () => undefined,
    });

    assert.deepEqual(executedIds, ["invalid-branch-1"]);
    assert.equal(result.status, "blocked");
    assert.match(result.finalContent, /连续提交完全相同的参数/);
  } finally {
    restore();
  }
});

test("Agent stops a changed-argument loop after two generic schema failures", async () => {
  const invalidCall = (id: string, mode: string) => ({
    choices: [
      {
        message: {
          content: "",
          tool_calls: [
            {
              id,
              type: "function",
              function: {
                name: "browser_custom_action",
                arguments: JSON.stringify({ mode }),
              },
            },
          ],
        },
      },
    ],
  });
  const responses = [
    invalidCall("cross-invalid-1", "a"),
    invalidCall("cross-invalid-2", "b"),
    invalidCall("cross-invalid-3", "c"),
    invalidCall("cross-invalid-4", "d"),
    { choices: [{ message: { content: "参数组合持续无效，已停止。" } }] },
  ];
  const restore = installBrowserGlobals(
    (index) => responses[index] ?? responses.at(-1)!,
  );
  const executedIds: string[] = [];

  try {
    const result = await runAutonomousAgentSession({
      config: {
        ...DEFAULT_AI_CONFIG,
        maxToolRounds: 10,
        autoContinueAfterToolRoundLimit: true,
      },
      messages: [],
      input: "执行带跨字段约束的操作。",
      attachments: [],
      context: {},
      assistantMessageId: "assistant-cross-field-recovery",
      tools: [
        {
          type: "function",
          function: {
            name: "browser_custom_action",
            description: "Test a cross-field rule.",
            parameters: {
              type: "object",
              properties: { mode: { type: "string" } },
              required: ["mode"],
              additionalProperties: false,
            },
          },
        },
      ],
      executeToolCalls: async (calls) => {
        executedIds.push(...calls.map((call) => call.id));
        return calls.map((call) => ({
          toolCallId: call.id,
          name: call.name,
          content: JSON.stringify({
            error:
              "browser_custom_action arguments invalid: mode and target must be supplied together",
          }),
        }));
      },
      onVisibleContent: () => undefined,
      onStatusUpdate: () => undefined,
    });

    assert.deepEqual(executedIds, ["cross-invalid-1", "cross-invalid-2"]);
    assert.equal(result.status, "blocked");
    assert.match(result.finalContent, /参数|约束|停止/);
  } finally {
    restore();
  }
});

function collectRequestImageUrls(body: Record<string, unknown>): string[] {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  return messages.flatMap((message) => {
    if (!message || typeof message !== "object") {
      return [];
    }
    const content = (message as { content?: unknown }).content;
    if (!Array.isArray(content)) {
      return [];
    }
    return content.flatMap((part) => {
      if (!part || typeof part !== "object") {
        return [];
      }
      const imageUrl = (part as { image_url?: { url?: unknown } }).image_url
        ?.url;
      return typeof imageUrl === "string" ? [imageUrl] : [];
    });
  });
}

function installBrowserGlobals(
  responsePayload:
    | Record<string, unknown>
    | ((requestIndex: number) => Record<string, unknown>),
  onRequest: () => void = () => undefined,
  onRequestBody: (body: Record<string, unknown>) => void = () => undefined,
): () => void {
  const originalFetch = globalThis.fetch;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: globalThis,
  });
  let requestIndex = 0;
  globalThis.fetch = (async (_input, init) => {
    onRequest();
    if (typeof init?.body === "string") {
      onRequestBody(JSON.parse(init.body) as Record<string, unknown>);
    }
    const payload =
      typeof responsePayload === "function"
        ? responsePayload(requestIndex)
        : responsePayload;
    requestIndex += 1;
    return new Response(JSON.stringify(payload), {
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
