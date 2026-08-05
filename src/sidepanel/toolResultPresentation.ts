import {
  estimateTextTokens,
  formatEstimatedTokenCount,
} from "../shared/tokenEstimate";

export const MAX_TOOL_RESULT_DISPLAY_CHARS = 256_000;
const MIN_TOOL_RESULT_MODEL_BATCH_CHARS = 12_000;
const MAX_TOOL_RESULT_MODEL_BATCH_CHARS = 64_000;
const TOOL_RESULT_MODEL_CONTEXT_RATIO = 0.2;

export interface ToolResultPresentationMeta {
  originalCharCount: number;
  displayedSourceCharCount: number;
  truncated: boolean;
}

export interface ToolResultPresentation {
  content: string;
  meta: ToolResultPresentationMeta;
}

export function presentToolResult(
  value: unknown,
  maxChars = MAX_TOOL_RESULT_DISPLAY_CHARS,
): ToolResultPresentation {
  const serialized = serializeToolResult(value);
  const displayLimit = Number.isFinite(maxChars)
    ? Math.max(0, Math.floor(maxChars))
    : MAX_TOOL_RESULT_DISPLAY_CHARS;
  if (serialized.length <= displayLimit) {
    return {
      content: serialized,
      meta: {
        originalCharCount: serialized.length,
        displayedSourceCharCount: serialized.length,
        truncated: false,
      },
    };
  }

  const fullMarker = `\n\n...[工具结果显示已截断；原始结果约 ${formatEstimatedTokenCount(estimateTextTokens(serialized))}；请使用该工具的分页/cursor 参数继续读取]`;
  const marker = fullMarker.slice(0, displayLimit);
  const displayedSourceCharCount = Math.max(0, displayLimit - marker.length);
  return {
    content: `${serialized.slice(0, displayedSourceCharCount)}${marker}`,
    meta: {
      originalCharCount: serialized.length,
      displayedSourceCharCount,
      truncated: true,
    },
  };
}

/**
 * Give one tool batch a bounded, model-aware share of the configured context.
 * The complete display representation stays in the tool card; only the copy
 * fed back into the next model request is compacted. This prevents one large
 * MCP listing from consuming most of the model context and stalling the next
 * ReAct turn.
 */
export function toolResultModelCharLimit(
  contextWindowTokens: number,
  batchSize: number,
): number {
  const normalizedContextTokens = Number.isFinite(contextWindowTokens)
    ? Math.max(8_192, Math.floor(contextWindowTokens))
    : 8_192;
  const normalizedBatchSize = Number.isFinite(batchSize)
    ? Math.max(1, Math.floor(batchSize))
    : 1;
  const batchBudget = Math.min(
    MAX_TOOL_RESULT_MODEL_BATCH_CHARS,
    Math.max(
      MIN_TOOL_RESULT_MODEL_BATCH_CHARS,
      Math.floor(normalizedContextTokens * TOOL_RESULT_MODEL_CONTEXT_RATIO),
    ),
  );
  return Math.max(1_000, Math.floor(batchBudget / normalizedBatchSize));
}

export function compactToolResultForModel(
  content: string,
  maxChars: number,
): string {
  const limit = Number.isFinite(maxChars)
    ? Math.max(0, Math.floor(maxChars))
    : 0;
  if (content.length <= limit) {
    return content;
  }
  const fullMarker = `\n\n...[tool result compacted for model context; omitted ${content.length - limit} characters. Use narrower filters, pagination, or cursor arguments to retrieve missing evidence]...\n\n`;
  if (limit <= fullMarker.length) {
    return fullMarker.slice(0, limit);
  }
  const available = limit - fullMarker.length;
  const headLength = Math.ceil(available * 0.7);
  const tailLength = available - headLength;
  return `${content.slice(0, headLength)}${fullMarker}${
    tailLength > 0 ? content.slice(-tailLength) : ""
  }`;
}

function serializeToolResult(value: unknown): string {
  try {
    return JSON.stringify(
      value ?? { error: "Tool returned no data." },
      null,
      2,
    );
  } catch (error) {
    return JSON.stringify(
      {
        error: "Tool result could not be serialized for display.",
        detail:
          error instanceof Error
            ? error.message
            : "Unknown serialization error.",
      },
      null,
      2,
    );
  }
}
