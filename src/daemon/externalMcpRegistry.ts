import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { isDeepStrictEqual } from "node:util";
import type { McpAvailableTool } from "../shared/wsProtocol";
import {
  createTrustedExternalAutoRunPolicy,
  createTrustedExternalReadOnlyPolicy,
  type ToolPolicy,
} from "../shared/toolPolicy";
import {
  MAX_EXTERNAL_MCP_SERVERS,
  createExternalMcpToolName,
  normalizeExternalMcpServerConfig,
  normalizeExternalMcpServers,
  type ExternalMcpServerConfig,
  type ExternalMcpServerSummary,
} from "../shared/externalMcp";
import type {
  AdditionalMcpToolBackend,
  ExternalMcpManagementBackend,
} from "../mcp/wsServer";

const CONNECT_TIMEOUT_MS = 20_000;
const CALL_TIMEOUT_MS = 60_000;
const MAX_RESULT_BYTES = 1024 * 1024;
const MAX_SERVER_INSTRUCTIONS_CHARS = 6_000;
const STREAMABLE_HTTP_CONNECT_ATTEMPTS = 3;
const EXTERNAL_MCP_TOOL_ATTEMPTS = 3;

interface RuntimeServer {
  client?: Client;
  transport?: StdioClientTransport | StreamableHTTPClientTransport;
  status: ExternalMcpServerSummary["status"];
  tools: McpAvailableTool[];
  instructions?: string;
  error?: string;
  connectPromise?: Promise<void>;
}

interface ToolRoute {
  serverId: string;
  remoteToolName: string;
}

export interface ExternalMcpRegistryOptions {
  saveServers: (servers: ExternalMcpServerConfig[]) => Promise<void>;
}

