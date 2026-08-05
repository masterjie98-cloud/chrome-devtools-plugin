import type { AiConfig } from "./aiConfig";
import { resolveAiModelsUrl } from "./aiEndpointPolicy";

const MAX_MODEL_CATALOG_BYTES = 1_048_576;
const MAX_MODEL_COUNT = 500;
const MAX_MODEL_ID_CHARS = 200;

type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export interface AiModelCatalogResult {
  models: string[];
  requestUrl: string;
}

export async function fetchAiModelCatalog(
  config: Pick<AiConfig, "apiUrl" | "apiKey">,
  options: {
    signal?: AbortSignal;
    fetchImpl?: FetchLike;
  } = {},
): Promise<AiModelCatalogResult> {
  const requestUrl = resolveAiModelsUrl(config.apiUrl);
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  const apiKey = config.apiKey.trim();
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const response = await (options.fetchImpl ?? fetch)(requestUrl, {
    method: "GET",
    headers,
    signal: options.signal,
  });
  const rawText = await readBoundedResponseText(response);
  if (!response.ok) {
    const detail = parseApiError(rawText);
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `模型列表鉴权失败（HTTP ${response.status}）。请检查当前模型的 API Key。${detail ? ` ${detail}` : ""}`,
      );
    }
    throw new Error(
      `获取模型列表失败（HTTP ${response.status}）。${detail ? ` ${detail}` : ""}`,
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawText) as unknown;
  } catch {
    throw new Error("模型列表响应不是有效 JSON。");
  }
  const models = parseOpenAiModelList(payload);
  if (models.length === 0) {
    throw new Error("模型列表响应中没有可用的 model id。");
  }
  return { models, requestUrl };
}

export function parseOpenAiModelList(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    throw new Error("模型列表格式不兼容：预期 OpenAI-compatible 的 { data: [{ id }] }。");
  }
  const seen = new Set<string>();
  const models: string[] = [];
  for (const entry of value.data) {
    if (!isRecord(entry) || typeof entry.id !== "string") {
      continue;
    }
    const id = entry.id.trim();
    if (!id || id.length > MAX_MODEL_ID_CHARS || seen.has(id)) {
      continue;
    }
    seen.add(id);
    models.push(id);
    if (models.length >= MAX_MODEL_COUNT) {
      break;
    }
  }
  return models;
}

async function readBoundedResponseText(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_MODEL_CATALOG_BYTES) {
    throw new Error("模型列表响应超过 1 MiB 安全上限。");
  }
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_MODEL_CATALOG_BYTES) {
      throw new Error("模型列表响应超过 1 MiB 安全上限。");
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > MAX_MODEL_CATALOG_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error("模型列表响应超过 1 MiB 安全上限。");
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

function parseApiError(rawText: string): string {
  try {
    const payload = JSON.parse(rawText) as unknown;
    if (!isRecord(payload)) {
      return "";
    }
    if (isRecord(payload.error) && typeof payload.error.message === "string") {
      return payload.error.message.slice(0, 300);
    }
    return typeof payload.message === "string"
      ? payload.message.slice(0, 300)
      : "";
  } catch {
    return rawText.trim().slice(0, 300);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
