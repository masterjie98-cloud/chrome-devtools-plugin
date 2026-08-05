export function validateAiProviderUrl(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return "API URL 不能为空。";
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return "API URL 必须是完整的 http(s) URL。";
  }
  if (url.username || url.password) {
    return "API URL 不能包含用户名或密码。";
  }
  if (url.protocol === "https:") {
    return undefined;
  }
  if (url.protocol === "http:" && isLoopbackHostname(url.hostname)) {
    return undefined;
  }
  if (url.protocol === "http:") {
    return "非本机 AI Provider 必须使用 HTTPS，避免 API Key 和页面数据明文传输。";
  }
  return "AI Provider 仅支持 HTTPS；本机 loopback 服务可使用 HTTP。";
}

export function assertSafeAiProviderUrl(value: string): URL {
  const error = validateAiProviderUrl(value);
  if (error) {
    throw new Error(error);
  }
  return new URL(value.trim());
}

export function resolveAiChatCompletionsUrl(value: string): string {
  const url = assertSafeAiProviderUrl(value);
  url.search = "";
  url.hash = "";
  const path = url.pathname.replace(/\/+$/, "");
  if (path.endsWith("/chat/completions")) {
    return url.toString();
  }
  if (!path || path.endsWith("/v1")) {
    url.pathname = `${path || "/v1"}/chat/completions`;
  }
  return url.toString();
}

export function resolveAiModelsUrl(value: string): string {
  const url = assertSafeAiProviderUrl(value);
  url.search = "";
  url.hash = "";
  const path = url.pathname.replace(/\/+$/, "");
  if (path.endsWith("/models")) {
    throw new Error(
      "API URL 不能填写模型列表地址；请填写 Provider 根地址、/v1 或 /chat/completions，聊天与模型列表会分别推导。",
    );
  }
  if (path.endsWith("/chat/completions")) {
    url.pathname = `${path.slice(0, -"/chat/completions".length)}/models`;
    return url.toString();
  }
  if (!path || path.endsWith("/v1")) {
    url.pathname = `${path || "/v1"}/models`;
    return url.toString();
  }
  throw new Error(
    "无法从自定义请求路径推导模型列表地址；请填写 Provider 根地址、/v1 或 /chat/completions。",
  );
}

export function getAiProviderOrigin(value: string): string | undefined {
  try {
    return assertSafeAiProviderUrl(value).origin;
  } catch {
    return undefined;
  }
}

export function hasAiProviderOriginChanged(
  previousUrl: string,
  nextUrl: string,
): boolean {
  const previousOrigin = getAiProviderOrigin(previousUrl);
  const nextOrigin = getAiProviderOrigin(nextUrl);
  return Boolean(
    previousOrigin && nextOrigin && previousOrigin !== nextOrigin,
  );
}

export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "[::1]"
  ) {
    return true;
  }
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(
    normalized,
  );
  if (!match) {
    return false;
  }
  const octets = match.slice(1).map(Number);
  return octets.every((octet) => octet >= 0 && octet <= 255) && octets[0] === 127;
}
