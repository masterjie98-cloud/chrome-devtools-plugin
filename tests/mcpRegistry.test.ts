import assert from "node:assert/strict";
import test from "node:test";
import {
  MCP_RUNTIME_TOOL_REGISTRY,
  MCP_TOOL_INPUT_SCHEMAS,
  listRuntimeMcpTools,
  parseMcpToolProfile,
  runtimeToolsForProfile,
} from "../src/mcp/toolRuntime";
import {
  MCP_EXPOSED_TOOL_DEFINITIONS,
  MCP_TOOL_NAMES,
} from "../src/shared/mcpTools";
import {
  ADAPTER_ROUTING_TOOL_INPUT_SCHEMAS,
  ADAPTER_ROUTING_TOOL_NAMES,
  ADAPTER_ROUTING_AVAILABLE_TOOLS,
  adapterRoutingToolOutputSchema,
} from "../src/mcp/adapterRoutingTools";
import {
  MCP_TOOL_OUTPUT_SCHEMAS,
  mcpToolOutputJsonSchema,
} from "../src/mcp/toolOutputSchemas";

test("canonical MCP runtime registry covers every exposed tool exactly once", () => {
  const registryNames = MCP_RUNTIME_TOOL_REGISTRY.map(
    ({ definition }) => definition.name,
  );
  const exposedNames = MCP_EXPOSED_TOOL_DEFINITIONS.map((tool) => tool.name);

  assert.deepEqual(registryNames, exposedNames);
  assert.equal(new Set(registryNames).size, registryNames.length);
  assert.equal(listRuntimeMcpTools().length, registryNames.length);
  assert.equal(
    MCP_RUNTIME_TOOL_REGISTRY.every(
      (registration) =>
        typeof registration.execute === "function" &&
        Boolean(registration.inputSchema) &&
        Boolean(registration.outputSchema) &&
        typeof registration.annotations.readOnlyHint === "boolean" &&
        typeof registration.annotations.destructiveHint === "boolean",
    ),
    true,
  );
});

test("the bounded action-stage executor is exposed to MCP clients", () => {
  assert.ok(
    MCP_RUNTIME_TOOL_REGISTRY.some(
      ({ definition }) =>
        definition.name === MCP_TOOL_NAMES.BROWSER_EXECUTE_ACTION_STAGE,
    ),
  );
});

test("every canonical MCP tool has a specific bounded output contract", () => {
  const allToolNames = Object.values(MCP_TOOL_NAMES);
  assert.deepEqual(
    Object.keys(MCP_TOOL_OUTPUT_SCHEMAS).sort(),
    [...allToolNames].sort(),
  );

  for (const toolName of allToolNames) {
    const jsonSchema = mcpToolOutputJsonSchema(toolName);
    assert.equal(jsonSchema.type, "object", `${toolName} must return an object`);
    assert.ok(
      jsonSchema.properties &&
        typeof jsonSchema.properties === "object" &&
        Object.keys(jsonSchema.properties).length > 0,
      `${toolName} must advertise named output fields`,
    );
  }

  const advertised = listRuntimeMcpTools();
  for (const tool of advertised) {
    assert.deepEqual(
      tool.outputSchema,
      mcpToolOutputJsonSchema(tool.name as (typeof allToolNames)[number]),
    );
  }
});

