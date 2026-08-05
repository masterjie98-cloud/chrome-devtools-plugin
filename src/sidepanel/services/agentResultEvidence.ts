import { getToolPolicy } from "../../shared/toolPolicy";
import { isExternalMcpToolName } from "../../shared/externalMcp";
import type { AiRequestedToolCall, AiToolResultMessage } from "./aiClient";
import {
  isAgentToolResultDefinitelyNotExecuted,
  isSuccessfulAgentToolResultContent,
} from "./agentToolResult";
import { isIncrementalActivitySummaryRequest } from "./activityToolCall";

const BROWSER_EFFECT_INTENT =
  /(?:点击|双击|填写|输入|选择|勾选|取消勾选|拖拽|滚动|提交|保存|更新|删除|移除|关闭|打开|跳转|导航|返回|刷新|上传|下载|修改|设置|启用|停用|mock|拦截|代理|click|type|fill|select|check|uncheck|drag|scroll|submit|save|update|delete|remove|close|open|navigate|go back|refresh|upload|modify|set|enable|disable)/i;

const BROWSER_EFFECT_CONTEXT =
  /(?:页面|网页|按钮|链接|输入框|文本框|下拉|表单|标签页|tab|抽屉|弹窗|对话框|路由|浏览器|请求|接口|network|dom|selector|button|input|select|form|dialog|drawer|route|browser|request|api)/i;

const COMPLETION_CLAIM =
  /(?:已(?:经)?(?:完成|点击|填写|输入|选择|勾选|取消|拖拽|滚动|提交|保存|更新|删除|移除|关闭|打开|跳转|导航|返回|刷新|上传|修改|设置|启用|停用)|(?:操作|任务|处理|修改|设置|保存|提交)(?:已)?完成|(?:成功|已经生效)|(?:clicked|filled|selected|submitted|saved|updated|deleted|removed|opened|closed|navigated|completed|done|succeeded|successful))/i;

const REPORTING_INTENT =
  /(?:报告|报表|状态|健康|异常|分布|汇总|总结|分析|诊断|审计|查询|检查|report|status|health|distribution|summary|analysis|diagnos|audit|query|check)/i;

const MISSING_REPORT_BODY_REFERENCE =
  /(?:(?:报告|报表|结果|详情|内容|数据|分析)[\s\S]{0,30}(?:如上(?:所示)?|见上(?:文|方)?|已在上(?:面|方)(?:展示|显示|列出)|上(?:面|方)(?:已经)?(?:展示|显示|列出))|(?:report|results?|details?|content|data|analysis)[\s\S]{0,48}(?:(?:shown|provided|listed|available)[\s\S]{0,16}above|see above))/i;

export interface AgentResultEvidenceState {
  requestedBrowserEffect: boolean;
  successfulMutationCount: number;
  mutationAttemptCount: number;
  independentlyVerified: boolean;
}

export type AgentResultEvidenceDecision =
  | { accepted: true }
  | {
      accepted: false;
      code:
        | "UNSUPPORTED_BROWSER_EFFECT_CLAIM"
        | "UNVERIFIED_BROWSER_EFFECT";
      message: string;
    };

export function createAgentResultEvidenceState(
  input: string,
): AgentResultEvidenceState {
  return {
    requestedBrowserEffect:
      !isIncrementalActivitySummaryRequest(input) &&
      BROWSER_EFFECT_INTENT.test(input) &&
      BROWSER_EFFECT_CONTEXT.test(input),
    successfulMutationCount: 0,
    mutationAttemptCount: 0,
    independentlyVerified: false,
  };
}

export function recordAgentResultEvidence(
  state: AgentResultEvidenceState,
  calls: readonly AiRequestedToolCall[],
  results: readonly AiToolResultMessage[],
): AgentResultEvidenceState {
  const resultsById = new Map(results.map((result) => [result.toolCallId, result]));
  let successfulMutationCount = state.successfulMutationCount;
  let mutationAttemptCount = state.mutationAttemptCount;
  let independentlyVerified = state.independentlyVerified;

  for (const call of calls) {
    if (isExternalMcpToolName(call.name)) {
      continue;
    }
    const policy = getToolPolicy(call.name, call.arguments);
    const result = resultsById.get(call.id);
    if (policy.mutatesBrowser || policy.openWorld) {
      mutationAttemptCount += 1;
      if (
        result &&
        isSuccessfulAgentToolResultContent(result.content) &&
        !isAgentToolResultDefinitelyNotExecuted(result.content)
      ) {
        successfulMutationCount += 1;
        independentlyVerified = false;
      }
      continue;
    }
    if (
      successfulMutationCount > 0 &&
      result &&
      isSuccessfulAgentToolResultContent(result.content)
    ) {
      independentlyVerified = true;
    }
  }

  return {
    ...state,
    successfulMutationCount,
    mutationAttemptCount,
    independentlyVerified,
  };
}

export function arbitrateAgentFinalResult(
  state: AgentResultEvidenceState,
  finalContent: string,
): AgentResultEvidenceDecision {
  if (!COMPLETION_CLAIM.test(finalContent)) {
    return { accepted: true };
  }
  if (
    state.requestedBrowserEffect &&
    state.successfulMutationCount === 0
  ) {
    return {
      accepted: false,
      code: "UNSUPPORTED_BROWSER_EFFECT_CLAIM",
      message:
        "模型声称页面操作已完成，但本轮没有成功执行任何对应的浏览器写工具。必须实际调用工具并取得结果后才能标记完成。",
    };
  }
  if (
    state.successfulMutationCount > 0 &&
    !state.independentlyVerified
  ) {
    return {
      accepted: false,
      code: "UNVERIFIED_BROWSER_EFFECT",
      message:
        "浏览器写操作已执行，但尚无后续独立只读证据验证结果，不能标记完成。",
    };
  }
  return { accepted: true };
}

export function needsSelfContainedReportRepair(
  input: string,
  finalContent: string,
  toolExchangeCount: number,
): boolean {
  const content = finalContent.trim();
  return (
    toolExchangeCount > 0 &&
    content.length > 0 &&
    content.length < 1_600 &&
    REPORTING_INTENT.test(input) &&
    MISSING_REPORT_BODY_REFERENCE.test(content)
  );
}
