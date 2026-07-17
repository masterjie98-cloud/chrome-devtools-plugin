import type { ArtifactReference } from "./artifacts";
import type {
  SemanticSnapshotCollection,
  SemanticSnapshotInput,
} from "./semanticSnapshot";

export interface PageSnapshotInput extends SemanticSnapshotInput {
  mode?: "interactive" | "outline" | "full";
  sourceLimit?: number;
  sinceRevision?: number;
}

export interface DomMutationDelta {
  fromRevision: number;
  toRevision: number;
  available: boolean;
  added: number;
  removed: number;
  attributes: number;
  characterData: number;
  truncated: boolean;
}

export interface PageSnapshotTarget {
  url: string;
  title: string;
  targetId: string;
  tabId: number;
  windowId?: number;
  frameId: number;
  documentId?: string;
  navigationId: string;
  revision: number;
}

export interface PageSnapshotProvenance {
  source: "chrome-content-script";
  observedAt: string;
  target: PageSnapshotTarget;
}

export interface DomRectSnapshot {
  x: number;
  y: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

export interface DomSummaryNode {
  tagName: string;
  selector: string;
  id?: string;
  className?: string;
  role?: string;
  ariaLabel?: string;
  text?: string;
  childElementCount: number;
  children?: DomSummaryNode[];
}

export interface PageSnapshot {
  url: string;
  title: string;
  origin: string;
  capturedAt: string;
  visibleText: string;
  domSummary: DomSummaryNode[];
  nodeCount: number;
  truncated: boolean;
  mode?: "interactive" | "outline" | "full";
  sourceVisited?: number;
  sourceLimit?: number;
  domRevision?: number;
  delta?: DomMutationDelta;
  semanticSnapshot?: SemanticSnapshotCollection;
  provenance?: PageSnapshotProvenance;
}

export interface DomElementInfo {
  selector: string;
  tagName: string;
  id?: string;
  className?: string;
  text?: string;
  outerHTML: string;
  attributes: Record<string, string>;
  computedStyle: Record<string, string>;
  rect: DomRectSnapshot;
}

export type DomQueryType = "selector" | "className" | "xpath";

export interface DomQueryInput {
  query: string;
  queryType: DomQueryType;
  limit?: number;
  includeText?: boolean;
  includeOuterHTML?: boolean;
  includeComputedStyle?: boolean;
  /**
   * Max chars for element text. Set 0 to disable truncation for this query.
   */
  maxTextLength?: number;
  /**
   * Max chars for element outerHTML. Set 0 to disable truncation for this query.
   */
  maxOuterHTMLLength?: number;
}

export interface DomQueryResult {
  query: string;
  queryType: DomQueryType;
  count: number;
  returnedCount?: number;
  truncated?: boolean;
  elements: DomElementInfo[];
  error?: string;
}

export interface HighlightElementInput {
  selector: string;
  durationMs?: number;
}

export interface HighlightElementResult {
  selector: string;
  highlighted: boolean;
}

export type DomSetValueTarget =
  | "auto"
  | "value"
  | "textContent"
  | "innerText"
  | "attribute";

export interface DomSetValueInput {
  selector: string;
  value: string;
  target?: DomSetValueTarget;
  attributeName?: string;
  dispatchEvents?: boolean;
}

export interface DomSetValueResult {
  selector: string;
  matched: boolean;
  target: Exclude<DomSetValueTarget, "auto">;
  tagName?: string;
  attributeName?: string;
  previousValue?: string;
  currentValue?: string;
}

export interface CssPatchInput {
  patchId: string;
  css: string;
}

export interface CssPatchResult {
  patchId: string;
  active: boolean;
}

export interface RemoveCssPatchInput {
  patchId: string;
}

export interface RemoveCssPatchResult {
  patchId: string;
  removed: boolean;
}

export type ScreenshotMimeType = "image/png" | "image/jpeg";
export type ScreenshotImageFormat = "png" | "jpeg";

export interface ScreenshotCaptureInput {
  type?: ScreenshotImageFormat;
  selector?: string;
  target?: string;
  element?: string;
  fullPage?: boolean;
  quality?: number;
  filename?: string;
  saveToDownloads?: boolean;
}

export interface ScreenshotCaptureResult {
  capturedAt: string;
  mimeType: ScreenshotMimeType;
  dataUrl: string;
  artifact?: ArtifactReference;
  method?: "cdp" | "visibleTab";
  fullPage?: boolean;
  selector?: string;
  width?: number;
  height?: number;
  filename?: string;
  savedAs?: string;
}

export interface BrowserTargetTab {
  id: number;
  windowId?: number;
  title?: string;
  url?: string;
  active?: boolean;
  highlighted?: boolean;
  selected?: boolean;
  lastAccessed?: number;
}

export interface BrowserTargetListResult {
  selectedTabId?: number;
  tabs: BrowserTargetTab[];
}

export interface BrowserTargetSetInput {
  tabId: number;
}

export interface BrowserTargetSetResult extends BrowserTargetListResult {
  selectedTab: BrowserTargetTab;
}

export interface BrowserTargetFrame {
  tabId: number;
  frameId: number;
  documentId?: string;
  url: string;
  title: string;
  isTop: boolean;
  selected: boolean;
  lastSeenAt: string;
}

export interface BrowserTargetFrameListResult {
  tabId: number;
  selectedFrameId: number;
  selectedDocumentId?: string;
  frames: BrowserTargetFrame[];
}

export interface BrowserTargetFrameSetInput {
  frameId: number;
  documentId?: string;
}

export interface BrowserTargetFrameSetResult
  extends BrowserTargetFrameListResult {
  selectedFrame: BrowserTargetFrame;
}

export interface BrowserDebuggerFrameCleanupInput {
  remove?: boolean;
  includeBlobAndFilesystem?: boolean;
}

export interface BrowserDebuggerFrameInfo {
  src: string;
  removed: boolean;
  reason: string;
}

export interface BrowserDebuggerFrameCleanupResult {
  scannedRoots: number;
  scannedFrames: number;
  incompatibleFrames: BrowserDebuggerFrameInfo[];
  removedCount: number;
}

export interface BrowserElementTargetInput {
  selector?: string;
  target?: string;
  element?: string;
}

export interface BrowserElementActionResult {
  selector: string;
  matched: boolean;
  tagName?: string;
  text?: string;
  rect?: DomRectSnapshot;
  action: string;
  inputMode?: "synthetic" | "cdp" | "dom";
  x?: number;
  y?: number;
  changed?: boolean;
}

export interface BrowserClickInput extends BrowserElementTargetInput {
  button?: "left" | "right" | "middle";
  doubleClick?: boolean;
  decisionBarrier?: boolean;
}

export interface BrowserHoverInput extends BrowserElementTargetInput {}

export interface BrowserTypeInput extends BrowserElementTargetInput {
  text: string;
  submit?: boolean;
  slowly?: boolean;
  replace?: boolean;
  decisionBarrier?: boolean;
}

export interface BrowserPressKeyInput {
  selector?: string;
  target?: string;
  key: string;
  decisionBarrier?: boolean;
}

export interface BrowserSelectOptionInput extends BrowserElementTargetInput {
  values: string[];
}

export type BrowserFormControlKind =
  | "text"
  | "checkbox"
  | "radio"
  | "select-one"
  | "select-multiple"
  | "unsupported";

export interface BrowserFormControlInspectInput
  extends BrowserElementRectInput {
  name?: string;
  values?: string[];
}

export interface BrowserFormControlInspectResult
  extends BrowserElementRectResult {
  elementToken?: string;
  controlKind?: BrowserFormControlKind;
  disabled?: boolean;
  readOnly?: boolean;
  checked?: boolean;
  selectedOptionIndices?: number[];
  desiredOptionIndices?: number[];
}

export interface BrowserSelectOptionApplyInput
  extends BrowserSelectOptionInput {
  expectedElementToken: string;
  expectedControlKind: "select-one" | "select-multiple";
}

export interface BrowserFormFieldInput extends BrowserElementTargetInput {
  name?: string;
  value: string | boolean | string[];
  type?: "text" | "checkbox" | "radio" | "select";
}

export interface BrowserFillFormInput {
  fields: BrowserFormFieldInput[];
  decisionBarrier?: boolean;
}

export interface BrowserFillFormFieldResult extends BrowserElementActionResult {
  name?: string;
  controlKind?: BrowserFormControlKind;
}

export interface BrowserFillFormResult {
  filled: boolean;
  fields: BrowserFillFormFieldResult[];
}

export interface BrowserDragInput {
  source?: string;
  sourceSelector?: string;
  target?: string;
  targetSelector?: string;
}

export interface BrowserDragResult {
  dragged: boolean;
  source: BrowserElementActionResult;
  target: BrowserElementActionResult;
}

export interface BrowserCoordinateInput {
  x: number;
  y: number;
}

export interface BrowserCoordinateClickInput extends BrowserCoordinateInput {
  button?: "left" | "right" | "middle";
  doubleClick?: boolean;
}

export interface BrowserCoordinateDragInput {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  steps?: number;
}

export interface BrowserMouseWheelInput {
  deltaX?: number;
  deltaY?: number;
  x?: number;
  y?: number;
}

export interface BrowserMouseResult {
  action: "move" | "click" | "down" | "up" | "drag" | "wheel";
  x?: number;
  y?: number;
  button?: "left" | "right" | "middle";
}

export type AgentPointerAction =
  | "move"
  | "click"
  | "doubleClick"
  | "down"
  | "up"
  | "drag"
  | "wheel"
  | "type"
  | "key"
  | "select"
  | "clear";

export type AgentPointerInput =
  | {
      action: "clear";
    }
  | {
      action: Exclude<AgentPointerAction, "drag" | "clear">;
      x: number;
      y: number;
    }
  | {
      action: "drag";
      x: number;
      y: number;
      endX: number;
      endY: number;
    };

export interface AgentPointerResult {
  action: AgentPointerAction;
  shown: boolean;
}

export interface BrowserWaitForInput {
  time?: number;
  text?: string;
  textGone?: string;
  selector?: string;
  timeoutMs?: number;
}

export interface BrowserWaitForResult {
  waited: boolean;
  reason: "time" | "text" | "textGone" | "selector" | "timeout";
  elapsedMs: number;
  text?: string;
  selector?: string;
}

export interface BrowserElementRectInput extends BrowserElementTargetInput {
  scrollIntoView?: boolean;
  requireHitTest?: boolean;
  focusElement?: boolean;
}

export interface BrowserElementRectResult {
  selector: string;
  matched: boolean;
  rect?: DomRectSnapshot;
  pageX?: number;
  pageY?: number;
  width?: number;
  height?: number;
  devicePixelRatio?: number;
  tagName?: string;
  text?: string;
  centerX?: number;
  centerY?: number;
  inViewport?: boolean;
  hitTestPassed?: boolean;
  focused?: boolean;
  editable?: boolean;
  accessibleName?: string;
  inputType?: string;
  autocomplete?: string;
  actionRisk?: "ordinary" | "decision_barrier";
  actionRiskReason?: string;
  dataSensitivity?: "ordinary" | "sensitive";
  dataSensitivityReason?: string;
}

export interface BrowserNavigateInput {
  url: string;
}

export interface BrowserNavigationResult {
  tabId: number;
  url?: string;
  title?: string;
  action: "navigate" | "back" | "forward" | "reload";
}

export interface BrowserCloseResult {
  tabId?: number;
  closed: boolean;
}

export interface BrowserResizeInput {
  width: number;
  height: number;
}

export interface BrowserResizeResult {
  windowId?: number;
  width?: number;
  height?: number;
}

export interface BrowserConsoleMessagesInput {
  level?: "error" | "warning" | "info" | "debug";
  all?: boolean;
  limit?: number;
}

export interface BrowserConsoleMessage {
  id: string;
  level: "error" | "warning" | "info" | "debug";
  type?: string;
  text: string;
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
  timestamp: string;
}

export interface BrowserConsoleMessagesResult {
  attached: boolean;
  tabId?: number;
  total: number;
  returned: number;
  messages: BrowserConsoleMessage[];
}

export interface BrowserEvaluateInput {
  expression: string;
  selector?: string;
  timeoutMs?: number;
}

export interface BrowserEvaluateResult {
  evaluated: boolean;
  result?: unknown;
  resultType?: string;
  serialized?: string;
  error?: string;
  truncated?: boolean;
}

export interface BrowserDialogInput {
  action: "accept" | "dismiss";
  promptText?: string;
}

export interface BrowserDialogResult {
  handled: boolean;
  action: "accept" | "dismiss";
  promptText?: string;
}

export interface BrowserStorageStateInput {
  includeLocalStorage?: boolean;
  includeSessionStorage?: boolean;
  includeCookies?: boolean;
  includeValues?: boolean;
}

export interface BrowserStorageStateResult {
  url: string;
  origin: string;
  localStorage?: Record<string, string>;
  sessionStorage?: Record<string, string>;
  cookies?: BrowserCookie[];
  valuesIncluded: boolean;
}

export interface BrowserCookie {
  name: string;
  value?: string;
  valueIncluded: boolean;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite?: string;
  expirationDate?: number;
  session?: boolean;
}

export interface BrowserCookieListInput {
  url?: string;
  name?: string;
  domain?: string;
  includeValues?: boolean;
}

export interface BrowserCookieListResult {
  url?: string;
  total: number;
  cookies: BrowserCookie[];
  valuesIncluded: boolean;
}

export interface BrowserCookieSetInput {
  url?: string;
  name: string;
  value: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: "no_restriction" | "lax" | "strict" | "unspecified";
  expirationDate?: number;
}

export interface BrowserCookieSetResult {
  cookie: BrowserCookie;
}

export interface BrowserCookieDeleteInput {
  url?: string;
  name: string;
}

export interface BrowserCookieDeleteResult {
  deleted: boolean;
  name: string;
  url?: string;
}

export interface ElementPickedEventPayload {
  element: DomElementInfo;
  page: {
    url: string;
    title: string;
  };
}