test("representative MCP output schemas reject shape drift", () => {
  assert.equal(
    MCP_TOOL_OUTPUT_SCHEMAS[MCP_TOOL_NAMES.BROWSER_QUERY_DOM].safeParse({
      query: "button",
      queryType: "selector",
      count: 1,
      elements: [],
    }).success,
    true,
  );
  assert.equal(
    MCP_TOOL_OUTPUT_SCHEMAS[MCP_TOOL_NAMES.BROWSER_QUERY_DOM].safeParse({
      query: "button",
      queryType: "selector",
      count: "1",
      elements: [],
    }).success,
    false,
  );
  assert.equal(
    MCP_TOOL_OUTPUT_SCHEMAS[MCP_TOOL_NAMES.BROWSER_CLICK].safeParse({
      selector: "#submit",
      matched: true,
      action: "click",
      inputMode: "cdp",
      x: 120,
      y: 80,
    }).success,
    true,
  );
  assert.equal(
    MCP_TOOL_OUTPUT_SCHEMAS[MCP_TOOL_NAMES.BROWSER_CLICK].safeParse({
      selector: "#submit",
      matched: true,
      action: "click",
      inputMode: "synthetic",
      x: 120,
      y: 80,
    }).success,
    false,
  );
  const networkOutput = {
    attached: true,
    digestOnly: true,
    total: 4,
    returned: 0,
    requests: [],
    activityDigest: {
      observedRequests: 4,
      totalGroups: 1,
      returnedGroups: 1,
      heartbeatRequestsCollapsed: 4,
      groups: [
        {
          method: "GET",
          url: "https://example.test/api/heartbeat",
          resourceType: "Fetch",
          status: 200,
          count: 4,
          failedCount: 0,
          latestStartedAt: 4,
          heartbeatLike: true,
        },
      ],
    },
    pagination: {
      version: "collection-page-v1",
      kind: "network",
      fingerprint: "deadbeef",
      offset: 0,
      limit: 50,
      returnedCount: 0,
      totalCount: 4,
      hasMore: false,
    },
  };
  assert.equal(
    MCP_TOOL_OUTPUT_SCHEMAS[MCP_TOOL_NAMES.BROWSER_NETWORK_REQUESTS].safeParse(
      networkOutput,
    ).success,
    true,
  );
  assert.equal(
    MCP_TOOL_OUTPUT_SCHEMAS[MCP_TOOL_NAMES.BROWSER_NETWORK_REQUESTS].safeParse({
      ...networkOutput,
      activityDigest: {
        ...networkOutput.activityDigest,
        leakedHeaders: { authorization: "forbidden" },
      },
    }).success,
    false,
  );
  assert.equal(
    MCP_TOOL_OUTPUT_SCHEMAS[MCP_TOOL_NAMES.BROWSER_NETWORK_REQUESTS].safeParse({
      ...networkOutput,
      pagination: {
        ...networkOutput.pagination,
        returnedCount: 4,
      },
    }).success,
    false,
  );
  assert.equal(
    MCP_TOOL_OUTPUT_SCHEMAS[MCP_TOOL_NAMES.BROWSER_HANDLE_DIALOG].safeParse({
      handled: true,
      action: "accept",
      promptText: "approved value",
    }).success,
    true,
  );
  assert.equal(
    MCP_TOOL_OUTPUT_SCHEMAS[MCP_TOOL_NAMES.BROWSER_HANDLE_DIALOG].safeParse({
      configured: true,
      action: "accept",
    }).success,
    false,
  );
  assert.equal(
    MCP_TOOL_OUTPUT_SCHEMAS[MCP_TOOL_NAMES.BROWSER_TYPE].safeParse({
      selector: "#editor",
      matched: true,
      action: "type",
      inputMode: "cdp",
      x: 40,
      y: 20,
    }).success,
    true,
  );
  assert.equal(
    MCP_TOOL_OUTPUT_SCHEMAS[MCP_TOOL_NAMES.BROWSER_PRESS_KEY].safeParse({
      selector: "<active-element>",
      matched: true,
      action: "pressKey",
      inputMode: "cdp",
    }).success,
    true,
  );
  assert.equal(
    MCP_TOOL_OUTPUT_SCHEMAS[MCP_TOOL_NAMES.BROWSER_SELECT_OPTION].safeParse({
      selector: "#country",
      matched: true,
      action: "selectOption",
      inputMode: "dom",
      changed: true,
      x: 40,
      y: 20,
    }).success,
    true,
  );
  assert.equal(
    MCP_TOOL_OUTPUT_SCHEMAS[MCP_TOOL_NAMES.BROWSER_SELECT_OPTION].safeParse({
      selector: "#country",
      matched: true,
      action: "selectOption",
      inputMode: "cdp",
      changed: true,
      x: 40,
      y: 20,
    }).success,
    false,
  );
  assert.equal(
    MCP_TOOL_OUTPUT_SCHEMAS[MCP_TOOL_NAMES.BROWSER_FILL_FORM].safeParse({
      filled: true,
      fields: [
        {
          selector: "#name",
          matched: true,
          action: "fillForm",
          inputMode: "cdp",
          changed: true,
          controlKind: "text",
          x: 40,
          y: 20,
        },
        {
          selector: "#country",
          matched: true,
          action: "fillForm",
          inputMode: "dom",
          changed: false,
          controlKind: "select-one",
          x: 40,
          y: 60,
        },
      ],
    }).success,
    true,
  );
  assert.equal(
    MCP_TOOL_OUTPUT_SCHEMAS[MCP_TOOL_NAMES.BROWSER_FILL_FORM].safeParse({
      filled: true,
      fields: [
        {
          selector: "#password",
          matched: true,
          action: "fillForm",
          inputMode: "cdp",
          changed: true,
          controlKind: "text",
          value: "must-not-be-returned",
          x: 40,
          y: 20,
        },
      ],
    }).success,
    false,
  );
  assert.equal(
    MCP_TOOL_OUTPUT_SCHEMAS[
      MCP_TOOL_NAMES.BROWSER_NETWORK_GET_RESPONSE_BODY
    ].safeParse({
      requestId: "request-1",
      body: "ok",
      base64Encoded: false,
      truncated: false,
    }).success,
    true,
  );
  assert.equal(
    MCP_TOOL_OUTPUT_SCHEMAS[
      MCP_TOOL_NAMES.BROWSER_NETWORK_GET_RESPONSE_BODY
    ].safeParse({ requestId: "request-1", body: "ok" }).success,
    false,
  );
  const auditOutput = {
    sessionId: "profile-a",
    filters: {},
    events: [
      {
        id: "event-1",
        eventType: "tool.completed",
        timestamp: "2026-07-13T00:00:00.000Z",
        requestId: "request-1",
        sessionId: "profile-a",
        toolName: "browser_snapshot",
        policyClass: "safe_read",
        argumentsSha256: "a".repeat(64),
        revision: 1,
        outcome: "completed",
        approvalWaitMs: 1200,
        queueWaitMs: 18,
        executorMs: 42,
        transportMs: 7,
        totalMs: 1267,
        resultChars: 481,
        payloadBytes: 912,
      },
      {
        id: "event-2",
        eventType: "grant.revoked",
        timestamp: "2026-07-13T00:00:01.000Z",
        requestId: "request-2",
        sessionId: "profile-a",
        toolName: "task_capability_grant",
        policyClass: "task_grant",
        argumentsSha256: "b".repeat(64),
        revision: 2,
        outcome: "completed",
      },
    ],
    pagination: {
      version: "collection-page-v1",
      kind: "audit",
      fingerprint: "deadbeef",
      offset: 0,
      limit: 50,
      returnedCount: 2,
      totalCount: 2,
      hasMore: false,
    },
  };
  assert.equal(
    MCP_TOOL_OUTPUT_SCHEMAS[
      MCP_TOOL_NAMES.BROWSER_GET_AUDIT_EVENTS
    ].safeParse(auditOutput).success,
    true,
  );
  assert.equal(
    MCP_TOOL_OUTPUT_SCHEMAS[
      MCP_TOOL_NAMES.BROWSER_GET_AUDIT_EVENTS
    ].safeParse({
      ...auditOutput,
      events: [{ ...auditOutput.events[0], args: { secret: true } }],
    }).success,
    false,
  );
  assert.equal(
    MCP_TOOL_OUTPUT_SCHEMAS[
      MCP_TOOL_NAMES.BROWSER_GET_AUDIT_EVENTS
    ].safeParse({
      ...auditOutput,
      events: [{ ...auditOutput.events[0], executorMs: -1 }],
    }).success,
    false,
  );
});

