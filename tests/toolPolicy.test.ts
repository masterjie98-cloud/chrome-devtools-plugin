import assert from "node:assert/strict";
import test from "node:test";
import {
  MCP_EXPOSED_TOOL_DEFINITIONS,
  MCP_TOOL_NAMES,
} from "../src/shared/mcpTools";
import {
  getToolPolicy,
  getToolPolicyAnnotations,
  hasExplicitToolPolicy,
  requiresToolApproval,
} from "../src/shared/toolPolicy";

test("every exposed MCP tool has explicit policy metadata", () => {
  const missing = MCP_EXPOSED_TOOL_DEFINITIONS.map((tool) => tool.name).filter(
    (toolName) => !hasExplicitToolPolicy(toolName),
  );

  assert.deepEqual(missing, []);
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

test("arbitrary evaluate stays hidden while scoped dialog handling is exposed", () => {
  const exposed = new Set(MCP_EXPOSED_TOOL_DEFINITIONS.map((tool) => tool.name));
  assert.equal(exposed.has(MCP_TOOL_NAMES.BROWSER_EVALUATE), false);
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
});
