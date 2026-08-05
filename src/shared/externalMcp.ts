export const MAX_EXTERNAL_MCP_SERVERS = 20;
export const EXTERNAL_MCP_TOOL_PREFIX = "extmcp__";

export type ExternalMcpTransportConfig =
  | {
      type: "stdio";
      command: string;
      args: string[];
      cwd?: string;
      env?: Record<string, string>;
    }
  | {
      type: "streamable-http";
      url: string;
      headers?: Record<string, string>;
    };

export interface ExternalMcpServerConfig {
  id: string;
  name: string;
  enabled: boolean;
  /** User-confirmed trust in this server's MCP read-only tool annotations. */
  trustReadOnlyTools?: boolean;
  /** User-confirmed permission for every tool from this server to run without approval. */
  autoApproveTools?: boolean;
  description?: string;
  timeoutMs?: number;
  disabledTools?: string[];
  importRequestedEnabled?: boolean;
  transport: ExternalMcpTransportConfig;
}

export type ExternalMcpRuntimeStatus =
  | "disabled"
  | "idle"
  | "connecting"
  | "connected"
  | "error";

export interface ExternalMcpServerSummary {
  id: string;
  name: string;
  enabled: boolean;
  trustReadOnlyTools: boolean;
  autoApproveTools: boolean;
  transportType: ExternalMcpTransportConfig["type"];
  endpointLabel: string;
  description?: string;
  importRequestedEnabled?: boolean;
  status: ExternalMcpRuntimeStatus;
  toolCount: number;
  error?: string;
}

export type ExternalMcpMode = "off" | "auto" | "selected";

export interface ExternalMcpSelection {
  mode: ExternalMcpMode;
  serverIds: string[];
}

export const DEFAULT_EXTERNAL_MCP_SELECTION: ExternalMcpSelection = {
  mode: "auto",
  serverIds: [],
};

const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_NAME_CHARS = 80;
const MAX_DESCRIPTION_CHARS = 1_000;
const MAX_COMMAND_CHARS = 1_000;
const MAX_ARGUMENTS = 100;
const MAX_ARGUMENT_CHARS = 4_000;
const MAX_KEY_VALUE_ENTRIES = 100;
const MAX_KEY_CHARS = 160;
const MAX_VALUE_CHARS = 16_000;
const MAX_DISABLED_TOOLS = 200;
const MAX_TOOL_NAME_CHARS = 200;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 300_000;

export function normalizeExternalMcpServerConfig(
  value: unknown,
): ExternalMcpServerConfig {
  if (!isRecord(value)) {
    throw new Error("MCP server config must be an object.");
  }
  const id = requireSafeId(value.id, "MCP server id");
  const name = requireCleanString(value.name, "MCP server name", MAX_NAME_CHARS);
  if (typeof value.enabled !== "boolean") {
    throw new Error("MCP server enabled must be boolean.");
  }
  const description = optionalCleanString(
    value.description,
    "MCP server description",
    MAX_DESCRIPTION_CHARS,
  );
  const timeoutMs = normalizeTimeoutMs(value.timeoutMs);
  const disabledTools = normalizeDisabledTools(value.disabledTools);
  return {
    id,
    name,
    enabled: value.enabled,
    ...(value.trustReadOnlyTools === true ? { trustReadOnlyTools: true } : {}),
    ...(value.autoApproveTools === true ? { autoApproveTools: true } : {}),
    ...(description ? { description } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(disabledTools !== undefined ? { disabledTools } : {}),
    ...(value.importRequestedEnabled === true
      ? { importRequestedEnabled: true }
      : {}),
    transport: normalizeExternalMcpTransport(value.transport),
  };
}

export function normalizeExternalMcpServers(
  value: unknown,
): ExternalMcpServerConfig[] {
  if (!Array.isArray(value)) {
    throw new Error("externalMcpServers must be an array.");
  }
  if (value.length > MAX_EXTERNAL_MCP_SERVERS) {
    throw new Error(
      `At most ${MAX_EXTERNAL_MCP_SERVERS} external MCP servers are supported.`,
    );
  }
  const seen = new Set<string>();
  return value.map((item) => {
    const server = normalizeExternalMcpServerConfig(item);
    if (seen.has(server.id)) {
      throw new Error(`Duplicate MCP server id: ${server.id}`);
    }
    seen.add(server.id);
    return server;
  });
}

export function parseExternalMcpImport(
  value: string | unknown,
  createId: (name: string) => string,
): ExternalMcpServerConfig[] {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      throw new Error("MCP 配置不是有效 JSON。");
    }
  }
  if (!isRecord(parsed)) {
    throw new Error("MCP 导入配置必须是 JSON 对象。");
  }
  const source = isRecord(parsed.mcpServers) ? parsed.mcpServers : parsed;
  const entries = Object.entries(source);
  if (entries.length === 0) {
    throw new Error("MCP 配置中没有可导入的 server。");
  }
  if (entries.length > MAX_EXTERNAL_MCP_SERVERS) {
    throw new Error(`一次最多导入 ${MAX_EXTERNAL_MCP_SERVERS} 个 MCP server。`);
  }
  return entries.map(([rawName, rawConfig]) => {
    if (!isRecord(rawConfig)) {
      throw new Error("每个 MCP server 配置都必须是对象。");
    }
    const fallbackName = requireCleanString(
      rawName,
      "MCP server name",
      MAX_NAME_CHARS,
    );
    const name =
      optionalCleanString(rawConfig.name, "MCP server name", MAX_NAME_CHARS) ??
      fallbackName;
    const config = normalizeImportedTransport(rawConfig);
    if (
      rawConfig.isActive !== undefined &&
      typeof rawConfig.isActive !== "boolean"
    ) {
      throw new Error(`MCP server ${name} 的 isActive 必须是 boolean。`);
    }
    return normalizeExternalMcpServerConfig({
      id: createId(name),
      name,
      enabled: false,
      trustReadOnlyTools: false,
      autoApproveTools: false,
      description: rawConfig.description,
      timeoutMs: rawConfig.timeout ?? rawConfig.timeoutMs,
      disabledTools: rawConfig.disabledTools,
      importRequestedEnabled: rawConfig.isActive === true,
      transport: config,
    });
  });
}

