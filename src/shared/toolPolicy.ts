import {
  MCP_TOOL_NAMES,
  normalizeMcpToolName,
  type McpToolName,
} from "./mcpTools";

export type ToolPolicyClass =
  | "safe_read"
  | "sensitive_read"
  | "reversible_write"
  | "page_action"
  | "destructive_write"
  | "arbitrary_execution"
  | "open_world";

export type ToolEffect =
  | "read"
  | "observation_state"
  | "page_interaction"
  | "browser_navigation"
  | "network_mutation"
  | "arbitrary_execution"
  | "unknown";

export type ToolDataSensitivity =
  | "safe_metadata"
  | "page_content"
  | "sensitive_value"
  | "raw_body"
  | "unknown";

export type ToolApprovalMode =
  | "none"
  | "task_grant"
  | "decision_barrier"
  | "always";

export type ToolCapability =
  | "page.observe.visual"
  | "page.observe.network_digest"
  | "page.observe.console_sanitized"
  | "page.observe.sensitive"
  | "page.interact.low_risk"
  | "page.interact.pointer"
  | "page.style.temporary"
  | "browser.navigate"
  | "browser.network.mutate"
  | "browser.sensitive"
  | "browser.execute.arbitrary"
  | "external.open_world";

export interface ToolPolicy {
  toolName: string;
  policyClass: ToolPolicyClass;
  known: boolean;
  requiresApproval: boolean;
  sensitive: boolean;
  mutatesBrowser: boolean;
  destructive: boolean;
  idempotent: boolean;
  openWorld: boolean;
  effect: ToolEffect;
  dataSensitivity: ToolDataSensitivity;
  approvalMode: ToolApprovalMode;
  capability?: ToolCapability;
  reason: string;
}

export interface ToolPolicyAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

interface PolicyTemplate
  extends Omit<ToolPolicy, "toolName" | "known" | "policyClass"> {
  policyClass: ToolPolicyClass;
}

const POLICY_TEMPLATES: Record<ToolPolicyClass, PolicyTemplate> = {
  safe_read: {
    policyClass: "safe_read",
    requiresApproval: false,
    sensitive: false,
    mutatesBrowser: false,
    destructive: false,
    idempotent: true,
    openWorld: false,
    effect: "read",
    dataSensitivity: "safe_metadata",
    approvalMode: "none",
    reason: "Reads bounded, non-sensitive page state without changing the browser.",
  },
  sensitive_read: {
    policyClass: "sensitive_read",
    requiresApproval: true,
    sensitive: true,
    mutatesBrowser: false,
    destructive: false,
    idempotent: true,
    openWorld: false,
    effect: "read",
    dataSensitivity: "sensitive_value",
    approvalMode: "decision_barrier",
    capability: "page.observe.sensitive",
    reason: "May expose screenshots, credentials, storage, network data, or private conversation content.",
  },
  reversible_write: {
    policyClass: "reversible_write",
    requiresApproval: true,
    sensitive: false,
    mutatesBrowser: true,
    destructive: false,
    idempotent: false,
    openWorld: false,
    effect: "observation_state",
    dataSensitivity: "page_content",
    approvalMode: "task_grant",
    capability: "page.style.temporary",
    reason: "Changes page or browser state and therefore requires user confirmation.",
  },
  page_action: {
    policyClass: "page_action",
    requiresApproval: true,
    sensitive: false,
    mutatesBrowser: true,
    destructive: false,
    idempotent: false,
    openWorld: false,
    effect: "page_interaction",
    dataSensitivity: "page_content",
    approvalMode: "task_grant",
    capability: "page.interact.low_risk",
    reason: "Interacts with the page and may trigger application side effects.",
  },
  destructive_write: {
    policyClass: "destructive_write",
    requiresApproval: true,
    sensitive: false,
    mutatesBrowser: true,
    destructive: true,
    idempotent: false,
    openWorld: false,
    effect: "network_mutation",
    dataSensitivity: "page_content",
    approvalMode: "decision_barrier",
    capability: "browser.network.mutate",
    reason: "Can navigate, close, delete, persist, or change browser/network state.",
  },
  arbitrary_execution: {
    policyClass: "arbitrary_execution",
    requiresApproval: true,
    sensitive: true,
    mutatesBrowser: true,
    destructive: true,
    idempotent: false,
    openWorld: false,
    effect: "arbitrary_execution",
    dataSensitivity: "sensitive_value",
    approvalMode: "always",
    capability: "browser.execute.arbitrary",
    reason: "Executes caller-provided JavaScript with page access.",
  },
  open_world: {
    policyClass: "open_world",
    requiresApproval: true,
    sensitive: true,
    mutatesBrowser: true,
    destructive: true,
    idempotent: false,
    openWorld: true,
    effect: "unknown",
    dataSensitivity: "unknown",
    approvalMode: "always",
    capability: "external.open_world",
    reason: "The tool is external or unknown, so its effects cannot be trusted by default.",
  },
};