export class ExternalMcpRegistry
  implements AdditionalMcpToolBackend, ExternalMcpManagementBackend
{
  private servers: ExternalMcpServerConfig[];
  private readonly runtimes = new Map<string, RuntimeServer>();
  private readonly toolRoutes = new Map<string, ToolRoute>();
  private readonly recoveryByServer = new Map<string, Promise<void>>();

  constructor(
    servers: ExternalMcpServerConfig[],
    private readonly options: ExternalMcpRegistryOptions,
  ) {
    this.servers = normalizeExternalMcpServers(servers);
    for (const server of this.servers) {
      this.runtimes.set(server.id, createRuntime(server.enabled));
    }
  }

  async listTools(
    options: { serverIds?: string[]; signal?: AbortSignal } = {},
  ): Promise<McpAvailableTool[]> {
    const tools: McpAvailableTool[] = [];
    const selectedIds = options.serverIds?.length
      ? new Set(options.serverIds)
      : undefined;
    for (const server of this.servers) {
      if (!server.enabled || (selectedIds && !selectedIds.has(server.id))) {
        continue;
      }
      try {
        throwIfAborted(options.signal);
        const activeRecovery = this.recoveryByServer.get(server.id);
        if (activeRecovery) {
          await withAbort(activeRecovery, options.signal);
        }
        await withAbort(this.ensureConnected(server.id), options.signal);
        const runtime = this.requireRuntime(server.id);
        for (const tool of runtime.tools) {
          const route = this.toolRoutes.get(tool.name);
          if (route?.serverId === server.id) {
            tools.push(tool);
          }
        }
      } catch (error) {
        if (options.signal?.aborted) {
          throw error;
        }
        // One unavailable server must not remove tools from healthy servers.
      }
    }
    return tools;
  }

  async callTool(
    toolName: string,
    args: Record<string, unknown>,
    options: { signal?: AbortSignal } = {},
  ): Promise<unknown> {
    let route = this.toolRoutes.get(toolName);
    if (!route) {
      await this.listTools({ signal: options.signal });
      route = this.toolRoutes.get(toolName);
    }
    if (!route) {
      throw new Error(`External MCP tool is unavailable: ${toolName}`);
    }
    const server = this.servers.find((item) => item.id === route.serverId);
    if (!server?.enabled) {
      throw new Error(`External MCP server is disabled: ${route.serverId}`);
    }
    const activeRecovery = this.recoveryByServer.get(route.serverId);
    try {
      if (activeRecovery) {
        await withAbort(activeRecovery, options.signal);
      }
      await withAbort(
        this.ensureConnected(route.serverId),
        options.signal,
      );
    } catch (error) {
      throw readableExternalMcpError(error);
    }
    const callTimeoutMs = server.timeoutMs ?? CALL_TIMEOUT_MS;
    let attemptedClient: Client | undefined;
    const invoke = async (): Promise<unknown> => {
      const currentRuntime = this.requireRuntime(route.serverId);
      if (!currentRuntime.client) {
        throw new Error(`External MCP server is not connected: ${server.name}`);
      }
      attemptedClient = currentRuntime.client;
      return withDeadline(
        attemptedClient.callTool(
          { name: route.remoteToolName, arguments: args },
          undefined,
          { signal: options.signal, timeout: callTimeoutMs },
        ),
        callTimeoutMs,
        options.signal,
        `MCP tool timed out after ${callTimeoutMs / 1000}s: ${toolName}`,
      );
    };
    const tool = this.requireRuntime(route.serverId).tools.find(
      (item) => item.name === toolName,
    );
    for (let attempt = 1; attempt <= EXTERNAL_MCP_TOOL_ATTEMPTS; attempt += 1) {
      try {
        return boundMcpResult(await invoke());
      } catch (error) {
        if (
          attempt >= EXTERNAL_MCP_TOOL_ATTEMPTS ||
          !canRetryExternalMcpTool(server, tool, error, options.signal)
        ) {
          throw readableExternalMcpError(error);
        }
        const statusCode = externalMcpHttpStatus(error);
        if (statusCode !== undefined) {
          console.warn(
            `[external-mcp] transient HTTP ${statusCode} in ${toolName} (${attempt}/${EXTERNAL_MCP_TOOL_ATTEMPTS}); retrying`,
          );
          await delay(100 * attempt, options.signal);
          continue;
        }
        await this.recoverConnection(
          route.serverId,
          attemptedClient,
          toolName,
          error,
          options.signal,
        );
      }
    }
    throw new Error(`External MCP tool retry budget exhausted: ${toolName}`);
  }

  getToolPolicy(toolName: string): ToolPolicy | undefined {
    const route = this.toolRoutes.get(toolName);
    if (!route) {
      return undefined;
    }
    const server = this.servers.find((item) => item.id === route.serverId);
    if (!server?.enabled) {
      return undefined;
    }
    const tool = this.runtimes
      .get(route.serverId)
      ?.tools.find((item) => item.name === toolName);
    if (server.autoApproveTools === true) {
      return createTrustedExternalAutoRunPolicy(
        toolName,
        tool?.annotations,
      );
    }
    if (server.trustReadOnlyTools !== true) {
      return undefined;
    }
    return tool?.annotations
      ? createTrustedExternalReadOnlyPolicy(toolName, tool.annotations)
      : undefined;
  }

  getToolOrigin(toolName: string):
    | {
        externalMcpServerId: string;
        externalMcpServerName: string;
        externalMcpToolName: string;
      }
    | undefined {
    const route = this.toolRoutes.get(toolName);
    const server = route
      ? this.servers.find((item) => item.id === route.serverId)
      : undefined;
    return server
      ? {
          externalMcpServerId: server.id,
          externalMcpServerName: server.name,
          externalMcpToolName: route!.remoteToolName,
        }
      : undefined;
  }

  listServers(): ExternalMcpServerSummary[] {
    return this.servers.map((server) => {
      const runtime = this.runtimes.get(server.id) ?? createRuntime(server.enabled);
      return {
        id: server.id,
        name: server.name,
        enabled: server.enabled,
        trustReadOnlyTools: server.trustReadOnlyTools === true,
        autoApproveTools: server.autoApproveTools === true,
        transportType: server.transport.type,
        endpointLabel:
          server.transport.type === "stdio"
            ? `${server.transport.command}${server.transport.args.length ? " …" : ""}`
            : safeEndpointLabel(server.transport.url),
        ...(server.description ? { description: server.description } : {}),
        ...(server.importRequestedEnabled
          ? { importRequestedEnabled: true }
          : {}),
        status: server.enabled ? runtime.status : "disabled",
        toolCount: runtime.tools.length,
        ...(runtime.error ? { error: runtime.error } : {}),
      };
    });
  }

  async upsertServer(value: ExternalMcpServerConfig): Promise<ExternalMcpServerSummary[]> {
    const server = normalizeExternalMcpServerConfig(value);
    const index = this.servers.findIndex((item) => item.id === server.id);
    if (index < 0 && this.servers.length >= MAX_EXTERNAL_MCP_SERVERS) {
      throw new Error(`最多配置 ${MAX_EXTERNAL_MCP_SERVERS} 个外部 MCP server。`);
    }
    if (
      this.servers.some(
        (item) => item.id !== server.id && item.name.toLowerCase() === server.name.toLowerCase(),
      )
    ) {
      throw new Error(`MCP server 名称已存在：${server.name}`);
    }
    const next = [...this.servers];
    if (index >= 0) {
      next[index] = server;
    } else {
      next.push(server);
    }
    await this.options.saveServers(next);
    await this.disconnect(server.id);
    this.servers = next;
    this.runtimes.set(server.id, createRuntime(server.enabled));
    if (server.enabled) {
      await this.ensureConnected(server.id).catch(() => undefined);
    }
    return this.listServers();
  }

  async removeServer(serverId: string): Promise<ExternalMcpServerSummary[]> {
    const next = this.servers.filter((server) => server.id !== serverId);
    if (next.length === this.servers.length) {
      throw new Error(`MCP server 不存在：${serverId}`);
    }
    await this.options.saveServers(next);
    await this.disconnect(serverId);
    this.servers = next;
    this.runtimes.delete(serverId);
    this.removeToolRoutes(serverId);
    return this.listServers();
  }

  async setServerEnabled(
    serverId: string,
    enabled: boolean,
  ): Promise<ExternalMcpServerSummary[]> {
    const index = this.servers.findIndex((server) => server.id === serverId);
    if (index < 0) {
      throw new Error(`MCP server 不存在：${serverId}`);
    }
    const next = [...this.servers];
    next[index] = {
      ...next[index]!,
      enabled,
      importRequestedEnabled: false,
    };
    await this.options.saveServers(next);
    this.servers = next;
    if (!enabled) {
      await this.disconnect(serverId);
      this.runtimes.set(serverId, createRuntime(false));
    } else {
      this.runtimes.set(serverId, createRuntime(true));
      await this.ensureConnected(serverId).catch(() => undefined);
    }
    return this.listServers();
  }

  async setServerReadOnlyTrust(
    serverId: string,
    trusted: boolean,
  ): Promise<ExternalMcpServerSummary[]> {
    const index = this.servers.findIndex((server) => server.id === serverId);
    if (index < 0) {
      throw new Error(`MCP server 不存在：${serverId}`);
    }
    const next = [...this.servers];
    next[index] = {
      ...next[index]!,
      trustReadOnlyTools: trusted,
    };
    await this.options.saveServers(next);
    this.servers = next;
    return this.listServers();
  }

  async setServerAutoApprove(
    serverId: string,
    enabled: boolean,
  ): Promise<ExternalMcpServerSummary[]> {
    const index = this.servers.findIndex((server) => server.id === serverId);
    if (index < 0) {
      throw new Error(`MCP server 不存在：${serverId}`);
    }
    const next = [...this.servers];
    next[index] = {
      ...next[index]!,
      autoApproveTools: enabled,
    };
    await this.options.saveServers(next);
    this.servers = next;
    return this.listServers();
  }

  async testServer(serverId: string): Promise<ExternalMcpServerSummary[]> {
    const server = this.servers.find((item) => item.id === serverId);
    if (!server) {
      throw new Error(`MCP server 不存在：${serverId}`);
    }
    if (!server.enabled) {
      throw new Error("请先启用这个 MCP server，再执行连接测试。");
    }
    await this.disconnect(serverId);
    this.runtimes.set(serverId, createRuntime(true));
    await this.ensureConnected(serverId);
    return this.listServers();
  }

  async close(): Promise<void> {
    await Promise.allSettled(this.servers.map((server) => this.disconnect(server.id)));
  }

  private async ensureConnected(serverId: string): Promise<void> {
    const server = this.servers.find((item) => item.id === serverId);
    if (!server?.enabled) {
      throw new Error(`External MCP server is disabled: ${serverId}`);
    }
    const runtime = this.requireRuntime(serverId);
    if (runtime.status === "connected" && runtime.client) {
      return;
    }
    if (runtime.connectPromise) {
      return runtime.connectPromise;
    }
    runtime.status = "connecting";
    runtime.error = undefined;
    runtime.connectPromise = this.connectWithRetry(server, runtime).finally(
      () => {
        runtime.connectPromise = undefined;
      },
    );
    return runtime.connectPromise;
  }

  private async connectWithRetry(
    server: ExternalMcpServerConfig,
    runtime: RuntimeServer,
  ): Promise<void> {
    const maxAttempts =
      server.transport.type === "streamable-http"
        ? STREAMABLE_HTTP_CONNECT_ATTEMPTS
        : 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await this.connect(server, runtime);
        return;
      } catch (error) {
        if (
          attempt >= maxAttempts ||
          !canRetryExternalMcpConnection(error)
        ) {
          throw readableExternalMcpError(error);
        }
        console.warn(
          `[external-mcp] ${server.name} initialize failed (${attempt}/${maxAttempts}); retrying: ${errorMessage(error)}`,
        );
        runtime.status = "connecting";
        runtime.error = undefined;
        await delay(100 * attempt);
      }
    }
  }

  private async connect(
    server: ExternalMcpServerConfig,
    runtime: RuntimeServer,
  ): Promise<void> {
    const client = new Client({
      name: "ai-devtools-assistant-external-mcp",
      version: "0.1.0",
    });
    const transport = createTransport(server);
    runtime.client = client;
    runtime.transport = transport;
    const connectTimeoutMs = server.timeoutMs ?? CONNECT_TIMEOUT_MS;
    try {
      await withDeadline(
        client.connect(transport),
        connectTimeoutMs,
        undefined,
        `MCP server 连接超时：${server.name}`,
      );
      runtime.instructions = normalizeServerInstructions(
        client.getInstructions(),
      );
      const listed = await withDeadline(
        client.listTools(),
        connectTimeoutMs,
        undefined,
        `MCP server 工具列表超时：${server.name}`,
      );
      const disabledTools = new Set(server.disabledTools ?? []);
      const mappedTools = listed.tools
        .filter((tool) => !disabledTools.has(tool.name))
        .slice(0, 200)
        .map((tool) => {
          const publicName = createExternalMcpToolName(server.id, tool.name);
          const annotations = normalizeToolAnnotations(tool.annotations);
          return {
            route: {
              publicName,
              remoteToolName: tool.name,
            },
            tool: {
              name: publicName,
              title: tool.title || tool.name,
              description: `[MCP: ${server.name}] ${tool.description ?? ""}`.trim(),
              externalMcpServerId: server.id,
              externalMcpServerName: server.name,
              externalMcpToolName: tool.name,
              ...(runtime.instructions
                ? {
                    externalMcpServerInstructions: runtime.instructions,
                  }
                : {}),
              ...(annotations ? { annotations } : {}),
              inputSchema: tool.inputSchema as McpAvailableTool["inputSchema"],
              ...(tool.outputSchema
                ? {
                    outputSchema:
                      tool.outputSchema as McpAvailableTool["outputSchema"],
                  }
                : {}),
            } satisfies McpAvailableTool,
          };
        });
      // Replace the server's routes as one synchronous step. During a transient
      // reconnect the previous routes stay usable until the fresh tools/list
      // response is ready, so concurrent calls never observe a false
      // "tool is unavailable" window.
      this.removeToolRoutes(server.id);
      for (const item of mappedTools) {
        this.toolRoutes.set(item.route.publicName, {
          serverId: server.id,
          remoteToolName: item.route.remoteToolName,
        });
      }
      runtime.tools = mappedTools.map((item) => item.tool);
      runtime.status = "connected";
      runtime.error = undefined;
    } catch (error) {
      runtime.status = "error";
      runtime.error = errorMessage(error);
      await client.close().catch(() => undefined);
      runtime.client = undefined;
      runtime.transport = undefined;
      runtime.tools = [];
      runtime.instructions = undefined;
      throw error;
    }
  }

  private async recoverConnection(
    serverId: string,
    failedClient: Client | undefined,
    toolName: string,
    error: unknown,
    signal?: AbortSignal,
  ): Promise<void> {
    const existingRecovery = this.recoveryByServer.get(serverId);
    if (existingRecovery) {
      await withAbort(existingRecovery, signal);
      return;
    }

    const runtime = this.requireRuntime(serverId);
    if (
      failedClient &&
      runtime.status === "connected" &&
      runtime.client &&
      runtime.client !== failedClient
    ) {
      return;
    }

    const recovery = (async () => {
      const currentRuntime = this.requireRuntime(serverId);
      if (
        failedClient &&
        currentRuntime.status === "connected" &&
        currentRuntime.client &&
        currentRuntime.client !== failedClient
      ) {
        return;
      }
      console.warn(
        `[external-mcp] transient failure in ${toolName}; reconnecting before retry: ${errorMessage(error)}`,
      );
      await this.disconnect(serverId, { preserveRoutes: true });
      await this.ensureConnected(serverId);
    })();
    this.recoveryByServer.set(serverId, recovery);
    try {
      await withAbort(recovery, signal);
    } finally {
      if (this.recoveryByServer.get(serverId) === recovery) {
        this.recoveryByServer.delete(serverId);
      }
    }
  }

  private async disconnect(
    serverId: string,
    options: { preserveRoutes?: boolean } = {},
  ): Promise<void> {
    const runtime = this.runtimes.get(serverId);
    if (!runtime) {
      return;
    }
    if (!options.preserveRoutes) {
      this.removeToolRoutes(serverId);
    }
    const client = runtime.client;
    runtime.client = undefined;
    runtime.transport = undefined;
    runtime.tools = [];
    runtime.instructions = undefined;
    runtime.status = "idle";
    runtime.error = undefined;
    if (client) {
      await client.close().catch(() => undefined);
    }
  }

  private removeToolRoutes(serverId: string): void {
    for (const [toolName, route] of this.toolRoutes) {
      if (route.serverId === serverId) {
        this.toolRoutes.delete(toolName);
      }
    }
  }

  private requireRuntime(serverId: string): RuntimeServer {
    const runtime = this.runtimes.get(serverId);
    if (!runtime) {
      throw new Error(`External MCP runtime is missing: ${serverId}`);
    }
    return runtime;
  }
}

