import type { BrowserDebuggerFrameCleanupResult } from "./dom";
import type { CollectionPagination } from "./collectionPagination";
import type { NetworkActivityDigest } from "./networkActivity";

export type DebuggerFetchMode = "continueRequest" | "failRequest" | "fulfillRequest";

export interface DebuggerFetchPrepareInput {
  urlPattern?: string;
}

export interface DebuggerFetchStatus {
  attached: boolean;
  fetchEnabled: boolean;
  tabId?: number;
  protocolVersion: string;
  note?: string;
  targetCleanup?: BrowserDebuggerFrameCleanupResult;
}

export type DebuggerProxyStage = "request" | "response";
export type DebuggerProxyHeaderOperation = "set" | "append" | "remove";

export interface DebuggerProxyHeaderModification {
  header: string;
  operation: DebuggerProxyHeaderOperation;
  value?: string;
}

export interface DebuggerProxyScenarioStep {
  name?: string;
  responseHeaders?: DebuggerProxyHeaderModification[];
  responseBody?: string;
  responseBodyBase64?: string;
  statusCode?: number;
  responsePhrase?: string;
  contentType?: string;
}

export interface DebuggerProxyRuleInput {
  id?: string;
  enabled?: boolean;
  priority?: number;
  urlPattern?: string;
  urlContains?: string;
  regexFilter?: string;
  method?: string;
  resourceType?: string;
  requestHeaders?: DebuggerProxyHeaderModification[];
  responseHeaders?: DebuggerProxyHeaderModification[];
  responseBody?: string;
  responseBodyBase64?: string;
  statusCode?: number;
  responsePhrase?: string;
  contentType?: string;
  mockStage?: DebuggerProxyStage;
  scenarioSteps?: DebuggerProxyScenarioStep[];
  scenarioRepeat?: "hold-last" | "loop";
  resetScenario?: boolean;
}

export interface DebuggerProxyRule extends DebuggerProxyRuleInput {
  id: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  hitCount: number;
  lastHitAt?: string;
  scenarioStepIndex?: number;
  scenarioHitCount?: number;
}

export interface DebuggerProxyStatus {
  attached: boolean;
  fetchEnabled: boolean;
  tabId?: number;
  protocolVersion: string;
  ruleCount: number;
  hitCount: number;
  targetCleanup?: BrowserDebuggerFrameCleanupResult;
}

export interface DebuggerProxyRuleMutationResult {
  status: DebuggerProxyStatus;
  rule?: DebuggerProxyRule;
  rules: DebuggerProxyRule[];
}

export interface DebuggerProxyListResult {
  status: DebuggerProxyStatus;
  rules: DebuggerProxyRule[];
}

export interface DebuggerProxyRemoveRuleInput {
  id: string;
}

export interface DebuggerProxyHit {
  id: string;
  ruleId: string;
  stage: DebuggerProxyStage;
  url: string;
  method: string;
  resourceType?: string;
  statusCode?: number;
  action: "continue" | "fulfill" | "fail" | "miss";
  requestId: string;
  networkId?: string;
  matchedAt: string;
  note?: string;
}

export interface DebuggerProxyListHitsInput {
  limit?: number;
  ruleId?: string;
}

export interface DebuggerProxyListHitsResult {
  total: number;
  returned: number;
  hits: DebuggerProxyHit[];
}

export interface DebuggerFetchActionInput {
  requestId: string;
  mode: DebuggerFetchMode;
  responseCode?: number;
  responseHeaders?: Array<{ name: string; value: string }>;
  bodyBase64?: string;
  errorReason?: string;
}

export interface DebuggerNetworkStartInput {
  preserveLog?: boolean;
  maxEntries?: number;
}

export interface DebuggerNetworkStatus {
  attached: boolean;
  networkEnabled: boolean;
  tabId?: number;
  protocolVersion: string;
  requestCount: number;
  maxEntries: number;
  droppedRequestCount: number;
  capacityReached: boolean;
  preservedLog: boolean;
  observationSessionId?: string;
  observationStartedAt?: string;
  targetCleanup?: BrowserDebuggerFrameCleanupResult;
}

export interface DebuggerNetworkListInput {
  cursor?: string;
  limit?: number;
  urlContains?: string;
  method?: string;
  resourceType?: string;
  statusMin?: number;
  statusMax?: number;
  digestOnly?: boolean;
}

export interface DebuggerNetworkGetInput {
  requestId: string;
  includeBody?: boolean;
}

export interface DebuggerNetworkBodyInput {
  requestId: string;
}

export interface DebuggerDetachInput {
  tabId?: number;
}

export interface DebuggerNetworkRequestSummary {
  requestId: string;
  url: string;
  method: string;
  resourceType?: string;
  status?: number;
  statusText?: string;
  mimeType?: string;
  fromDiskCache?: boolean;
  fromServiceWorker?: boolean;
  encodedDataLength?: number;
  startedAt: number;
  startedWallTimeMs?: number;
  finishedAt?: number;
  durationMs?: number;
  failed?: boolean;
  errorText?: string;
  initiatorType?: string;
  initiatorStack?: DebuggerInitiatorCallFrame[];
}

export interface DebuggerInitiatorCallFrame {
  functionName?: string;
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
}

export interface DebuggerNetworkRequestDetail
  extends DebuggerNetworkRequestSummary {
  documentUrl?: string;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestPostData?: string;
  remoteAddress?: string;
  body?: DebuggerNetworkResponseBody;
}

export interface DebuggerNetworkResponseBody {
  requestId: string;
  body: string;
  base64Encoded: boolean;
  truncated: boolean;
}

export interface DebuggerNetworkListResult {
  attached: boolean;
  tabId?: number;
  digestOnly: boolean;
  total: number;
  returned: number;
  requests: DebuggerNetworkRequestSummary[];
  activityDigest: NetworkActivityDigest;
  droppedRequestCount: number;
  capacityReached: boolean;
  pagination: CollectionPagination;
  observationSessionId?: string;
  observationStartedAt?: string;
}

export interface DebuggerDetachResult {
  detached: boolean;
  tabId?: number;
}
