export const EMPTY_ASSISTANT_CONTENT_FALLBACK =
  "AI 未返回可显示的最终内容。请检查上方工具结果，或安全重试本轮回复。";

export function getAssistantDisplayContent(
  content: string,
  options: { allowEmpty?: boolean } = {},
): string {
  const visibleContent = stripAssistantToolMarkup(content);
  return visibleContent || options.allowEmpty
    ? visibleContent
    : EMPTY_ASSISTANT_CONTENT_FALLBACK;
}

export function stripAssistantToolMarkup(content: string): string {
  let next = content
    .replace(
      /<\|tool_calls_section_begin\|>[\s\S]*?<\|tool_calls_section_end\|>/gi,
      "",
    )
    .replace(/<\|tool_call_begin\|>[\s\S]*?<\|tool_call_end\|>/gi, "")
    .replace(/<tool_call>\s*[\s\S]*?<\/tool_call>/gi, "")
    .replace(/<function>\s*[\s\S]*?<\/function>/gi, "")
    .replace(/<task_status>\s*[\s\S]*?<\/task_status>/gi, "")
    .replace(/<final_answer>\s*([\s\S]*?)\s*<\/final_answer>/gi, "$1");

  const trailingToolCallStart = next.lastIndexOf("<tool_call>");
  if (trailingToolCallStart !== -1) {
    next = next.slice(0, trailingToolCallStart);
  }

  const trailingFunctionStart = next.lastIndexOf("<function>");
  if (trailingFunctionStart !== -1) {
    next = next.slice(0, trailingFunctionStart);
  }

  const trailingProviderSectionStart = next.lastIndexOf(
    "<|tool_calls_section_begin|>",
  );
  const trailingProviderCallStart = next.lastIndexOf("<|tool_call_begin|>");
  const trailingProviderStart =
    trailingProviderSectionStart !== -1
      ? trailingProviderSectionStart
      : trailingProviderCallStart;
  if (trailingProviderStart !== -1) {
    next = next.slice(0, trailingProviderStart);
  }

  return next
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
