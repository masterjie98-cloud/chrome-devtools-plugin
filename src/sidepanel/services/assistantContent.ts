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
    .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, "")
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

  const trailingThinkStart = next.search(/<think\b[^>]*>[^<]*$/i);
  if (trailingThinkStart !== -1) {
    next = next.slice(0, trailingThinkStart);
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

  next = next
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return stripInternalDeliberationPrefix(next);
}

const INTERNAL_DELIBERATION_MARKERS = [
  /\bdo not (?:fabricate|repeat|call|mention|invent)\b/i,
  /\bthe user (?:asked|wants|requested|said)\b/i,
  /\bi(?:'ve| have)? already\b/i,
  /\bi have sufficient (?:evidence|information|context)\b/i,
  /\bi (?:should|need to|must)\b/i,
  /\blet me (?:provide|give|answer|summarize)\b/i,
  /\bfinal (?:answer|response|consolidated answer)\b/i,
] as const;

/**
 * Some OpenAI-compatible providers occasionally put their private planning
 * prefix in `content` instead of `reasoning_content`. Only remove a prefix when
 * several high-confidence planning markers occur before a real Markdown
 * heading, so ordinary English answers remain untouched.
 */
function stripInternalDeliberationPrefix(content: string): string {
  const headingMatch = /#{1,6}[\t ]+(?=\S)/g.exec(content);
  if (!headingMatch || headingMatch.index < 80) {
    return content;
  }

  const prefix = content.slice(0, headingMatch.index);
  const markerCount = INTERNAL_DELIBERATION_MARKERS.reduce(
    (count, marker) => count + (marker.test(prefix) ? 1 : 0),
    0,
  );
  const hasInternalDirective = INTERNAL_DELIBERATION_MARKERS[0].test(prefix);
  if (markerCount < 3 && !(hasInternalDirective && markerCount >= 2)) {
    return content;
  }

  return content.slice(headingMatch.index).trimStart();
}
