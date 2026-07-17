export const SANITIZE_LIMITS = {
  visibleText: 6000,
  domSummaryText: 160,
  domSummaryNodes: 90,
  outerHTML: 8000,
  elementText: 1000,
  attributeValue: 320,
  domMutationValue: 4000,
  cssPatch: 6000,
  queryResults: 100
} as const;

const SENSITIVE_KEY_PATTERN =
  /(password|passwd|pwd|token|secret|authorization|auth|cookie|session|credential|jwt|bearer|api[-_]?key|access[-_]?key|refresh[-_]?token)/i;

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_PATTERN = /(?<!\d)(?:\+?\d[\d\s().-]{7,}\d)(?!\d)/g;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi;
const HEADER_SECRET_PATTERN = /\b(authorization|cookie|set-cookie)\s*:\s*([^\n\r]+)/gi;
const KEY_VALUE_SECRET_PATTERN =
  /\b([A-Za-z0-9_.-]*(?:password|passwd|pwd|token|secret|authorization|auth|cookie|session|credential|jwt|api[-_]?key|access[-_]?key)[A-Za-z0-9_.-]*)\s*[:=]\s*["']?[^"'\s<>&]{4,}/gi;

export function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  if (!Number.isSafeInteger(maxLength) || maxLength <= 0) {
    return "";
  }

  let omittedChars = value.length - maxLength;
  let marker = "";
  let prefixLength = maxLength;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    marker = `\n...[truncated ${omittedChars} chars]`;
    if (marker.length >= maxLength) {
      return value.slice(0, maxLength);
    }
    prefixLength = maxLength - marker.length;
    const nextOmittedChars = value.length - prefixLength;
    if (nextOmittedChars === omittedChars) {
      break;
    }
    omittedChars = nextOmittedChars;
  }

  return `${value.slice(0, prefixLength)}${marker}`;
}

export function sanitizeText(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  const redacted = compact
    .replace(HEADER_SECRET_PATTERN, (_match, key: string) => `${key}: [REDACTED]`)
    .replace(EMAIL_PATTERN, "[REDACTED_EMAIL]")
    .replace(PHONE_PATTERN, "[REDACTED_PHONE]")
    .replace(BEARER_PATTERN, "Bearer [REDACTED]")
    .replace(KEY_VALUE_SECRET_PATTERN, (_match, key: string) => `${key}=[REDACTED]`);

  return truncateText(redacted, maxLength);
}

export function sanitizeHtmlSnippet(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  const redacted = compact
    .replace(HEADER_SECRET_PATTERN, (_match, key: string) => `${key}: [REDACTED]`)
    .replace(/(\s[^\s=>]*(?:password|passwd|pwd|token|secret|authorization|auth|cookie|session|credential|jwt|api[-_]?key|access[-_]?key)[^\s=>]*\s*=\s*)(["'])(.*?)\2/gi, "$1$2[REDACTED]$2")
    .replace(/(\svalue\s*=\s*)(["'])(.*?)\2/gi, "$1$2[REDACTED]$2")
    .replace(EMAIL_PATTERN, "[REDACTED_EMAIL]")
    .replace(PHONE_PATTERN, "[REDACTED_PHONE]")
    .replace(BEARER_PATTERN, "Bearer [REDACTED]");

  return truncateText(redacted, maxLength);
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

export function sanitizeAttributeValue(name: string, value: string): string {
  if (isSensitiveKey(name) || (name === "value" && value.length > 0)) {
    return "[REDACTED]";
  }

  return sanitizeText(value, SANITIZE_LIMITS.attributeValue);
}

export function sanitizeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);

    url.username = url.username ? "[REDACTED]" : "";
    url.password = url.password ? "[REDACTED]" : "";
    for (const key of Array.from(url.searchParams.keys())) {
      if (isSensitiveKey(key)) {
        url.searchParams.set(key, "[REDACTED]");
      }
    }
    if (url.hash) {
      url.hash = sanitizeUrlFragment(url.hash);
    }

    return truncateText(url.toString(), 1200);
  } catch {
    return sanitizeText(rawUrl, 1200);
  }
}

function sanitizeUrlFragment(fragment: string): string {
  const rawFragment = fragment.startsWith("#") ? fragment.slice(1) : fragment;
  const questionMarkIndex = rawFragment.indexOf("?");
  const prefix = questionMarkIndex >= 0
    ? rawFragment.slice(0, questionMarkIndex + 1)
    : "";
  const parameterText = questionMarkIndex >= 0
    ? rawFragment.slice(questionMarkIndex + 1)
    : rawFragment;

  if (!parameterText.includes("=")) {
    return fragment;
  }

  const params = new URLSearchParams(parameterText);
  let redacted = false;
  for (const key of Array.from(params.keys())) {
    if (isSensitiveKey(key)) {
      params.set(key, "[REDACTED]");
      redacted = true;
    }
  }

  return redacted ? `#${prefix}${params.toString()}` : fragment;
}