const POLICY_GROUPS = {
  safe_read: [
    MCP_TOOL_NAMES.BROWSER_GET_SELECTED_ELEMENT,
    MCP_TOOL_NAMES.BROWSER_GET_CONTEXT_DIGEST,
    MCP_TOOL_NAMES.BROWSER_GET_PAGE_CONTEXT,
    MCP_TOOL_NAMES.BROWSER_SNAPSHOT,
    MCP_TOOL_NAMES.BROWSER_QUERY_DOM,
    MCP_TOOL_NAMES.BROWSER_WAIT_FOR,
    MCP_TOOL_NAMES.BROWSER_LIST_TABS,
    MCP_TOOL_NAMES.BROWSER_SET_TARGET_TAB,
    MCP_TOOL_NAMES.BROWSER_LIST_FRAMES,
    MCP_TOOL_NAMES.BROWSER_SET_TARGET_FRAME,
  ],
  sensitive_read: [
    MCP_TOOL_NAMES.BROWSER_GET_PLUGIN_CONVERSATION,
    MCP_TOOL_NAMES.BROWSER_GET_AUDIT_EVENTS,
    MCP_TOOL_NAMES.BROWSER_GET_LAST_PLUGIN_MESSAGE,
    MCP_TOOL_NAMES.BROWSER_TAKE_SCREENSHOT,
    MCP_TOOL_NAMES.BROWSER_STORAGE_STATE,
    MCP_TOOL_NAMES.BROWSER_COOKIE_LIST,
    MCP_TOOL_NAMES.BROWSER_CONSOLE_MESSAGES,
    MCP_TOOL_NAMES.BROWSER_NETWORK_REQUESTS,
    MCP_TOOL_NAMES.BROWSER_NETWORK_LIST_REQUESTS,
    MCP_TOOL_NAMES.BROWSER_NETWORK_GET_REQUEST,
    MCP_TOOL_NAMES.BROWSER_NETWORK_GET_RESPONSE_BODY,
    MCP_TOOL_NAMES.BROWSER_PROXY_LIST_RULES,
    MCP_TOOL_NAMES.BROWSER_PROXY_LIST_HITS,
    MCP_TOOL_NAMES.BROWSER_LIST_NETWORK_RULES,
  ],
  reversible_write: [
    MCP_TOOL_NAMES.BROWSER_START_ELEMENT_PICKER,
    MCP_TOOL_NAMES.BROWSER_CANCEL_ELEMENT_PICKER,
    MCP_TOOL_NAMES.BROWSER_HIGHLIGHT_ELEMENT,
    MCP_TOOL_NAMES.BROWSER_CLEAR_HIGHLIGHTS,
    MCP_TOOL_NAMES.BROWSER_RESIZE,
    MCP_TOOL_NAMES.BROWSER_HOVER,
    MCP_TOOL_NAMES.BROWSER_NETWORK_START_RECORDING,
    MCP_TOOL_NAMES.BROWSER_NETWORK_STOP_RECORDING,
    MCP_TOOL_NAMES.BROWSER_APPLY_CSS_PATCH,
    MCP_TOOL_NAMES.BROWSER_REMOVE_CSS_PATCH,
    MCP_TOOL_NAMES.BROWSER_DEBUGGER_DETACH,
  ],
  page_action: [
    MCP_TOOL_NAMES.BROWSER_CLICK,
    MCP_TOOL_NAMES.BROWSER_DRAG,
    MCP_TOOL_NAMES.BROWSER_FILL_FORM,
    MCP_TOOL_NAMES.BROWSER_EXECUTE_ACTION_STAGE,
    MCP_TOOL_NAMES.BROWSER_TYPE,
    MCP_TOOL_NAMES.BROWSER_PRESS_KEY,
    MCP_TOOL_NAMES.BROWSER_SELECT_OPTION,
    MCP_TOOL_NAMES.BROWSER_MOUSE_MOVE_XY,
    MCP_TOOL_NAMES.BROWSER_MOUSE_CLICK_XY,
    MCP_TOOL_NAMES.BROWSER_MOUSE_DOWN,
    MCP_TOOL_NAMES.BROWSER_MOUSE_UP,
    MCP_TOOL_NAMES.BROWSER_MOUSE_DRAG_XY,
    MCP_TOOL_NAMES.BROWSER_MOUSE_WHEEL_XY,
    MCP_TOOL_NAMES.BROWSER_HANDLE_DIALOG,
    MCP_TOOL_NAMES.BROWSER_SET_DOM_VALUE,
  ],
  destructive_write: [
    MCP_TOOL_NAMES.BROWSER_NAVIGATE,
    MCP_TOOL_NAMES.BROWSER_NAVIGATE_BACK,
    MCP_TOOL_NAMES.BROWSER_NAVIGATE_FORWARD,
    MCP_TOOL_NAMES.BROWSER_RELOAD,
    MCP_TOOL_NAMES.BROWSER_CLOSE,
    MCP_TOOL_NAMES.BROWSER_COOKIE_SET,
    MCP_TOOL_NAMES.BROWSER_COOKIE_DELETE,
    MCP_TOOL_NAMES.BROWSER_NETWORK_CLEAR,
    MCP_TOOL_NAMES.BROWSER_PROXY_ENABLE,
    MCP_TOOL_NAMES.BROWSER_PROXY_DISABLE,
    MCP_TOOL_NAMES.BROWSER_PROXY_UPSERT_RULE,
    MCP_TOOL_NAMES.BROWSER_PROXY_REMOVE_RULE,
    MCP_TOOL_NAMES.BROWSER_PROXY_CLEAR_RULES,
    MCP_TOOL_NAMES.BROWSER_UPSERT_HEADER_RULE,
    MCP_TOOL_NAMES.BROWSER_UPSERT_GET_MOCK,
    MCP_TOOL_NAMES.BROWSER_REMOVE_NETWORK_RULE,
  ],
  arbitrary_execution: [MCP_TOOL_NAMES.BROWSER_EVALUATE],
} as const satisfies Partial<
  Record<ToolPolicyClass, readonly McpToolName[]>
