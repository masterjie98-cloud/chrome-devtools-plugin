export interface ActionTargetDescriptor {
  tagName: string;
  role?: string;
  inputType?: string;
  accessibleName?: string;
  text?: string;
  id?: string;
  name?: string;
  autocomplete?: string;
  placeholder?: string;
  testId?: string;
  formAssociated?: boolean;
}

export interface ActionTargetRisk {
  actionRisk: "ordinary" | "decision_barrier";
  actionRiskReason?: string;
  dataSensitivity: "ordinary" | "sensitive";
  dataSensitivityReason?: string;
}

const COMMIT_LIKE_PATTERN =
  /(?:submit|save|update|delete|remove|publish|send|pay|purchase|confirm|commit|upload|logout|signout|create|apply|approve|reject|deploy|提交|保存|更新|修改|删除|发布|发送|支付|确认|上传|退出|创建|申请|批准|拒绝|部署)/i;
const SENSITIVE_FIELD_PATTERN =
  /(?:password|passwd|pwd|otp|one.?time|token|secret|api.?key|credit.?card|card.?number|cvv|cvc|pin|密码|验证码|口令|密钥|银行卡)/i;
const SENSITIVE_AUTOCOMPLETE_TOKENS = new Set([
  "current-password",
  "new-password",
  "one-time-code",
  "cc-number",
  "cc-csc",
  "cc-exp",
]);

export function classifyActionTarget(
  descriptor: ActionTargetDescriptor,
): ActionTargetRisk {
  const inputType = descriptor.inputType?.trim().toLowerCase();
  const autocompleteTokens = (descriptor.autocomplete ?? "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const semanticText = [
    descriptor.accessibleName,
    descriptor.text,
    descriptor.id,
    descriptor.name,
    descriptor.placeholder,
    descriptor.testId,
  ]
    .filter(Boolean)
    .join(" ");

  let actionRiskReason: string | undefined;
  if (inputType === "submit") {
    actionRiskReason = "resolved target is a submit control";
  } else if (inputType === "reset") {
    actionRiskReason = "resolved target resets form state";
  } else if (inputType === "file") {
    actionRiskReason = "resolved target opens a local file chooser";
  } else if (COMMIT_LIKE_PATTERN.test(semanticText)) {
    actionRiskReason = "resolved target has commit-like semantics";
  }

  let dataSensitivityReason: string | undefined;
  if (inputType === "password") {
    dataSensitivityReason = "resolved target is a password control";
  } else if (
    autocompleteTokens.some((token) =>
      SENSITIVE_AUTOCOMPLETE_TOKENS.has(token),
    )
  ) {
    dataSensitivityReason =
      "resolved target requests sensitive browser autocomplete data";
  } else if (SENSITIVE_FIELD_PATTERN.test(semanticText)) {
    dataSensitivityReason = "resolved target has sensitive-field semantics";
  }

  return {
    actionRisk: actionRiskReason ? "decision_barrier" : "ordinary",
    ...(actionRiskReason ? { actionRiskReason } : {}),
    dataSensitivity: dataSensitivityReason ? "sensitive" : "ordinary",
    ...(dataSensitivityReason ? { dataSensitivityReason } : {}),
  };
}
