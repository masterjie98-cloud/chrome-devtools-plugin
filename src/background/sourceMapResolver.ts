import type {
  GeneratedSourceLocation,
  SourceMapResolution,
} from "../shared/sourceLocation";

export interface LoadedScriptMetadata {
  scriptId: string;
  url: string;
  sourceMapURL?: string;
  hash?: string;
  buildId?: string;
}

export const MAX_SOURCE_MAP_BYTES = 16 * 1024 * 1024;
const MAX_MAPPING_SEGMENTS = 1_000_000;
const MAX_INDEXED_SECTIONS = 1_000;
const MAX_SOURCE_MAP_CACHE_ENTRIES = 4;
export const SOURCE_MAP_TIMEOUT_MS = 8_000;
const sourceMapCache = new Map<string, Promise<ParsedSourceMap>>();

interface RawFlatSourceMap {
  version: number;
  file?: string;
  sourceRoot?: string;
  sources: string[];
  sourcesContent?: Array<string | null>;
  names?: string[];
  mappings: string;
  debugId?: string;
}

interface ParsedSegment {
  generatedColumn: number;
  sourceIndex?: number;
  originalLine?: number;
  originalColumn?: number;
  nameIndex?: number;
}

interface ParsedSourceMap {
  mapUrl: string;
  debugId?: string;
  sections: Array<{
    offsetLine: number;
    offsetColumn: number;
    raw: RawFlatSourceMap;
    lines: ParsedSegment[][];
  }>;
}

export interface SourceMapLoadContext {
  cachePartition?: string;
  loadText?: (mapUrl: string) => Promise<string>;
}