>;

const POLICY_CLASS_BY_TOOL = buildPolicyIndex();

export function getToolPolicy(
  toolName: string,
  args: Record<string, unknown> = {},
): ToolPolicy {
  const normalizedName = normalizeMcpToolName(toolName);
  if (!normalizedName) {
    return createPolicy(toolName.trim() || "unknown", "open_world", false);
  }

  const baseClass = POLICY_CLASS_BY_TOOL.get(normalizedName);
  if (!baseClass) {
    return createPolicy(normalizedName, "open_world", false);
  }

  if (baseClass === "page_action" && args.decisionBarrier === true) {
    return overridePolicy(createPolicy(normalizedName, baseClass, true), {
      destructive: true,
      approvalMode: "decision_barrier",
      reason:
        "The executor resolved a target that requires a separate user decision barrier.",
    });
  }

  if (
    normalizedName === MCP_TOOL_NAMES.BROWSER_DRAG ||
    normalizedName === MCP_TOOL_NAMES.BROWSER_MOUSE_CLICK_XY ||
    normalizedName === MCP_TOOL_NAMES.BROWSER_MOUSE_DOWN ||
    normalizedName === MCP_TOOL_NAMES.BROWSER_MOUSE_UP ||
    normalizedName === MCP_TOOL_NAMES.BROWSER_MOUSE_DRAG_XY
  ) {
    return overridePolicy(createPolicy(normalizedName, baseClass, true), {
      destructive: true,
      approvalMode: "decision_barrier",
      reason:
        "This low-level pointer action cannot prove the resolved target semantics before dispatch and must remain a one-time decision barrier.",
    });
  }

  if (
    normalizedName === MCP_TOOL_NAMES.BROWSER_HANDLE_DIALOG &&
    args.action === "accept"
  ) {
    return overridePolicy(createPolicy(normalizedName, baseClass, true), {
      destructive: true,
      approvalMode: "decision_barrier",
      reason:
        "Accepting a JavaScript dialog may commit a page action and requires a separate confirmation.",
    });
  }

  if (
    normalizedName === MCP_TOOL_NAMES.BROWSER_QUERY_DOM &&
    (args.maxOuterHTMLLength === 0 || args.maxTextLength === 0)
  ) {
    return createPolicy(normalizedName, "sensitive_read", true);
  }

  if (
    normalizedName === MCP_TOOL_NAMES.BROWSER_EXECUTE_ACTION_STAGE &&
    containsCommitLikeStageAction(args)
  ) {
    return overridePolicy(createPolicy(normalizedName, baseClass, true), {
      destructive: true,
      approvalMode: "decision_barrier",
      reason: "The bounded action stage contains a commit-like click or sensitive field and must be confirmed as one decision barrier.",
    });
  }

  if (normalizedName === MCP_TOOL_NAMES.BROWSER_NETWORK_STOP_RECORDING) {
    return overridePolicy(createPolicy(normalizedName, baseClass, true), {
      requiresApproval: false,
      approvalMode: "none",
      capability: undefined,
      reason: "Stops the current bounded local observation session without exposing data or changing the page.",
    });
  }

  if (normalizedName === MCP_TOOL_NAMES.BROWSER_TAKE_SCREENSHOT) {
    return overridePolicy(createPolicy(normalizedName, baseClass, true), {
      dataSensitivity: "page_content",
      approvalMode: "task_grant",
      capability: "page.observe.visual",
      reason: "Captures sanitized page pixels for the current bounded task and egress destination.",
    });
  }

  if (normalizedName === MCP_TOOL_NAMES.BROWSER_NETWORK_START_RECORDING) {
    return overridePolicy(createPolicy(normalizedName, baseClass, true), {
      effect: "observation_state",
      dataSensitivity: "safe_metadata",
      approvalMode: "task_grant",
      capability: "page.observe.network_digest",
      reason: "Starts bounded Network observation for the current task; raw traffic remains separately protected.",
    });
  }

  if (
    normalizedName === MCP_TOOL_NAMES.BROWSER_NETWORK_REQUESTS &&
    args.digestOnly === true
  ) {
    return overridePolicy(createPolicy(normalizedName, baseClass, true), {
      sensitive: false,
      dataSensitivity: "page_content",
      approvalMode: "task_grant",
      capability: "page.observe.network_digest",
      reason: "Reads a bounded grouped Network digest without raw request rows or response bodies.",
    });
  }

  if (normalizedName === MCP_TOOL_NAMES.BROWSER_CONSOLE_MESSAGES) {
    return overridePolicy(createPolicy(normalizedName, baseClass, true), {
      dataSensitivity: "page_content",
      approvalMode: "task_grant",
      capability: "page.observe.console_sanitized",
      reason: "Reads bounded sanitized console output for the current task.",
    });
  }

  if (
    normalizedName === MCP_TOOL_NAMES.BROWSER_CLICK &&
    isCommitLikeSelector(args.selector)
  ) {
    return overridePolicy(createPolicy(normalizedName, baseClass, true), {
      destructive: true,
      approvalMode: "decision_barrier",
      reason: "The requested target appears commit-like and must be confirmed at the decision boundary.",
    });
  }

  if (
    normalizedName === MCP_TOOL_NAMES.BROWSER_TYPE &&
    args.submit === true
  ) {
    return overridePolicy(createPolicy(normalizedName, baseClass, true), {
      destructive: true,
      approvalMode: "decision_barrier",
      reason: "Typing followed by submit must be confirmed at the decision boundary.",
    });
  }

  if (
    normalizedName === MCP_TOOL_NAMES.BROWSER_PRESS_KEY &&
    typeof args.key === "string" &&
    args.key.trim().toLowerCase() === "enter"
  ) {
    return overridePolicy(createPolicy(normalizedName, baseClass, true), {
      destructive: true,
      approvalMode: "decision_barrier",
      reason: "Enter can submit the focused form and requires a decision barrier.",
    });
  }

  if (
    (normalizedName === MCP_TOOL_NAMES.BROWSER_TYPE ||
      normalizedName === MCP_TOOL_NAMES.BROWSER_FILL_FORM ||
      normalizedName === MCP_TOOL_NAMES.BROWSER_SET_DOM_VALUE) &&
    containsSensitiveFieldHint(args)
  ) {
    return overridePolicy(createPolicy(normalizedName, baseClass, true), {
      sensitive: true,
      dataSensitivity: "sensitive_value",
      approvalMode: "decision_barrier",
      reason: "The requested field appears to contain a password, OTP, token, secret, or payment value.",
    });
  }

  return createPolicy(normalizedName, baseClass, true);
}

