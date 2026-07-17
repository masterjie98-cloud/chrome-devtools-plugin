import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DaemonStateResourceKey } from "../shared/wsProtocol";
import { MCP_DIRECT_STATE_RESOURCES } from "../shared/mcpResources";
import { ADAPTER_ROUTING_TOOL_NAMES } from "./adapterRoutingTools";
import {
  RESOURCE_SESSION_ID_PATTERN,
  RESOURCE_TARGET_KEY_PATTERN,
  assertResourceSessionSelection,
  assertTargetResourcePayload,
  createSessionResourceUri,
  createTargetResourceUri,
  parseResourceSessionSummaries,
  withResourceBinding,
  type ResourceSessionSummary,
} from "./resourceRouting";

export interface StateResourceDaemonClient {
  callTool(toolName: string, args: Record<string, unknown>): Promise<unknown>;
  readState(key: DaemonStateResourceKey, sessionId?: string): Promise<unknown>;
  selectedSessionId(): string | undefined;
}

const MAX_DISCOVERABLE_RESOURCE_SESSIONS = 32;
const RESOURCE_DISCOVERY_CACHE_MS = 250;

export function registerStateResources(
  server: McpServer,
  daemonClient: StateResourceDaemonClient,
): void {
  const listSessions = createResourceSessionLister(daemonClient);
  for (const { name, stateKey, scope } of MCP_DIRECT_STATE_RESOURCES) {
    const uriTemplate =
      scope === "target"
        ? `ai-devtools://session/{sessionId}/target/{targetKey}/${name}`
        : `ai-devtools://session/{sessionId}/${name}`;
    server.registerResource(
      name,
      new ResourceTemplate(uriTemplate, {
        list: async () => ({
          resources: (await listSessions()).flatMap(
            (session) => {
              const uri =
                scope === "target"
                  ? session.resourceTargetKey
                    ? createTargetResourceUri(
                        session.sessionId,
                        session.resourceTargetKey,
                        name,
                      )
                    : null
                  : createSessionResourceUri(session.sessionId, name);
              return uri
                ? [
                    {
                      uri,
                      name: `${name}:${session.sessionId}`,
                      title: `${name} (${session.sessionId})`,
                      description: `Session-bound AI DevTools state: ${stateKey}`,
                      mimeType: "application/json",
                    },
                  ]
                : [];
            },
          ),
        }),
        complete: {
          sessionId: async (value: string) => {
            const sessions = await listSessions();
            return sessions
              .map((session) => session.sessionId)
              .filter((sessionId) => sessionId.startsWith(value));
          },
          ...(scope === "target"
            ? {
                targetKey: async (value: string, context?: {
                  arguments?: Record<string, string>;
                }) =>
                  (await listSessions())
                    .filter(
                      (session) =>
                        (!context?.arguments?.sessionId ||
                          session.sessionId === context.arguments.sessionId) &&
                        Boolean(session.resourceTargetKey?.startsWith(value)),
                    )
                    .flatMap((session) =>
                      session.resourceTargetKey
                        ? [session.resourceTargetKey]
                        : [],
                    ),
              }
            : {}),
        },
      }),
      {
        title: name,
        description:
          scope === "target"
            ? `Exact session/tab/frame/document-bound AI DevTools state: ${stateKey}`
            : `Session-bound AI DevTools state: ${stateKey}`,
        mimeType: "application/json",
      },
      async (resourceUri, variables) => {
        try {
          const sessionId = requireResourceVariable(
            variables.sessionId,
            "sessionId",
            RESOURCE_SESSION_ID_PATTERN,
          );
          assertResourceSessionSelection(
            daemonClient.selectedSessionId(),
            sessionId,
          );
          const data = await daemonClient.readState(stateKey, sessionId);
          let targetKey: string | undefined;
          if (scope === "target") {
            targetKey = requireResourceVariable(
              variables.targetKey,
              "targetKey",
              RESOURCE_TARGET_KEY_PATTERN,
            );
            assertTargetResourcePayload(stateKey, data, targetKey);
          }
          const boundData = withResourceBinding(data, {
            scope,
            sessionId,
            ...(targetKey ? { targetKey } : {}),
          });
          return {
            contents: [
              {
                uri: resourceUri.href,
                mimeType: "application/json",
                text: JSON.stringify(boundData, null, 2),
              },
            ],
          };
        } catch (error) {
          return {
            contents: [
              {
                uri: resourceUri.href,
                mimeType: "application/json",
                text: JSON.stringify(
                  {
                    error:
                      error instanceof Error
                        ? error.message
                        : "Failed to read local daemon state.",
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }
      },
    );
  }
}

function createResourceSessionLister(
  daemonClient: StateResourceDaemonClient,
): () => Promise<ResourceSessionSummary[]> {
  let cached:
    | { expiresAt: number; value: Promise<ResourceSessionSummary[]> }
    | undefined;
  return async () => {
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }
    const value = daemonClient
      .callTool(ADAPTER_ROUTING_TOOL_NAMES.LIST_SESSIONS, {})
      .then((data) =>
        parseResourceSessionSummaries(data).slice(
          0,
          MAX_DISCOVERABLE_RESOURCE_SESSIONS,
        ),
      )
      .catch(() => []);
    cached = { expiresAt: now + RESOURCE_DISCOVERY_CACHE_MS, value };
    return value;
  };
}

function requireResourceVariable(
  value: string | string[] | undefined,
  name: string,
  pattern: RegExp,
): string {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(
      `RESOURCE_URI_INVALID: ${name} must come from resources/list or resource template completion.`,
    );
  }
  return value;
}