export async function resolveSourceMapLocation(
  script: LoadedScriptMetadata | undefined,
  generated: GeneratedSourceLocation,
  includeExcerpt = false,
  loadContext?: SourceMapLoadContext,
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
    const parsed = await loadSourceMap(mapUrl, loadContext);
    const section = selectSourceMapSection(
      parsed,
      generated.lineNumber,
      generated.columnNumber,
    );
    if (!section) {
      return {
        status: "unavailable",
        generated,
        sourceMapUrl: publicSourceMapUrl(mapUrl),
        scriptIdentity: sourceMapIdentity(script, parsed.debugId),
        reason: "No indexed source-map section contains the generated location.",
      };
    }
    const localLine = generated.lineNumber - section.offsetLine;
    const localColumn =
      localLine === 0
        ? generated.columnNumber - section.offsetColumn
        : generated.columnNumber;
    const line = section.lines[localLine];
    if (!line?.length) {
      return {
        status: "unavailable",
        generated,
        sourceMapUrl: publicSourceMapUrl(mapUrl),
        scriptIdentity: sourceMapIdentity(script, parsed.debugId),
        reason: "No mapping exists for the generated line.",
      };
    }
    let selected: ParsedSegment | undefined;
    for (const segment of line) {
      if (segment.generatedColumn > localColumn) {
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
        sourceMapUrl: publicSourceMapUrl(mapUrl),
        scriptIdentity: sourceMapIdentity(script, parsed.debugId),
        reason: "No source-bearing mapping precedes the generated column.",
      };
    }
    const source = section.raw.sources[selected.sourceIndex];
    if (!source) {
      return {
        status: "failed",
        generated,
        sourceMapUrl: publicSourceMapUrl(mapUrl),
        scriptIdentity: sourceMapIdentity(script, parsed.debugId),
        reason: "The selected mapping references an invalid source index.",
      };
    }
    const content = section.raw.sourcesContent?.[selected.sourceIndex];
    return {
      status: "resolved",
      generated,
      sourceMapUrl: publicSourceMapUrl(mapUrl),
      scriptIdentity: sourceMapIdentity(script, parsed.debugId),
      original: {
        source: resolveOriginalSource(
          parsed.mapUrl,
          section.raw.sourceRoot,
          source,
        ),
        lineNumber: selected.originalLine + 1,
        columnNumber: selected.originalColumn + 1,
        name:
          selected.nameIndex === undefined
            ? undefined
            : section.raw.names?.[selected.nameIndex],
        sourceRoot: section.raw.sourceRoot,
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
      sourceMapUrl: publicSourceMapUrl(mapUrl),
      scriptIdentity: sourceMapIdentity(script),
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

function loadSourceMap(
  mapUrl: string,
  loadContext?: SourceMapLoadContext,
): Promise<ParsedSourceMap> {
  const cacheKey = `${loadContext?.cachePartition ?? "extension-fetch"}\0${mapUrl}`;
  const cached = sourceMapCache.get(cacheKey);
  if (cached) {
    sourceMapCache.delete(cacheKey);
    sourceMapCache.set(cacheKey, cached);
    return cached;
  }
  const pending = readSourceMapText(mapUrl, loadContext?.loadText).then(
    (text) => parseSourceMap(text, mapUrl),
  );
  while (sourceMapCache.size >= MAX_SOURCE_MAP_CACHE_ENTRIES) {
    const oldest = sourceMapCache.keys().next().value;
    if (typeof oldest !== "string") {
      break;
    }
    sourceMapCache.delete(oldest);
  }
  sourceMapCache.set(cacheKey, pending);
  pending.catch(() => sourceMapCache.delete(cacheKey));
  return pending;
}

async function readSourceMapText(
  mapUrl: string,
  loadText?: (mapUrl: string) => Promise<string>,
): Promise<string> {
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
    assertSourceMapTextSize(text);
    return text;
  }
  if (loadText) {
    const text = await loadText(mapUrl);
    assertSourceMapTextSize(text);
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
      throw new Error("Source map exceeds the 16 MiB limit.");
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_SOURCE_MAP_BYTES) {
      throw new Error("Source map exceeds the 16 MiB limit.");
    }
    return new TextDecoder().decode(bytes);
  } finally {
    clearTimeout(timeout);
  }
}

function assertSourceMapTextSize(text: string): void {
  if (new TextEncoder().encode(text).byteLength > MAX_SOURCE_MAP_BYTES) {
    throw new Error("Source map exceeds the 16 MiB limit.");
  }
}

function parseSourceMap(text: string, mapUrl: string): ParsedSourceMap {
  const value = JSON.parse(text) as unknown;
  if (!isRecord(value) || value.version !== 3) {
    throw new Error("Unsupported or invalid Source Map v3 payload.");
  }
  const debugId = readDebugId(value);
  if (value.sections !== undefined) {
    if (
      !Array.isArray(value.sections) ||
      value.sections.length === 0 ||
      value.sections.length > MAX_INDEXED_SECTIONS
    ) {
      throw new Error("Unsupported or invalid indexed Source Map v3 payload.");
    }
    const mappingBudget = { count: 0 };
    const sections = value.sections.map((section, index) =>
      parseIndexedSection(section, index, mappingBudget),
    );
    for (let index = 1; index < sections.length; index += 1) {
      const previous = sections[index - 1]!;
      const current = sections[index]!;
      if (
        current.offsetLine < previous.offsetLine ||
        (current.offsetLine === previous.offsetLine &&
          current.offsetColumn <= previous.offsetColumn)
      ) {
        throw new Error(
          "Indexed Source Map sections must have strictly increasing offsets.",
        );
      }
    }
    return {
      mapUrl,
      debugId,
      sections,
    };
  }
  const raw = parseFlatSourceMap(value);
  const mappingBudget = { count: 0 };
  return {
    mapUrl,
    debugId: debugId ?? raw.debugId,
    sections: [
      {
        offsetLine: 0,
        offsetColumn: 0,
        raw,
        lines: decodeMappings(raw.mappings, mappingBudget),
      },
    ],
  };
}

function parseIndexedSection(
  value: unknown,
  index: number,
  mappingBudget: { count: number },
): ParsedSourceMap["sections"][number] {
  if (!isRecord(value) || !isRecord(value.offset)) {
    throw new Error(`Indexed Source Map section ${index} is invalid.`);
  }
  if (value.url !== undefined) {
    throw new Error(
      "Indexed Source Map sections with external URLs are not supported.",
    );
  }
  const offsetLine = value.offset.line;
  const offsetColumn = value.offset.column;
  if (
    !Number.isInteger(offsetLine) ||
    Number(offsetLine) < 0 ||
    !Number.isInteger(offsetColumn) ||
    Number(offsetColumn) < 0
  ) {
    throw new Error(`Indexed Source Map section ${index} has an invalid offset.`);
  }
  const raw = parseFlatSourceMap(value.map);
  return {
    offsetLine: Number(offsetLine),
    offsetColumn: Number(offsetColumn),
    raw,
    lines: decodeMappings(raw.mappings, mappingBudget),
  };
}

function parseFlatSourceMap(value: unknown): RawFlatSourceMap {
  if (
    !isRecord(value) ||
    value.version !== 3 ||
    !Array.isArray(value.sources) ||
    !value.sources.every((source) => typeof source === "string") ||
    (value.names !== undefined &&
      (!Array.isArray(value.names) ||
        !value.names.every((name) => typeof name === "string"))) ||
    typeof value.mappings !== "string" ||
    value.sections !== undefined
  ) {
    throw new Error("Unsupported or invalid Source Map v3 payload.");
  }
  return {
    version: 3,
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
    debugId: readDebugId(value),
  };
}

function selectSourceMapSection(
  sourceMap: ParsedSourceMap,
  lineNumber: number,
  columnNumber: number,
): ParsedSourceMap["sections"][number] | undefined {
  let selected: ParsedSourceMap["sections"][number] | undefined;
  for (const section of sourceMap.sections) {
    if (
      section.offsetLine > lineNumber ||
      (section.offsetLine === lineNumber &&
        section.offsetColumn > columnNumber)
    ) {
      break;
    }
    selected = section;
  }
  return selected;
}

function sourceMapIdentity(
  script: LoadedScriptMetadata,
  debugId?: string,
): NonNullable<SourceMapResolution["scriptIdentity"]> | undefined {
  const hash = normalizeIdentity(script.hash);
  const buildId = normalizeIdentity(script.buildId);
  const normalizedDebugId = normalizeIdentity(debugId);
  if (!hash && !buildId && !normalizedDebugId) {
    return undefined;
  }
  return {
    hash,
    buildId,
    debugId: normalizedDebugId,
    debugIdMatch:
      buildId && normalizedDebugId
        ? normalizeDebugId(buildId) === normalizeDebugId(normalizedDebugId)
        : undefined,
  };
}

function normalizeIdentity(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, 200) : undefined;
}