export function normalizeExternalMcpSelection(
  value: unknown,
): ExternalMcpSelection {
  if (!isRecord(value)) {
    return { ...DEFAULT_EXTERNAL_MCP_SELECTION };
  }
  const mode: ExternalMcpMode =
    value.mode === "auto" || value.mode === "selected" || value.mode === "off"
      ? value.mode
      : DEFAULT_EXTERNAL_MCP_SELECTION.mode;
  const serverIds = Array.isArray(value.serverIds)
    ? Array.from(
        new Set(
          value.serverIds
            .filter((item): item is string =>
              typeof item === "string" && SAFE_ID_PATTERN.test(item),
            )
            .slice(0, MAX_EXTERNAL_MCP_SERVERS),
        ),
      )
    : [];
  return {
    mode: mode === "selected" && serverIds.length === 0 ? "off" : mode,
    serverIds,
  };
}

export function createExternalMcpToolName(
  serverId: string,
  toolName: string,
): string {
  const server = safeToolSegment(serverId, 18);
  const tool = safeToolSegment(toolName, 25);
  const hash = stableHash(`${serverId}\u0000${toolName}`);
  return `${EXTERNAL_MCP_TOOL_PREFIX}${server}__${tool}_${hash}`.slice(0, 64);
}

export function isExternalMcpToolName(toolName: string): boolean {
  return toolName.startsWith(EXTERNAL_MCP_TOOL_PREFIX);
}

export function externalMcpToolAllowed(
  toolName: string,
  serverId: string | undefined,
  selection: ExternalMcpSelection,
): boolean {
  if (!isExternalMcpToolName(toolName)) {
    return true;
  }
  if (selection.mode === "off") {
    return false;
  }
  if (selection.mode === "auto") {
    return true;
  }
  return Boolean(serverId && selection.serverIds.includes(serverId));
}

function normalizeImportedTransport(value: unknown): ExternalMcpTransportConfig {
  if (!isRecord(value)) {
    throw new Error("每个 MCP server 配置都必须是对象。");
  }
  if (typeof value.command === "string") {
    return normalizeExternalMcpTransport({
      type: "stdio",
      command: value.command,
      args: value.args ?? [],
      cwd: value.cwd,
      env: value.env,
    });
  }
  const rawType = typeof value.type === "string" ? value.type.toLowerCase() : "";
  if (rawType === "sse") {
    throw new Error("不支持旧 SSE transport；请改用 Streamable HTTP URL。");
  }
  if (
    rawType &&
    rawType !== "streamable-http" &&
    rawType !== "streamablehttp" &&
    rawType !== "http"
  ) {
    throw new Error(`不支持的 MCP transport type：${String(value.type)}`);
  }
  const remoteUrl = value.url ?? value.baseUrl;
  if (typeof remoteUrl === "string") {
    return normalizeExternalMcpTransport({
      type: "streamable-http",
      url: remoteUrl,
      headers: value.headers,
    });
  }
  throw new Error(
    "MCP server 必须提供 command（stdio）或 url/baseUrl（Streamable HTTP）。",
  );
}

