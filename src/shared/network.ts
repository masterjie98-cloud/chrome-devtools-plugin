export type HeaderOperation = "set" | "append" | "remove";
export type HeaderRuleTarget = "request" | "response";

export type ChromeResourceType =
  | "main_frame"
  | "sub_frame"
  | "stylesheet"
  | "script"
  | "image"
  | "font"
  | "object"
  | "xmlhttprequest"
  | "ping"
  | "csp_report"
  | "media"
  | "websocket"
  | "webtransport"
  | "webbundle"
  | "other";

export interface HeaderModification {
  header: string;
  operation: HeaderOperation;
  value?: string;
}

export interface HeaderRuleInput {
  ruleId?: number;
  priority?: number;
  target?: HeaderRuleTarget;
  urlFilter?: string;
  regexFilter?: string;
  resourceTypes?: ChromeResourceType[];
  headers: HeaderModification[];
}

export interface GetMockRuleInput {
  ruleId?: number;
  priority?: number;
  urlFilter?: string;
  regexFilter?: string;
  resourceTypes?: ChromeResourceType[];
  extensionPath?: string;
}

export interface RemoveDnrRuleInput {
  ruleId: number;
}

export interface DnrRuleSummary {
  id: number;
  priority: number;
  actionType: string;
  urlFilter?: string;
  regexFilter?: string;
  resourceTypes?: string[];
  requestMethods?: string[];
  requestHeaders?: HeaderModification[];
  responseHeaders?: HeaderModification[];
  redirect?: {
    extensionPath?: string;
    url?: string;
  };
}

export interface DnrRuleMutationResult {
  ruleId: number;
  rules: DnrRuleSummary[];
}