function normalizeToolAnnotations(
  value: unknown,
): McpAvailableTool["annotations"] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const annotations: NonNullable<McpAvailableTool["annotations"]> = {};
  for (const key of [
    "readOnlyHint",
    "destructiveHint",
    "idempotentHint",
    "openWorldHint",
  ] as const) {
    if (typeof raw[key] === "boolean") {
      annotations[key] = raw[key];
    }
  }
  return Object.keys(annotations).length > 0 ? annotations : undefined;
}

function createRuntime(enabled: boolean): RuntimeServer {
  return {
    status: enabled ? "idle" : "disabled",
    tools: [],
  };
}

function createTransport(
  server: ExternalMcpServerConfig,
): StdioClientTransport | StreamableHTTPClientTransport {
  if (server.transport.type === "stdio") {
    return new StdioClientTransport({
      command: server.transport.command,
      args: server.transport.args,
      ...(server.transport.cwd ? { cwd: server.transport.cwd } : {}),
      env: {
        ...getDefaultEnvironment(),
        ...(server.transport.env ?? {}),
      },
      stderr: "pipe",
    });
  }
  return new StreamableHTTPClientTransport(new URL(server.transport.url), {
    requestInit: server.transport.headers
      ? { headers: { ...server.transport.headers } }
      : undefined,
  });
}

