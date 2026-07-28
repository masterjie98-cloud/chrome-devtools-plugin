export interface BrowserCssExplainInput {
  selector: string;
  frameId?: number;
  documentId?: string;
  properties?: string[];
  maxRules?: number;
  includeVariables?: boolean;
}

export interface BrowserCssDeclaration {
  property: string;
  value: string;
  important: boolean;
}

export interface BrowserCssMatchedRule {
  selector: string;
  source?: string;
  media?: string;
  declarations: BrowserCssDeclaration[];
}

export interface BrowserCssExplainResult {
  version: "browser-css-explain-v1";
  matched: boolean;
  selector: string;
  target: {
    tabId: number;
    frameId: number;
    documentId?: string;
  };
  computed: Record<string, string>;
  variables: Record<string, string>;
  inlineStyle: BrowserCssDeclaration[];
  matchedRules: BrowserCssMatchedRule[];
  boxModel?: {
    rect: { x: number; y: number; width: number; height: number };
    margin: Record<string, string>;
    border: Record<string, string>;
    padding: Record<string, string>;
  };
  sourceHints: Array<{
    url: string;
    sourceMapUrl?: string;
    originalSources?: string[];
  }>;
  warnings: string[];
}

export interface BrowserPerformanceDiagnosticsInput {
  frameId?: number;
  documentId?: string;
  resourceLimit?: number;
  longTaskLimit?: number;
}

export interface BrowserPerformanceDiagnosticsResult {
  version: "browser-performance-diagnostics-v1";
  capturedAt: string;
  target: {
    tabId: number;
    frameId: number;
    documentId?: string;
  };
  navigation: Record<string, number | string | null>;
  paints: Array<{ name: string; startTime: number }>;
  largestContentfulPaint: {
    startTime: number;
    size?: number;
    element?: string;
  } | null;
  cumulativeLayoutShift: number;
  layoutShifts: Array<{
    value: number;
    startTime: number;
    hadRecentInput: boolean;
  }>;
  longTasks: Array<{ startTime: number; duration: number }>;
  interactions: Array<{
    name: string;
    startTime: number;
    duration: number;
    interactionId: number;
    target?: string;
  }>;
  resources: Array<{
    name: string;
    initiatorType: string;
    duration: number;
    transferSize: number;
    decodedBodySize: number;
  }>;
  summary: {
    domContentLoadedMs: number | null;
    loadMs: number | null;
    firstContentfulPaintMs: number | null;
    largestContentfulPaintMs: number | null;
    totalBlockingTimeMs: number;
    cumulativeLayoutShift: number;
    resourceCount: number;
    interactionToNextPaintMs: number | null;
  };
  traceSummary: {
    longTaskCount: number;
    longestTaskMs: number;
    totalLongTaskMs: number;
    slowResourceCount: number;
    totalResourceDurationMs: number;
  };
  findings: string[];
  warnings: string[];
}

export interface BrowserRealtimeActivityInput {
  frameId?: number;
  documentId?: string;
  limit?: number;
}

export interface BrowserRealtimeActivityResult {
  version: "browser-realtime-activity-v1";
  capturedAt: string;
  target: {
    tabId: number;
    frameId: number;
    documentId?: string;
  };
  websocket: Array<{
    requestId: string;
    url?: string;
    openedAt?: number;
    closedAt?: number;
    sentFrames: number;
    receivedFrames: number;
    sentBytes: number;
    receivedBytes: number;
    lastError?: string;
  }>;
  eventSource: Array<{
    requestId: string;
    url?: string;
    messageCount: number;
    lastEventName?: string;
    lastEventAt?: number;
  }>;
  serviceWorkers: {
    controlled: boolean;
    controllerUrl?: string;
    registrations: Array<{
      scope: string;
      activeUrl?: string;
      state?: string;
    }>;
  };
  indexedDb: Array<{
    name: string;
    version?: number;
    objectStores?: string[];
  }>;
  warnings: string[];
}
