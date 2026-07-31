import {
  debuggerAttach,
  debuggerDetach,
  debuggerGetTargets,
  debuggerSendCommand,
  getAllNavigationFrames,
  getSelectedContentFrameSnapshot,
  getTab,
  isTabUrlScriptable,
  queryActiveTab,
} from "./chromeApi";
import type { DebuggerCommandTarget } from "./chromeApi";
import type {
  BrowserConsoleMessage,
  BrowserConsoleMessagesInput,
  BrowserConsoleMessagesResult,
  BrowserCoordinateClickInput,
  BrowserCoordinateDragInput,
  BrowserCoordinateInput,
  BrowserDialogInput,
  BrowserDialogResult,
  BrowserPressKeyInput,
  BrowserTypeInput,
  BrowserMouseResult,
  BrowserMouseWheelInput,
  PageSnapshotTarget,
  ScreenshotCaptureInput,
  ScreenshotCaptureResult,
} from "../shared/dom";
import type {
  DebuggerDetachInput,
  DebuggerDetachResult,
  DebuggerFetchPrepareInput,
  DebuggerFetchStatus,
  DebuggerNetworkBodyInput,
  DebuggerNetworkGetInput,
  DebuggerNetworkListInput,
  DebuggerNetworkListResult,
  DebuggerNetworkRequestDetail,
  DebuggerNetworkRequestSummary,
  DebuggerNetworkResponseBody,
  DebuggerNetworkStartInput,
  DebuggerNetworkStatus,
  DebuggerProxyHeaderModification,
  DebuggerProxyHit,
  DebuggerProxyListHitsInput,
  DebuggerProxyListHitsResult,
  DebuggerProxyListResult,
  DebuggerProxyRemoveRuleInput,
  DebuggerProxyRule,
  DebuggerProxyRuleInput,
  DebuggerProxyRuleMutationResult,
  DebuggerProxyStage,
  DebuggerProxyStatus,
} from "../shared/debugger";
import type { BrowserActivityEventInput } from "../shared/browserActivity";
import type {
  BrowserRealtimeActivityResult,
} from "../shared/pageDiagnostics";
import type {
  BrowserRuntimeError,
  BrowserRuntimeErrorsInput,
  BrowserRuntimeErrorsResult,
  GeneratedSourceLocation,
  RuntimeErrorStackFrame,
  SourceMapResolution,
} from "../shared/sourceLocation";
import {
  DEBUG_EXECUTION_LIMITS,
  type BrowserDebugBreakpoint,
  type BrowserDebugBreakpointInput,
  type BrowserDebugBreakpointResult,
  type BrowserDebugCallFrame,
  type BrowserDebugControlInput,
  type BrowserDebugControlResult,
  type BrowserDebugEvaluateInput,
  type BrowserDebugEvaluateResult,
  type BrowserDebugException,
  type BrowserDebugPauseOnExceptionsState,
  type BrowserDebugPausedState,
  type BrowserDebugRemoteObject,
} from "../shared/debugExecution";
import {
  MAX_SOURCE_MAP_BYTES,
  resolveSourceMapLocation,
  SOURCE_MAP_TIMEOUT_MS,
  type LoadedScriptMetadata,
  type SourceMapLoadContext,
} from "./sourceMapResolver";
import {
  buildNetworkActivityDigest,
  normalizeNetworkResultPagination,
} from "../shared/networkActivity";
import { selectNetworkRequestToEvict } from "../shared/networkRetention";
import { paginateCollection } from "../shared/collectionPagination";
import { MESSAGE_TYPES } from "../shared/messages";
import { makeEvent, sendRuntimeEvent } from "../shared/messaging";
import {
  trustedMouseClickEvents,
  trustedMouseDownEvent,
  trustedMouseDragEvents,
  trustedMouseMoveEvent,
  trustedMouseUpEvent,
  trustedMouseWheelEvent,
  type TrustedMouseEventParams,
} from "./trustedInput";
import { currentJavaScriptDialogCommand } from "./dialogHandling";
import {
  trustedKeyEvents,
  trustedReplaceSelectionEvents,
  type TrustedKeyEventParams,
} from "../shared/trustedKeyboard";
import { selectRuntimeErrorWindow } from "../shared/runtimeErrorCursor";
import {
  createOopifAutoAttachParams,
  frameOwnerContentOrigin,
  mapDebuggerFrameTree,
  matchUniqueNavigationFrameRoute,
  requireDebuggerFrameRoute,
  type CdpFrameTreeNode,
  type DebuggerFrameRoute,
} from "./debuggerFrameRouting";
import {
  debuggerAttachFailureMessage,
  selectPageTargetInfo,
  topLevelDebuggerTarget,
} from "./debuggerTargetRouting";
import { getTargetNavigationState } from "./targetNavigation";

const PROTOCOL_VERSION = "1.3";
const DEFAULT_MAX_NETWORK_ENTRIES = 2_000;
const MAX_RESPONSE_BODY_CHARS = 120_000;
const MAX_PROXY_HITS = 300;
const MAX_CONSOLE_MESSAGES = 500;
const MAX_RUNTIME_ERRORS = 500;
const MAX_CAPTURED_RUNTIME_STACK_FRAMES = 24;
const MAX_RUNTIME_ERROR_TEXT_CHARS = 4_000;
const MAX_CHILD_DEBUGGER_SESSIONS = 128;
const PROXY_STATE_STORAGE_KEY = "aiDevtools.proxyState";
const PROXY_HITS_STORAGE_KEY = "aiDevtools.proxyHits";
const PROXY_LOG_PREFIX = "[ai-devtools-proxy]";

/** 全链路诊断日志；在 chrome://extensions → Service Worker 控制台查看 */
const PROXY_DEBUG = true;

type ProxyLogLevel = "info" | "warn" | "error";

function formatProxyLogMessage(
  phase: string,
  data?: Record<string, unknown>,
): string {
  if (!data) {
    return `${PROXY_LOG_PREFIX} ${phase}`;
  }
  try {
    return `${PROXY_LOG_PREFIX} ${phase} ${JSON.stringify(data)}`;
  } catch {
    return `${PROXY_LOG_PREFIX} ${phase} ${String(data)}`;
  }
}

function proxyLog(
  phase: string,
  data?: Record<string, unknown>,
  level: ProxyLogLevel = "info",
): void {
  if (!PROXY_DEBUG) {
    return;
  }
  const message = formatProxyLogMessage(phase, data ? { phase, ...data } : undefined);
  // 勿对 chrome://extensions 错误页使用 console.error(前缀, 对象)，会显示 [object Object]
  if (level === "warn" || level === "error") {
    console.warn(message);
    return;
  }
  console.log(message);
}

function isDebuggerDetachedError(message: string): boolean {
  return /not attached|target closed|invalid state|connection lost/i.test(
    message,
  );
}

function summarizeProxyRule(rule: DebuggerProxyRule): Record<string, unknown> {
  return {
    id: rule.id,
    enabled: rule.enabled,
    priority: rule.priority,
    method: rule.method,
    resourceType: rule.resourceType,
    urlContains: rule.urlContains,
    urlPattern: rule.urlPattern,
    regexFilter: rule.regexFilter,
    mockStage: rule.mockStage,
    stages: fetchStagesForRule(rule),
    hasRequestHeaders: Boolean(rule.requestHeaders?.length),
    hasResponseBody:
      rule.responseBody !== undefined || rule.responseBodyBase64 !== undefined,
    statusCode: rule.statusCode,
    hitCount: rule.hitCount,
  };
}

function summarizeFetchPause(
  event: FetchRequestPausedEvent,
  stage: DebuggerProxyStage,
): Record<string, unknown> {
  return {
    stage,
    requestId: event.requestId,
    networkId: event.networkId,
    method: event.request.method,
    url: event.request.url,
    resourceType: event.resourceType,
    responseStatusCode: event.responseStatusCode,
  };
}

function summarizeDebuggee(source: DebuggerTarget): Record<string, unknown> {
  return {
    tabId: source.tabId,
    targetId: source.targetId,
    sessionId: source.sessionId,
    extensionId: source.extensionId,
  };
}

type DebuggerTarget = DebuggerCommandTarget;

interface NetworkRequestRecord {
  requestId: string;
  url: string;
  method: string;
  resourceType?: string;
  documentUrl?: string;
  requestHeaders?: Record<string, string>;
  requestPostData?: string;
  responseHeaders?: Record<string, string>;
  status?: number;
  statusText?: string;
  mimeType?: string;
  fromDiskCache?: boolean;
  fromServiceWorker?: boolean;
  encodedDataLength?: number;
  startedAt: number;
  startedWallTimeMs?: number;
  finishedAt?: number;
  failed?: boolean;
  errorText?: string;
  initiatorType?: string;
  initiatorStack?: import("../shared/debugger").DebuggerInitiatorCallFrame[];
  remoteAddress?: string;
}

interface ConsoleMessageRecord extends BrowserConsoleMessage {
  timestampMs: number;
}

interface CapturedRuntimeStackFrame extends RuntimeErrorStackFrame {
  debuggerTargetKey: string;
}

interface RuntimeErrorRecord extends Omit<BrowserRuntimeError, "frames"> {
  timestampMs: number;
  frames: CapturedRuntimeStackFrame[];
}

interface RealtimeWebSocketRecord {
  requestId: string;
  url?: string;
  openedAt?: number;
  closedAt?: number;
  sentFrames: number;
  receivedFrames: number;
  sentBytes: number;
  receivedBytes: number;
  lastError?: string;
}

interface RealtimeEventSourceRecord {
  requestId: string;
  url?: string;
  messageCount: number;
  lastEventName?: string;
  lastEventAt?: number;
}

interface NetworkSession {
  tabId: number;
  target: DebuggerTarget;
  targetInfo?: chrome.debugger.TargetInfo;
  attached: boolean;
  networkEnabled: boolean;
  fetchEnabled: boolean;
  runtimeEnabled: boolean;
  logEnabled: boolean;
  debuggerEnabled: boolean;
  oopifAutoAttachEnabled: boolean;
  pageStartedAt: number;
  maxEntries: number;
  preservedLog: boolean;
  observationSessionId?: string;
  observationStartedAt?: string;
  droppedRequestCount: number;
  requests: Map<string, NetworkRequestRecord>;
  requestOrder: string[];
  consoleMessages: ConsoleMessageRecord[];
  runtimeErrorMonitoringActive: boolean;
  runtimeErrorStreamId: string;
  runtimeErrorSequence: number;
  droppedRuntimeErrorCount: number;
  runtimeErrors: RuntimeErrorRecord[];
  scripts: Map<string, LoadedScriptMetadata>;
  scriptsById: Map<string, LoadedScriptMetadata>;
  breakpoints: Map<string, StoredDebugBreakpoint>;
  pausedTargets: Map<string, BrowserDebugPausedState>;
  pauseOnExceptions: Map<string, BrowserDebugPauseOnExceptionsState>;
  webSockets: Map<string, RealtimeWebSocketRecord>;
  eventSources: Map<string, RealtimeEventSourceRecord>;
}

interface StoredDebugBreakpoint extends BrowserDebugBreakpoint {
  debuggerTargetKey: string;
}

interface SelectedDebugTarget {
  tabId: number;
  frameId: number;
  documentId?: string;
  target: DebuggerTarget;
}

interface ChildDebuggerSession {
  target: DebuggerTarget;
}

interface RoutedChildDebuggerSession extends DebuggerFrameRoute {
  sessionId: string;
  target: DebuggerTarget;
}

export type TrustedInputTargetAddress = Pick<
  PageSnapshotTarget,
  "tabId" | "frameId" | "documentId"
>;

interface TrustedInputSession {
  tabId: number;
  target: DebuggerTarget;
  coordinateOffset?: BrowserCoordinateInput;
}

interface ScreenshotClip {
  x: number;
  y: number;
  width: number;
  height: number;
}

let activeSession: NetworkSession | null = null;
let debuggerListenersRegistered = false;
const proxyRules = new Map<string, DebuggerProxyRule>();
const childDebuggerSessions = new Map<string, ChildDebuggerSession>();
const childDebuggerRoutes = new Map<number, RoutedChildDebuggerSession>();
const debuggerFrameRoutes = new Map<number, DebuggerFrameRoute>();
let childRouteRefreshGeneration = 0;
let proxyHits: DebuggerProxyHit[] = [];
let proxyEnabled = false;
let proxyStateLoaded = false;
let proxyRestoreLoopGeneration = 0;
let proxyStateBroadcastTimer: ReturnType<typeof setTimeout> | null = null;
let ensureSessionPromise: Promise<NetworkSession> | null = null;
const manualDebuggerDetachTabIds = new Set<number>();
const debuggerActivityListeners = new Set<
  (event: BrowserActivityEventInput) => void
>();
let debuggerActivityMonitoringActive = false;
let debuggerActivityMonitorTabId: number | undefined;

export function subscribeDebuggerActivity(
  listener: (event: BrowserActivityEventInput) => void,
): () => void {
  debuggerActivityListeners.add(listener);
  return () => debuggerActivityListeners.delete(listener);
}

export function emitDebuggerActivityLifecycle(
  active: boolean,
  target?: BrowserActivityEventInput["target"],
  locksDebugger = false,
): void {
  debuggerActivityMonitoringActive = active;
  debuggerActivityMonitorTabId =
    active && locksDebugger ? target?.tabId : undefined;
  const event: BrowserActivityEventInput = {
    kind: "navigation",
    observedAt: new Date().toISOString(),
    target,
    summary: {
      reason: active ? "monitoring-started" : "monitoring-stopped",
    },
  };
  for (const listener of debuggerActivityListeners) {
    listener(event);
  }
}

export function emitDebuggerNavigationActivity(
  event: Omit<BrowserActivityEventInput, "kind">,
): void {
  emitDebuggerActivity({
    ...event,
    kind: "navigation",
  });
}

export async function resolveGeneratedSourceLocation(
  generated: GeneratedSourceLocation,
  includeExcerpt = false,
): Promise<SourceMapResolution> {
  const session = await ensureDebuggerSession();
  await ensureDebuggerEnabled(session);
  const script = session.scripts.get(generated.url);
  return resolveSourceMapLocation(
    script,
    generated,
    includeExcerpt,
    createSourceMapLoadContext(session, session.target, script),
  );
}

export async function evaluatePageJavaScript(
  input: BrowserDebugEvaluateInput,
): Promise<BrowserDebugEvaluateResult> {
  const selected = await resolveSelectedDebugTarget();
  const session = requireActiveDebugSession(selected.tabId);
  await ensureRuntimeEnabled(session);
  const objectGroup = `ai-devtools-evaluate-${Date.now().toString(36)}`;
  const startedAt = Date.now();
  try {
    const response = await debuggerSendCommand<
      {
        expression: string;
        objectGroup: string;
        includeCommandLineAPI: boolean;
        silent: boolean;
        returnByValue: boolean;
        generatePreview: boolean;
        userGesture: boolean;
        awaitPromise: boolean;
        throwOnSideEffect: boolean;
        timeout: number;
        disableBreaks: boolean;
        replMode: boolean;
        allowUnsafeEvalBlockedByCSP: boolean;
      },
      RuntimeEvaluationResponse
    >(selected.target, "Runtime.evaluate", {
      expression: evaluationExpression(input),
      objectGroup,
      includeCommandLineAPI: true,
      silent: false,
      returnByValue: true,
      generatePreview: true,
      userGesture: false,
      awaitPromise: input.awaitPromise ?? true,
      throwOnSideEffect: input.throwOnSideEffect ?? false,
      timeout: input.timeoutMs ?? 5_000,
      disableBreaks: input.allowBreakpoints !== true,
      replMode: input.replMode ?? false,
      allowUnsafeEvalBlockedByCSP: true,
    });
    const exception = toDebugException(response.exceptionDetails);
    return {
      evaluated: exception === undefined,
      tabId: selected.tabId,
      frameId: selected.frameId,
      ...(selected.documentId ? { documentId: selected.documentId } : {}),
      elapsedMs: Date.now() - startedAt,
      result: toDebugRemoteObject(response.result),
      ...(exception ? { exception } : {}),
    };
  } finally {
    await debuggerSendCommand(
      selected.target,
      "Runtime.releaseObjectGroup",
      { objectGroup },
    ).catch(() => undefined);
  }
}

export async function manageJavaScriptBreakpoint(
  input: BrowserDebugBreakpointInput,
): Promise<BrowserDebugBreakpointResult> {
  const selected = await resolveSelectedDebugTarget();
  const session = requireActiveDebugSession(selected.tabId);
  await ensureDebuggerEnabled(session);
  const targetKey = debuggerTargetIdentity(selected.target);

  if (input.action === "list") {
    return breakpointResult("list", session, selected.tabId, targetKey);
  }

  if (input.action === "remove") {
    const stored = findStoredBreakpoint(
      session,
      targetKey,
      input.breakpointId ?? "",
    );
    if (!stored) {
      throw new Error(
        `BREAKPOINT_NOT_FOUND: ${input.breakpointId ?? "missing breakpointId"} is not owned by the selected page frame.`,
      );
    }
    await debuggerSendCommand(selected.target, "Debugger.removeBreakpoint", {
      breakpointId: stored.breakpointId,
    });
    session.breakpoints.delete(storedBreakpointKey(stored));
    return {
      ...breakpointResult("remove", session, selected.tabId, targetKey),
      removedBreakpointId: stored.breakpointId,
    };
  }

  if (session.breakpoints.size >= DEBUG_EXECUTION_LIMITS.breakpoints) {
    throw new Error(
      `BREAKPOINT_LIMIT_REACHED: at most ${DEBUG_EXECUTION_LIMITS.breakpoints} active breakpoints are retained.`,
    );
  }
  const response = await debuggerSendCommand<
    {
      lineNumber: number;
      columnNumber: number;
      condition?: string;
      url?: string;
      urlRegex?: string;
    },
    DebuggerSetBreakpointByUrlResponse
  >(selected.target, "Debugger.setBreakpointByUrl", {
    lineNumber: (input.lineNumber ?? 1) - 1,
    columnNumber: input.columnNumber ?? 0,
    ...(input.condition ? { condition: input.condition } : {}),
    ...(input.url ? { url: input.url } : {}),
    ...(input.urlRegex ? { urlRegex: input.urlRegex } : {}),
  });
  const breakpoint: StoredDebugBreakpoint = {
    breakpointId: response.breakpointId,
    ...(input.url ? { url: input.url } : {}),
    ...(input.urlRegex ? { urlRegex: input.urlRegex } : {}),
    lineNumber: input.lineNumber ?? 1,
    columnNumber: input.columnNumber ?? 0,
    ...(input.condition ? { condition: input.condition } : {}),
    resolvedLocations: (response.locations ?? []).map(toPublicBreakpointLocation),
    createdAt: new Date().toISOString(),
    debuggerTargetKey: targetKey,
  };
  session.breakpoints.set(storedBreakpointKey(breakpoint), breakpoint);
  return {
    ...breakpointResult("set", session, selected.tabId, targetKey),
    breakpoint: publicBreakpoint(breakpoint),
  };
}

