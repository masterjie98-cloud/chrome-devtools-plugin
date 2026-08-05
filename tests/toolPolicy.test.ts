import assert from "node:assert/strict";
import test from "node:test";
import {
  MCP_EXPOSED_TOOL_DEFINITIONS,
  MCP_TOOL_NAMES,
} from "../src/shared/mcpTools";
import {
  getToolPolicy,
  getToolPolicyAnnotations,
  createTrustedExternalAutoRunPolicy,
  createTrustedExternalReadOnlyPolicy,
  hasExplicitToolPolicy,
  requiresToolApproval,
} from "../src/shared/toolPolicy";

test("every exposed MCP tool has explicit policy metadata", () => {
  const missing = MCP_EXPOSED_TOOL_DEFINITIONS.map((tool) => tool.name).filter(
    (toolName) => !hasExplicitToolPolicy(toolName),
  );

  assert.deepEqual(missing, []);
});

test("external MCP auto-run policy is explicit and annotation-aware", () => {
  const destructive = createTrustedExternalAutoRunPolicy(
    "extmcp__delete_fixture",
    {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  );
  assert.equal(destructive.requiresApproval, false);
  assert.equal(destructive.approvalMode, "none");
  assert.equal(destructive.policyClass, "destructive_write");
  assert.equal(destructive.destructive, true);
  assert.equal(destructive.capability, "external.open_world");

  const undeclared = createTrustedExternalAutoRunPolicy("extmcp__unknown");
  assert.equal(undeclared.requiresApproval, false);
  assert.equal(undeclared.policyClass, "open_world");
  assert.equal(undeclared.openWorld, true);
});

test("external read-only annotations require explicit trust and reject conflicts", () => {
  const trusted = createTrustedExternalReadOnlyPolicy("extmcp__metrics", {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
  });
  assert.equal(trusted?.approvalMode, "none");
  assert.equal(trusted?.mutatesBrowser, false);
  assert.equal(trusted?.openWorld, true);

  assert.equal(
    createTrustedExternalReadOnlyPolicy("extmcp__unknown", {}),
    undefined,
  );
  assert.equal(
    createTrustedExternalReadOnlyPolicy("extmcp__conflict", {
      readOnlyHint: true,
      destructiveHint: true,
    }),
    undefined,
  );
});

test("ordinary bounded page reads do not require confirmation", () => {
  assert.equal(
    requiresToolApproval(MCP_TOOL_NAMES.BROWSER_SNAPSHOT),
    false,
  );
  assert.equal(
    requiresToolApproval(MCP_TOOL_NAMES.BROWSER_QUERY_DOM, {
      query: "#app",
      maxOuterHTMLLength: 2000,
    }),
    false,
  );
});

test("full DOM, sensitive reads, mutations, and unknown tools require confirmation", () => {
  assert.equal(
    requiresToolApproval(MCP_TOOL_NAMES.BROWSER_QUERY_DOM, {
      query: "html",
      maxOuterHTMLLength: 0,
    }),
    true,
  );
  assert.equal(
    requiresToolApproval(MCP_TOOL_NAMES.BROWSER_COOKIE_LIST),
    true,
  );
  assert.equal(
    requiresToolApproval(MCP_TOOL_NAMES.BROWSER_GET_AUDIT_EVENTS),
    true,
  );
  assert.equal(
    requiresToolApproval(MCP_TOOL_NAMES.BROWSER_CLICK, {
      selector: "#submit",
    }),
    true,
  );
  assert.equal(
    requiresToolApproval(MCP_TOOL_NAMES.BROWSER_FILL_FORM, {
      fields: [{ selector: "#name", value: "Ada" }],
    }),
    true,
  );
  assert.equal(
    requiresToolApproval(MCP_TOOL_NAMES.BROWSER_SELECT_OPTION, {
      selector: "#country",
      values: ["cn"],
    }),
    true,
  );
  assert.equal(requiresToolApproval("external_send_data"), true);
});

test("policy annotations describe intent but unknown tools remain denied", () => {
  assert.deepEqual(getToolPolicyAnnotations(MCP_TOOL_NAMES.BROWSER_SNAPSHOT), {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  });

  const unknown = getToolPolicy("external_send_data");
  assert.equal(unknown.known, false);
  assert.equal(unknown.policyClass, "open_world");
  assert.equal(unknown.requiresApproval, true);
  assert.equal(unknown.openWorld, true);
});

test("DevTools execution is exposed only behind non-reusable arbitrary-execution approval", () => {
  const exposed = new Set(MCP_EXPOSED_TOOL_DEFINITIONS.map((tool) => tool.name));
  for (const toolName of [
    MCP_TOOL_NAMES.BROWSER_EVALUATE,
    MCP_TOOL_NAMES.BROWSER_DEBUGGER_BREAKPOINT,
    MCP_TOOL_NAMES.BROWSER_DEBUGGER_CONTROL,
  ]) {
    assert.equal(exposed.has(toolName), true);
    const policy = getToolPolicy(toolName);
    assert.equal(policy.policyClass, "arbitrary_execution");
    assert.equal(policy.approvalMode, "always");
    assert.equal(policy.mutatesBrowser, true);
    assert.equal(policy.idempotent, false);
  }
  assert.equal(exposed.has(MCP_TOOL_NAMES.BROWSER_HANDLE_DIALOG), true);
  assert.equal(
    requiresToolApproval(MCP_TOOL_NAMES.BROWSER_HANDLE_DIALOG),
    true,
  );
});

test("dynamic approval modes distinguish cleanup, task grants, and decision barriers", () => {
  assert.equal(
    getToolPolicy(MCP_TOOL_NAMES.BROWSER_NETWORK_STOP_RECORDING).approvalMode,
    "none",
  );
  assert.equal(
    getToolPolicy(MCP_TOOL_NAMES.BROWSER_NETWORK_REQUESTS, {
      digestOnly: true,
    }).approvalMode,
    "task_grant",
  );
  assert.equal(
    getToolPolicy(MCP_TOOL_NAMES.BROWSER_NETWORK_REQUESTS).approvalMode,
    "decision_barrier",
  );
  const debugActivity = getToolPolicy(
    MCP_TOOL_NAMES.BROWSER_DEBUG_ACTIVITY,
  );
  assert.equal(debugActivity.approvalMode, "task_grant");
  assert.equal(debugActivity.capability, "page.observe.network_digest");
  assert.equal(debugActivity.sensitive, false);
  assert.equal(
    getToolPolicy(MCP_TOOL_NAMES.BROWSER_CLICK, { selector: "#save" })
      .approvalMode,
    "decision_barrier",
  );
  assert.equal(
    getToolPolicy(MCP_TOOL_NAMES.BROWSER_CLICK, { selector: "#next" })
      .approvalMode,
    "task_grant",
  );
  assert.equal(
    getToolPolicy(MCP_TOOL_NAMES.BROWSER_CLICK, {
      selector: ".ant-btn-primary",
      decisionBarrier: true,
    }).approvalMode,
    "decision_barrier",
  );
  assert.equal(
    getToolPolicy(MCP_TOOL_NAMES.BROWSER_EXECUTE_ACTION_STAGE, {
      actions: [
        {
          id: "submit",
          type: "click",
          selector: ".ant-btn-primary",
        },
      ],
      decisionBarrier: true,
    }).approvalMode,
    "decision_barrier",
  );
  assert.equal(
    getToolPolicy(MCP_TOOL_NAMES.BROWSER_PRESS_KEY, { key: "Enter" })
      .approvalMode,
    "decision_barrier",
  );
  assert.equal(
    getToolPolicy(MCP_TOOL_NAMES.BROWSER_MOUSE_CLICK_XY, { x: 10, y: 20 })
      .approvalMode,
    "decision_barrier",
  );
  assert.equal(
    getToolPolicy(MCP_TOOL_NAMES.BROWSER_HANDLE_DIALOG, { action: "accept" })
      .approvalMode,
    "decision_barrier",
  );
  assert.equal(
    getToolPolicy(MCP_TOOL_NAMES.BROWSER_ACTIVITY_START).approvalMode,
    "task_grant",
  );
  const bodyCapture = getToolPolicy(MCP_TOOL_NAMES.BROWSER_ACTIVITY_START, {
    includeResponseBodies: true,
  });
  assert.equal(bodyCapture.approvalMode, "decision_barrier");
  assert.equal(bodyCapture.dataSensitivity, "raw_body");
  assert.equal(bodyCapture.sensitive, true);
});