async function withDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  timeoutMessage: string,
): Promise<T> {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException("Aborted", "AbortError");
  }
  let timeout: NodeJS.Timeout | undefined;
  let onAbort: (() => void) | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    if (signal) {
      onAbort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    if (timeout) clearTimeout(timeout);
    if (signal && onAbort) signal.removeEventListener("abort", onAbort);
  }
}

function boundMcpResult(value: unknown): unknown {
  const normalized = compactDuplicateStructuredContent(
    JSON.parse(JSON.stringify(value ?? null)) as unknown,
  );
  const serialized = JSON.stringify(normalized);
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (bytes <= MAX_RESULT_BYTES) {
    return normalized;
  }
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: `MCP result exceeded the ${MAX_RESULT_BYTES}-byte local limit. Use the server tool's pagination or filtering arguments.`,
      },
    ],
    _meta: { truncated: true, originalBytes: bytes },
  };
}

function compactDuplicateStructuredContent(value: unknown): unknown {
  if (!isRecord(value) || !isRecord(value.structuredContent)) {
    return value;
  }
  if (!Array.isArray(value.content)) {
    return value;
  }
  const content = value.content.filter((entry) => {
    if (
      !isRecord(entry) ||
      entry.type !== "text" ||
      typeof entry.text !== "string"
    ) {
      return true;
    }
    try {
      return !isDeepStrictEqual(
        JSON.parse(entry.text) as unknown,
        value.structuredContent,
      );
    } catch {
      return true;
    }
  });
  return content.length === value.content.length
    ? value
    : { ...value, content };
}

