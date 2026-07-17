import { getDynamicRules, updateDynamicRules } from "./chromeApi";
import type {
  DnrRuleMutationResult,
  DnrRuleSummary,
  GetMockRuleInput,
  HeaderModification,
  HeaderRuleInput,
  RemoveDnrRuleInput
} from "../shared/network";

const DEFAULT_RESOURCE_TYPES = ["xmlhttprequest", "main_frame", "sub_frame"] as const;
const DEFAULT_MOCK_RESOURCE_TYPES = ["xmlhttprequest"] as const;
const DEFAULT_MOCK_EXTENSION_PATH = "/mocks/default.json";
const STARTING_DYNAMIC_RULE_ID = 1000;

export async function listDynamicRuleSummaries(): Promise<DnrRuleSummary[]> {
  const rules = await getDynamicRules();
  return rules.map(summarizeRule).sort((a, b) => a.id - b.id);
}

export async function upsertHeaderRule(input: HeaderRuleInput): Promise<DnrRuleMutationResult> {
  const ruleId = input.ruleId ?? (await getNextRuleId());
  const headerInfos = input.headers.map(toModifyHeaderInfo);
  const action: chrome.declarativeNetRequest.RuleAction = {
    type: "modifyHeaders" as chrome.declarativeNetRequest.RuleActionType,
    ...(input.target === "response"
      ? { responseHeaders: headerInfos }
      : { requestHeaders: headerInfos })
  };
  const rule: chrome.declarativeNetRequest.Rule = {
    id: ruleId,
    priority: input.priority ?? 1,
    action,
    condition: {
      urlFilter: input.urlFilter,
      regexFilter: input.regexFilter,
      resourceTypes: (input.resourceTypes ?? DEFAULT_RESOURCE_TYPES) as chrome.declarativeNetRequest.ResourceType[]
    }
  };

  await updateDynamicRules({
    removeRuleIds: [ruleId],
    addRules: [rule]
  });

  return {
    ruleId,
    rules: await listDynamicRuleSummaries()
  };
}

export async function upsertGetMockRule(input: GetMockRuleInput): Promise<DnrRuleMutationResult> {
  const ruleId = input.ruleId ?? (await getNextRuleId());
  const extensionPath = normalizeMockExtensionPath(input.extensionPath);
  const rule: chrome.declarativeNetRequest.Rule = {
    id: ruleId,
    priority: input.priority ?? 1,
    action: {
      type: "redirect" as chrome.declarativeNetRequest.RuleActionType,
      redirect: {
        extensionPath
      }
    },
    condition: {
      urlFilter: input.urlFilter,
      regexFilter: input.regexFilter,
      resourceTypes: (input.resourceTypes ?? DEFAULT_MOCK_RESOURCE_TYPES) as chrome.declarativeNetRequest.ResourceType[],
      requestMethods: ["get"] as chrome.declarativeNetRequest.RequestMethod[]
    }
  };

  await updateDynamicRules({
    removeRuleIds: [ruleId],
    addRules: [rule]
  });

  return {
    ruleId,
    rules: await listDynamicRuleSummaries()
  };
}

export async function removeRule(input: RemoveDnrRuleInput): Promise<DnrRuleMutationResult> {
  await updateDynamicRules({
    removeRuleIds: [input.ruleId]
  });

  return {
    ruleId: input.ruleId,
    rules: await listDynamicRuleSummaries()
  };
}

function toModifyHeaderInfo(modification: HeaderModification): chrome.declarativeNetRequest.ModifyHeaderInfo {
  const info: chrome.declarativeNetRequest.ModifyHeaderInfo = {
    header: modification.header,
    operation: modification.operation as chrome.declarativeNetRequest.HeaderOperation
  };

  if (modification.operation !== "remove") {
    info.value = modification.value ?? "";
  }

  return info;
}

async function getNextRuleId(): Promise<number> {
  const rules = await getDynamicRules();
  return Math.max(STARTING_DYNAMIC_RULE_ID - 1, ...rules.map((rule) => rule.id)) + 1;
}

function summarizeRule(rule: chrome.declarativeNetRequest.Rule): DnrRuleSummary {
  return {
    id: rule.id,
    priority: rule.priority ?? 1,
    actionType: String(rule.action.type),
    urlFilter: rule.condition.urlFilter,
    regexFilter: rule.condition.regexFilter,
    resourceTypes: rule.condition.resourceTypes?.map(String),
    requestMethods: rule.condition.requestMethods?.map(String),
    requestHeaders: rule.action.requestHeaders?.map((header) => ({
      header: header.header,
      operation: String(header.operation) as HeaderModification["operation"],
      value: header.value
    })),
    responseHeaders: rule.action.responseHeaders?.map((header) => ({
      header: header.header,
      operation: String(header.operation) as HeaderModification["operation"],
      value: header.value
    })),
    redirect: rule.action.redirect
      ? {
          extensionPath: rule.action.redirect.extensionPath,
          url: rule.action.redirect.url
        }
      : undefined
  };
}

function normalizeMockExtensionPath(extensionPath?: string): string {
  const trimmedPath = extensionPath?.trim();
  if (!trimmedPath) {
    return DEFAULT_MOCK_EXTENSION_PATH;
  }

  if (trimmedPath.startsWith("chrome-extension://")) {
    let parsedUrl: URL;

    try {
      parsedUrl = new URL(trimmedPath);
    } catch {
      throw new Error(`Invalid mock extensionPath: ${trimmedPath}`);
    }

    if (parsedUrl.protocol !== "chrome-extension:") {
      throw new Error(
        `Mock extensionPath must be an extension-local path like ${DEFAULT_MOCK_EXTENSION_PATH}.`,
      );
    }

    if (parsedUrl.host !== chrome.runtime.id) {
      throw new Error(
        `Mock extensionPath points to another extension (${parsedUrl.host}). Use a path inside this extension, such as ${DEFAULT_MOCK_EXTENSION_PATH}.`,
      );
    }

    return parsedUrl.pathname || DEFAULT_MOCK_EXTENSION_PATH;
  }

  if (trimmedPath.includes("://")) {
    throw new Error(
      `Mock extensionPath must be an extension-local path like ${DEFAULT_MOCK_EXTENSION_PATH}.`,
    );
  }

  return trimmedPath.startsWith("/") ? trimmedPath : `/${trimmedPath}`;
}