export function requiresToolApproval(
  toolName: string,
  args: Record<string, unknown> = {},
): boolean {
  return getToolPolicy(toolName, args).requiresApproval;
}

export function getToolPolicyAnnotations(
  toolName: string,
  args: Record<string, unknown> = {},
): ToolPolicyAnnotations {
  const policy = getToolPolicy(toolName, args);
  return {
    readOnlyHint: !policy.mutatesBrowser,
    destructiveHint: policy.destructive,
    idempotentHint: policy.idempotent,
    openWorldHint: policy.openWorld,
  };
}

export function hasExplicitToolPolicy(toolName: string): boolean {
  const normalizedName = normalizeMcpToolName(toolName);
  return Boolean(normalizedName && POLICY_CLASS_BY_TOOL.has(normalizedName));
}

function buildPolicyIndex(): Map<McpToolName, ToolPolicyClass> {
  const result = new Map<McpToolName, ToolPolicyClass>();

  for (const [policyClass, names] of Object.entries(POLICY_GROUPS) as Array<
    [ToolPolicyClass, readonly McpToolName[]]
  >) {
    for (const name of names) {
      if (result.has(name)) {
        throw new Error(`Duplicate tool policy classification: ${name}`);
      }
      result.set(name, policyClass);
    }
  }

  return result;
}

