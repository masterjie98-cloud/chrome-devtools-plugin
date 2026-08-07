import type { ArtifactReference } from "../../shared/artifacts";
import { ArtifactStore } from "./store";

export const DEFAULT_INLINE_JSON_BYTES = 256 * 1024;

export interface ExternalizedJsonResult {
  artifact: ArtifactReference;
  contentType: "application/json";
  originalByteLength: number;
  externalized: true;
  retrieval: {
    tool: "browser_read_artifact";
    artifactId: string;
    instructions: string;
  };
  summary: Record<string, unknown>;
}

export async function externalizeLargeJsonResult(
  value: unknown,
  sessionId: string,
  artifactStore: ArtifactStore,
  inlineByteLimit = DEFAULT_INLINE_JSON_BYTES,
): Promise<unknown> {
  if (isScreenshotResult(value)) {
    return value;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    return value;
  }
  const bytes = Buffer.from(serialized, "utf8");
  if (bytes.byteLength <= inlineByteLimit) {
    return value;
  }
  const artifact = await artifactStore.putBytes(
    sessionId,
    "payload",
    "application/json",
    bytes,
  );
  return {
    artifact,
    contentType: "application/json",
    originalByteLength: bytes.byteLength,
    externalized: true,
    retrieval: {
      tool: "browser_read_artifact",
      artifactId: artifact.id,
      instructions:
        "The complete result is stored locally. Use browser_read_artifact in read or search mode to inspect the evidence before answering; the summary is not the full result.",
    },
    summary: summarizeExternalizedValue(value),
  } satisfies ExternalizedJsonResult;
}

function isScreenshotResult(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === "object" &&
      "mimeType" in value &&
      (value.mimeType === "image/png" || value.mimeType === "image/jpeg") &&
      "dataUrl" in value &&
      typeof value.dataUrl === "string",
  );
}

function summarizeExternalizedValue(value: unknown): Record<string, unknown> {
  const summary = summarizeValue(value);
  if (!isRecord(value) || !Array.isArray(value.content)) {
    return summary;
  }
  const textBlocks = value.content.flatMap((entry, index) => {
    if (!isRecord(entry) || typeof entry.text !== "string") {
      return [];
    }
    let parsedJson: Record<string, unknown> | undefined;
    try {
      parsedJson = summarizeValue(JSON.parse(entry.text) as unknown);
    } catch {
      // Plain-text MCP blocks still expose their exact size for retrieval.
    }
    return [
      {
        index,
        charCount: entry.text.length,
        ...(parsedJson ? { parsedJson } : {}),
      },
    ];
  });
  return textBlocks.length > 0
    ? { ...summary, mcpTextBlocks: textBlocks.slice(0, 20) }
    : summary;
}

function summarizeValue(value: unknown, depth = 0): Record<string, unknown> {
  if (Array.isArray(value)) {
    return {
      type: "array",
      itemCount: value.length,
      ...(depth < 2 && value.length > 0
        ? { itemShape: summarizeValue(value[0], depth + 1) }
        : {}),
    };
  }
  if (isRecord(value)) {
    const keys = Object.keys(value);
    const projectedKeys = keys.slice(0, 40);
    return {
      type: "object",
      fieldCount: keys.length,
      fields: projectedKeys,
      ...(keys.length > 40 ? { omittedFieldCount: keys.length - 40 } : {}),
      ...(depth < 2
        ? {
            fieldShapes: Object.fromEntries(
              projectedKeys
                .slice(0, 12)
                .map((key) => [key, summarizeValue(value[key], depth + 1)]),
            ),
          }
        : {}),
    };
  }
  return {
    type: value === null ? "null" : typeof value,
    ...(typeof value === "string" ? { charCount: value.length } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
