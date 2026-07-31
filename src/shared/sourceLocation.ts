export interface BrowserLocateSourceInput {
  selector: string;
  frameId?: number;
  documentId?: string;
  maxDepth?: number;
  includeSourceExcerpt?: boolean;
}

export type FrameworkKind = "react" | "vue" | "unknown";

export interface FrameworkComponentLocation {
  name: string;
  fileName?: string;
  lineNumber?: number;
  columnNumber?: number;
}

export interface GeneratedSourceLocation {
  url: string;
  lineNumber: number;
  columnNumber: number;
  functionName?: string;
}

export interface OriginalSourceLocation {
  source: string;
  lineNumber: number;
  columnNumber: number;
  name?: string;
  sourceRoot?: string;
  excerpt?: string;
}

export interface SourceMapResolution {
  status: "resolved" | "unavailable" | "unsupported" | "failed";
  generated?: GeneratedSourceLocation;
  original?: OriginalSourceLocation;
  sourceMapUrl?: string;
  scriptIdentity?: {
    hash?: string;
    buildId?: string;
    debugId?: string;
    debugIdMatch?: boolean;
  };
  reason?: string;
}

export interface RuntimeErrorCursor {
  streamId: string;
  sequence: number;
}

export interface RuntimeErrorStackFrame {
  scriptId?: string;
  generated: GeneratedSourceLocation;
  asyncContext?: string;
  sourceMap?: SourceMapResolution;
}

export interface BrowserRuntimeError {
  id: string;
  sequence: number;
  kind: "exception" | "console";
  level: "error" | "warning";
  text: string;
  timestamp: string;
  exceptionId?: number;
  revoked?: boolean;
  frames: RuntimeErrorStackFrame[];
  framesOmitted: number;
}

export interface BrowserRuntimeErrorsInput {
  afterStreamId?: string;
  afterSequence?: number;
  limit?: number;
  maxFramesPerError?: number;
  includeWarnings?: boolean;
  includeRevoked?: boolean;
  includeSourceExcerpt?: boolean;
}

export interface BrowserRuntimeErrorsResult {
  version: "browser-runtime-errors-v1";
  attached: boolean;
  tabId?: number;
  cursorStatus:
    | "ok"
    | "stream_restarted"
    | "events_dropped"
    | "cursor_ahead";
  cursor: RuntimeErrorCursor;
  nextCursor: RuntimeErrorCursor;
  oldestSequence: number;
  latestSequence: number;
  missedEvents: number;
  droppedEvents: number;
  total: number;
  returned: number;
  errors: BrowserRuntimeError[];
}

export interface BrowserLocateSourceResult {
  version: "browser-source-location-v1";
  matched: boolean;
  selector: string;
  framework: FrameworkKind;
  components: FrameworkComponentLocation[];
  sourceMap?: SourceMapResolution;
  target: {
    tabId: number;
    frameId: number;
    documentId?: string;
  };
  warnings: string[];
}