function normalizeDebugId(value: string): string {
  return value.replace(/^debugid:/i, "").replace(/-/g, "").toLowerCase();
}

function publicSourceMapUrl(mapUrl: string): string {
  if (mapUrl.startsWith("data:")) {
    return "data:source-map";
  }
  try {
    const url = new URL(mapUrl);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().slice(0, 2_000);
  } catch {
    return mapUrl.split(/[?#]/, 1)[0]!.slice(0, 2_000);
  }
}

function readDebugId(value: Record<string, unknown>): string | undefined {
  const candidate =
    typeof value.debugId === "string"
      ? value.debugId
      : typeof value.debug_id === "string"
        ? value.debug_id
        : undefined;
  return normalizeIdentity(candidate);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function decodeMappings(
  mappings: string,
  budget: { count: number },
): ParsedSegment[][] {
  const lines: ParsedSegment[][] = [];
  let sourceIndex = 0;
  let originalLine = 0;
  let originalColumn = 0;
  let nameIndex = 0;
  for (const encodedLine of mappings.split(";")) {
    const line: ParsedSegment[] = [];
    let generatedColumn = 0;
    for (const encodedSegment of encodedLine.split(",")) {
      if (!encodedSegment) {
        continue;
      }
      budget.count += 1;
      if (budget.count > MAX_MAPPING_SEGMENTS) {
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
