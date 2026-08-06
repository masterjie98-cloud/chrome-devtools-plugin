import assert from "node:assert/strict";
import test from "node:test";
import {
  arbitrateAgentFinalResult,
  createAgentResultEvidenceState,
  needsSelfContainedReportRepair,
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

test("external MCP calls are not browser mutation or verification evidence", () => {
  let state = createAgentResultEvidenceState("点击保存按钮并确认页面更新");
  state = recordAgentResultEvidence(
    state,
    [
      {
        id: "external-query",
        name: "extmcp__prometheus__query_deadbee",
        arguments: { query: "up" },
        rawArguments: '{"query":"up"}',
      },
    ],
    [
      {
        toolCallId: "external-query",
        name: "extmcp__prometheus__query_deadbee",
        content: '{"status":"success"}',
      },
    ],
  );

  assert.equal(state.mutationAttemptCount, 0);
  assert.equal(state.successfulMutationCount, 0);
  assert.equal(state.independentlyVerified, false);
  const decision = arbitrateAgentFinalResult(state, "已经点击并保存成功。");
  assert.equal(decision.accepted, false);
  if (!decision.accepted) {
    assert.equal(decision.code, "UNSUPPORTED_BROWSER_EFFECT_CLAIM");
  }
});

test("result arbiter does not turn ordinary factual answers into browser tasks", () => {
  const state = createAgentResultEvidenceState("解释浏览器是怎么工作的");
  assert.deepEqual(
    arbitrateAgentFinalResult(state, "说明已经完成。"),
    { accepted: true },
  );
});

test("result arbiter does not combine MCP return wording with a negated browser clause", () => {
  const state = createAgentResultEvidenceState(
    "只使用已启用的 k8s-dev MCP 查询 Pod。如果首次查询返回 isError，修正 namespace 后重试。禁止调用任何浏览器页面工具。",
  );

  assert.equal(state.requestedBrowserEffect, false);
  assert.deepEqual(
    arbitrateAgentFinalResult(
      state,
      "## Pod 报告\n\nMCP 查询已经完成，并保留了错误与限制说明。",
    ),
    { accepted: true },
  );
});

test("result arbiter still recognizes explicit browser and network mutations", () => {
  assert.equal(
    createAgentResultEvidenceState("在页面上点击保存按钮").requestedBrowserEffect,
    true,
  );
  assert.equal(
    createAgentResultEvidenceState("拦截 Network 请求并 mock 接口响应")
      .requestedBrowserEffect,
    true,
  );
  assert.equal(
    createAgentResultEvidenceState("不要点击页面按钮，只查询 MCP")
      .requestedBrowserEffect,
    false,
  );
});

test("result arbiter treats a saved-cursor activity summary as read-only evidence", () => {
  const state = createAgentResultEvidenceState(
    "刚才页面发生了什么变化？只读取监听开始后保存游标之后的增量摘要，不要全量读取 Network。",
  );
  assert.equal(state.requestedBrowserEffect, false);
  assert.deepEqual(
    arbitrateAgentFinalResult(
      state,
      "页面停留在登录页，期间已刷新 5 次，共观察到 25 条 Network 请求。",
    ),
    { accepted: true },
  );
});

test("report arbiter rejects a short final answer that points to a missing report above", () => {
  assert.equal(
    needsSelfContainedReportRepair(
      "生成 Kubernetes 服务状态报告，包含节点、Pod 和异常 Deployment。",
      "Kubernetes 服务状态报告已完整生成，所有关键维度均已验证。报告如上所示。",
      6,
    ),
    true,
  );
  assert.equal(
    needsSelfContainedReportRepair(
      "生成 Kubernetes 服务状态报告。",
      "## 集群状态\n\n| 状态 | 数量 |\n| --- | ---: |\n| Running | 643 |",
      2,
    ),
    false,
  );
  assert.equal(
    needsSelfContainedReportRepair(
      "解释 CSS 盒模型。",
      "示意图如上所示。",
      1,
    ),
    false,
  );
});