function createPolicy(
  toolName: string,
  policyClass: ToolPolicyClass,
  known: boolean,
): ToolPolicy {
  return {
    toolName,
    known,
    ...POLICY_TEMPLATES[policyClass],
  };
}

function overridePolicy(
  policy: ToolPolicy,
  overrides: Partial<ToolPolicy>,
): ToolPolicy {
  const result = { ...policy, ...overrides };
  return {
    ...result,
    requiresApproval: result.approvalMode !== "none",
  };
}

function isCommitLikeSelector(value: unknown): boolean {
  return (
    typeof value === "string" &&
    /(?:submit|save|update|delete|remove|publish|send|pay|purchase|confirm|commit|upload|logout|signout|create|apply|approve|reject|deploy|提交|保存|更新|修改|删除|发布|发送|支付|确认|上传|退出|创建|申请|批准|拒绝|部署)/i.test(
      value,
    )
  );
}

function containsSensitiveFieldHint(args: Record<string, unknown>): boolean {
  try {
    return /(?:password|passwd|pwd|otp|one.?time|token|secret|credit.?card|card.?number|cvv|cvc|密码|验证码|口令|密钥|银行卡)/i.test(
      JSON.stringify(args),
    );
  } catch {
    return true;
  }
}

function containsCommitLikeStageAction(args: Record<string, unknown>): boolean {
  if (!Array.isArray(args.actions)) {
    return true;
  }
  return args.actions.some((action) => {
    if (!action || typeof action !== "object") {
      return true;
    }
    const candidate = action as Record<string, unknown>;
    return (
      (candidate.type === "click" && isCommitLikeSelector(candidate.selector)) ||
      ((candidate.type === "fill" || candidate.type === "select") &&
        containsSensitiveFieldHint(candidate))
    );
  });
}
