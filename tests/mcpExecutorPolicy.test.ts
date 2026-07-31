import assert from "node:assert/strict";
import test from "node:test";
import {
  INTERNAL_TOOL_EFFECTS,
  MCP_INTERNAL_TOOL_BINDINGS,
  assertMcpExecutorBoundary,
} from "../src/shared/mcpExecutionPolicy";
import {
  MCP_EXPOSED_TOOL_DEFINITIONS,
  MCP_TOOL_NAMES,
} from "../src/shared/mcpTools";
import { getToolPolicy } from "../src/shared/toolPolicy";
import { TOOL_NAMES } from "../src/shared/tools";

test("every MCP and internal tool has a fail-closed executor declaration", () => {
  assert.deepEqual(
    Object.keys(MCP_INTERNAL_TOOL_BINDINGS).sort(),
    Object.values(MCP_TOOL_NAMES).sort(),
  );
  assert.deepEqual(
    Object.keys(INTERNAL_TOOL_EFFECTS).sort(),
    Object.values(TOOL_NAMES).sort(),
  );
});

test("read-only MCP tools cannot bind to DOM, browser, or network mutation executors", () => {
  for (const { name } of MCP_EXPOSED_TOOL_DEFINITIONS) {
    const policy = getToolPolicy(name);
    if (policy.mutatesBrowser) {
      continue;
    }
    for (const internalToolName of MCP_INTERNAL_TOOL_BINDINGS[name]) {
      const effect = INTERNAL_TOOL_EFFECTS[internalToolName];
      assert.equal(effect.mutatesDom, false, `${name} -> ${internalToolName}`);
      assert.equal(effect.mutatesBrowser, false, `${name} -> ${internalToolName}`);
      assert.doesNotThrow(() =>
        assertMcpExecutorBoundary(name, internalToolName, false),
      );
    }
  }
});

test("every targetRef consumer may execute the live semantic freshness check", () => {
  const targetRefConsumers = [
    MCP_TOOL_NAMES.BROWSER_WORKFLOW,
    MCP_TOOL_NAMES.BROWSER_LOCATE_SOURCE,
    MCP_TOOL_NAMES.BROWSER_TAKE_SCREENSHOT,
    MCP_TOOL_NAMES.BROWSER_CLICK,
    MCP_TOOL_NAMES.BROWSER_HOVER,
    MCP_TOOL_NAMES.BROWSER_DRAG,
    MCP_TOOL_NAMES.BROWSER_FILL_FORM,
    MCP_TOOL_NAMES.BROWSER_EXECUTE_ACTION_STAGE,
    MCP_TOOL_NAMES.BROWSER_ACT,
    MCP_TOOL_NAMES.BROWSER_VERIFY,
    MCP_TOOL_NAMES.BROWSER_TYPE,
    MCP_TOOL_NAMES.BROWSER_PRESS_KEY,
    MCP_TOOL_NAMES.BROWSER_SELECT_OPTION,
  ] as const;

  for (const toolName of targetRefConsumers) {
    assert.doesNotThrow(
      () =>
        assertMcpExecutorBoundary(
          toolName,
          TOOL_NAMES.DOM_GET_PAGE_INFO,
          getToolPolicy(toolName).mutatesBrowser,
        ),
      `${toolName} must be able to validate a targetRef before execution`,
    );
  }
});

test("target selection is routing-only and cannot authorize an unrelated executor", () => {
  assert.equal(
    INTERNAL_TOOL_EFFECTS[TOOL_NAMES.BROWSER_SET_TARGET_TAB].mutationScope,
    "routing",
  );
  assert.equal(
    INTERNAL_TOOL_EFFECTS[TOOL_NAMES.BROWSER_SET_TARGET_FRAME].mutationScope,
    "routing",
  );
  assert.throws(
    () =>
      assertMcpExecutorBoundary(
        MCP_TOOL_NAMES.BROWSER_SNAPSHOT,
        TOOL_NAMES.BROWSER_CLICK,
        false,
      ),
    /EXECUTOR_POLICY_VIOLATION/,
  );
  assert.throws(
    () =>
      assertMcpExecutorBoundary(
        MCP_TOOL_NAMES.BROWSER_CLICK,
        TOOL_NAMES.BROWSER_CLICK,
        false,
      ),
    /read-only.*cannot enter page mutation executor/,
  );
  assert.throws(
    () =>
      assertMcpExecutorBoundary(
        MCP_TOOL_NAMES.BROWSER_GET_CONTEXT_DIGEST,
        TOOL_NAMES.DOM_GET_PAGE_INFO,
        false,
      ),
    /cannot execute/,
  );
});