export async function controlJavaScriptDebugger(
  input: BrowserDebugControlInput,
): Promise<BrowserDebugControlResult> {
  const selected = await resolveSelectedDebugTarget();
  const session = requireActiveDebugSession(selected.tabId);
  await ensureDebuggerEnabled(session);
  const targetKey = debuggerTargetIdentity(selected.target);

  if (input.action === "pause") {
    await debuggerSendCommand(selected.target, "Debugger.pause", {});
    if (!(await waitForDebuggerPause(session, targetKey))) {
      throw new Error(
        "DEBUGGER_PAUSE_TIMEOUT: Chrome did not report a paused state for the selected page frame.",
      );
    }
  } else if (input.action === "resume") {
    requirePausedTarget(session, targetKey);
    await debuggerSendCommand(selected.target, "Debugger.resume", {});
    session.pausedTargets.delete(targetKey);
  } else if (
    input.action === "step_over" ||
    input.action === "step_into" ||
    input.action === "step_out"
  ) {
    requirePausedTarget(session, targetKey);
    const method =
      input.action === "step_over"
        ? "Debugger.stepOver"
        : input.action === "step_into"
          ? "Debugger.stepInto"
          : "Debugger.stepOut";
    await debuggerSendCommand(selected.target, method, {});
    session.pausedTargets.delete(targetKey);
    await waitForDebuggerPause(session, targetKey);
  } else if (input.action === "set_pause_on_exceptions") {
    const state = input.pauseOnExceptions ?? "none";
    await debuggerSendCommand(selected.target, "Debugger.setPauseOnExceptions", {
      state,
    });
    session.pauseOnExceptions.set(targetKey, state);
  } else if (input.action === "evaluate_on_call_frame") {
    const paused = requirePausedTarget(session, targetKey);
    const callFrameId = input.callFrameId ?? "";
    if (!paused.callFrames.some((frame) => frame.callFrameId === callFrameId)) {
      throw new Error(
        "STALE_CALL_FRAME: callFrameId is not part of the current pause. Read debugger status again.",
      );
    }
    const objectGroup = `ai-devtools-call-frame-${Date.now().toString(36)}`;
    try {
      const response = await debuggerSendCommand<
        {
          callFrameId: string;
          expression: string;
          objectGroup: string;
          includeCommandLineAPI: boolean;
          silent: boolean;
          returnByValue: boolean;
          generatePreview: boolean;
          throwOnSideEffect: boolean;
          timeout: number;
        },
        RuntimeEvaluationResponse
      >(selected.target, "Debugger.evaluateOnCallFrame", {
        callFrameId,
        expression: input.expression ?? "",
        objectGroup,
        includeCommandLineAPI: true,
        silent: false,
        returnByValue: true,
        generatePreview: true,
        throwOnSideEffect: input.throwOnSideEffect ?? false,
        timeout: input.timeoutMs ?? 5_000,
      });
      const exception = toDebugException(response.exceptionDetails);
      return debugControlResult(input.action, session, selected, targetKey, {
        evaluation: toDebugRemoteObject(response.result),
        ...(exception ? { exception } : {}),
      });
    } finally {
      await debuggerSendCommand(
        selected.target,
        "Runtime.releaseObjectGroup",
        { objectGroup },
      ).catch(() => undefined);
    }
  }

  return debugControlResult(input.action, session, selected, targetKey);
}

function evaluationExpression(input: BrowserDebugEvaluateInput): string {
  if (!input.selector) {
    return input.expression;
  }
  return `(async function(element) { return (${input.expression}); })(document.querySelector(${JSON.stringify(input.selector)}))`;
}

async function resolveSelectedDebugTarget(): Promise<SelectedDebugTarget> {
  const tab = await queryActiveTab();
  if (!tab?.id) {
    throw new Error("No active task-bound tab is available.");
  }
  const before = getSelectedContentFrameSnapshot(tab.id);
  if (!before?.documentId) {
    throw new Error(
      "STALE_CONTEXT: the selected page frame has no current document binding. Observe the page again before debugging.",
    );
  }
  const navigationBefore = getTargetNavigationState(tab.id, false);
  const trusted = await ensureTrustedInputSession({
    tabId: tab.id,
    frameId: before.frameId,
    documentId: before.documentId,
  });
  const after = getSelectedContentFrameSnapshot(tab.id);
  const navigationAfter = getTargetNavigationState(tab.id, false);
  if (
    !after ||
    after.frameId !== before.frameId ||
    after.documentId !== before.documentId ||
    navigationAfter.navigationId !== navigationBefore.navigationId ||
    navigationAfter.revision !== navigationBefore.revision
  ) {
    throw new Error(
      "STALE_CONTEXT: the selected page frame changed before debugger execution. Observe the page and request a fresh approval.",
    );
  }
  return {
    tabId: tab.id,
    frameId: after.frameId,
    documentId: after.documentId,
    target: trusted.target,
  };
}

function requireActiveDebugSession(tabId: number): NetworkSession {
  if (!activeSession?.attached || activeSession.tabId !== tabId) {
    throw new Error(
      "DEBUGGER_SESSION_UNAVAILABLE: the exact selected tab is not attached.",
    );
  }
  return activeSession;
}

async function ensureRuntimeEnabled(session: NetworkSession): Promise<void> {
  if (session.runtimeEnabled) {
    return;
  }
  for (const target of allDebuggerTargets(session)) {
    await debuggerSendCommand(target, "Runtime.enable", {});
  }
  session.runtimeEnabled = true;
}

function breakpointResult(
  action: BrowserDebugBreakpointInput["action"],
  session: NetworkSession,
  tabId: number,
  targetKey: string,
): BrowserDebugBreakpointResult {
  return {
    action,
    tabId,
    breakpoints: [...session.breakpoints.values()]
      .filter((entry) => entry.debuggerTargetKey === targetKey)
      .map(publicBreakpoint),
  };
}

function publicBreakpoint(
  value: StoredDebugBreakpoint,
): BrowserDebugBreakpoint {
  const { debuggerTargetKey: _targetKey, ...result } = value;
  return result;
}

function storedBreakpointKey(value: StoredDebugBreakpoint): string {
  return `${value.debuggerTargetKey}:${value.breakpointId}`;
}

function findStoredBreakpoint(
  session: NetworkSession,
  targetKey: string,
  breakpointId: string,
): StoredDebugBreakpoint | undefined {
  return [...session.breakpoints.values()].find(
    (entry) =>
      entry.debuggerTargetKey === targetKey &&
      entry.breakpointId === breakpointId,
  );
}

function toPublicBreakpointLocation(
  location: DebuggerLocation,
): BrowserDebugBreakpoint["resolvedLocations"][number] {
  return {
    scriptId: location.scriptId,
    lineNumber: location.lineNumber + 1,
    columnNumber: location.columnNumber ?? 0,
  };
}

function requirePausedTarget(
  session: NetworkSession,
  targetKey: string,
): BrowserDebugPausedState {
  const state = session.pausedTargets.get(targetKey);
  if (!state) {
    throw new Error(
      "DEBUGGER_NOT_PAUSED: the selected page frame is not currently paused.",
    );
  }
  return state;
}

async function waitForDebuggerPause(
  session: NetworkSession,
  targetKey: string,
): Promise<boolean> {
  const deadline = Date.now() + 2_000;
  while (!session.pausedTargets.has(targetKey) && Date.now() < deadline) {
    await delayMs(10);
  }
  return session.pausedTargets.has(targetKey);
}

function debugControlResult(
  action: BrowserDebugControlInput["action"],
  session: NetworkSession,
  selected: SelectedDebugTarget,
  targetKey: string,
  extra: Pick<
    BrowserDebugControlResult,
    "evaluation" | "exception"
  > = {},
): BrowserDebugControlResult {
  const state = session.pausedTargets.get(targetKey);
  return {
    action,
    tabId: selected.tabId,
    frameId: selected.frameId,
    ...(selected.documentId ? { documentId: selected.documentId } : {}),
    paused: Boolean(state),
    pauseOnExceptions: session.pauseOnExceptions.get(targetKey) ?? "none",
    ...(state ? { state } : {}),
    ...extra,
  };
}

function toDebugRemoteObject(
  remote: RuntimeRemoteObject,
): BrowserDebugRemoteObject {
  let value = remote.value;
  let truncated = false;
  if (value !== undefined) {
    try {
      const serialized = JSON.stringify(value);
      if (serialized.length > DEBUG_EXECUTION_LIMITS.valueChars) {
        value = `${serialized.slice(0, DEBUG_EXECUTION_LIMITS.valueChars)}…[truncated]`;
        truncated = true;
      }
    } catch {
      value = undefined;
      truncated = true;
    }
  }
  const description = boundedDebugText(remote.description);
  const preview = remote.preview?.properties
    ?.slice(0, DEBUG_EXECUTION_LIMITS.previewProperties)
    .map((property) => ({
      name: boundedDebugText(property.name, 500) ?? "",
      type: property.type,
      ...(property.value !== undefined
        ? { value: boundedDebugText(property.value, 2_000) }
        : {}),
      ...(property.subtype ? { subtype: property.subtype } : {}),
    }));
  return {
    type: remote.type,
    ...(remote.subtype ? { subtype: remote.subtype } : {}),
    ...(remote.className ? { className: remote.className } : {}),
    ...(value !== undefined ? { value } : {}),
    ...(remote.unserializableValue
      ? { unserializableValue: remote.unserializableValue }
      : {}),
    ...(description ? { description } : {}),
    ...(preview?.length ? { preview } : {}),
    truncated:
      truncated ||
      (remote.preview?.overflow === true) ||
      (remote.preview?.properties?.length ?? 0) >
        DEBUG_EXECUTION_LIMITS.previewProperties,
  };
}

function toDebugException(
  details: RuntimeExceptionDetails | undefined,
): BrowserDebugException | undefined {
  if (!details) {
    return undefined;
  }
  return {
    text: boundedDebugText(details.text) ?? "JavaScript evaluation failed.",
    ...(details.url ? { url: boundedDebugText(details.url, 8_000) } : {}),
    ...(details.lineNumber !== undefined
      ? { lineNumber: details.lineNumber + 1 }
      : {}),
    ...(details.columnNumber !== undefined
      ? { columnNumber: details.columnNumber }
      : {}),
    ...(details.exception?.description
      ? { description: boundedDebugText(details.exception.description) }
      : {}),
  };
}

function boundedDebugText(
  value: string | undefined,
  maxChars = 4_000,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value.length <= maxChars
    ? value
    : `${value.slice(0, maxChars)}…[truncated]`;
}

function createSourceMapLoadContext(
  session: NetworkSession,
  target: DebuggerTarget,
  script: LoadedScriptMetadata | undefined,
): SourceMapLoadContext {
  const scriptIdentity =
    script?.hash || script?.buildId || script?.scriptId || "unknown-script";
  return {
    cachePartition: `${session.tabId}:${debuggerTargetIdentity(target)}:${scriptIdentity}`,
    loadText: (mapUrl) =>
      withSourceMapTimeout(loadSourceMapThroughDebugger(target, mapUrl)),
  };
}