function canRetryExternalMcpConnection(error: unknown): boolean {
  const statusCode = externalMcpHttpStatus(error);
  if (statusCode !== undefined) {
    return (
      statusCode === 400 ||
      statusCode === 408 ||
      statusCode === 425 ||
      statusCode === 429 ||
      statusCode >= 500
    );
  }
  const message = errorMessage(error);
  if (/连接超时|timed out/i.test(message)) {
    return false;
  }
  return /error posting to endpoint|fetch failed|network error|econnreset|econnrefused|socket hang up|connection (?:closed|reset)|transport (?:closed|error)|terminated|unexpected eof/i.test(
    message,
  );
}

function canRetryExternalMcpTool(
  server: ExternalMcpServerConfig,
  tool: McpAvailableTool | undefined,
  error: unknown,
  signal: AbortSignal | undefined,
): boolean {
  if (
    signal?.aborted ||
    (server.trustReadOnlyTools !== true && server.autoApproveTools !== true) ||
    !tool?.annotations?.readOnlyHint ||
    !tool.annotations.idempotentHint ||
    tool.annotations.destructiveHint !== false
  ) {
    return false;
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return false;
  }
  const message = errorMessage(error);
  if (
    /\b(?:401|403|unauthori[sz]ed|forbidden|invalid arguments?|validation)\b/i.test(
      message,
    )
  ) {
    return false;
  }
  return /streamable http error|error posting to endpoint|fetch failed|network error|econnreset|econnrefused|etimedout|timed out|socket hang up|connection (?:closed|reset)|transport (?:closed|error)|terminated|unexpected eof/i.test(
    message,
  );
}

