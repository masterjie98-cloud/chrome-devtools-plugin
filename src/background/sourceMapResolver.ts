import type {
  GeneratedSourceLocation,
  SourceMapResolution,
} from "../shared/sourceLocation";

export interface LoadedScriptMetadata {
  scriptId: string;
  url: string;
  sourceMapURL?: string;
}

const MAX_SOURCE_MAP_BYTES = 2 * 1024 * 1024;
const MAX_MAPPING_SEGMENTS = 500_000;
const SOURCE_MAP_TIMEOUT_MS = 3_000;
const sourceMapCache = new Map<string, Promise<ParsedSourceMap>>();

interface RawSourceMap {
  version: number;
  file?: string;
  sourceRoot?: string;
  sources: string[];
  sourcesContent?: Array<string | null>;
  names?: string[];
  mappings: string;
  sections?: unknown;
}

interface ParsedSegment {
  generatedColumn: number;
  sourceIndex?: number;
  originalLine?: number;
  originalColumn?: number;
  nameIndex?: number;
}

interface ParsedSourceMap {
  raw: RawSourceMap;
  mapUrl: string;
  lines: ParsedSegment[][];
}

export async function resolveSourceMapLocation(
  script: LoadedScriptMetadata | undefined,
  generated: GeneratedSourceLocation,
  includeExcerpt = false,
): Promise<SourceMapResolution> {
  if (!script?.sourceMapURL) {
    return {
      status: "unavailable",
      generated,
      reason: "The loaded script exposes no sourceMapURL.",
    };
  }
  let mapUrl: string;
  try {
    mapUrl = resolveMapUrl(script.url, script.sourceMapURL);
  } catch (error) {
    return {
      status: "failed",
      generated,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  try {
    const parsed = await loadSourceMap(mapUrl);
    if (parsed.raw.sections !== undefined) {
      return {
        status: "unsupported",
        generated,
        reason: "Indexed source maps with sections are not supported.",
      };
    }
    const line = parsed.lines[generated.lineNumber];
    if (!line?.length) {
      return {
        status: "unavailable",
        generated,
        reason: "No mapping exists for the generated line.",
      };
    }
    let selected: ParsedSegment | undefined;
    for (const segment of line) {
      if (segment.generatedColumn > generated.columnNumber) {
        break;
      }
      if (segment.sourceIndex !== undefined) {
        selected = segment;
      }
    }
    if (
      !selected ||
      selected.sourceIndex === undefined ||
      selected.originalLine === undefined ||
      selected.originalColumn === undefined
    ) {
      return {
        status: "unavailable",
        generated,
        reason: "No source-bearing mapping precedes the generated column.",
      };
    }
    const source = parsed.raw.sources[selected.sourceIndex];
    if (!source) {
      return {
        status: "failed",
        generated,
        reason: "The selected mapping references an invalid source index.",
      };
    }
    const content = parsed.raw.sourcesContent?.[selected.sourceIndex];
    return {
      status: "resolved",
      generated,
      original: {
        source: resolveOriginalSource(
          parsed.mapUrl,
          parsed.raw.sourceRoot,
          source,
        ),
        lineNumber: selected.originalLine + 1,
        columnNumber: selected.originalColumn + 1,
        name:
          selected.nameIndex === undefined
            ? undefined
            : parsed.raw.names?.[selected.nameIndex],
        sourceRoot: parsed.raw.sourceRoot,
        excerpt:
          includeExcerpt && typeof content === "string"
            ? sourceExcerpt(content, selected.originalLine)
            : undefined,
      },
    };
  } catch (error) {
    return {
      status: "failed",
      generated,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function resolveMapUrl(scriptUrl: string, sourceMapURL: string): string {
  if (sourceMapURL.startsWith("data:")) {
    return sourceMapURL;
  }
  const resolved = new URL(sourceMapURL, scriptUrl);
  if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
    throw new Error("Only http(s) and data source maps are supported.");
  }
  resolved.username = "";
  resolved.password = "";
  return resolved.toString();
}

function loadSourceMap(mapUrl: string): Promise<ParsedSourceMap> {
  const cached = sourceMapCache.get(mapUrl);
  if (cached) {
    return cached;
  }
  const pending = readSourceMapText(mapUrl).then((text) =>
    parseSourceMap(text, mapUrl),
  );
  sourceMapCache.set(mapUrl, pending);
  pending.catch(() => sourceMapCache.delete(mapUrl));
  return pending;
}

async function readSourceMapText(mapUrl: string): Promise<string> {
  if (mapUrl.startsWith("data:")) {
    const comma = mapUrl.indexOf(",");
    if (comma < 0) {
      throw new Error("Invalid data source map URL.");
    }
    const metadata = mapUrl.slice(0, comma);
    const encoded = mapUrl.slice(comma + 1);
    const text = metadata.includes(";base64")
      ? atob(encoded)
      : decodeURIComponent(encoded);
    if (new TextEncoder().encode(text).byteLength > MAX_SOURCE_MAP_BYTES) {
      throw new Error("Source map exceeds the 2 MiB limit.");
    }
    return text;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SOURCE_MAP_TIMEOUT_MS);
  try {
    const response = await fetch(mapUrl, {
      signal: controller.signal,
      credentials: "omit",
      cache: "force-cache",
      redirect: "follow",
    });
    if (!response.ok) {
      throw new Error(`Source map fetch failed with HTTP ${response.status}.`);
    }
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_SOURCE_MAP_BYTES) {
      throw new Error("Source map exceeds the 2 MiB limit.");
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_SOURCE_MAP_BYTES) {
      throw new Error("Source map exceeds the 2 MiB limit.");
    }
    return new TextDecoder().decode(bytes);
  } finally {
    clearTimeout(timeout);
  }
}

function parseSourceMap(text: string, mapUrl: string): ParsedSourceMap {
  const value = JSON.parse(text) as Partial<RawSourceMap>;
  if (
    value.version !== 3 ||
    !Array.isArray(value.sources) ||
    !value.sources.every((source) => typeof source === "string") ||
    (value.names !== undefined &&
      (!Array.isArray(value.names) ||
        !value.names.every((name) => typeof name === "string"))) ||
    typeof value.mappings !== "string"
  ) {
    throw new Error("Unsupported or invalid Source Map v3 payload.");
  }
  const raw: RawSourceMap = {
    version: value.version,
    file: typeof value.file === "string" ? value.file : undefined,
    sourceRoot:
      typeof value.sourceRoot === "string" ? value.sourceRoot : undefined,
    sources: value.sources as string[],
    sourcesContent: Array.isArray(value.sourcesContent)
      ? value.sourcesContent.map((entry) =>
          typeof entry === "string" ? entry : null,
        )
      : undefined,
    names: Array.isArray(value.names) ? (value.names as string[]) : [],
    mappings: value.mappings,
    sections: value.sections,
  };
  return {
    raw,
    mapUrl,
    lines: decodeMappings(raw.mappings),
  };
}

function decodeMappings(mappings: string): ParsedSegment[][] {
  const lines: ParsedSegment[][] = [];
  let sourceIndex = 0;
  let originalLine = 0;
  let originalColumn = 0;
  let nameIndex = 0;
  let segmentCount = 0;
  for (const encodedLine of mappings.split(";")) {
    const line: ParsedSegment[] = [];
    let generatedColumn = 0;
    for (const encodedSegment of encodedLine.split(",")) {
      if (!encodedSegment) {
        continue;
      }
      segmentCount += 1;
      if (segmentCount > MAX_MAPPING_SEGMENTS) {
        throw new Error("Source map exceeds the mapping segment limit.");
      }
      const values = decodeVlqSegment(encodedSegment);
      generatedColumn += values[0] ?? 0;
      const segment: ParsedSegment = { generatedColumn };
      if (values.length >= 4) {
        sourceIndex += values[1] ?? 0;
        originalLine += values[2] ?? 0;
        originalColumn += values[3] ?? 0;
        segment.sourceIndex = sourceIndex;
        segment.originalLine = originalLine;
        segment.originalColumn = originalColumn;
      }
      if (values.length >= 5) {
        nameIndex += values[4] ?? 0;
        segment.nameIndex = nameIndex;
      }
      line.push(segment);
    }
    lines.push(line);
  }
  return lines;
}

function decodeVlqSegment(value: string): number[] {
  const output: number[] = [];
  let current = 0;
  let shift = 0;
  for (const character of value) {
    const digit = BASE64_DIGITS.indexOf(character);
    if (digit < 0) {
      throw new Error("Source map contains an invalid Base64 VLQ digit.");
    }
    const continuation = (digit & 32) !== 0;
    current += (digit & 31) << shift;
    if (continuation) {
      shift += 5;
      continue;
    }
    const negative = (current & 1) === 1;
    const decoded = current >> 1;
    output.push(negative ? -decoded : decoded);
    current = 0;
    shift = 0;
  }
  if (shift !== 0) {
    throw new Error("Source map contains an incomplete VLQ segment.");
  }
  return output;
}

function resolveOriginalSource(
  mapUrl: string,
  sourceRoot: string | undefined,
  source: string,
): string {
  try {
    const base = sourceRoot
      ? new URL(sourceRoot, mapUrl).toString()
      : mapUrl;
    return new URL(source, base).toString();
  } catch {
    return `${sourceRoot ?? ""}${source}`.slice(0, 2_000);
  }
}

function sourceExcerpt(content: string, lineIndex: number): string {
  return (content.split(/\r?\n/)[lineIndex] ?? "").slice(0, 500);
}

const BASE64_DIGITS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