function normalizeExternalMcpTransport(value: unknown): ExternalMcpTransportConfig {
  if (!isRecord(value)) {
    throw new Error("MCP transport must be an object.");
  }
  if (value.type === "stdio") {
    const command = requireCleanString(
      value.command,
      "MCP stdio command",
      MAX_COMMAND_CHARS,
    );
    const args = normalizeStringArray(value.args ?? [], "MCP stdio args");
    const cwd = optionalCleanString(value.cwd, "MCP stdio cwd", 4_000);
    const env = normalizeStringRecord(value.env, "MCP stdio env");
    return {
      type: "stdio",
      command,
      args,
      ...(cwd ? { cwd } : {}),
      ...(env ? { env } : {}),
    };
  }
  if (value.type === "streamable-http") {
    const url = requireCleanString(value.url, "MCP HTTP URL", 4_000);
    assertSafeMcpHttpUrl(url);
    const headers = normalizeStringRecord(value.headers, "MCP HTTP headers");
    return {
      type: "streamable-http",
      url,
      ...(headers ? { headers } : {}),
    };
  }
  throw new Error("MCP transport type must be stdio or streamable-http.");
}

function assertSafeMcpHttpUrl(raw: string): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("MCP HTTP URL 无效。");
  }
  const localHost =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]" ||
    url.hostname === "::1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && localHost)) {
    throw new Error("远程 MCP 必须使用 HTTPS；仅 localhost 可使用 HTTP。");
  }
  if (url.username || url.password) {
    throw new Error("MCP URL 不能内嵌用户名或密码，请改用 headers。");
  }
}

function normalizeStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > MAX_ARGUMENTS) {
    throw new Error(`${label} must be an array with at most ${MAX_ARGUMENTS} items.`);
  }
  return value.map((item, index) =>
    requireCleanString(item, `${label}[${index}]`, MAX_ARGUMENT_CHARS, true),
  );
}

function normalizeTimeoutMs(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < MIN_TIMEOUT_MS ||
    value > MAX_TIMEOUT_MS
  ) {
    throw new Error(
      `MCP timeout must be an integer between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS} milliseconds.`,
    );
  }
  return value;
}

function normalizeDisabledTools(value: unknown): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.length > MAX_DISABLED_TOOLS) {
    throw new Error(
      `MCP disabledTools must be an array with at most ${MAX_DISABLED_TOOLS} items.`,
    );
  }
  return Array.from(
    new Set(
      value.map((item, index) =>
        requireCleanString(
          item,
          `MCP disabledTools[${index}]`,
          MAX_TOOL_NAME_CHARS,
        ),
      ),
    ),
  );
}

function normalizeStringRecord(
  value: unknown,
  label: string,
): Record<string, string> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const entries = Object.entries(value);
  if (entries.length > MAX_KEY_VALUE_ENTRIES) {
    throw new Error(`${label} has too many entries.`);
  }
  return Object.fromEntries(
    entries.map(([key, item]) => [
      requireCleanString(key, `${label} key`, MAX_KEY_CHARS),
      requireCleanString(item, `${label}.${key}`, MAX_VALUE_CHARS, true),
    ]),
  );
}

function requireSafeId(value: unknown, label: string): string {
  if (typeof value !== "string" || !SAFE_ID_PATTERN.test(value)) {
    throw new Error(`${label} must match ${SAFE_ID_PATTERN}.`);
  }
  return value;
}

function optionalCleanString(
  value: unknown,
  label: string,
  max: number,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requireCleanString(value, label, max);
}

function requireCleanString(
  value: unknown,
  label: string,
  max: number,
  allowEmpty = false,
): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }
  const normalized = value.trim();
  if ((!allowEmpty && !normalized) || normalized.length > max || /[\u0000\r\n]/.test(value)) {
    throw new Error(`${label} is empty, too long, or contains a forbidden control character.`);
  }
  return allowEmpty ? value : normalized;
}

function safeToolSegment(value: string, max: number): string {
  const normalized = value.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return (normalized || "tool").slice(0, max);
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, "0").slice(-7);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