function normalizeServerInstructions(
  value: string | undefined,
): string | undefined {
  if (!value) {
    return undefined;
  }
  const cleaned = value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .trim();
  if (!cleaned) {
    return undefined;
  }
  if (cleaned.length <= MAX_SERVER_INSTRUCTIONS_CHARS) {
    return cleaned;
  }
  return `${cleaned.slice(0, MAX_SERVER_INSTRUCTIONS_CHARS)}\n[server instructions truncated by client]`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readableExternalMcpError(error: unknown): Error {
  if (error instanceof DOMException && error.name === "AbortError") {
    return error;
  }
  const message = errorMessage(error);
  if (error instanceof Error && error.message === message) {
    return error;
  }
  const wrapped = new Error(message);
  if (error instanceof Error) {
    wrapped.name = error.name;
  }
  const statusCode = externalMcpHttpStatus(error);
  if (statusCode !== undefined) {
    (wrapped as Error & { code?: number }).code = statusCode;
  }
  return wrapped;
}

function externalMcpHttpStatus(error: unknown): number | undefined {
  if (!isRecord(error)) {
    return undefined;
  }
  const code = error.code;
  return typeof code === "number" && code >= 100 && code <= 599
    ? code
    : undefined;
}

function safeEndpointLabel(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname}`.slice(0, 160);
  } catch {
    return "Streamable HTTP";
  }
}

function errorMessage(error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const message =
    rawMessage.replace(/[\r\n]+/g, " ").trim() ||
    "Unknown external MCP transport error.";
  const statusCode = externalMcpHttpStatus(error);
  const withStatus =
    statusCode !== undefined && !message.includes(`HTTP ${statusCode}`)
      ? `${message} (HTTP ${statusCode})`
      : message;
  return withStatus.slice(0, 500);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException("Aborted", "AbortError");
  }
}

async function withAbort<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  throwIfAborted(signal);
  if (!signal) {
    return promise;
  }
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () =>
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    if (onAbort) {
      signal.removeEventListener("abort", onAbort);
    }
  }
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  if (!signal) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