test("MCP tool profiles reduce model-visible capability without changing policy", () => {
  const smart = runtimeToolsForProfile("smart");
  const inspect = runtimeToolsForProfile("inspect");
  const read = runtimeToolsForProfile("read");
  const full = runtimeToolsForProfile("full");

  assert.equal(inspect.every((tool) => tool.policyClass === "safe_read"), true);
  assert.equal(
    read.every(
      (tool) =>
        tool.policyClass === "safe_read" ||
        tool.policyClass === "sensitive_read",
    ),
    true,
  );
  assert.equal(inspect.length < read.length, true);
  assert.equal(read.length < full.length, true);
  assert.equal(smart.length, 11);
  assert.deepEqual(
    smart.slice(0, 6).map((tool) => tool.definition.name),
    [
      MCP_TOOL_NAMES.BROWSER_STATUS,
      MCP_TOOL_NAMES.BROWSER_WORKFLOW,
      MCP_TOOL_NAMES.BROWSER_OBSERVE,
      MCP_TOOL_NAMES.BROWSER_ACT,
      MCP_TOOL_NAMES.BROWSER_VERIFY,
      MCP_TOOL_NAMES.BROWSER_DEBUG_ACTIVITY,
    ],
  );
  assert.equal(parseMcpToolProfile(undefined), "smart");
  assert.throws(() => parseMcpToolProfile("admin"), /Invalid/);
});

