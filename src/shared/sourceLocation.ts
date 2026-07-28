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
  reason?: string;
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
