import assert from "node:assert/strict";
import test from "node:test";
import {
  arbitrateAgentFinalResult,
  createAgentResultEvidenceState,
  recordAgentResultEvidence,
} from "../src/sidepanel/services/agentResultEvidence";

test("result arbiter rejects a browser success claim without a mutation record", () => {
  const state = createAgentResultEvidenceState("点击保存按钮并确认页面更新");
  const decision = arbitrateAgentFinalResult(state, "已经点击并保存成功。");

  assert.equal(decision.accepted, false);
  if (!decision.accepted) {
    assert.equal(decision.code, "UNSUPPORTED_BROWSER_EFFECT_CLAIM");
  }
});

test("result arbiter requires an independent read after a successful mutation", () => {
  let state = createAgentResultEvidenceState("填写表单并保存");
  state = recordAgentResultEvidence(
    state,
    [
      {
        id: "click",
        name: "browser_click",
        arguments: { selector: "#save" },
        rawArguments: '{"selector":"#save"}',
      },
    ],
    [
      {
        toolCallId: "click",
        name: "browser_click",
        content: '{"ok":true,"matched":true}',
      },
    ],
  );

  let decision = arbitrateAgentFinalResult(state, "保存成功。");
  assert.equal(decision.accepted, false);
  if (!decision.accepted) {
    assert.equal(decision.code, "UNVERIFIED_BROWSER_EFFECT");
  }

  state = recordAgentResultEvidence(
    state,
    [
      {
        id: "observe",
        name: "browser_snapshot",
        arguments: {},
        rawArguments: "{}",
      },
    ],
    [
      {
        toolCallId: "observe",
        name: "browser_snapshot",
        content: '{"ok":true,"text":"Saved"}',
      },
    ],
  );
  decision = arbitrateAgentFinalResult(state, "保存成功。");
  assert.deepEqual(decision, { accepted: true });
});

test("result arbiter does not turn ordinary factual answers into browser tasks", () => {
  const state = createAgentResultEvidenceState("解释浏览器是怎么工作的");
  assert.deepEqual(
    arbitrateAgentFinalResult(state, "说明已经完成。"),
    { accepted: true },
  );
});