test("canonical MCP Zod inputs reject unknown properties", () => {
  assert.equal(
    MCP_TOOL_INPUT_SCHEMAS[
      MCP_TOOL_NAMES.BROWSER_GET_PAGE_CONTEXT
    ].safeParse({ unexpected: true }).success,
    false,
  );
  assert.equal(
    MCP_TOOL_INPUT_SCHEMAS[MCP_TOOL_NAMES.BROWSER_SNAPSHOT].safeParse({
      limit: 50,
      cursor: "ss1_deadbeef_50",
    }).success,
    true,
  );
  assert.equal(
    MCP_TOOL_INPUT_SCHEMAS[MCP_TOOL_NAMES.BROWSER_SNAPSHOT].safeParse({
      limit: 101,
    }).success,
    false,
  );
  assert.equal(
    MCP_TOOL_INPUT_SCHEMAS[MCP_TOOL_NAMES.BROWSER_CLICK].safeParse({
      ref: "sr1_deadbeef_s12",
    }).success,
    true,
  );
  assert.equal(
    MCP_TOOL_INPUT_SCHEMAS[MCP_TOOL_NAMES.BROWSER_CLICK].safeParse({
      ref: "s12",
    }).success,
    false,
  );
  assert.equal(
    MCP_TOOL_INPUT_SCHEMAS[MCP_TOOL_NAMES.BROWSER_WAIT_FOR].safeParse({
      time: 1,
      unexpected: true,
    }).success,
    false,
  );
  assert.equal(
    MCP_TOOL_INPUT_SCHEMAS[MCP_TOOL_NAMES.BROWSER_WAIT_FOR].safeParse({
      time: 1,
    }).success,
    true,
  );
  assert.equal(
    MCP_TOOL_INPUT_SCHEMAS[MCP_TOOL_NAMES.BROWSER_NETWORK_REQUESTS].safeParse({
      digestOnly: true,
      limit: 50,
    }).success,
    true,
  );
  assert.equal(
    MCP_TOOL_INPUT_SCHEMAS[MCP_TOOL_NAMES.BROWSER_NETWORK_REQUESTS].safeParse({
      digestOnly: "true",
    }).success,
    false,
  );
  assert.equal(
    MCP_TOOL_INPUT_SCHEMAS[MCP_TOOL_NAMES.BROWSER_PRESS_KEY].safeParse({
      key: "ArrowLeft",
    }).success,
    true,
  );
  assert.equal(
    MCP_TOOL_INPUT_SCHEMAS[MCP_TOOL_NAMES.BROWSER_PRESS_KEY].safeParse({
      key: "Control+A",
    }).success,
    false,
  );
  assert.equal(
    MCP_TOOL_INPUT_SCHEMAS[MCP_TOOL_NAMES.BROWSER_TYPE].safeParse({
      selector: "#editor",
      text: "x".repeat(501),
      slowly: true,
    }).success,
    false,
  );
  assert.equal(
    MCP_TOOL_INPUT_SCHEMAS[MCP_TOOL_NAMES.BROWSER_FILL_FORM].safeParse({
      fields: [{ selector: "#agree", type: "checkbox", value: true }],
    }).success,
    true,
  );
  assert.equal(
    MCP_TOOL_INPUT_SCHEMAS[MCP_TOOL_NAMES.BROWSER_FILL_FORM].safeParse({
      fields: [{ selector: "#agree", type: "checkbox", value: "true" }],
    }).success,
    false,
  );
  assert.equal(
    MCP_TOOL_INPUT_SCHEMAS[MCP_TOOL_NAMES.BROWSER_FILL_FORM].safeParse({
      fields: Array.from({ length: 51 }, (_, index) => ({
        selector: `#field-${index}`,
        value: "x",
      })),
    }).success,
    false,
  );
  assert.equal(
    MCP_TOOL_INPUT_SCHEMAS[MCP_TOOL_NAMES.BROWSER_SELECT_OPTION].safeParse({
      selector: "#country",
      values: ["cn", "cn"],
    }).success,
    false,
  );
  assert.equal(
    MCP_TOOL_INPUT_SCHEMAS[
      MCP_TOOL_NAMES.BROWSER_GET_PLUGIN_CONVERSATION
    ].safeParse({ cursor: "cp1_conversation_deadbeef_20_5", limit: 5 })
      .success,
    true,
  );
  assert.equal(
    MCP_TOOL_INPUT_SCHEMAS[
      MCP_TOOL_NAMES.BROWSER_GET_AUDIT_EVENTS
    ].safeParse({
      cursor: "cp1_audit_deadbeef_100_50",
      limit: 100,
      eventType: "grant.revoked",
      outcome: "completed",
    }).success,
    true,
  );
  assert.equal(
    MCP_TOOL_INPUT_SCHEMAS[
      MCP_TOOL_NAMES.BROWSER_GET_AUDIT_EVENTS
    ].safeParse({ cursor: "cp1_audit_deadbeef_50", limit: 101 }).success,
    false,
  );
});