async function withSourceMapTimeout<T>(pending: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Source Map load timed out after 8 seconds.")),
          SOURCE_MAP_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

async function loadSourceMapThroughDebugger(
  target: DebuggerTarget,
  mapUrl: string,
): Promise<string> {
  const frameTree = await debuggerSendCommand<
    Record<string, never>,
    { frameTree?: { frame?: { id?: string } } }
  >(target, "Page.getFrameTree", {});
  const frameId = frameTree.frameTree?.frame?.id;
  if (!frameId) {
    throw new Error("CDP did not return a frame for Source Map loading.");
  }
  const response = await debuggerSendCommand<
    {
      frameId: string;
      url: string;
      options: { disableCache: boolean; includeCredentials: boolean };
    },
    {
      resource?: {
        success?: boolean;
        netError?: number;
        netErrorName?: string;
        httpStatusCode?: number;
        stream?: string;
      };
    }
  >(target, "Network.loadNetworkResource", {
    frameId,
    url: mapUrl,
    options: {
      disableCache: false,
      includeCredentials: false,
    },
  });
  const resource = response.resource;
  if (
    resource?.success !== true ||
    (resource.httpStatusCode !== undefined &&
      resource.httpStatusCode >= 400) ||
    !resource.stream
  ) {
    const detail =
      resource?.netErrorName ||
      (resource?.httpStatusCode !== undefined
        ? `HTTP ${resource.httpStatusCode}`
        : resource?.netError !== undefined
          ? `network error ${resource.netError}`
          : "no readable stream");
    throw new Error(`CDP Source Map load failed: ${detail}.`);
  }
  return readDebuggerTextStream(target, resource.stream);
}

async function readDebuggerTextStream(
  target: DebuggerTarget,
  handle: string,
): Promise<string> {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let emptyReads = 0;
  try {
    while (true) {
      const result = await debuggerSendCommand<
        { handle: string; size: number },
        { data?: string; base64Encoded?: boolean; eof?: boolean }
      >(target, "IO.read", {
        handle,
        size: 64 * 1024,
      });
      const data = result.data ?? "";
      const bytes = result.base64Encoded
        ? decodeBase64Bytes(data)
        : new TextEncoder().encode(data);
      if (bytes.byteLength > 0) {
        chunks.push(bytes);
        totalBytes += bytes.byteLength;
        emptyReads = 0;
      } else {
        emptyReads += 1;
      }
      if (totalBytes > MAX_SOURCE_MAP_BYTES) {
        throw new Error("Source map exceeds the 16 MiB limit.");
      }
      if (result.eof === true) {
        break;
      }
      if (emptyReads >= 3) {
        throw new Error("CDP Source Map stream stopped making progress.");
      }
    }
  } finally {
    await debuggerSendCommand(target, "IO.close", { handle }).catch(
      () => undefined,
    );
  }
  const output = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(output);
}

function decodeBase64Bytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

interface StoredProxyState {
  enabled?: boolean;
  rules?: DebuggerProxyRule[];
}

export async function prepareFetchDebugger(
  input: DebuggerFetchPrepareInput,
): Promise<DebuggerFetchStatus> {
  await ensureProxyStateLoaded();
  const session = await ensureDebuggerSession();
  await debuggerSendCommand(session.target, "Fetch.enable", {
    patterns: [
      {
        urlPattern: input.urlPattern || "*",
        requestStage: "Request"
      }
    ]
  });
  session.fetchEnabled = true;

  return {
    attached: true,
    fetchEnabled: true,
    tabId: session.tabId,
    protocolVersion: PROTOCOL_VERSION,
    note: "CDP Fetch is enabled. Requests are continued unless a proxy rule matches."
  };
}

export async function captureDebuggerScreenshot(
  input: ScreenshotCaptureInput & { clip?: ScreenshotClip } = {},
): Promise<ScreenshotCaptureResult> {
  const session = await ensureDebuggerSession();
  const captureSession =
    input.frameId !== undefined && input.frameId !== 0
      ? await ensureTrustedInputSession({
          tabId: session.tabId,
          frameId: input.frameId,
          documentId: input.documentId,
        })
      : { tabId: session.tabId, target: session.target };
  await debuggerSendCommand(captureSession.target, "Page.enable", {}).catch(
    () => undefined,
  );

  const format = input.type === "jpeg" ? "jpeg" : "png";
  const params: Record<string, unknown> = {
    format,
    fromSurface: true,
  };

  if (format === "jpeg" && input.quality !== undefined) {
    params.quality = Math.max(0, Math.min(100, Math.round(input.quality)));
  }

  let width: number | undefined;
  let height: number | undefined;

  if (input.clip) {
    const clip = normalizeScreenshotClip({
      ...input.clip,
      x: input.clip.x + (captureSession.coordinateOffset?.x ?? 0),
      y: input.clip.y + (captureSession.coordinateOffset?.y ?? 0),
    });
    params.clip = { ...clip, scale: 1 };
    params.captureBeyondViewport = true;
    width = Math.round(clip.width);
    height = Math.round(clip.height);
  } else if (input.fullPage) {
    const metrics = await debuggerSendCommand<
      Record<string, never>,
      PageLayoutMetrics
    >(captureSession.target, "Page.getLayoutMetrics", {});
    const contentSize = metrics.cssContentSize ?? metrics.contentSize;
    const clip = normalizeScreenshotClip({
      x: contentSize.x ?? 0,
      y: contentSize.y ?? 0,
      width: contentSize.width,
      height: contentSize.height,
    });
    params.clip = { ...clip, scale: 1 };
    params.captureBeyondViewport = true;
    width = Math.round(clip.width);
    height = Math.round(clip.height);
  }

  const result = await debuggerSendCommand<
    Record<string, unknown>,
    { data: string }
  >(captureSession.target, "Page.captureScreenshot", params);
  const mimeType = format === "jpeg" ? "image/jpeg" : "image/png";

  return {
    capturedAt: new Date().toISOString(),
    mimeType,
    dataUrl: `data:${mimeType};base64,${result.data}`,
    method: "cdp",
    fullPage: Boolean(input.fullPage),
    selector: input.target ?? input.selector,
    width,
    height,
  };
}

export async function dispatchTrustedMouseMove(
  input: BrowserCoordinateInput,
  expectedTarget?: TrustedInputTargetAddress,
): Promise<BrowserMouseResult> {
  const session = await ensureTrustedInputSession(expectedTarget);
  await withTrustedInputFocus(session, () =>
    dispatchTrustedMouseEvents(session, [trustedMouseMoveEvent(input)]),
  );
  return { action: "move", x: input.x, y: input.y };
}

export async function dispatchTrustedMouseClick(
  input: BrowserCoordinateClickInput,
  expectedTarget?: TrustedInputTargetAddress,
): Promise<BrowserMouseResult> {
  const session = await ensureTrustedInputSession(expectedTarget);
  const button = input.button ?? "left";
  await withTrustedInputFocus(session, () =>
    dispatchTrustedMouseEvents(session, trustedMouseClickEvents(input)),
  );
  return { action: "click", x: input.x, y: input.y, button };
}

export async function dispatchTrustedMouseDown(
  input: BrowserCoordinateClickInput,
  expectedTarget?: TrustedInputTargetAddress,
): Promise<BrowserMouseResult> {
  const session = await ensureTrustedInputSession(expectedTarget);
  const button = input.button ?? "left";
  await withTrustedInputFocus(session, () =>
    dispatchTrustedMouseEvents(session, [trustedMouseDownEvent(input)]),
  );
  return { action: "down", x: input.x, y: input.y, button };
}

export async function dispatchTrustedMouseUp(
  input: BrowserCoordinateClickInput,
  expectedTarget?: TrustedInputTargetAddress,
): Promise<BrowserMouseResult> {
  const session = await ensureTrustedInputSession(expectedTarget);
  const button = input.button ?? "left";
  await withTrustedInputFocus(session, () =>
    dispatchTrustedMouseEvents(session, [trustedMouseUpEvent(input)]),
  );
  return { action: "up", x: input.x, y: input.y, button };
}

export async function dispatchTrustedMouseDrag(
  input: BrowserCoordinateDragInput,
  expectedTarget?: TrustedInputTargetAddress,
): Promise<BrowserMouseResult> {
  const session = await ensureTrustedInputSession(expectedTarget);
  await withTrustedInputFocus(session, () =>
    dispatchTrustedMouseEvents(
      session,
      trustedMouseDragEvents(input),
      true,
    ),
  );
  return { action: "drag", x: input.endX, y: input.endY, button: "left" };
}

export async function dispatchTrustedMouseWheel(
  input: BrowserMouseWheelInput,
  expectedTarget?: TrustedInputTargetAddress,
): Promise<BrowserMouseResult> {
  const session = await ensureTrustedInputSession(expectedTarget);
  const point = await resolveTrustedWheelPoint(session, input);
  await withTrustedInputFocus(session, () =>
    dispatchTrustedMouseEvents(session, [
      trustedMouseWheelEvent(input, point),
    ]),
  );
  return { action: "wheel", x: point.x, y: point.y };
}

export async function handleCurrentJavaScriptDialog(
  input: BrowserDialogInput,
  expectedTabId: number,
): Promise<BrowserDialogResult> {
  const session = await ensureDebuggerSessionForTab(expectedTabId);
  try {
    await debuggerSendCommand(
      session.target,
      "Page.handleJavaScriptDialog",
      currentJavaScriptDialogCommand(input),
    );
  } catch (error) {
    throw new Error(
      `NO_JAVASCRIPT_DIALOG: no current JavaScript dialog could be ${input.action === "accept" ? "accepted" : "dismissed"}. Open the dialog in the selected tab and retry. Details: ${errorMessage(error)}`,
    );
  }
  return {
    handled: true,
    action: input.action,
    ...(input.action === "accept" && input.promptText !== undefined
      ? { promptText: input.promptText }
      : {}),
  };
}

export async function dispatchTrustedTextInput(
  input: Pick<BrowserTypeInput, "text" | "replace" | "slowly" | "submit">,
  expectedTarget: TrustedInputTargetAddress,
): Promise<void> {
  const session = await ensureTrustedInputSession(expectedTarget);
  await withTrustedInputFocus(session, async () => {
    if (input.replace) {
      await dispatchTrustedKeyboardEvents(
        session,
        trustedReplaceSelectionEvents(),
      );
    }

    const chunks = input.slowly ? Array.from(input.text) : [input.text];
    for (const text of chunks) {
      if (text) {
        await debuggerSendCommand(session.target, "Input.insertText", { text });
      }
      if (input.slowly && text) {
        await delayMs(35);
      }
    }

    if (input.submit) {
      await dispatchTrustedKeyboardEvents(session, trustedKeyEvents("Enter"));
    }
  });
}

export async function dispatchTrustedKeyPress(
  input: Pick<BrowserPressKeyInput, "key">,
  expectedTarget: TrustedInputTargetAddress,
): Promise<void> {
  const session = await ensureTrustedInputSession(expectedTarget);
  await withTrustedInputFocus(session, () =>
    dispatchTrustedKeyboardEvents(session, trustedKeyEvents(input.key)),
  );
}

async function withTrustedInputFocus<T>(
  session: TrustedInputSession,
  execute: () => Promise<T>,
): Promise<T> {
  await debuggerSendCommand(
    session.target,
    "Emulation.setFocusEmulationEnabled",
    { enabled: true },
  );
  try {
    return await execute();
  } finally {
    await debuggerSendCommand(
      session.target,
      "Emulation.setFocusEmulationEnabled",
      { enabled: false },
    ).catch(() => undefined);
  }
}

async function ensureTrustedInputSession(
  expectedTarget: TrustedInputTargetAddress | undefined,
): Promise<TrustedInputSession> {
  const session = expectedTarget
    ? await ensureDebuggerSessionForTab(expectedTarget.tabId)
    : await ensureDebuggerSession();
  if (!expectedTarget || expectedTarget.frameId === 0) {
    return { tabId: session.tabId, target: session.target };
  }

  await ensureOopifAutoAttach(session);
  await refreshChildDebuggerRoutes(session);
  const oopifRoute = childDebuggerRoutes.get(expectedTarget.frameId);
  if (oopifRoute) {
    const route = requireDebuggerFrameRoute(
      childDebuggerRoutes,
      expectedTarget.frameId,
      expectedTarget.documentId,
    );
    return { tabId: session.tabId, target: route.target };
  }
  const route = requireDebuggerFrameRoute(
    debuggerFrameRoutes,
    expectedTarget.frameId,
    expectedTarget.documentId,
  );
  return {
    tabId: session.tabId,
    target: session.target,
    coordinateOffset: await resolveFrameContentOrigin(session.target, route),
  };
}

async function dispatchTrustedMouseEvents(
  session: TrustedInputSession,
  events: TrustedMouseEventParams[],
  paceMoves = false,
): Promise<void> {
  for (const event of events) {
    const translated = session.coordinateOffset
      ? {
          ...event,
          x: event.x + session.coordinateOffset.x,
          y: event.y + session.coordinateOffset.y,
        }
      : event;
    await debuggerSendCommand(
      session.target,
      "Input.dispatchMouseEvent",
      translated,
    );
    if (paceMoves && event.type === "mouseMoved") {
      await delayMs(16);
    }
  }
}

async function dispatchTrustedKeyboardEvents(
  session: TrustedInputSession,
  events: TrustedKeyEventParams[],
): Promise<void> {
  for (const event of events) {
    await debuggerSendCommand(
      session.target,
      "Input.dispatchKeyEvent",
      event,
    );
  }
}

async function resolveTrustedWheelPoint(
  session: TrustedInputSession,
  input: BrowserMouseWheelInput,
): Promise<{ x: number; y: number }> {
  if (input.x !== undefined && input.y !== undefined) {
    return { x: input.x, y: input.y };
  }
  const metrics = await debuggerSendCommand<
    Record<string, never>,
    { cssVisualViewport?: { clientWidth?: number; clientHeight?: number } }
  >(session.target, "Page.getLayoutMetrics", {}).catch(
    (): { cssVisualViewport?: { clientWidth?: number; clientHeight?: number } } =>
      ({}),
  );
  return {
    x: input.x ?? Math.round((metrics.cssVisualViewport?.clientWidth ?? 0) / 2),
    y: input.y ?? Math.round((metrics.cssVisualViewport?.clientHeight ?? 0) / 2),
  };
}

export async function enableProxyDebugger(): Promise<DebuggerProxyStatus> {
  await ensureProxyStateLoaded();
  proxyEnabled = true;
  await saveProxyState();
  proxyLog("proxy.enable.start", {
    ruleCount: proxyRules.size,
    rules: currentProxyRules().map(summarizeProxyRule),
  });
  const session = await ensureDebuggerSession();
  await ensureNetworkEnabled(session);
  await applyFetchInterception(session);
  const status = proxyStatus();
  proxyLog("proxy.enable.done", { status });
  return status;
}

export async function disableProxyDebugger(): Promise<DebuggerProxyStatus> {
  await ensureProxyStateLoaded();
  proxyEnabled = false;
  await saveProxyState();
  if (activeSession?.attached && activeSession.fetchEnabled) {
    for (const target of allDebuggerTargets(activeSession)) {
      await debuggerSendCommand(target, "Fetch.disable", {}).catch((error) => {
        proxyLog(
          "fetch.disable.target.fail",
          { target: summarizeDebuggee(target), error: errorMessage(error) },
          "warn",
        );
      });
    }
    activeSession.fetchEnabled = false;
  }
  const status = proxyStatus();
  proxyLog("proxy.disable", { status });
  return status;
}

export async function listProxyRules(): Promise<DebuggerProxyListResult> {
  await ensureProxyStateLoaded();
  return {
    status: proxyStatus(),
    rules: currentProxyRules(),
  };
}

export async function upsertProxyRule(
  input: DebuggerProxyRuleInput,
): Promise<DebuggerProxyRuleMutationResult> {
  await ensureProxyStateLoaded();
  const now = new Date().toISOString();
  const existing = input.id ? proxyRules.get(input.id) : undefined;
  const id = input.id?.trim() || `proxy-${Date.now().toString(36)}`;
  const matcher = normalizeProxyMatcherFields({ ...existing, ...input });
  const { resetScenario: _resetScenario, ...storedInput } = input;
  const rule: DebuggerProxyRule = {
    ...existing,
    ...storedInput,
    urlPattern: matcher.urlPattern,
    urlContains: matcher.urlContains,
    regexFilter: matcher.regexFilter,
    id,
    enabled: input.enabled ?? existing?.enabled ?? true,
    priority: input.priority ?? existing?.priority ?? 1,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    hitCount: existing?.hitCount ?? 0,
    lastHitAt: existing?.lastHitAt,
    scenarioStepIndex:
      input.resetScenario === true
        ? 0
        : (existing?.scenarioStepIndex ?? 0),
    scenarioHitCount:
      input.resetScenario === true
        ? 0
        : (existing?.scenarioHitCount ?? 0),
  };

  clearExplicitProxyFields(rule, input);

  proxyRules.set(id, rule);
  proxyEnabled = true;
  await saveProxyState();
  proxyLog("proxy.rule.upsert", {
    rule: summarizeProxyRule(rule),
    matcher,
    inputId: input.id,
  });
  const session = await ensureDebuggerSession();
  await ensureNetworkEnabled(session);
  await applyFetchInterception(session);

  const result = {
    status: proxyStatus(),
    rule,
    rules: currentProxyRules(),
  };
  proxyLog("proxy.rule.upsert.done", { status: result.status });
  return result;
}

function clearExplicitProxyFields(
  rule: DebuggerProxyRule,
  input: DebuggerProxyRuleInput,
): void {
  if (Object.prototype.hasOwnProperty.call(input, "requestHeaders")) {
    rule.requestHeaders = input.requestHeaders;
  }
  if (Object.prototype.hasOwnProperty.call(input, "responseHeaders")) {
    rule.responseHeaders = input.responseHeaders;
  }
  if (Object.prototype.hasOwnProperty.call(input, "responseBody")) {
    rule.responseBody = input.responseBody;
  }
  if (Object.prototype.hasOwnProperty.call(input, "responseBodyBase64")) {
    rule.responseBodyBase64 = input.responseBodyBase64;
  }
  if (Object.prototype.hasOwnProperty.call(input, "statusCode")) {
    rule.statusCode = input.statusCode;
  }
  if (Object.prototype.hasOwnProperty.call(input, "contentType")) {
    rule.contentType = input.contentType;
  }
  if (Object.prototype.hasOwnProperty.call(input, "responsePhrase")) {
    rule.responsePhrase = input.responsePhrase;
  }
  if (Object.prototype.hasOwnProperty.call(input, "mockStage")) {
    rule.mockStage = input.mockStage;
  }
  if (Object.prototype.hasOwnProperty.call(input, "scenarioSteps")) {
    rule.scenarioSteps = input.scenarioSteps;
    if (!input.scenarioSteps?.length) {
      rule.scenarioStepIndex = 0;
      rule.scenarioHitCount = 0;
    }
  }
  if (Object.prototype.hasOwnProperty.call(input, "scenarioRepeat")) {
    rule.scenarioRepeat = input.scenarioRepeat;
  }
}

export async function removeProxyRule(
  input: DebuggerProxyRemoveRuleInput,
): Promise<DebuggerProxyRuleMutationResult> {
  await ensureProxyStateLoaded();
  proxyRules.delete(input.id);
  await saveProxyState();
  if (activeSession?.attached) {
    await applyFetchInterception(activeSession);
  }

  return {
    status: proxyStatus(),
    rules: currentProxyRules(),
  };
}

export async function clearProxyRules(): Promise<DebuggerProxyRuleMutationResult> {
  await ensureProxyStateLoaded();
  proxyRules.clear();
  await saveProxyState();
  if (activeSession?.attached) {
    await applyFetchInterception(activeSession);
  }

  return {
    status: proxyStatus(),
    rules: [],
  };
}

export async function restoreProxyDebuggerForTab(
  tabId?: number,
): Promise<DebuggerProxyStatus | undefined> {
  await ensureProxyStateLoaded();
  if (!proxyEnabled || proxyRules.size === 0) {
    proxyLog("proxy.restore.skip", {
      tabId,
      proxyEnabled,
      ruleCount: proxyRules.size,
    });
    return undefined;
  }

  proxyLog("proxy.restore.start", {
    tabId,
    hadSession: Boolean(activeSession),
    wasAttached: activeSession?.attached,
  });

  if (activeSession && !activeSession.attached) {
    clearChildDebuggerSessions();
    activeSession = null;
  }

  try {
    const session = await ensureDebuggerSessionForTab(tabId);
    await ensureNetworkEnabled(session);
    await applyFetchInterception(session);
    const status = proxyStatus();
    proxyLog("proxy.restore.done", { tabId, status });
    return status;
  } catch (error) {
    proxyLog(
      "proxy.restore.fail",
      { tabId, error: errorMessage(error) },
      "error",
    );
    throw error;
  }
}

export function listProxyHits(
  input: DebuggerProxyListHitsInput,
): DebuggerProxyListHitsResult {
  const filtered = input.ruleId
    ? proxyHits.filter((hit) => hit.ruleId === input.ruleId)
    : proxyHits;
  const limit = input.limit ?? 100;
  const hits = filtered.slice(-limit).reverse();

  return {
    total: filtered.length,
    returned: hits.length,
    hits,
  };
}

export async function listConsoleMessages(
  input: BrowserConsoleMessagesInput,
): Promise<BrowserConsoleMessagesResult> {
  const session = await ensureDebuggerSession();
  await ensureConsoleEnabled(session);

  const minLevel = input.level ?? "info";
  const limit = input.limit ?? 100;
  const filtered = session.consoleMessages
    .filter(
      (message) => input.all || message.timestampMs >= session.pageStartedAt,
    )
    .filter(
      (message) =>
        consoleLevelWeight(message.level) <= consoleLevelWeight(minLevel),
    );
  const messages = filtered
    .slice(-limit)
    .map(({ timestampMs: _timestampMs, ...message }) => message)
    .reverse();

  return {
    attached: session.attached,
    tabId: session.tabId,
    total: filtered.length,
    returned: messages.length,
    messages,
  };
}

export async function startRuntimeErrorMonitoring(
  preserveLog = false,
): Promise<{ streamId: string; sequence: number }> {
  const session = await ensureDebuggerSession();
  if (!session.runtimeErrorMonitoringActive && !preserveLog) {
    resetRuntimeErrorStream(session);
  }
  await Promise.all([
    ensureConsoleEnabled(session),
    ensureDebuggerEnabled(session),
  ]);
  session.runtimeErrorMonitoringActive = true;
  return {
    streamId: session.runtimeErrorStreamId,
    sequence: session.runtimeErrorSequence,
  };
}

export function stopRuntimeErrorMonitoring(): void {
  if (activeSession) {
    activeSession.runtimeErrorMonitoringActive = false;
  }
}

export async function listRuntimeErrors(
  input: BrowserRuntimeErrorsInput,
): Promise<BrowserRuntimeErrorsResult> {
  const session = await ensureDebuggerSession();
  await startRuntimeErrorMonitoring(true);

  const window = selectRuntimeErrorWindow(
    session.runtimeErrors,
    session.runtimeErrorStreamId,
    session.runtimeErrorSequence,
    input,
  );
  const maxFrames = input.maxFramesPerError ?? 8;
  const errors = await Promise.all(
    window.selected.map((error) =>
      materializeRuntimeError(
        session,
        error,
        maxFrames,
        input.includeSourceExcerpt === true,
      ),
    ),
  );

  return {
    version: "browser-runtime-errors-v1",
    attached: session.attached,
    tabId: session.tabId,
    cursorStatus: window.cursorStatus,
    cursor: {
      streamId: session.runtimeErrorStreamId,
      sequence: window.effectiveAfter,
    },
    nextCursor: {
      streamId: session.runtimeErrorStreamId,
      sequence: window.nextSequence,
    },
    oldestSequence: window.oldestSequence,
    latestSequence: window.latestSequence,
    missedEvents: window.missedEvents,
    droppedEvents: session.droppedRuntimeErrorCount,
    total: window.candidates.length,
    returned: errors.length,
    errors,
  };
}

export async function startNetworkDebugger(
  input: DebuggerNetworkStartInput,
): Promise<DebuggerNetworkStatus> {
  const session = await ensureDebuggerSession();
  const maxEntries = input.maxEntries ?? DEFAULT_MAX_NETWORK_ENTRIES;
  const preserveLog = input.preserveLog ?? false;
  session.maxEntries = maxEntries;
  session.preservedLog = preserveLog;
  if (!session.networkEnabled && !preserveLog) {
    clearNetworkRequests();
  }

  if (!session.networkEnabled) {
    session.observationSessionId = `network-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    session.observationStartedAt = new Date().toISOString();
  }

  await debuggerSendCommand(session.target, "Network.enable", {});
  session.networkEnabled = true;

  return networkStatus();
}

export async function collectRealtimeDebuggerActivity(
  limit = 30,
): Promise<Pick<BrowserRealtimeActivityResult, "websocket" | "eventSource">> {
  const session = await ensureDebuggerSession();
  if (!session.networkEnabled) {
    await debuggerSendCommand(session.target, "Network.enable", {});
    session.networkEnabled = true;
  }
  const boundedLimit = Math.min(100, Math.max(1, limit));
  return {
    websocket: Array.from(session.webSockets.values())
      .slice(-boundedLimit)
      .reverse()
      .map((entry) => ({ ...entry })),
    eventSource: Array.from(session.eventSources.values())
      .slice(-boundedLimit)
      .reverse()
      .map((entry) => ({ ...entry })),
  };
}

export async function stopNetworkDebugger(): Promise<DebuggerNetworkStatus> {
  const session = requireNetworkSession();
  if (session.networkEnabled) {
    await debuggerSendCommand(session.target, "Network.disable", {});
    session.networkEnabled = false;
  }
  return networkStatus();
}

export function clearNetworkDebugger(): DebuggerNetworkStatus {
  clearNetworkRequests();
  return networkStatus();
}

export function listNetworkRequests(
  input: DebuggerNetworkListInput,
): DebuggerNetworkListResult {
  const digestOnly = input.digestOnly === true;
  if (!activeSession) {
    const page = paginateCollection([], input, {
      kind: "network",
      sourceKey: "detached",
      defaultLimit: 50,
      maxLimit: 100,
    });
    return {
      attached: false,
      digestOnly,
      total: 0,
      returned: 0,
      requests: [],
      activityDigest: buildNetworkActivityDigest([]),
      droppedRequestCount: 0,
      capacityReached: false,
      pagination: normalizeNetworkResultPagination(page.pagination, digestOnly),
      observationSessionId: undefined,
      observationStartedAt: undefined,
    };
  }

  const filteredRequests = activeSession.requestOrder
    .map((requestId) => activeSession?.requests.get(requestId))
    .filter((request): request is NetworkRequestRecord => Boolean(request))
    .filter((request) => matchesNetworkFilter(request, input))
    .reverse()
    .map(toNetworkSummary);
  const page = paginateCollection(filteredRequests, input, {
    kind: "network",
    sourceKey: JSON.stringify({
      tabId: activeSession.tabId,
      urlContains: input.urlContains ?? null,
      method: input.method?.toLowerCase() ?? null,
      resourceType: input.resourceType?.toLowerCase() ?? null,
      statusMin: input.statusMin ?? null,
      statusMax: input.statusMax ?? null,
    }),
    defaultLimit: 50,
    maxLimit: 100,
  });

  return {
    attached: activeSession.attached,
    tabId: activeSession.tabId,
    digestOnly,
    total: filteredRequests.length,
    returned: digestOnly ? 0 : page.items.length,
    requests: digestOnly ? [] : page.items,
    activityDigest: buildNetworkActivityDigest(filteredRequests),
    droppedRequestCount: activeSession.droppedRequestCount,
    capacityReached: activeSession.droppedRequestCount > 0,
    pagination: normalizeNetworkResultPagination(page.pagination, digestOnly),
    observationSessionId: activeSession.observationSessionId,
    observationStartedAt: activeSession.observationStartedAt,
  };
}

export async function getNetworkRequest(
  input: DebuggerNetworkGetInput,
): Promise<DebuggerNetworkRequestDetail> {
  const session = requireNetworkSession();
  const record = session.requests.get(input.requestId);
  if (!record) {
    throw new Error(`Network request not found: ${input.requestId}`);
  }

  const detail: DebuggerNetworkRequestDetail = {
    ...toNetworkSummary(record),
    documentUrl: record.documentUrl,
    requestHeaders: record.requestHeaders,
    responseHeaders: record.responseHeaders,
    requestPostData: record.requestPostData,
    initiatorType: record.initiatorType,
    initiatorStack: record.initiatorStack,
    remoteAddress: record.remoteAddress,
  };

  if (input.includeBody) {
    detail.body = await getNetworkResponseBody({
      requestId: input.requestId,
    });
  }

  return detail;
}

export async function getNetworkResponseBody(
  input: DebuggerNetworkBodyInput,
): Promise<DebuggerNetworkResponseBody> {
  const session = requireNetworkSession();
  if (!session.requests.has(input.requestId)) {
    throw new Error(`Network request not found: ${input.requestId}`);
  }

  const result = await debuggerSendCommand<
    { requestId: string },
    { body: string; base64Encoded: boolean }
  >(session.target, "Network.getResponseBody", {
    requestId: input.requestId,
  });

  const truncated = result.body.length > MAX_RESPONSE_BODY_CHARS;
  return {
    requestId: input.requestId,
    body: truncated
      ? result.body.slice(0, MAX_RESPONSE_BODY_CHARS)
      : result.body,
    base64Encoded: result.base64Encoded,
    truncated,
  };
}

export async function detachDebugger(
  input: DebuggerDetachInput = {},
): Promise<DebuggerDetachResult> {
  const tabId = input.tabId ?? activeSession?.tabId;
  if (!tabId) {
    return { detached: false };
  }

  manualDebuggerDetachTabIds.add(tabId);
  if (activeSession?.tabId === tabId && activeSession.attached) {
    await resumePausedDebugTargets(activeSession);
    await debuggerDetach(activeSession.target).catch((error) => {
      manualDebuggerDetachTabIds.delete(tabId);
      throw error;
    });
  } else {
    await debuggerDetach({ tabId }).catch(() => {
      manualDebuggerDetachTabIds.delete(tabId);
    });
  }

  if (activeSession?.tabId === tabId) {
    clearChildDebuggerSessions();
    activeSession = null;
  }

  return { detached: true, tabId };
}

function registerDebuggerListeners(): void {
  if (debuggerListenersRegistered) {
    return;
  }

  chrome.debugger.onEvent.addListener(handleDebuggerEvent);
  chrome.debugger.onDetach.addListener((source, reason) => {
    const session = activeSession;
    if (!session || !sourceMatchesSession(source, session)) {
      return;
    }
    proxyLog("debugger.detach", {
      reason,
      source: summarizeDebuggee(source),
      tabId: session.tabId,
    });
    clearChildDebuggerSessions();
    session.attached = false;
    session.networkEnabled = false;
    session.fetchEnabled = false;
    session.oopifAutoAttachEnabled = false;
    session.breakpoints.clear();
    session.pausedTargets.clear();
    session.pauseOnExceptions.clear();
    if (shouldRespectManualDebuggerDetach(session.tabId, reason)) {
      void stopProxyAfterManualDebuggerDetach(session.tabId, reason);
      return;
    }
    if (proxyEnabled && proxyRules.size > 0) {
      void tryImmediateProxyReattach(session.tabId, reason);
      requestProxyRestore(session.tabId, `detach.${reason}`);
    }
  });
  debuggerListenersRegistered = true;
}

function shouldRespectManualDebuggerDetach(tabId: number, reason: string): boolean {
  const wasManualDetach = manualDebuggerDetachTabIds.delete(tabId);
  return reason === "canceled_by_user" || wasManualDetach;
}

async function stopProxyAfterManualDebuggerDetach(
  tabId: number,
  reason: string,
): Promise<void> {
  proxyEnabled = false;
  proxyRestoreLoopGeneration += 1;
  clearChildDebuggerSessions();
  await saveProxyState();
  scheduleProxyStateBroadcast();
  proxyLog("proxy.stopAfterManualDetach", { tabId, reason });
}

const PROXY_RESTORE_ATTEMPTS = 50;
const PROXY_RESTORE_INTERVAL_MS = 25;

async function tryImmediateProxyReattach(
  tabId: number,
  reason: string,
): Promise<void> {
  await ensureProxyStateLoaded();
  if (!proxyEnabled || proxyRules.size === 0) {
    return;
  }

  try {
    proxyLog("proxy.reattach.immediate", { tabId, reason });
    if (activeSession && activeSession.tabId === tabId && !activeSession.attached) {
      clearChildDebuggerSessions();
    }
    const session = await ensureDebuggerSessionForTab(tabId);
    await ensureNetworkEnabled(session);
    await applyFetchInterception(session);
    proxyLog("proxy.reattach.immediate.done", {
      tabId,
      attached: activeSession?.attached,
      fetchEnabled: activeSession?.fetchEnabled,
    });
  } catch (error) {
    proxyLog(
      "proxy.reattach.immediate.fail",
      { tabId, reason, error: errorMessage(error) },
      "warn",
    );
  }
}

export function requestProxyRestore(tabId: number, reason: string): void {
  void ensureProxyStateLoaded().then(() => {
    if (!proxyEnabled || proxyRules.size === 0) {
      return;
    }
    const generation = ++proxyRestoreLoopGeneration;
    proxyLog("proxy.restore.loop.start", { tabId, reason, generation });
    void runProxyRestoreLoop(tabId, generation, reason);
  });
}

async function runProxyRestoreLoop(
  tabId: number,
  generation: number,
  reason: string,
): Promise<void> {
  proxyLog("proxy.restore.start", { tabId, reason, generation });

  for (let attempt = 0; attempt < PROXY_RESTORE_ATTEMPTS; attempt += 1) {
    if (generation !== proxyRestoreLoopGeneration) {
      return;
    }

    if (attempt > 0) {
      await delayMs(PROXY_RESTORE_INTERVAL_MS);
    }

    try {
      const tab = await getTab(tabId);
      const tabUrl = tab?.url ?? tab?.pendingUrl;
      if (!tab?.id || !isTabUrlScriptable(tabUrl)) {
        continue;
      }

      if (activeSession?.tabId === tabId && !activeSession.attached) {
        clearChildDebuggerSessions();
      }

      const session = await ensureDebuggerSessionForTab(tabId);
      await ensureNetworkEnabled(session);
      await applyFetchInterception(session);

      if (activeSession?.attached && activeSession.fetchEnabled) {
        proxyLog("proxy.restore.done", {
          tabId,
          reason,
          attempt,
          generation,
        });
        return;
      }
    } catch (error) {
      proxyLog(
        "proxy.restore.loop.attempt.fail",
        {
          tabId,
          reason,
          attempt,
          error: errorMessage(error),
        },
        "warn",
      );
    }
  }

  proxyLog(
    "proxy.restore.loop.exhausted",
    { tabId, reason, generation },
    "warn",
  );
}

function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function scheduleProxyStateBroadcast(): void {
  if (proxyStateBroadcastTimer !== null) {
    clearTimeout(proxyStateBroadcastTimer);
  }
  proxyStateBroadcastTimer = setTimeout(() => {
    proxyStateBroadcastTimer = null;
    broadcastProxyStateChanged();
  }, 80);
}

function broadcastProxyStateChanged(): void {
  void persistProxyHits();
  void saveProxyState();
  sendRuntimeEvent(
    makeEvent("background", MESSAGE_TYPES.DEBUGGER_PROXY_STATE_CHANGED, {
      status: proxyStatus(),
      rules: currentProxyRules(),
      hits: proxyHits.slice(-50).reverse(),
    }),
  );
}

function handleDebuggerEvent(
  source: DebuggerTarget,
  method: string,
  params?: object,
): void {
  if (!params) {
    return;
  }

  if (method === "Target.attachedToTarget") {
    if (activeSession && sourceMatchesSession(source, activeSession)) {
      void handleAttachedToTarget(
        activeSession,
        source,
        params as TargetAttachedToTargetEvent,
      );
    }
    return;
  }

  if (method === "Target.detachedFromTarget") {
    handleDetachedFromTarget(params as TargetDetachedFromTargetEvent);
    return;
  }

  if (method === "Fetch.requestPaused") {
    void handleFetchPauseEvent(source, params as FetchRequestPausedEvent).catch(
      (error) => {
        proxyLog("fetch.pause.unhandled", {
          error: errorMessage(error),
        }, "warn");
      },
    );
    return;
  }

  if (!activeSession || !sourceMatchesSession(source, activeSession)) {
    return;
  }

  switch (method) {
    case "Network.requestWillBeSent":
      handleRequestWillBeSent(params as NetworkRequestWillBeSentEvent);
      break;
    case "Network.responseReceived":
      handleResponseReceived(params as NetworkResponseReceivedEvent);
      break;
    case "Network.loadingFinished":
      handleLoadingFinished(params as NetworkLoadingFinishedEvent);
      break;
    case "Network.loadingFailed":
      handleLoadingFailed(params as NetworkLoadingFailedEvent);
      break;
    case "Network.webSocketCreated":
      handleWebSocketCreated(params as NetworkWebSocketCreatedEvent);
      break;
    case "Network.webSocketWillSendHandshakeRequest":
      handleWebSocketHandshake(params as NetworkWebSocketHandshakeEvent);
      break;
    case "Network.webSocketFrameSent":
      handleWebSocketFrame(params as NetworkWebSocketFrameEvent, "sent");
      break;
    case "Network.webSocketFrameReceived":
      handleWebSocketFrame(params as NetworkWebSocketFrameEvent, "received");
      break;
    case "Network.webSocketClosed":
      handleWebSocketClosed(params as NetworkWebSocketClosedEvent);
      break;
    case "Network.webSocketFrameError":
      handleWebSocketError(params as NetworkWebSocketErrorEvent);
      break;
    case "Network.eventSourceMessageReceived":
      handleEventSourceMessage(params as NetworkEventSourceMessageEvent);
      break;
    case "Runtime.consoleAPICalled":
      handleRuntimeConsoleAPICalled(
        source,
        params as RuntimeConsoleApiCalledEvent,
      );
      break;
    case "Runtime.exceptionThrown":
      handleRuntimeExceptionThrown(
        source,
        params as RuntimeExceptionThrownEvent,
      );
      break;
    case "Runtime.exceptionRevoked":
      handleRuntimeExceptionRevoked(params as RuntimeExceptionRevokedEvent);
      break;
    case "Log.entryAdded":
      handleLogEntryAdded(params as LogEntryAddedEvent);
      break;
    case "Debugger.scriptParsed":
      handleScriptParsed(source, params as DebuggerScriptParsedEvent);
      break;
    case "Debugger.paused":
      handleDebuggerPaused(source, params as DebuggerPausedEvent);
      break;
    case "Debugger.resumed":
      activeSession.pausedTargets.delete(debuggerTargetIdentity(source));
      break;
    case "Debugger.breakpointResolved":
      handleDebuggerBreakpointResolved(
        source,
        params as DebuggerBreakpointResolvedEvent,
      );
      break;
    default:
      break;
  }
}

function handleDebuggerPaused(
  source: DebuggerTarget,
  event: DebuggerPausedEvent,
): void {
  const session = activeSession;
  if (!session || !sourceMatchesSession(source, session)) {
    return;
  }
  const callFrames = event.callFrames
    .slice(0, DEBUG_EXECUTION_LIMITS.callFrames)
    .map((frame): BrowserDebugCallFrame => {
      const script = session.scriptsById.get(frame.location.scriptId);
      return {
        callFrameId: frame.callFrameId,
        functionName:
          boundedDebugText(frame.functionName, 1_000) || "(anonymous)",
        ...(frame.url || script?.url
          ? { url: boundedDebugText(frame.url || script?.url, 8_000) }
          : {}),
        scriptId: frame.location.scriptId,
        lineNumber: frame.location.lineNumber + 1,
        columnNumber: frame.location.columnNumber ?? 0,
        scopeTypes: frame.scopeChain
          .slice(0, 20)
          .map((scope) => scope.type),
      };
    });
  session.pausedTargets.set(debuggerTargetIdentity(source), {
    paused: true,
    reason: boundedDebugText(event.reason, 500) ?? "other",
    hitBreakpoints: (event.hitBreakpoints ?? []).slice(
      0,
      DEBUG_EXECUTION_LIMITS.breakpoints,
    ),
    callFrames,
    pausedAt: new Date().toISOString(),
  });
}

function handleDebuggerBreakpointResolved(
  source: DebuggerTarget,
  event: DebuggerBreakpointResolvedEvent,
): void {
  const session = activeSession;
  if (!session || !sourceMatchesSession(source, session)) {
    return;
  }
  const targetKey = debuggerTargetIdentity(source);
  const stored = findStoredBreakpoint(
    session,
    targetKey,
    event.breakpointId,
  );
  if (!stored) {
    return;
  }
  const resolved = toPublicBreakpointLocation(event.location);
  if (
    !stored.resolvedLocations.some(
      (location) =>
        location.scriptId === resolved.scriptId &&
        location.lineNumber === resolved.lineNumber &&
        location.columnNumber === resolved.columnNumber,
    )
  ) {
    stored.resolvedLocations.push(resolved);
  }
}

async function handleFetchPauseEvent(
  source: DebuggerTarget,
  event: FetchRequestPausedEvent,
): Promise<void> {
  const session = activeSession;
  const stage = isResponsePausedEvent(event) ? "response" : "request";

  if (session && !session.attached) {
    proxyLog("fetch.pause.detached", {
      ...summarizeFetchPause(event, stage),
      source: summarizeDebuggee(source),
      tabId: session.tabId,
    });
    await continuePausedRequestOnSource(source, event.requestId).catch((error) => {
      proxyLog(
        "fetch.pause.continueAfterDetach.fail",
        { requestId: event.requestId, error: errorMessage(error) },
        "warn",
      );
    });
    return;
  }
  if (!session || !sourceMatchesSession(source, session)) {
    proxyLog("fetch.pause.unmatchedDebuggee", {
      ...summarizeFetchPause(event, stage),
      source: summarizeDebuggee(source),
      sessionTabId: session?.tabId,
      sessionTargetId: session?.target.targetId,
    });
    await continuePausedRequestOnSource(source, event.requestId).catch((error) => {
      proxyLog(
        "fetch.pause.unmatchedDebuggee.continue.fail",
        { requestId: event.requestId, error: errorMessage(error) },
        "warn",
      );
    });
    return;
  }

  await handleFetchRequestPaused(source, event);
}

async function handleAttachedToTarget(
  session: NetworkSession,
  source: DebuggerTarget,
  event: TargetAttachedToTargetEvent,
): Promise<void> {
  if (!event.sessionId) {
    return;
  }
  if (event.targetInfo?.type !== "iframe") {
    return;
  }
  if (
    !childDebuggerSessions.has(event.sessionId) &&
    childDebuggerSessions.size >= MAX_CHILD_DEBUGGER_SESSIONS
  ) {
    await debuggerSendCommand(source, "Target.detachFromTarget", {
      sessionId: event.sessionId,
    }).catch(() => undefined);
    proxyLog(
      "oopif.session.limit",
      { limit: MAX_CHILD_DEBUGGER_SESSIONS },
      "warn",
    );
    return;
  }

  const childTarget: DebuggerTarget = {
    ...source,
    sessionId: event.sessionId,
  };
  childDebuggerSessions.set(event.sessionId, {
    target: childTarget,
  });
  childRouteRefreshGeneration += 1;
  try {
    await enableOopifAutoAttachOnTarget(childTarget);
    await syncChildSessionState(session, childTarget);
    await refreshChildDebuggerRoutes(session);
  } catch (error) {
    proxyLog("child.session.sync.fail", {
      sessionId: event.sessionId,
      error: errorMessage(error),
    }, "warn");
  }
}

function clearChildDebuggerSessions(): void {
  childRouteRefreshGeneration += 1;
  childDebuggerSessions.clear();
  childDebuggerRoutes.clear();
  debuggerFrameRoutes.clear();
}

async function ensureOopifAutoAttach(session: NetworkSession): Promise<void> {
  if (session.oopifAutoAttachEnabled) {
    return;
  }
  try {
    await enableOopifAutoAttachOnTarget(session.target);
    session.oopifAutoAttachEnabled = true;
  } catch (error) {
    proxyLog(
      "oopif.autoAttach.unavailable",
      { tabId: session.tabId, error: errorMessage(error) },
      "warn",
    );
  }
}

async function enableOopifAutoAttachOnTarget(
  target: DebuggerTarget,
): Promise<void> {
  await debuggerSendCommand(
    target,
    "Target.setAutoAttach",
    createOopifAutoAttachParams(),
  );
}

async function refreshChildDebuggerRoutes(
  session: NetworkSession,
): Promise<void> {
  const generation = ++childRouteRefreshGeneration;
  const [rootFrameTree, navigationFrames] = await Promise.all([
    debuggerSendCommand<Record<string, never>, PageFrameTreeResult>(
      session.target,
      "Page.getFrameTree",
      {},
    ),
    getAllNavigationFrames(session.tabId),
  ]);
  const frameRoutes = mapDebuggerFrameTree(
    rootFrameTree.frameTree,
    navigationFrames,
  );
  const resolvedRoutes = new Map<number, RoutedChildDebuggerSession>();
  const resolvedFrameRoutes = new Map<number, DebuggerFrameRoute>();
  const ambiguousFrameIds = new Set<number>();
  for (const route of frameRoutes.values()) {
    if (route.frameId !== 0) {
      resolvedFrameRoutes.set(route.frameId, route);
    }
  }

  await Promise.all(
    [...childDebuggerSessions.entries()].map(async ([sessionId, child]) => {
      const childFrameTree = await debuggerSendCommand<
        Record<string, never>,
        PageFrameTreeResult
      >(child.target, "Page.getFrameTree", {}).catch(() => undefined);
      const cdpFrameId = childFrameTree?.frameTree.frame.id;
      if (!cdpFrameId) {
        return;
      }
      const route =
        frameRoutes.get(cdpFrameId) ??
        matchUniqueNavigationFrameRoute(
          childFrameTree.frameTree.frame,
          navigationFrames,
        );
      if (!route || route.frameId === 0 || ambiguousFrameIds.has(route.frameId)) {
        return;
      }
      if (resolvedRoutes.has(route.frameId)) {
        resolvedRoutes.delete(route.frameId);
        ambiguousFrameIds.add(route.frameId);
        return;
      }
      resolvedRoutes.set(route.frameId, {
        ...route,
        sessionId,
        target: child.target,
      });
    }),
  );

  if (generation !== childRouteRefreshGeneration || activeSession !== session) {
    return;
  }
  childDebuggerRoutes.clear();
  debuggerFrameRoutes.clear();
  for (const [frameId, route] of resolvedFrameRoutes) {
    debuggerFrameRoutes.set(frameId, route);
  }
  for (const [frameId, route] of resolvedRoutes) {
    if (!ambiguousFrameIds.has(frameId)) {
      childDebuggerRoutes.set(frameId, route);
    }
  }
}

async function resolveFrameContentOrigin(
  target: DebuggerTarget,
  route: DebuggerFrameRoute,
): Promise<BrowserCoordinateInput> {
  await debuggerSendCommand(target, "DOM.enable", {}).catch(() => undefined);
  const owner = await debuggerSendCommand<
    { frameId: string },
    DomGetFrameOwnerResult
  >(target, "DOM.getFrameOwner", { frameId: route.cdpFrameId });
  const box = await debuggerSendCommand<
    { backendNodeId: number },
    DomGetBoxModelResult
  >(target, "DOM.getBoxModel", { backendNodeId: owner.backendNodeId });
  return frameOwnerContentOrigin(box.model);
}

function handleDetachedFromTarget(event: TargetDetachedFromTargetEvent): void {
  if (!event.sessionId) {
    return;
  }
  const childTarget = childDebuggerSessions.get(event.sessionId)?.target;
  const detachedTargetKey = childTarget
    ? debuggerTargetIdentity(childTarget)
    : undefined;
  childDebuggerSessions.delete(event.sessionId);
  if (activeSession && detachedTargetKey) {
    activeSession.pausedTargets.delete(detachedTargetKey);
    activeSession.pauseOnExceptions.delete(detachedTargetKey);
    for (const [key, breakpoint] of activeSession.breakpoints) {
      if (breakpoint.debuggerTargetKey === detachedTargetKey) {
        activeSession.breakpoints.delete(key);
      }
    }
  }
  childRouteRefreshGeneration += 1;
  for (const [frameId, route] of childDebuggerRoutes) {
    if (route.sessionId === event.sessionId) {
      childDebuggerRoutes.delete(frameId);
    }
  }
}

async function ensureDebuggerSession(): Promise<NetworkSession> {
  if (ensureSessionPromise) {
    return ensureSessionPromise;
  }

  ensureSessionPromise = ensureDebuggerSessionForTab(undefined).finally(() => {
    ensureSessionPromise = null;
  });

  return ensureSessionPromise;
}

async function ensureDebuggerSessionForTab(
  tabId: number | undefined,
): Promise<NetworkSession> {
  const tab = tabId === undefined ? await queryActiveTab() : await getTab(tabId);
  if (!tab?.id) {
    throw new Error("No active tab is available.");
  }
  const tabUrl = tab.url ?? getPendingTabUrl(tab);
  if (!isTabUrlScriptable(tabUrl)) {
    throw new Error(
      `当前目标页不支持 CDP 请求代理 (${tabUrl ?? "unknown"}); 请切到 http(s) 或 file 页面后再启用 Fetch/代理。`,
    );
  }

  registerDebuggerListeners();

  const resolvedTarget = await resolveDebuggerTarget(tab.id, tabUrl);

  if (activeSession && activeSession.tabId !== tab.id) {
    if (debuggerActivityMonitorTabId !== undefined) {
      throw new Error(
        `ACTIVITY_MONITOR_CONFLICT: Tab ${debuggerActivityMonitorTabId} owns the active Network/Console monitor. Stop that monitor before attaching Chrome debugger to Tab ${tab.id}.`,
      );
    }
    await resumePausedDebugTargets(activeSession);
    await debuggerDetach(activeSession.target).catch(() => undefined);
    clearChildDebuggerSessions();
    activeSession = null;
  }

  if (!activeSession) {
    activeSession = {
      tabId: tab.id,
      target: resolvedTarget.target,
      targetInfo: resolvedTarget.targetInfo,
      attached: false,
      networkEnabled: false,
      fetchEnabled: false,
      runtimeEnabled: false,
      logEnabled: false,
      debuggerEnabled: false,
      oopifAutoAttachEnabled: false,
      pageStartedAt: Date.now(),
      maxEntries: DEFAULT_MAX_NETWORK_ENTRIES,
      preservedLog: true,
      observationSessionId: undefined,
      observationStartedAt: undefined,
      droppedRequestCount: 0,
      requests: new Map(),
      requestOrder: [],
      consoleMessages: [],
      runtimeErrorMonitoringActive: false,
      runtimeErrorStreamId: createRuntimeErrorStreamId(),
      runtimeErrorSequence: 0,
      droppedRuntimeErrorCount: 0,
      runtimeErrors: [],
      scripts: new Map(),
      scriptsById: new Map(),
      breakpoints: new Map(),
      pausedTargets: new Map(),
      pauseOnExceptions: new Map(),
      webSockets: new Map(),
      eventSources: new Map(),
    };
  }

  if (!activeSession.attached) {
    proxyLog("debugger.attach.start", {
      tabId: tab.id,
      target: summarizeDebuggee(activeSession.target),
    });
    await attachDebuggerToTab(activeSession);
    activeSession.attached = true;
    proxyLog("debugger.attach.done", {
      tabId: tab.id,
      target: summarizeDebuggee(activeSession.target),
    });
  }

  await ensureOopifAutoAttach(activeSession);

  return activeSession;
}

async function attachDebuggerToTab(session: NetworkSession): Promise<void> {
  const target: DebuggerTarget = topLevelDebuggerTarget(session.tabId);
  try {
    await debuggerAttach(target, PROTOCOL_VERSION);
    session.target = target;
    proxyLog("debugger.attach.target", {
      tabId: session.tabId,
      target: summarizeDebuggee(target),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    proxyLog(
      "debugger.attach.target.fail",
      { tabId: session.tabId, target: summarizeDebuggee(target), error: message },
      "warn",
    );
    throw new Error(debuggerAttachFailureMessage(message));
  }
}

function uniqueDebuggeeTargets(targets: DebuggerTarget[]): DebuggerTarget[] {
  const seen = new Set<string>();
  const unique: DebuggerTarget[] = [];

  for (const target of targets) {
    const key = `${target.tabId ?? ""}|${target.targetId ?? ""}|${target.extensionId ?? ""}|${target.sessionId ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(target);
  }

  return unique;
}

async function resolveDebuggerTarget(
  tabId: number,
  tabUrl: string | undefined,
): Promise<{
  target: DebuggerTarget;
  targetInfo?: chrome.debugger.TargetInfo;
}> {
  const targets = await debuggerGetTargets().catch(() => []);
  const pageTarget = selectPageTargetInfo(targets, tabId, tabUrl);

  if (pageTarget) {
    return {
      target: topLevelDebuggerTarget(tabId),
      targetInfo: pageTarget,
    };
  }

  return {
    target: topLevelDebuggerTarget(tabId),
  };
}

function sameDebuggee(a: DebuggerTarget, b: DebuggerTarget): boolean {
  return (
    a.tabId === b.tabId &&
    a.targetId === b.targetId &&
    a.extensionId === b.extensionId &&
    a.sessionId === b.sessionId
  );
}

function sourceMatchesSession(
  source: DebuggerTarget,
  session: NetworkSession,
): boolean {
  if (source.sessionId && childDebuggerSessions.has(source.sessionId)) {
    return true;
  }

  return (
    source.tabId === session.tabId ||
    (Boolean(session.target.targetId) &&
      source.targetId === session.target.targetId)
  );
}

async function syncChildSessionState(
  session: NetworkSession,
  target: DebuggerTarget,
): Promise<void> {
  if (session.networkEnabled) {
    await debuggerSendCommand(target, "Network.enable", {}).catch(
      () => undefined,
    );
  }
  if (session.runtimeEnabled) {
    await debuggerSendCommand(target, "Runtime.enable", {}).catch(
      () => undefined,
    );
  }
  if (session.logEnabled) {
    await debuggerSendCommand(target, "Log.enable", {}).catch(() => undefined);
  }
  if (session.debuggerEnabled) {
    await debuggerSendCommand(target, "Debugger.enable", {}).catch(
      () => undefined,
    );
  }
  if (proxyEnabled) {
    await applyFetchInterceptionToTarget(target, buildFetchPatterns()).catch(
      () => undefined,
    );
  }
}

function allDebuggerTargets(session: NetworkSession): DebuggerTarget[] {
  return uniqueDebuggeeTargets([
    session.target,
    ...[...childDebuggerSessions.values()].map((child) => child.target),
  ]);
}

function findDebuggerTargetByIdentity(
  session: NetworkSession,
  identity: string,
): DebuggerTarget | undefined {
  return allDebuggerTargets(session).find(
    (target) => debuggerTargetIdentity(target) === identity,
  );
}

async function ensureNetworkEnabled(session: NetworkSession): Promise<void> {
  if (session.networkEnabled) {
    return;
  }

  for (const target of allDebuggerTargets(session)) {
    await debuggerSendCommand(target, "Network.enable", {});
  }
  session.networkEnabled = true;
}

async function ensureConsoleEnabled(session: NetworkSession): Promise<void> {
  if (!session.runtimeEnabled) {
    for (const target of allDebuggerTargets(session)) {
      await debuggerSendCommand(target, "Runtime.enable", {});
    }
    session.runtimeEnabled = true;
  }
  if (!session.logEnabled) {
    for (const target of allDebuggerTargets(session)) {
      await debuggerSendCommand(target, "Log.enable", {}).catch(
        () => undefined,
      );
    }
    session.logEnabled = true;
  }
}

async function ensureDebuggerEnabled(session: NetworkSession): Promise<void> {
  if (session.debuggerEnabled) {
    return;
  }
  for (const target of allDebuggerTargets(session)) {
    await debuggerSendCommand(target, "Debugger.enable", {});
  }
  session.debuggerEnabled = true;
}

async function resumePausedDebugTargets(session: NetworkSession): Promise<void> {
  for (const target of allDebuggerTargets(session)) {
    const targetKey = debuggerTargetIdentity(target);
    if (!session.pausedTargets.has(targetKey)) {
      continue;
    }
    await debuggerSendCommand(target, "Debugger.resume", {}).catch(
      () => undefined,
    );
    session.pausedTargets.delete(targetKey);
  }
}

async function applyFetchInterception(session: NetworkSession): Promise<void> {
  const patterns = buildFetchPatterns();

  for (const target of allDebuggerTargets(session)) {
    await applyFetchInterceptionToTarget(target, patterns);
  }
  session.fetchEnabled = proxyEnabled && patterns.length > 0;
  proxyLog("fetch.enable", {
    tabId: session.tabId,
    proxyEnabled,
    patternCount: patterns.length,
    patterns,
    fetchEnabled: session.fetchEnabled,
    targets: allDebuggerTargets(session).map(summarizeDebuggee),
  });
}

async function applyFetchInterceptionToTarget(
  target: DebuggerTarget,
  patterns: Array<{
    urlPattern: string;
    resourceType?: string;
    requestStage: "Request" | "Response";
  }>,
): Promise<void> {
  if (!proxyEnabled || patterns.length === 0) {
    await debuggerSendCommand(target, "Fetch.disable", {}).catch(() => undefined);
    return;
  }

  await debuggerSendCommand(target, "Fetch.enable", {
    patterns,
  });
  proxyLog("fetch.enable.target", {
    target: summarizeDebuggee(target),
    patternCount: patterns.length,
  });
}

function buildFetchPatterns(): Array<{
  urlPattern: string;
  resourceType?: string;
  requestStage: "Request" | "Response";
}> {
  const patterns: Array<{
    urlPattern: string;
    resourceType?: string;
    requestStage: "Request" | "Response";
  }> = [];
  const seen = new Set<string>();

  for (const rule of currentProxyRules()) {
    if (!rule.enabled) {
      continue;
    }
    const urlPattern = fetchUrlPatternForRule(rule);
    for (const stage of fetchStagesForRule(rule)) {
      const requestStage = stage === "request" ? "Request" : "Response";
      const key = `${urlPattern}\n${requestStage}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      patterns.push({
        urlPattern,
        requestStage,
      });
    }
  }

  if (patterns.length === 0 && proxyRules.size > 0) {
    proxyLog(
      "fetch.patterns.empty",
      {
        ruleCount: proxyRules.size,
        rules: currentProxyRules().map(summarizeProxyRule),
        hint: "规则没有 request/response 动作，CDP 不会暂停任何请求",
      },
      "warn",
    );
  }

  return patterns;
}

function fetchUrlPatternForRule(rule: DebuggerProxyRule): string {
  if (rule.urlPattern?.trim()) {
    return fetchUrlPatternFromMatcher(rule.urlPattern.trim(), "pattern");
  }
  if (rule.urlContains?.trim()) {
    return fetchUrlPatternFromMatcher(rule.urlContains.trim(), "contains");
  }
  if (rule.regexFilter?.trim()) {
    return "*";
  }
  return "*";
}

function fetchUrlPatternFromMatcher(
  matcher: string,
  source: "pattern" | "contains",
): string {
  const withoutQuery = matcher.split(/[?#]/, 1)[0]?.trim() ?? "";
  const base = withoutQuery || matcher.trim();
  if (!base) {
    return "*";
  }
  if (source === "contains") {
    return `*${base}*`;
  }
  if (base !== matcher.trim() && !base.endsWith("*")) {
    return `${base}*`;
  }
  return base;
}

export function fetchStagesForRule(rule: DebuggerProxyRule): DebuggerProxyStage[] {
  const effectiveRule = materializeScenarioRule(rule);
  const stages = new Set<DebuggerProxyStage>();
  if (
    effectiveRule.requestHeaders?.length ||
    shouldFulfillAtRequest(effectiveRule)
  ) {
    stages.add("request");
  }
  if (hasResponseAction(effectiveRule)) {
    stages.add("response");
  }
  return Array.from(stages);
}

function shouldFulfillAtRequest(rule: DebuggerProxyRule): boolean {
  return (
    rule.mockStage === "request" &&
    (rule.responseBody !== undefined ||
      rule.responseBodyBase64 !== undefined ||
      rule.statusCode !== undefined ||
      rule.responsePhrase !== undefined ||
      Boolean(rule.responseHeaders?.length) ||
      Boolean(rule.contentType))
  );
}

function hasResponseAction(rule: DebuggerProxyRule): boolean {
  return (
    rule.mockStage !== "request" &&
    (rule.responseBody !== undefined ||
      rule.responseBodyBase64 !== undefined ||
      rule.statusCode !== undefined ||
      rule.responsePhrase !== undefined ||
      Boolean(rule.responseHeaders?.length) ||
      Boolean(rule.contentType))
  );
}

async function handleFetchRequestPaused(
  source: DebuggerTarget,
  event: FetchRequestPausedEvent,
): Promise<void> {
  const session = activeSession;
  const eventSession = session
    ? ({
        ...session,
        target: source,
      } satisfies NetworkSession)
    : undefined;
  if (!eventSession) {
    proxyLog("fetch.handle.noSession", summarizeFetchPause(event, "request"));
    await continuePausedRequestOnSource(source, event.requestId).catch((error) => {
      proxyLog(
        "fetch.continue.noSession.fail",
        { requestId: event.requestId, error: errorMessage(error) },
        "warn",
      );
    });
    return;
  }

  const stage = isResponsePausedEvent(event) ? "response" : "request";
  const allRules = Array.from(proxyRules.values());
  const rules = allRules
    .filter((rule) => matchesProxyRule(rule, event, stage))
    .map(materializeScenarioRule)
    .sort(compareProxyRules);
  const ruleDiagnostics = allRules.map((rule) => ({
    ...summarizeProxyRule(rule),
    match: rules.some((matched) => matched.id === rule.id),
    mismatch: explainProxyRuleMismatch(rule, event, stage),
  }));

  proxyLog("fetch.pause", {
    ...summarizeFetchPause(event, stage),
    source: summarizeDebuggee(source),
    sessionAttached: session?.attached,
    sessionFetchEnabled: session?.fetchEnabled,
    matchedRuleIds: rules.map((rule) => rule.id),
    ruleDiagnostics,
  });

  const recordMiss = rules.length === 0 && proxyRules.size > 0;
  const willRecordMiss = recordMiss && shouldRecordProxyMiss(event);
  if (recordMiss) {
    proxyLog("fetch.match.none", {
      url: event.request.url,
      stage,
      willRecordMiss,
      missFilterReason: willRecordMiss
        ? undefined
        : describeProxyMissFilterReason(event),
    });
  }
  if (willRecordMiss) {
    recordProxyMiss(event, stage);
  }

  if (!session?.attached) {
    const matchedRule = rules[0];
    if (matchedRule) {
      recordProxyHit(
        matchedRule,
        event,
        stage,
        "fail",
        "调试器未附着，无法改写请求",
      );
    }
    await continueFetchRequest(eventSession, event.requestId, source).catch((error) => {
      proxyLog(
        "fetch.continue.afterUnattached.fail",
        { requestId: event.requestId, error: errorMessage(error) },
        "warn",
      );
    });
    return;
  }

  try {
    if (stage === "request") {
      await handleRequestStagePaused(eventSession, source, event, rules);
      return;
    }
    await handleResponseStagePaused(eventSession, source, event, rules);
  } catch (error) {
    for (const rule of rules) {
      recordProxyHit(rule, event, stage, "fail", errorMessage(error));
    }
    await continuePausedRequestOnSource(source, event.requestId).catch(
      (continueError) => {
        proxyLog(
          "fetch.continue.afterHandlerError.fail",
          {
            requestId: event.requestId,
            error: errorMessage(continueError),
          },
          "warn",
        );
      },
    );
    proxyLog(
      "fetch.handle.error",
      { requestId: event.requestId, error: errorMessage(error) },
      "error",
    );
  }
}

async function handleRequestStagePaused(
  session: NetworkSession,
  source: DebuggerTarget,
  event: FetchRequestPausedEvent,
  rules: DebuggerProxyRule[],
): Promise<void> {
  const fulfillRule = rules.find(shouldFulfillAtRequest);
  if (fulfillRule) {
    proxyLog("fetch.request.fulfill", {
      ruleId: fulfillRule.id,
      url: event.request.url,
    });
    await fulfillFetchRequest(session, event, fulfillRule, "request", source);
    recordProxyHit(fulfillRule, event, "request", "fulfill");
    await advanceProxyScenario(fulfillRule.id);
    return;
  }

  const headerRules = rules.filter((rule) => rule.requestHeaders?.length);
  if (headerRules.length === 0) {
    proxyLog("fetch.request.continue", {
      requestId: event.requestId,
      url: event.request.url,
      matchedWithoutAction: rules.map((rule) => rule.id),
    });
    await continueFetchRequest(session, event.requestId, source);
    return;
  }

  const requestHeaders = headerRules.reduce(
    (headers, rule) =>
      applyHeaderModifications(headers, rule.requestHeaders ?? []),
    toHeaderEntries(event.request.headers),
  );
  await sendFetchCommand(
    session,
    "Fetch.continueRequest",
    {
      requestId: event.requestId,
      headers: requestHeaders,
    },
    source,
  );

  for (const rule of headerRules) {
    recordProxyHit(rule, event, "request", "continue");
  }
}

async function handleResponseStagePaused(
  session: NetworkSession,
  source: DebuggerTarget,
  event: FetchRequestPausedEvent,
  rules: DebuggerProxyRule[],
): Promise<void> {
  const responseRules = rules.filter(hasResponseAction);
  if (responseRules.length === 0) {
    proxyLog("fetch.response.continue", {
      requestId: event.requestId,
      url: event.request.url,
      matchedWithoutResponseAction: rules.map((rule) => rule.id),
    });
    await continueFetchRequest(session, event.requestId, source);
    return;
  }

  const bodyRule = responseRules.find(
    (rule) =>
      rule.responseBody !== undefined || rule.responseBodyBase64 !== undefined,
  );
  const statusRule = responseRules.find((rule) => rule.statusCode !== undefined);
  const contentTypeRule = responseRules.find((rule) => rule.contentType);
  let headers = sanitizeHeaderEntries(event.responseHeaders ?? []);

  for (const rule of responseRules) {
    headers = applyHeaderModifications(headers, rule.responseHeaders ?? []);
  }

  if (bodyRule) {
    headers = prepareHeadersForBodyReplacement(
      headers,
      bodyRule,
      contentTypeRule?.contentType,
    );
  } else if (contentTypeRule?.contentType) {
    headers = applyHeaderModifications(headers, [
      {
        header: "content-type",
        operation: "set",
        value: contentTypeRule.contentType,
      },
    ]);
  }

  const params: Record<string, unknown> = {
    requestId: event.requestId,
    responseCode: statusRule?.statusCode ?? event.responseStatusCode ?? 200,
    responseHeaders: sanitizeHeaderEntries(headers),
  };
  const responsePhrase = statusRule?.responsePhrase ?? event.responseStatusText;
  if (responsePhrase) {
    params.responsePhrase = responsePhrase;
  }

  if (bodyRule) {
    params.body = responseBodyBase64(bodyRule);
  }

  proxyLog("fetch.response.fulfill", {
    requestId: event.requestId,
    url: event.request.url,
    ruleIds: responseRules.map((rule) => rule.id),
    statusCode: params.responseCode,
    hasBody: Boolean(params.body),
  });
  await sendFetchCommand(session, "Fetch.fulfillRequest", params, source);

  for (const rule of responseRules) {
    recordProxyHit(rule, event, "response", "fulfill");
  }
  await advanceProxyScenarios(responseRules.map((rule) => rule.id));
}

async function continueFetchRequest(
  session: NetworkSession,
  requestId: string,
  source?: DebuggerTarget,
): Promise<void> {
  await sendFetchCommand(
    session,
    "Fetch.continueRequest",
    {
      requestId,
    },
    source,
  );
}

async function continuePausedRequestOnSource(
  source: DebuggerTarget,
  requestId: string,
): Promise<void> {
  await debuggerSendCommand(source, "Fetch.continueRequest", {
    requestId,
  });
}

async function fulfillFetchRequest(
  session: NetworkSession,
  event: FetchRequestPausedEvent,
  rule: DebuggerProxyRule,
  stage: DebuggerProxyStage,
  source?: DebuggerTarget,
): Promise<void> {
  let headers = applyHeaderModifications([], rule.responseHeaders ?? []);
  if (rule.contentType) {
    headers = applyHeaderModifications(headers, [
      {
        header: "content-type",
        operation: "set",
        value: rule.contentType,
      },
    ]);
  }
  headers = prepareHeadersForBodyReplacement(headers, rule, rule.contentType);

  const params: Record<string, unknown> = {
    requestId: event.requestId,
    responseCode:
      rule.statusCode ?? (stage === "response" ? event.responseStatusCode : 200),
    responseHeaders: sanitizeHeaderEntries(headers),
    body: responseBodyBase64(rule),
  };
  const responsePhrase = rule.responsePhrase ?? event.responseStatusText;
  if (responsePhrase) {
    params.responsePhrase = responsePhrase;
  }

  await sendFetchCommand(session, "Fetch.fulfillRequest", params, source);
}

async function sendFetchCommand(
  session: NetworkSession,
  method: "Fetch.continueRequest" | "Fetch.fulfillRequest",
  params: Record<string, unknown>,
  preferredSource?: DebuggerTarget,
): Promise<unknown> {
  const errors: string[] = [];
  const targets = preferredSource
    ? [preferredSource]
    : fetchCommandTargets(session);
  for (const target of targets) {
    try {
      return await debuggerSendCommand(target, method, params);
    } catch (error) {
      errors.push(`${debuggeeLabel(target)}: ${errorMessage(error)}`);
    }
  }
  const joined = errors.join(" | ");
  if (
    method === "Fetch.continueRequest" &&
    isDebuggerDetachedError(joined)
  ) {
    proxyLog("fetch.command.skipDetached", {
      method,
      requestId: params.requestId,
      errors,
    }, "warn");
    return undefined;
  }
  proxyLog(
    "fetch.command.fail",
    { method, requestId: params.requestId, errors },
    "warn",
  );
  throw new Error(joined);
}

function fetchCommandTargets(session: NetworkSession): DebuggerTarget[] {
  return uniqueDebuggeeTargets([
    session.target,
    ...[...childDebuggerSessions.values()].map((child) => child.target),
    activeSession?.target,
    session.targetInfo?.id ? { targetId: session.targetInfo.id } : undefined,
    { tabId: session.tabId },
  ].filter(isDebuggerTarget));
}

function isDebuggerTarget(target: DebuggerTarget | undefined): target is DebuggerTarget {
  return Boolean(target?.tabId || target?.targetId || target?.extensionId);
}

function debuggeeLabel(target: DebuggerTarget): string {
  const sessionSuffix = target.sessionId ? `, sessionId=${target.sessionId}` : "";
  if (target.targetId) {
    return `targetId=${target.targetId}${sessionSuffix}`;
  }
  if (target.tabId) {
    return `tabId=${target.tabId}${sessionSuffix}`;
  }
  return `extensionId=${target.extensionId ?? "unknown"}${sessionSuffix}`;
}

function currentProxyRules(): DebuggerProxyRule[] {
  return Array.from(proxyRules.values()).sort(compareProxyRules);
}

function materializeScenarioRule(rule: DebuggerProxyRule): DebuggerProxyRule {
  const steps = rule.scenarioSteps;
  if (!steps?.length) {
    return rule;
  }
  const index = Math.min(
    steps.length - 1,
    Math.max(0, rule.scenarioStepIndex ?? 0),
  );
  const step = steps[index]!;
  return {
    ...rule,
    responseHeaders: step.responseHeaders ?? rule.responseHeaders,
    responseBody:
      step.responseBody !== undefined ? step.responseBody : rule.responseBody,
    responseBodyBase64:
      step.responseBodyBase64 !== undefined
        ? step.responseBodyBase64
        : rule.responseBodyBase64,
    statusCode:
      step.statusCode !== undefined ? step.statusCode : rule.statusCode,
    responsePhrase:
      step.responsePhrase !== undefined
        ? step.responsePhrase
        : rule.responsePhrase,
    contentType:
      step.contentType !== undefined ? step.contentType : rule.contentType,
  };
}

async function advanceProxyScenario(ruleId: string): Promise<void> {
  await advanceProxyScenarios([ruleId]);
}

async function advanceProxyScenarios(ruleIds: string[]): Promise<void> {
  let changed = false;
  for (const ruleId of new Set(ruleIds)) {
    const rule = proxyRules.get(ruleId);
    const steps = rule?.scenarioSteps;
    if (!rule || !steps?.length) {
      continue;
    }
    const current = Math.min(
      steps.length - 1,
      Math.max(0, rule.scenarioStepIndex ?? 0),
    );
    rule.scenarioStepIndex =
      current >= steps.length - 1
        ? rule.scenarioRepeat === "loop"
          ? 0
          : current
        : current + 1;
    rule.scenarioHitCount = (rule.scenarioHitCount ?? 0) + 1;
    rule.updatedAt = new Date().toISOString();
    changed = true;
  }
  if (changed) {
    await saveProxyState();
  }
}

function compareProxyRules(a: DebuggerProxyRule, b: DebuggerProxyRule): number {
  const priorityDelta = (b.priority ?? 1) - (a.priority ?? 1);
  return priorityDelta || a.createdAt.localeCompare(b.createdAt);
}

function proxyStatus(): DebuggerProxyStatus {
  return {
    attached: activeSession?.attached ?? false,
    fetchEnabled: activeSession?.fetchEnabled ?? false,
    tabId: activeSession?.tabId,
    protocolVersion: PROTOCOL_VERSION,
    ruleCount: proxyRules.size,
    hitCount: proxyHits.length,
  };
}

async function ensureProxyStateLoaded(): Promise<void> {
  if (proxyStateLoaded) {
    return;
  }

  const stored = await readSessionStorage<StoredProxyState>(
    PROXY_STATE_STORAGE_KEY,
  );
  proxyRules.clear();
  for (const rule of stored?.rules ?? []) {
    proxyRules.set(rule.id, migrateStoredProxyRule(rule));
  }
  proxyEnabled = Boolean(stored?.enabled);
  const storedHits = await readSessionStorage<DebuggerProxyHit[]>(
    PROXY_HITS_STORAGE_KEY,
  );
  if (storedHits?.length) {
    proxyHits = storedHits.slice(-MAX_PROXY_HITS);
  }
  proxyStateLoaded = true;
  proxyLog("proxy.state.loaded", {
    proxyEnabled,
    ruleCount: proxyRules.size,
    rules: currentProxyRules().map(summarizeProxyRule),
    hitCount: proxyHits.length,
  });
}

async function saveProxyState(): Promise<void> {
  await writeSessionStorage(PROXY_STATE_STORAGE_KEY, {
    enabled: proxyEnabled,
    rules: currentProxyRules(),
  } satisfies StoredProxyState);
}

function readSessionStorage<T>(key: string): Promise<T | undefined> {
  return new Promise((resolve) => {
    chrome.storage.session.get(key, (items) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        resolve(undefined);
        return;
      }
      resolve(items[key] as T | undefined);
    });
  });
}

function writeSessionStorage(key: string, value: unknown): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.session.set({ [key]: value }, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

function isResponsePausedEvent(event: FetchRequestPausedEvent): boolean {
  return (
    event.responseStatusCode !== undefined ||
    event.responseErrorReason !== undefined
  );
}

function explainProxyRuleMismatch(
  rule: DebuggerProxyRule,
  event: FetchRequestPausedEvent,
  stage: DebuggerProxyStage,
): string | undefined {
  if (!rule.enabled) {
    return "rule_disabled";
  }
  const stages = fetchStagesForRule(rule);
  if (!stages.includes(stage)) {
    return `stage_mismatch:rule_stages=${stages.join(",")},pause_stage=${stage}`;
  }
  if (
    rule.method &&
    rule.method.toLowerCase() !== event.request.method.toLowerCase()
  ) {
    return `method_mismatch:rule=${rule.method},request=${event.request.method}`;
  }
  if (
    rule.resourceType &&
    rule.resourceType.toLowerCase() !== event.resourceType?.toLowerCase()
  ) {
    return `resourceType_mismatch:rule=${rule.resourceType},request=${event.resourceType ?? "unknown"}`;
  }
  if (
    rule.urlContains &&
    !urlContainsMatches(rule.urlContains, event.request.url)
  ) {
    return `urlContains_mismatch:needle=${rule.urlContains}`;
  }
  if (rule.regexFilter) {
    try {
      if (!new RegExp(rule.regexFilter).test(event.request.url)) {
        return `regex_mismatch:${rule.regexFilter}`;
      }
    } catch {
      return `regex_invalid:${rule.regexFilter}`;
    }
  }
  if (rule.urlPattern && !urlPatternMatches(rule.urlPattern, event.request.url)) {
    return `urlPattern_mismatch:pattern=${rule.urlPattern}`;
  }
  return undefined;
}

function describeProxyMissFilterReason(
  event: FetchRequestPausedEvent,
): string {
  if (event.resourceType === "Document") {
    return "skip_document";
  }
  const url = event.request.url.toLowerCase();
  const enabledRules = currentProxyRules().filter((rule) => rule.enabled);
  if (enabledRules.length === 0) {
    return "no_enabled_rules";
  }
  const hints = enabledRules
    .map((rule) => proxyRuleUrlHint(rule))
    .filter((hint): hint is string => Boolean(hint));
  if (hints.length === 0) {
    return "would_record_but_filtered"; // shouldn't happen if shouldRecord returns false
  }
  if (!hints.some((hint) => url.includes(hint))) {
    return `url_not_matching_hints:${hints.join("|")}`;
  }
  return "unknown_filter";
}

function matchesProxyRule(
  rule: DebuggerProxyRule,
  event: FetchRequestPausedEvent,
  stage: DebuggerProxyStage,
): boolean {
  return explainProxyRuleMismatch(rule, event, stage) === undefined;
}

function normalizeProxyMatcherFields(
  input: DebuggerProxyRuleInput,
): Pick<DebuggerProxyRuleInput, "urlPattern" | "urlContains" | "regexFilter"> {
  if (input.regexFilter?.trim()) {
    return { regexFilter: input.regexFilter.trim() };
  }

  const rawPattern = input.urlPattern?.trim();
  if (
    rawPattern &&
    (/^[a-z][a-z0-9+.-]*:\/\//i.test(rawPattern) || rawPattern.startsWith("*://"))
  ) {
    return { urlPattern: rawPattern };
  }

  const containsSource = input.urlContains?.trim() || rawPattern;
  if (containsSource) {
    return { urlContains: containsSource.replace(/^\*+|\*+$/g, "") };
  }

  return {};
}

function migrateStoredProxyRule(rule: DebuggerProxyRule): DebuggerProxyRule {
  const matcher = normalizeProxyMatcherFields(rule);
  const hasInlineMock =
    rule.responseBody !== undefined ||
    rule.responseBodyBase64 !== undefined ||
    rule.statusCode !== undefined ||
    Boolean(rule.contentType);
  return {
    ...rule,
    urlPattern: matcher.urlPattern,
    urlContains: matcher.urlContains,
    regexFilter: matcher.regexFilter,
    mockStage: rule.mockStage ?? (hasInlineMock ? "response" : undefined),
  };
}

function urlPatternMatches(pattern: string, url: string): boolean {
  const trimmed = pattern.trim();
  if (!trimmed || trimmed === "*") {
    return true;
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) || trimmed.startsWith("*://")) {
    const escaped = trimmed
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*");
    return new RegExp(`^${escaped}$`).test(url);
  }

  const fragment = trimmed.replace(/^\*+|\*+$/g, "");
  if (!fragment) {
    return true;
  }
  return url.toLowerCase().includes(fragment.toLowerCase());
}

function shouldRecordProxyMiss(event: FetchRequestPausedEvent): boolean {
  if (event.resourceType === "Document") {
    return false;
  }

  const noisyTypes = new Set([
    "Image",
    "Stylesheet",
    "Font",
    "Media",
    "Script",
  ]);
  if (event.resourceType && noisyTypes.has(event.resourceType)) {
    return false;
  }

  return true;
}

function urlContainsMatches(needle: string, url: string): boolean {
  const fragment = needle.trim().toLowerCase();
  if (!fragment) {
    return true;
  }

  const lower = url.toLowerCase();
  let searchFrom = 0;
  while (searchFrom < lower.length) {
    const idx = lower.indexOf(fragment, searchFrom);
    if (idx < 0) {
      return false;
    }
    const after = lower.charAt(idx + fragment.length);
    if (after === "" || after === "?" || after === "#") {
      return true;
    }
    if (after !== "/") {
      searchFrom = idx + 1;
      continue;
    }
    searchFrom = idx + 1;
  }
  return false;
}

function proxyRuleUrlHint(rule: DebuggerProxyRule): string | undefined {
  if (rule.urlContains?.trim()) {
    return rule.urlContains.trim().toLowerCase();
  }
  if (rule.urlPattern?.trim()) {
    return rule.urlPattern.trim().replace(/^\*+|\*+$/g, "").toLowerCase();
  }
  return undefined;
}

function applyHeaderModifications(
  headers: HeaderEntry[],
  modifications: DebuggerProxyHeaderModification[],
): HeaderEntry[] {
  let next = sanitizeHeaderEntries(headers);

  for (const modification of modifications) {
    const headerName = modification.header.trim();
    if (!headerName || headerName.startsWith(":")) {
      continue;
    }
    const key = headerKey(headerName);
    const existing = next.find((header) => headerKey(header.name) === key);

    if (modification.operation === "remove") {
      next = next.filter((header) => headerKey(header.name) !== key);
      continue;
    }

    if (modification.operation === "append" && existing) {
      existing.value = existing.value
        ? `${existing.value}, ${modification.value ?? ""}`
        : (modification.value ?? "");
      continue;
    }

    next = next.filter((header) => headerKey(header.name) !== key);
    next.push({
      name: headerName,
      value: modification.value ?? "",
    });
  }

  return next;
}

function prepareHeadersForBodyReplacement(
  headers: HeaderEntry[],
  rule: DebuggerProxyRule,
  contentType?: string,
): HeaderEntry[] {
  let next = applyHeaderModifications(headers, [
    { header: "content-encoding", operation: "remove" },
    { header: "transfer-encoding", operation: "remove" },
    { header: "content-length", operation: "remove" },
  ]);

  const resolvedContentType =
    contentType ?? rule.contentType ?? inferContentType(rule.responseBody);
  if (resolvedContentType) {
    next = applyHeaderModifications(next, [
      {
        header: "content-type",
        operation: "set",
        value: resolvedContentType,
      },
    ]);
  }

  const length = responseBodyByteLength(rule);
  if (length !== undefined) {
    next = applyHeaderModifications(next, [
      {
        header: "content-length",
        operation: "set",
        value: String(length),
      },
    ]);
  }

  return next;
}

function inferContentType(body: string | undefined): string | undefined {
  if (!body) {
    return undefined;
  }
  const trimmed = body.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return "application/json; charset=utf-8";
  }
  if (trimmed.startsWith("<")) {
    return "text/html; charset=utf-8";
  }
  return "text/plain; charset=utf-8";
}

function responseBodyBase64(rule: DebuggerProxyRule): string {
  if (rule.responseBodyBase64 !== undefined) {
    return rule.responseBodyBase64;
  }
  return utf8ToBase64(rule.responseBody ?? "");
}

function responseBodyByteLength(rule: DebuggerProxyRule): number | undefined {
  if (rule.responseBody !== undefined) {
    return new TextEncoder().encode(rule.responseBody).length;
  }
  if (rule.responseBodyBase64 !== undefined) {
    return base64ByteLength(rule.responseBodyBase64);
  }
  return undefined;
}

function utf8ToBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }
  return btoa(binary);
}

function base64ByteLength(value: string): number {
  const normalized = value.replace(/\s/g, "");
  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

function toHeaderEntries(headers: Record<string, unknown> | undefined): HeaderEntry[] {
  if (!headers) {
    return [];
  }

  return sanitizeHeaderEntries(Object.entries(headers).map(([name, value]) => ({
    name,
    value: String(value),
  })));
}

function headerKey(name: string): string {
  return name.toLowerCase();
}

function sanitizeHeaderEntries(headers: HeaderEntry[]): HeaderEntry[] {
  return headers
    .map((header) => ({
      name: String(header.name ?? "").trim(),
      value: String(header.value ?? ""),
    }))
    .filter((header) => Boolean(header.name) && !header.name.startsWith(":"));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function recordProxyHit(
  rule: DebuggerProxyRule,
  event: FetchRequestPausedEvent,
  stage: DebuggerProxyStage,
  action: DebuggerProxyHit["action"],
  note?: string,
): void {
  const now = new Date().toISOString();
  const stored = proxyRules.get(rule.id) ?? rule;
  stored.hitCount = (stored.hitCount ?? 0) + 1;
  stored.lastHitAt = now;
  proxyRules.set(stored.id, stored);
  proxyHits.push({
    id: `hit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    ruleId: stored.id,
    stage,
    url: event.request.url,
    method: event.request.method,
    resourceType: event.resourceType,
    statusCode: event.responseStatusCode,
    action,
    requestId: event.requestId,
    networkId: event.networkId,
    matchedAt: now,
    note,
  });
  proxyHits = proxyHits.slice(-MAX_PROXY_HITS);
  scheduleProxyStateBroadcast();
  proxyLog("proxy.hit.recorded", {
    ruleId: stored.id,
    hitCount: stored.hitCount,
    stage,
    action,
    url: event.request.url,
    note,
    totalHits: proxyHits.length,
  });
}

function recordProxyMiss(
  event: FetchRequestPausedEvent,
  stage: DebuggerProxyStage,
): void {
  proxyHits.push({
    id: `miss-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    ruleId: "__miss__",
    stage,
    url: event.request.url,
    method: event.request.method,
    resourceType: event.resourceType,
    statusCode: event.responseStatusCode,
    action: "miss",
    requestId: event.requestId,
    networkId: event.networkId,
    matchedAt: new Date().toISOString(),
    note: describeProxyMiss(event, stage),
  });
  proxyHits = proxyHits.slice(-MAX_PROXY_HITS);
  scheduleProxyStateBroadcast();
  proxyLog("proxy.miss.recorded", {
    url: event.request.url,
    stage,
    note: describeProxyMiss(event, stage),
    totalHits: proxyHits.length,
  });
}

function persistProxyHits(): Promise<void> {
  return writeSessionStorage(PROXY_HITS_STORAGE_KEY, proxyHits);
}

function describeProxyMiss(
  event: FetchRequestPausedEvent,
  stage: DebuggerProxyStage,
): string {
  const activeRules = currentProxyRules().filter((rule) => rule.enabled);
  if (activeRules.length === 0) {
    return "没有启用的代理规则。";
  }

  const stageMatches = activeRules.filter((rule) =>
    fetchStagesForRule(rule).includes(stage),
  );
  if (stageMatches.length === 0) {
    return `当前请求处于 ${stage} 阶段，但规则监听的是其他阶段。`;
  }

  const methodMatches = stageMatches.filter(
    (rule) =>
      !rule.method ||
      rule.method.toLowerCase() === event.request.method.toLowerCase(),
  );
  if (methodMatches.length === 0) {
    return `HTTP method 不匹配：${event.request.method}。`;
  }

  const typeMatches = methodMatches.filter(
    (rule) =>
      !rule.resourceType ||
      rule.resourceType.toLowerCase() === event.resourceType?.toLowerCase(),
  );
  if (typeMatches.length === 0) {
    return `resourceType 不匹配：${event.resourceType ?? "unknown"}。`;
  }

  return "URL 不匹配；请检查 urlPattern/urlContains/regexFilter。";
}

function normalizeScreenshotClip(clip: ScreenshotClip): ScreenshotClip {
  return {
    x: Math.max(0, Math.round(clip.x * 100) / 100),
    y: Math.max(0, Math.round(clip.y * 100) / 100),
    width: Math.max(1, Math.round(clip.width * 100) / 100),
    height: Math.max(1, Math.round(clip.height * 100) / 100),
  };
}

function handleRuntimeConsoleAPICalled(
  source: DebuggerTarget,
  event: RuntimeConsoleApiCalledEvent,
): void {
  const session = activeSession;
  if (!session) {
    return;
  }

  const timestampMs = event.timestamp ?? Date.now();
  const frame = event.stackTrace?.callFrames?.[0];
  pushConsoleMessage(session, {
    id: `console-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    level: consoleTypeToLevel(event.type),
    type: event.type,
    text: event.args.map(remoteObjectText).join(" "),
    url: frame?.url,
    lineNumber: frame?.lineNumber,
    columnNumber: frame?.columnNumber,
    timestamp: new Date(timestampMs).toISOString(),
    timestampMs,
  });
  if (
    session.runtimeErrorMonitoringActive &&
    (event.type === "error" ||
      event.type === "assert" ||
      event.type === "warning" ||
      event.type === "warn")
  ) {
    pushRuntimeError(session, {
      kind: "console",
      level:
        event.type === "warning" || event.type === "warn"
          ? "warning"
          : "error",
      text: event.args.map(remoteObjectText).join(" "),
      timestampMs,
      frames: captureRuntimeStackFrames(
        session,
        source,
        event.stackTrace,
      ),
    });
  }
}

function handleRuntimeExceptionThrown(
  source: DebuggerTarget,
  event: RuntimeExceptionThrownEvent,
): void {
  const session = activeSession;
  if (!session?.runtimeErrorMonitoringActive) {
    return;
  }
  const details = event.exceptionDetails;
  const timestampMs = event.timestamp ?? Date.now();
  const frames = captureRuntimeStackFrames(
    session,
    source,
    details.stackTrace,
  );
  if (frames.length === 0) {
    const fallback = runtimeExceptionFallbackFrame(session, source, details);
    if (fallback) {
      frames.push(fallback);
    }
  }
  pushRuntimeError(session, {
    kind: "exception",
    level: "error",
    text: runtimeExceptionText(details),
    timestampMs,
    exceptionId: details.exceptionId,
    frames,
  });
}

function handleRuntimeExceptionRevoked(
  event: RuntimeExceptionRevokedEvent,
): void {
  const session = activeSession;
  if (!session) {
    return;
  }
  for (let index = session.runtimeErrors.length - 1; index >= 0; index -= 1) {
    const error = session.runtimeErrors[index];
    if (error?.exceptionId === event.exceptionId) {
      error.revoked = true;
      break;
    }
  }
}

function handleScriptParsed(
  source: DebuggerTarget,
  event: DebuggerScriptParsedEvent,
): void {
  const session = activeSession;
  if (!session || !event.url) {
    return;
  }
  const script: LoadedScriptMetadata = {
    scriptId: event.scriptId,
    url: event.url,
    sourceMapURL: event.sourceMapURL,
    hash: event.hash,
    buildId: event.buildId,
  };
  session.scripts.set(event.url, script);
  session.scriptsById.set(
    loadedScriptKey(source, event.scriptId),
    script,
  );
  if (session.scripts.size > 2_000) {
    const oldest = session.scripts.keys().next().value;
    if (typeof oldest === "string") {
      session.scripts.delete(oldest);
    }
  }
  if (session.scriptsById.size > 4_000) {
    const oldest = session.scriptsById.keys().next().value;
    if (typeof oldest === "string") {
      session.scriptsById.delete(oldest);
    }
  }
}

function handleLogEntryAdded(event: LogEntryAddedEvent): void {
  const session = activeSession;
  if (!session) {
    return;
  }

  const entry = event.entry;
  const timestampMs = entry.timestamp ?? Date.now();
  pushConsoleMessage(session, {
    id: `log-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    level: logLevelToConsoleLevel(entry.level),
    type: entry.source,
    text: entry.text,
    url: entry.url,
    lineNumber: entry.lineNumber,
    timestamp: new Date(timestampMs).toISOString(),
    timestampMs,
  });
}

function pushConsoleMessage(
  session: NetworkSession,
  message: ConsoleMessageRecord,
): void {
  session.consoleMessages.push(message);
  session.consoleMessages = session.consoleMessages.slice(-MAX_CONSOLE_MESSAGES);
  emitDebuggerActivity({
    kind: "console",
    observedAt: message.timestamp,
    summary: {
      level: message.level,
      message: message.text,
      source: {
        url: message.url,
        lineNumber: message.lineNumber,
        columnNumber: message.columnNumber,
      },
    },
  });
}

function createRuntimeErrorStreamId(): string {
  return `runtime-errors-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function resetRuntimeErrorStream(session: NetworkSession): void {
  session.runtimeErrorStreamId = createRuntimeErrorStreamId();
  session.runtimeErrorSequence = 0;
  session.droppedRuntimeErrorCount = 0;
  session.runtimeErrors = [];
}

function pushRuntimeError(
  session: NetworkSession,
  input: {
    kind: BrowserRuntimeError["kind"];
    level: BrowserRuntimeError["level"];
    text: string;
    timestampMs: number;
    exceptionId?: number;
    frames: CapturedRuntimeStackFrame[];
  },
): void {
  const sequence = session.runtimeErrorSequence + 1;
  session.runtimeErrorSequence = sequence;
  session.runtimeErrors.push({
    id: `runtime-error-${sequence.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    sequence,
    kind: input.kind,
    level: input.level,
    text: input.text.slice(0, MAX_RUNTIME_ERROR_TEXT_CHARS),
    timestamp: new Date(input.timestampMs).toISOString(),
    timestampMs: input.timestampMs,
    exceptionId: input.exceptionId,
    frames: input.frames.slice(0, MAX_CAPTURED_RUNTIME_STACK_FRAMES),
    framesOmitted: Math.max(
      0,
      input.frames.length - MAX_CAPTURED_RUNTIME_STACK_FRAMES,
    ),
  });
  while (session.runtimeErrors.length > MAX_RUNTIME_ERRORS) {
    session.runtimeErrors.shift();
    session.droppedRuntimeErrorCount += 1;
  }
}

function captureRuntimeStackFrames(
  session: NetworkSession,
  source: DebuggerTarget,
  stack: RuntimeStackTrace | undefined,
): CapturedRuntimeStackFrame[] {
  const frames: CapturedRuntimeStackFrame[] = [];
  let current = stack;
  let depth = 0;
  while (
    current &&
    depth < 8 &&
    frames.length < MAX_CAPTURED_RUNTIME_STACK_FRAMES
  ) {
    for (const frame of current.callFrames ?? []) {
      const script = findLoadedScript(
        session,
        source,
        frame.scriptId,
        frame.url,
      );
      const url = frame.url || script?.url;
      if (!url) {
        continue;
      }
      frames.push({
        scriptId: frame.scriptId,
        generated: {
          url,
          lineNumber: Math.max(0, Math.floor(frame.lineNumber ?? 0)),
          columnNumber: Math.max(0, Math.floor(frame.columnNumber ?? 0)),
          functionName: frame.functionName?.slice(0, 300),
        },
        asyncContext:
          depth > 0
            ? (current.description || "async").slice(0, 200)
            : undefined,
        debuggerTargetKey: debuggerTargetIdentity(source),
      });
      if (frames.length >= MAX_CAPTURED_RUNTIME_STACK_FRAMES) {
        break;
      }
    }
    current = current.parent;
    depth += 1;
  }
  return frames;
}

function runtimeExceptionFallbackFrame(
  session: NetworkSession,
  source: DebuggerTarget,
  details: RuntimeExceptionDetails,
): CapturedRuntimeStackFrame | undefined {
  const script = findLoadedScript(
    session,
    source,
    details.scriptId,
    details.url,
  );
  const url = details.url || script?.url;
  if (!url) {
    return undefined;
  }
  return {
    scriptId: details.scriptId,
    generated: {
      url,
      lineNumber: Math.max(0, Math.floor(details.lineNumber ?? 0)),
      columnNumber: Math.max(0, Math.floor(details.columnNumber ?? 0)),
    },
    debuggerTargetKey: debuggerTargetIdentity(source),
  };
}

function runtimeExceptionText(details: RuntimeExceptionDetails): string {
  const detail =
    details.exception === undefined
      ? ""
      : remoteObjectText(details.exception);
  return (detail || details.text || "Unhandled JavaScript exception").slice(
    0,
    MAX_RUNTIME_ERROR_TEXT_CHARS,
  );
}

function debuggerTargetIdentity(target: DebuggerTarget): string {
  return (
    target.sessionId ||
    target.targetId ||
    (target.tabId === undefined ? "unknown" : `tab:${target.tabId}`)
  );
}

function loadedScriptKey(
  target: DebuggerTarget | string,
  scriptId: string,
): string {
  const targetKey =
    typeof target === "string" ? target : debuggerTargetIdentity(target);
  return `${targetKey}:${scriptId}`;
}

function findLoadedScript(
  session: NetworkSession,
  target: DebuggerTarget | string,
  scriptId: string | undefined,
  url: string | undefined,
): LoadedScriptMetadata | undefined {
  if (scriptId) {
    const byId = session.scriptsById.get(loadedScriptKey(target, scriptId));
    if (byId) {
      return byId;
    }
  }
  return url ? session.scripts.get(url) : undefined;
}

async function materializeRuntimeError(
  session: NetworkSession,
  error: RuntimeErrorRecord,
  maxFrames: number,
  includeSourceExcerpt: boolean,
): Promise<BrowserRuntimeError> {
  const frames = await Promise.all(
    error.frames.slice(0, maxFrames).map(async (frame) => {
      const script = findLoadedScript(
        session,
        frame.debuggerTargetKey,
        frame.scriptId,
        frame.generated.url,
      );
      const target = findDebuggerTargetByIdentity(
        session,
        frame.debuggerTargetKey,
      );
      const sourceMap = await resolveSourceMapLocation(
        script,
        frame.generated,
        includeSourceExcerpt,
        target
          ? createSourceMapLoadContext(session, target, script)
          : {
              cachePartition: `${session.tabId}:${frame.debuggerTargetKey}:detached`,
              loadText: async () => {
                throw new Error(
                  "The debugger target that produced this stack frame is no longer attached.",
                );
              },
            },
      );
      const {
        debuggerTargetKey: _debuggerTargetKey,
        ...publicFrame
      } = frame;
      return {
        ...publicFrame,
        sourceMap,
      };
    }),
  );
  return {
    id: error.id,
    sequence: error.sequence,
    kind: error.kind,
    level: error.level,
    text: error.text,
    timestamp: error.timestamp,
    exceptionId: error.exceptionId,
    revoked: error.revoked,
    frames,
    framesOmitted:
      error.framesOmitted + Math.max(0, error.frames.length - frames.length),
  };
}

function consoleTypeToLevel(
  type: RuntimeConsoleApiCalledEvent["type"],
): BrowserConsoleMessage["level"] {
  switch (type) {
    case "error":
    case "assert":
      return "error";
    case "warning":
    case "warn":
      return "warning";
    case "debug":
      return "debug";
    case "log":
    case "info":
    default:
      return "info";
  }
}

function logLevelToConsoleLevel(
  level: LogEntryAddedEvent["entry"]["level"],
): BrowserConsoleMessage["level"] {
  switch (level) {
    case "error":
      return "error";
    case "warning":
      return "warning";
    case "verbose":
      return "debug";
    case "info":
    default:
      return "info";
  }
}

function consoleLevelWeight(level: BrowserConsoleMessage["level"]): number {
  switch (level) {
    case "error":
      return 0;
    case "warning":
      return 1;
    case "info":
      return 2;
    case "debug":
    default:
      return 3;
  }
}

function remoteObjectText(remoteObject: RuntimeRemoteObject): string {
  if (remoteObject.value !== undefined) {
    return String(remoteObject.value);
  }
  if (remoteObject.unserializableValue !== undefined) {
    return remoteObject.unserializableValue;
  }
  if (remoteObject.description) {
    return remoteObject.description;
  }
  return remoteObject.type;
}

function handleRequestWillBeSent(event: NetworkRequestWillBeSentEvent): void {
  const session = requireNetworkSession();
  if (event.type === "Document") {
    session.pageStartedAt = Date.now();
    emitDebuggerActivity({
      kind: "navigation",
      observedAt: new Date().toISOString(),
      summary: {
        method: event.request.method,
        url: event.request.url,
        resourceType: event.type,
        requestId: event.requestId,
        initiatorType: event.initiator?.type,
        source: firstInitiatorSource(event.initiator),
        reason: "document-request",
      },
    });
  }
  const existing = session.requests.get(event.requestId);
  const record: NetworkRequestRecord = {
    ...(existing ?? {}),
    requestId: event.requestId,
    url: event.request.url,
    method: event.request.method,
    resourceType: event.type,
    documentUrl: event.documentURL,
    requestHeaders: normalizeHeaders(event.request.headers),
    requestPostData: event.request.postData,
    startedAt: event.timestamp,
    startedWallTimeMs:
      typeof event.wallTime === "number"
        ? Math.round(event.wallTime * 1_000)
        : undefined,
    initiatorType: event.initiator?.type,
    initiatorStack: flattenInitiatorStack(event.initiator),
  };

  if (!existing) {
    session.requestOrder.push(event.requestId);
  }
  session.requests.set(event.requestId, record);
  trimNetworkRequests(session);
}

function handleResponseReceived(event: NetworkResponseReceivedEvent): void {
  const session = requireNetworkSession();
  const existing = session.requests.get(event.requestId);
  if (!existing) {
    return;
  }

  existing.resourceType = event.type ?? existing.resourceType;
  existing.status = event.response.status;
  existing.statusText = event.response.statusText;
  existing.mimeType = event.response.mimeType;
  existing.responseHeaders = normalizeHeaders(event.response.headers);
  existing.fromDiskCache = event.response.fromDiskCache;
  existing.fromServiceWorker = event.response.fromServiceWorker;
  existing.remoteAddress = event.response.remoteIPAddress
    ? `${event.response.remoteIPAddress}:${event.response.remotePort ?? ""}`
    : undefined;
  if (shouldEmitNetworkActivity(existing)) {
    emitDebuggerActivity({
      kind: "network",
      observedAt: new Date().toISOString(),
      summary: {
        method: existing.method,
        url: existing.url,
        resourceType: existing.resourceType,
        status: existing.status,
        requestId: existing.requestId,
        initiatorType: existing.initiatorType,
      },
    });
  }
}

function handleLoadingFinished(event: NetworkLoadingFinishedEvent): void {
  const session = requireNetworkSession();
  const existing = session.requests.get(event.requestId);
  if (!existing) {
    return;
  }

  existing.finishedAt = event.timestamp;
  existing.encodedDataLength = event.encodedDataLength;
}

function handleLoadingFailed(event: NetworkLoadingFailedEvent): void {
  const session = requireNetworkSession();
  const existing = session.requests.get(event.requestId);
  if (!existing) {
    return;
  }

  existing.finishedAt = event.timestamp;
  existing.failed = true;
  existing.errorText = event.errorText;
  emitDebuggerActivity({
    kind: "network",
    observedAt: new Date().toISOString(),
    summary: {
      method: existing.method,
      url: existing.url,
      resourceType: existing.resourceType,
      failed: true,
      requestId: existing.requestId,
      initiatorType: existing.initiatorType,
      reason: event.errorText,
    },
  });
}

function handleWebSocketCreated(event: NetworkWebSocketCreatedEvent): void {
  const session = requireNetworkSession();
  session.webSockets.set(event.requestId, {
    requestId: event.requestId,
    url: event.url?.slice(0, 2_000),
    openedAt: event.timestamp,
    sentFrames: 0,
    receivedFrames: 0,
    sentBytes: 0,
    receivedBytes: 0,
  });
}

function handleWebSocketHandshake(event: NetworkWebSocketHandshakeEvent): void {
  const session = requireNetworkSession();
  const existing = session.webSockets.get(event.requestId);
  if (existing) {
    existing.openedAt = event.timestamp ?? existing.openedAt;
    existing.url = event.request?.url?.slice(0, 2_000) ?? existing.url;
  }
}

function handleWebSocketFrame(
  event: NetworkWebSocketFrameEvent,
  direction: "sent" | "received",
): void {
  const session = requireNetworkSession();
  const existing =
    session.webSockets.get(event.requestId) ??
    ({
      requestId: event.requestId,
      sentFrames: 0,
      receivedFrames: 0,
      sentBytes: 0,
      receivedBytes: 0,
    } satisfies RealtimeWebSocketRecord);
  const bytes = new TextEncoder().encode(event.response.payloadData ?? "").length;
  if (direction === "sent") {
    existing.sentFrames += 1;
    existing.sentBytes += bytes;
  } else {
    existing.receivedFrames += 1;
    existing.receivedBytes += bytes;
  }
  session.webSockets.set(event.requestId, existing);
}

function handleWebSocketClosed(event: NetworkWebSocketClosedEvent): void {
  const existing = requireNetworkSession().webSockets.get(event.requestId);
  if (existing) {
    existing.closedAt = event.timestamp;
  }
}

function handleWebSocketError(event: NetworkWebSocketErrorEvent): void {
  const existing = requireNetworkSession().webSockets.get(event.requestId);
  if (existing) {
    existing.lastError = event.errorMessage.slice(0, 500);
  }
}

function handleEventSourceMessage(event: NetworkEventSourceMessageEvent): void {
  const session = requireNetworkSession();
  const request = session.requests.get(event.requestId);
  const existing =
    session.eventSources.get(event.requestId) ??
    ({
      requestId: event.requestId,
      url: request?.url?.slice(0, 2_000),
      messageCount: 0,
    } satisfies RealtimeEventSourceRecord);
  existing.messageCount += 1;
  existing.lastEventName = event.eventName?.slice(0, 500);
  existing.lastEventAt = event.timestamp;
  session.eventSources.set(event.requestId, existing);
}

function emitDebuggerActivity(event: BrowserActivityEventInput): void {
  if (!debuggerActivityMonitoringActive) {
    return;
  }
  const normalizedEvent =
    event.target || !activeSession
      ? event
      : {
          ...event,
          target: {
            url: activeSession.targetInfo?.url ?? "",
            title: activeSession.targetInfo?.title ?? "",
            targetId: String(activeSession.tabId),
            tabId: activeSession.tabId,
          },
        };
  for (const listener of debuggerActivityListeners) {
    listener(normalizedEvent);
  }
}

function firstInitiatorSource(
  initiator: NetworkRequestWillBeSentEvent["initiator"],
): BrowserActivityEventInput["summary"]["source"] {
  const frame = initiator?.stack?.callFrames?.[0];
  return frame
    ? {
        url: frame.url,
        functionName: frame.functionName,
        lineNumber: frame.lineNumber,
        columnNumber: frame.columnNumber,
      }
    : undefined;
}

function matchesNetworkFilter(
  request: NetworkRequestRecord,
  input: DebuggerNetworkListInput,
): boolean {
  if (
    input.urlContains &&
    !request.url.toLowerCase().includes(input.urlContains.toLowerCase())
  ) {
    return false;
  }
  if (
    input.method &&
    request.method.toLowerCase() !== input.method.toLowerCase()
  ) {
    return false;
  }
  if (
    input.resourceType &&
    request.resourceType?.toLowerCase() !== input.resourceType.toLowerCase()
  ) {
    return false;
  }
  if (input.statusMin !== undefined && (request.status ?? 0) < input.statusMin) {
    return false;
  }
  if (
    input.statusMax !== undefined &&
    (request.status ?? Number.POSITIVE_INFINITY) > input.statusMax
  ) {
    return false;
  }
  return true;
}

function toNetworkSummary(
  request: NetworkRequestRecord,
): DebuggerNetworkRequestSummary {
  return {
    requestId: request.requestId,
    url: request.url,
    method: request.method,
    resourceType: request.resourceType,
    status: request.status,
    statusText: request.statusText,
    mimeType: request.mimeType,
    fromDiskCache: request.fromDiskCache,
    fromServiceWorker: request.fromServiceWorker,
    encodedDataLength: request.encodedDataLength,
    startedAt: request.startedAt,
    startedWallTimeMs: request.startedWallTimeMs,
    finishedAt: request.finishedAt,
    durationMs:
      request.finishedAt === undefined
        ? undefined
        : Math.round((request.finishedAt - request.startedAt) * 1000),
    failed: request.failed,
    errorText: request.errorText,
    initiatorType: request.initiatorType,
    initiatorStack: request.initiatorStack,
  };
}

function flattenInitiatorStack(
  initiator: NetworkRequestWillBeSentEvent["initiator"],
): import("../shared/debugger").DebuggerInitiatorCallFrame[] | undefined {
  const frames: import("../shared/debugger").DebuggerInitiatorCallFrame[] = [];
  let stack = initiator?.stack;
  let depth = 0;
  while (stack && depth < 4 && frames.length < 12) {
    for (const frame of stack.callFrames ?? []) {
      frames.push({
        functionName: frame.functionName,
        url: frame.url,
        lineNumber: frame.lineNumber,
        columnNumber: frame.columnNumber,
      });
      if (frames.length >= 12) {
        break;
      }
    }
    stack = stack.parent;
    depth += 1;
  }
  return frames.length > 0 ? frames : undefined;
}

function clearNetworkRequests(): void {
  activeSession?.requests.clear();
  if (activeSession) {
    activeSession.requestOrder = [];
    activeSession.droppedRequestCount = 0;
    activeSession.webSockets.clear();
    activeSession.eventSources.clear();
  }
}

function trimNetworkRequests(session: NetworkSession): void {
  while (session.requestOrder.length > session.maxEntries) {
    const requestId = selectNetworkRequestToEvict(
      session.requestOrder
        .map((candidateId) => session.requests.get(candidateId))
        .filter(
          (request): request is NetworkRequestRecord => request !== undefined,
        )
        .map((request) => ({
          requestId: request.requestId,
          method: request.method,
          resourceType: request.resourceType,
          status: request.status,
          failed: request.failed,
          finished: request.finishedAt !== undefined,
        })),
    );
    if (!requestId) {
      break;
    }
    const orderIndex = session.requestOrder.indexOf(requestId);
    if (orderIndex >= 0) {
      session.requestOrder.splice(orderIndex, 1);
    }
    session.requests.delete(requestId);
    session.droppedRequestCount += 1;
  }
}

function networkStatus(): DebuggerNetworkStatus {
  return {
    attached: activeSession?.attached ?? false,
    networkEnabled: activeSession?.networkEnabled ?? false,
    tabId: activeSession?.tabId,
    protocolVersion: PROTOCOL_VERSION,
    requestCount: activeSession?.requests.size ?? 0,
    maxEntries: activeSession?.maxEntries ?? DEFAULT_MAX_NETWORK_ENTRIES,
    droppedRequestCount: activeSession?.droppedRequestCount ?? 0,
    capacityReached: (activeSession?.droppedRequestCount ?? 0) > 0,
    preservedLog: activeSession?.preservedLog ?? true,
    observationSessionId: activeSession?.observationSessionId,
    observationStartedAt: activeSession?.observationStartedAt,
  };
}

function shouldEmitNetworkActivity(
  request: NetworkRequestRecord,
): boolean {
  const method = request.method.toUpperCase();
  return (
    request.resourceType === "Document" ||
    request.resourceType === "XHR" ||
    request.resourceType === "Fetch" ||
    method !== "GET" ||
    request.failed === true ||
    (request.status ?? 0) >= 300
  );
}

function requireNetworkSession(): NetworkSession {
  if (!activeSession?.attached) {
    throw new Error("Chrome debugger is not attached. Start Network recording first.");
  }
  return activeSession;
}

function getPendingTabUrl(tab: chrome.tabs.Tab): string | undefined {
  return (tab as chrome.tabs.Tab & { pendingUrl?: string }).pendingUrl;
}

function normalizeHeaders(
  headers: Record<string, unknown> | undefined,
): Record<string, string> | undefined {
  if (!headers) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key, String(value)]),
  );
}

interface DebuggerStackTrace {
  callFrames?: Array<{
    functionName?: string;
    url?: string;
    lineNumber?: number;
    columnNumber?: number;
  }>;
  parent?: DebuggerStackTrace;
}

interface NetworkRequestWillBeSentEvent {
  requestId: string;
  documentURL?: string;
  request: {
    url: string;
    method: string;
    headers?: Record<string, unknown>;
    postData?: string;
  };
  timestamp: number;
  wallTime?: number;
  type?: string;
  initiator?: {
    type?: string;
    stack?: DebuggerStackTrace;
  };
}

interface DebuggerScriptParsedEvent {
  scriptId: string;
  url: string;
  sourceMapURL?: string;
  hash?: string;
  buildId?: string;
}

interface NetworkResponseReceivedEvent {
  requestId: string;
  timestamp: number;
  type?: string;
  response: {
    status: number;
    statusText: string;
    headers?: Record<string, unknown>;
    mimeType?: string;
    fromDiskCache?: boolean;
    fromServiceWorker?: boolean;
    remoteIPAddress?: string;
    remotePort?: number;
  };
}

interface NetworkLoadingFinishedEvent {
  requestId: string;
  timestamp: number;
  encodedDataLength?: number;
}

interface NetworkLoadingFailedEvent {
  requestId: string;
  timestamp: number;
  errorText?: string;
}

interface NetworkWebSocketCreatedEvent {
  requestId: string;
  url?: string;
  timestamp?: number;
}

interface NetworkWebSocketHandshakeEvent {
  requestId: string;
  timestamp?: number;
  request?: { url?: string };
}

interface NetworkWebSocketFrameEvent {
  requestId: string;
  timestamp: number;
  response: {
    opcode?: number;
    mask?: boolean;
    payloadData?: string;
  };
}

interface NetworkWebSocketClosedEvent {
  requestId: string;
  timestamp: number;
}

interface NetworkWebSocketErrorEvent {
  requestId: string;
  timestamp: number;
  errorMessage: string;
}

interface NetworkEventSourceMessageEvent {
  requestId: string;
  timestamp: number;
  eventName?: string;
  eventId?: string;
  data?: string;
}

interface PageLayoutMetrics {
  contentSize: {
    x?: number;
    y?: number;
    width: number;
    height: number;
  };
  cssContentSize?: {
    x?: number;
    y?: number;
    width: number;
    height: number;
  };
}

interface RuntimeRemoteObject {
  type: string;
  subtype?: string;
  className?: string;
  value?: unknown;
  unserializableValue?: string;
  description?: string;
  preview?: {
    overflow?: boolean;
    properties?: Array<{
      name: string;
      type: string;
      value?: string;
      subtype?: string;
    }>;
  };
}

interface RuntimeEvaluationResponse {
  result: RuntimeRemoteObject;
  exceptionDetails?: RuntimeExceptionDetails;
}

interface RuntimeConsoleApiCalledEvent {
  type:
    | "log"
    | "debug"
    | "info"
    | "error"
    | "warning"
    | "warn"
    | "dir"
    | "dirxml"
    | "table"
    | "trace"
    | "clear"
    | "startGroup"
    | "startGroupCollapsed"
    | "endGroup"
    | "assert"
    | "profile"
    | "profileEnd"
    | "count"
    | "timeEnd";
  args: RuntimeRemoteObject[];
  timestamp?: number;
  stackTrace?: RuntimeStackTrace;
}

interface RuntimeStackTrace {
  description?: string;
  callFrames?: RuntimeCallFrame[];
  parent?: RuntimeStackTrace;
}

interface RuntimeCallFrame {
  functionName?: string;
  scriptId?: string;
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
}

interface RuntimeExceptionDetails {
  exceptionId: number;
  text: string;
  lineNumber?: number;
  columnNumber?: number;
  scriptId?: string;
  url?: string;
  stackTrace?: RuntimeStackTrace;
  exception?: RuntimeRemoteObject;
}

interface RuntimeExceptionThrownEvent {
  timestamp?: number;
  exceptionDetails: RuntimeExceptionDetails;
}

interface RuntimeExceptionRevokedEvent {
  exceptionId: number;
}

interface DebuggerLocation {
  scriptId: string;
  lineNumber: number;
  columnNumber?: number;
}

interface DebuggerSetBreakpointByUrlResponse {
  breakpointId: string;
  locations?: DebuggerLocation[];
}

interface DebuggerPausedEvent {
  callFrames: Array<{
    callFrameId: string;
    functionName: string;
    url?: string;
    location: DebuggerLocation;
    scopeChain: Array<{ type: string }>;
  }>;
  reason: string;
  hitBreakpoints?: string[];
}

interface DebuggerBreakpointResolvedEvent {
  breakpointId: string;
  location: DebuggerLocation;
}

interface LogEntryAddedEvent {
  entry: {
    source?: string;
    level: "verbose" | "info" | "warning" | "error";
    text: string;
    timestamp?: number;
    url?: string;
    lineNumber?: number;
  };
}

interface HeaderEntry {
  name: string;
  value: string;
}

interface TargetAttachedToTargetEvent {
  sessionId: string;
  targetInfo?: CdpTargetInfo;
  waitingForDebugger?: boolean;
}

interface CdpTargetInfo {
  targetId: string;
  type: string;
  url: string;
  parentFrameId?: string;
}

interface PageFrameTreeResult {
  frameTree: CdpFrameTreeNode;
}

interface DomGetFrameOwnerResult {
  backendNodeId: number;
}

interface DomGetBoxModelResult {
  model: {
    content: number[];
  };
}

interface TargetDetachedFromTargetEvent {
  sessionId: string;
  targetId?: string;
}

interface FetchRequestPausedEvent {
  requestId: string;
  request: {
    url: string;
    method: string;
    headers?: Record<string, unknown>;
    postData?: string;
  };
  frameId?: string;
  resourceType?: string;
  responseErrorReason?: string;
  responseStatusCode?: number;
  responseStatusText?: string;
  responseHeaders?: HeaderEntry[];
  networkId?: string;
  redirectedRequestId?: string;
}
