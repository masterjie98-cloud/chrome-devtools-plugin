export const DEBUG_EXECUTION_LIMITS = {
  expressionChars: 12_000,
  breakpointConditionChars: 2_000,
  timeoutMsMin: 100,
  timeoutMsMax: 10_000,
  breakpoints: 64,
  callFrames: 24,
  previewProperties: 24,
  valueChars: 20_000,
} as const;

export interface BrowserDebugEvaluateInput {
  expression: string;
  selector?: string;
  awaitPromise?: boolean;
  replMode?: boolean;
  throwOnSideEffect?: boolean;
  allowBreakpoints?: boolean;
  timeoutMs?: number;
}

export interface BrowserDebugRemoteObject {
  type: string;
  subtype?: string;
  className?: string;
  value?: unknown;
  unserializableValue?: string;
  description?: string;
  preview?: Array<{
    name: string;
    type: string;
    value?: string;
    subtype?: string;
  }>;
  truncated: boolean;
}

export interface BrowserDebugException {
  text: string;
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
  description?: string;
}

export interface BrowserDebugEvaluateResult {
  evaluated: boolean;
  tabId: number;
  frameId: number;
  documentId?: string;
  elapsedMs: number;
  result?: BrowserDebugRemoteObject;
  exception?: BrowserDebugException;
}

export interface BrowserDebugBreakpointInput {
  action: "set" | "remove" | "list";
  breakpointId?: string;
  url?: string;
  urlRegex?: string;
  lineNumber?: number;
  columnNumber?: number;
  condition?: string;
}

export interface BrowserDebugBreakpoint {
  breakpointId: string;
  url?: string;
  urlRegex?: string;
  lineNumber: number;
  columnNumber: number;
  condition?: string;
  resolvedLocations: Array<{
    scriptId: string;
    lineNumber: number;
    columnNumber: number;
  }>;
  createdAt: string;
}

export interface BrowserDebugBreakpointResult {
  action: BrowserDebugBreakpointInput["action"];
  tabId: number;
  breakpoint?: BrowserDebugBreakpoint;
  removedBreakpointId?: string;
  breakpoints: BrowserDebugBreakpoint[];
}

export type BrowserDebugPauseOnExceptionsState =
  | "none"
  | "uncaught"
  | "caught"
  | "all";

export interface BrowserDebugControlInput {
  action:
    | "status"
    | "pause"
    | "resume"
    | "step_over"
    | "step_into"
    | "step_out"
    | "evaluate_on_call_frame"
    | "set_pause_on_exceptions";
  callFrameId?: string;
  expression?: string;
  timeoutMs?: number;
  throwOnSideEffect?: boolean;
  pauseOnExceptions?: BrowserDebugPauseOnExceptionsState;
}

export interface BrowserDebugCallFrame {
  callFrameId: string;
  functionName: string;
  url?: string;
  scriptId: string;
  lineNumber: number;
  columnNumber: number;
  scopeTypes: string[];
}

export interface BrowserDebugPausedState {
  paused: true;
  reason: string;
  hitBreakpoints: string[];
  callFrames: BrowserDebugCallFrame[];
  pausedAt: string;
}

export interface BrowserDebugControlResult {
  action: BrowserDebugControlInput["action"];
  tabId: number;
  frameId: number;
  documentId?: string;
  paused: boolean;
  pauseOnExceptions: BrowserDebugPauseOnExceptionsState;
  state?: BrowserDebugPausedState;
  evaluation?: BrowserDebugRemoteObject;
  exception?: BrowserDebugException;
}