test("adapter-only Profile routing tools use strict bounded inputs", () => {
  assert.equal(
    ADAPTER_ROUTING_TOOL_INPUT_SCHEMAS[
      ADAPTER_ROUTING_TOOL_NAMES.LIST_SESSIONS
    ].safeParse({ unexpected: true }).success,
    false,
  );
  assert.equal(
    ADAPTER_ROUTING_TOOL_INPUT_SCHEMAS[
      ADAPTER_ROUTING_TOOL_NAMES.SET_SESSION
    ].safeParse({ sessionId: "profile-a", unexpected: true }).success,
    false,
  );
  assert.equal(
    ADAPTER_ROUTING_TOOL_INPUT_SCHEMAS[
      ADAPTER_ROUTING_TOOL_NAMES.SET_SESSION
    ].safeParse({ sessionId: "" }).success,
    false,
  );

  const validOutput = {
    selectionMode: "explicit",
    selectedSessionId: "profile-a",
    sessions: [
      {
        sessionId: "profile-a",
        browserConnected: true,
        uiConnected: true,
        selected: true,
        activeTarget: null,
        resourceTargetKey: null,
        lastSeenAt: "2026-07-13T00:00:00.000Z",
        stateUpdatedAt: "2026-07-13T00:00:00.000Z",
        revision: 1,
      },
    ],
  };
  assert.equal(adapterRoutingToolOutputSchema.safeParse(validOutput).success, true);
  assert.equal(
    adapterRoutingToolOutputSchema.safeParse({
      ...validOutput,
      selectionMode: "global",
    }).success,
    false,
  );
  assert.equal(
    ADAPTER_ROUTING_AVAILABLE_TOOLS.every(
      (tool) =>
        tool.outputSchema?.type === "object" &&
        Boolean(tool.outputSchema.properties?.selectedSessionId),
    ),
    true,
  );
});
