export const MAX_TOOL_RESULT_DISPLAY_CHARS = 256_000;

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

  const fullMarker = `\n\n...[工具结果显示已截断；原始结果 ${serialized.length} 字符，显示上限 ${displayLimit} 字符；请使用该工具的分页/cursor 参数继续读取]`;
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
