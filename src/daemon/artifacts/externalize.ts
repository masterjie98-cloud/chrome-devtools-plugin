import type { ArtifactReference } from "../../shared/artifacts";
import { ArtifactStore } from "./store";

export const DEFAULT_INLINE_JSON_BYTES = 256 * 1024;

export interface ExternalizedJsonResult {
  artifact: ArtifactReference;
  contentType: "application/json";
  originalByteLength: number;
  externalized: true;
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
    summary: summarizeValue(value),
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

function summarizeValue(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) {
    return { type: "array", itemCount: value.length };
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>);
    return {
      type: "object",
      fieldCount: keys.length,
      fields: keys.slice(0, 40),
      ...(keys.length > 40 ? { omittedFieldCount: keys.length - 40 } : {}),
    };
  }
  return { type: value === null ? "null" : typeof value };
}
