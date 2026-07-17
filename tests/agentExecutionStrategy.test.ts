import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAgentExecutionStrategyPrompt,
  describeAgentToolBatchPlan,
  initialAgentPlanningSteps,
  MAX_AGENT_TOOL_BATCH_SIZE,
} from "../src/sidepanel/services/agentExecutionStrategy";
import {
  isAgentToolResultDefinitelyNotExecuted,
  isSuccessfulAgentToolResultContent,
} from "../src/sidepanel/services/agentToolResult";
import type { AiRequestedToolCall } from "../src/sidepanel/services/aiClient";

test("execution strategy is task-general and defines dependency barriers", () => {
  const prompt = buildAgentExecutionStrategyPrompt();

  assert.match(prompt, /Goal-Evidence-Action-Barrier-Verify-Replan/);
  assert.match(prompt, /forms are only one possible task shape/);
  assert.match(prompt, /decision barrier/i);
  assert.match(prompt, /arguments depend on an earlier result/i);
  assert.match(prompt, /at most 4 calls/i);
  assert.match(prompt, /current page evidence/);
  assert.match(prompt, /one browser_execute_action_stage/);
  assert.match(prompt, /browser_fill_form directly/);
  assert.match(prompt, /native browser CSS only/);
  assert.match(prompt, /exact selector from the freshest browser_snapshot/);
  assert.match(prompt, /do not retry it unchanged/i);
  assert.match(prompt, /Playwright\/jQuery text selectors/);
  assert.match(prompt, /re-plan from current evidence/i);
  assert.equal(MAX_AGENT_TOOL_BATCH_SIZE, 4);
  assert.equal(initialAgentPlanningSteps().length, 4);
});

test("task-state plan distinguishes read evidence from ordered effects", () => {
  const reads: AiRequestedToolCall[] = [
    toolCall("read-dom", "browser_query_dom", { query: "button" }),
    toolCall("read-network", "browser_network_requests", {}),
  ];
  const effects: AiRequestedToolCall[] = [
    toolCall("click", "browser_click", { selector: "#open" }),
    toolCall("type", "browser_type", { selector: "#name", text: "demo" }),
  ];

  assert.match(describeAgentToolBatchPlan(reads).join("\n"), /只读观察批次/);
  assert.match(describeAgentToolBatchPlan(effects).join("\n"), /按请求顺序/);
  assert.match(describeAgentToolBatchPlan(effects).join("\n"), /停止剩余动作/);
});

test("tool result success classification rejects failed and skipped states", () => {
  assert.equal(isSuccessfulAgentToolResultContent('{"ok":true}'), true);
  assert.equal(isSuccessfulAgentToolResultContent('{"matched":false}'), false);
  assert.equal(isSuccessfulAgentToolResultContent('{"skipped":true}'), false);
  assert.equal(
    isSuccessfulAgentToolResultContent(
      '{"errorCode":"AGENT_BATCH_DEPENDENCY_SKIPPED"}',
    ),
    false,
  );
  assert.equal(isSuccessfulAgentToolResultContent("plain successful result"), true);
  assert.equal(isSuccessfulAgentToolResultContent(""), false);
  assert.equal(isAgentToolResultDefinitelyNotExecuted('{"denied":true}'), true);
  assert.equal(isAgentToolResultDefinitelyNotExecuted('{"skipped":true}'), true);
  assert.equal(isAgentToolResultDefinitelyNotExecuted('{"matched":false}'), true);
  assert.equal(
    isAgentToolResultDefinitelyNotExecuted(
      JSON.stringify({
        error:
          "TOOL_FAILED: Failed to execute 'querySelectorAll' on 'Document': 'span:contains(\"Service Account\")' is not a valid selector.",
      }),
    ),
    true,
  );
  assert.equal(
    isAgentToolResultDefinitelyNotExecuted(
      '{"error":"INVALID_NATIVE_CSS_SELECTOR: use native CSS only."}',
    ),
    true,
  );
  assert.equal(
    isAgentToolResultDefinitelyNotExecuted(
      '{"error":"TRUSTED_INPUT_TARGET_NOT_FOUND: target matched no element."}',
    ),
    true,
  );
  assert.equal(
    isAgentToolResultDefinitelyNotExecuted(
      '{"error":"STALE_CONTEXT: browser revision changed while approval was pending."}',
    ),
    true,
  );
  assert.equal(
    isAgentToolResultDefinitelyNotExecuted('{"error":"partial failure"}'),
    false,
  );
  assert.equal(
    isAgentToolResultDefinitelyNotExecuted(
      '{"error":"MCP tool connection closed before a result was returned."}',
    ),
    false,
  );
});

function toolCall(
  id: string,
  name: string,
  args: Record<string, unknown>,
): AiRequestedToolCall {
  return {
    id,
    name,
    arguments: args,
    rawArguments: JSON.stringify(args),
  };
}
