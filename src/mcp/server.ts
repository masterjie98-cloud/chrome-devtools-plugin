import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  formatMcpToolResult,
  parseMcpToolProfile,
  registerProxyMcpTools,
} from "./toolRuntime";
import { DaemonClient } from "./daemonClient";
import {
  ADAPTER_ROUTING_TOOL_INPUT_SCHEMAS,
  ADAPTER_ROUTING_TOOL_NAMES,
  adapterRoutingToolOutputSchema,
  type AdapterRoutingToolName,
} from "./adapterRoutingTools";
import { registerStateResources } from "./stateResourceRegistry";
import {
  COLLABORATION_TOOL_NAMES,
  cancelCollaborationTaskInputSchema,
  cancelCollaborationTaskOutputSchema,
  delegateCollaborationTaskInputSchema,
  delegateCollaborationTaskOutputSchema,
  publishCollaborationItemInputSchema,
  publishCollaborationItemOutputSchema,
  updateCollaborationTaskInputSchema,
  updateCollaborationTaskOutputSchema,
  waitForCollaborationResultInputSchema,
  waitForCollaborationResultOutputSchema,
} from "./collaborationTools";
import {
  createSessionResourceUri,
  RESOURCE_SESSION_ID_PATTERN,
} from "./resourceRouting";
import { registerWorkspaceSourceTool } from "./workspaceTools";

const mcpServer = new McpServer({
  name: "ai-devtools-assistant",
  version: "0.1.0",
});

const daemonClient = new DaemonClient();
const toolProfile = parseMcpToolProfile(
  process.env.AI_DEVTOOLS_MCP_TOOL_PROFILE,
);
let shuttingDown = false;

registerResources(mcpServer);
registerResourceSubscriptions(mcpServer);
registerTools(mcpServer);
registerPrompts(mcpServer);

await mcpServer.connect(new StdioServerTransport());

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}

process.stdin.once("end", () => {
  void shutdown("STDIN_EOF");
});

process.stdin.once("close", () => {
  void shutdown("STDIN_CLOSED");
});

async function shutdown(
  reason: "SIGINT" | "SIGTERM" | "STDIN_EOF" | "STDIN_CLOSED",
): Promise<void> {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.error(`[ai-devtools-mcp] shutting down after ${reason}.`);

  daemonClient.close();
  try {
    await mcpServer.close();
    process.exit(0);
  } catch {
    console.error("[ai-devtools-mcp] failed to close the MCP transport cleanly.");
    process.exit(1);
  }
}

function registerResources(server: McpServer): void {
  registerStateResources(server, daemonClient);

  server.registerResource(
    "artifact",
    new ResourceTemplate("ai-devtools://artifact/{artifactId}", {
      list: undefined,
    }),
    {
      title: "AI DevTools artifact",
      description:
        "Session-bound screenshot or oversized payload stored by the local daemon.",
    },
    async (resourceUri, variables) => {
      const artifactId = variables.artifactId;
      if (typeof artifactId !== "string") {
        return {
          contents: [
            {
              uri: resourceUri.href,
              mimeType: "application/json",
              text: JSON.stringify({ error: "Invalid artifact ID." }),
            },
          ],
        };
      }
      const result = await daemonClient.readArtifact(artifactId);
      if (!result.ok) {
        return {
          contents: [
            {
              uri: resourceUri.href,
              mimeType: "application/json",
              text: JSON.stringify({ error: result.error }),
            },
          ],
        };
      }
      if (
        result.artifact.mimeType === "application/json" ||
        result.artifact.mimeType.startsWith("text/")
      ) {
        return {
          contents: [
            {
              uri: resourceUri.href,
              mimeType: result.artifact.mimeType,
              text: Buffer.from(result.dataBase64, "base64").toString("utf8"),
            },
          ],
        };
      }
      return {
        contents: [
          {
            uri: resourceUri.href,
            mimeType: result.artifact.mimeType,
            blob: result.dataBase64,
          },
        ],
      };
    },
  );
}

function registerResourceSubscriptions(server: McpServer): void {
  const subscriptions = new Set<string>();
  server.server.registerCapabilities({
    resources: {
      subscribe: true,
      listChanged: true,
    },
  });
  server.server.setRequestHandler(SubscribeRequestSchema, async (request) => {
    const uri = requireActivityStreamSubscriptionUri(request.params.uri);
    subscriptions.add(uri);
    return {};
  });
  server.server.setRequestHandler(UnsubscribeRequestSchema, async (request) => {
    subscriptions.delete(request.params.uri);
    return {};
  });
  daemonClient.subscribeActivityUpdates((payload) => {
    const uri = createSessionResourceUri(
      payload.sessionId,
      "activity-stream",
    );
    if (!subscriptions.has(uri)) {
      return;
    }
    void server.server.sendResourceUpdated({ uri }).catch((error) => {
      console.error(
        `[ai-devtools-mcp] failed to send activity resource update: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  });
}

function requireActivityStreamSubscriptionUri(uri: string): string {
  const match =
    /^ai-devtools:\/\/session\/([^/]+)\/activity-stream$/.exec(uri);
  const sessionId = match?.[1];
  if (!sessionId || !RESOURCE_SESSION_ID_PATTERN.test(sessionId)) {
    throw new Error(
      "RESOURCE_URI_INVALID: only listed activity-stream resources support subscription.",
    );
  }
  if (daemonClient.selectedSessionId() !== sessionId) {
    throw new Error(
      "ROLE_FORBIDDEN: activity subscription session does not match this MCP adapter.",
    );
  }
  return uri;
}

function registerTools(server: McpServer): void {
  registerProxyMcpTools(server, daemonClient, { profile: toolProfile });
  registerWorkspaceSourceTool(server);
  registerAdapterRoutingTool(
    server,
    ADAPTER_ROUTING_TOOL_NAMES.LIST_SESSIONS,
    "List Chrome Profile sessions",
    "List known local Chrome Profile sessions and show which Profile this Codex MCP adapter currently targets. This reads daemon routing metadata only.",
  );
  registerAdapterRoutingTool(
    server,
    ADAPTER_ROUTING_TOOL_NAMES.SET_SESSION,
    "Select Chrome Profile session",
    "Bind only this Codex MCP adapter connection to one sessionId returned by browser_list_sessions. This changes routing, not page or browser content.",
  );
  server.registerTool(
    COLLABORATION_TOOL_NAMES.PUBLISH_ITEM,
    {
      title: "Publish AI collaboration context",
      description:
        "Publish one bounded, sanitized finding, task update, page-analysis result, or implementation note to the selected Chrome Profile workspace for the extension AI. This changes local collaboration state only and never modifies the page.",
      inputSchema: publishCollaborationItemInputSchema,
      outputSchema: publishCollaborationItemOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args: Record<string, unknown>) => {
      try {
        return formatMcpToolResult(
          await daemonClient.callTool(
            COLLABORATION_TOOL_NAMES.PUBLISH_ITEM,
            args,
          ),
        );
      } catch (error) {
        return formatMcpToolResult(
          {
            error:
              error instanceof Error
                ? error.message
                : "Failed to publish local collaboration context.",
          },
          true,
        );
      }
    },
  );
  server.registerTool(
    COLLABORATION_TOOL_NAMES.DELEGATE_TASK,
    {
      title: "Delegate a task to the extension Agent",
      description:
        "Create one durable question or task in the selected Chrome Profile. The extension displays it as a Codex/MCP chat message and requires the user to accept it before its Agent runs. taskId is the idempotency key and must never be reused for different work. This grants no browser permission.",
      inputSchema: delegateCollaborationTaskInputSchema,
      outputSchema: delegateCollaborationTaskOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args: Record<string, unknown>, extra) => {
      try {
        return formatMcpToolResult(
          await daemonClient.callTool(
            COLLABORATION_TOOL_NAMES.DELEGATE_TASK,
            args,
            {
              signal: extra.signal,
              idempotencyKey: `mcp:${String(extra.requestId)}`,
            },
          ),
        );
      } catch (error) {
        return formatMcpToolResult(
          {
            error:
              error instanceof Error
                ? error.message
                : "Failed to delegate the local collaboration task.",
          },
          true,
        );
      }
    },
  );
  server.registerTool(
    COLLABORATION_TOOL_NAMES.WAIT_FOR_TASK_RESULT,
    {
      title: "Wait for an extension Agent result",
      description:
        "Wait for one durable delegated-task result in the selected Chrome Profile. A stored terminal result returns immediately. Cancellation or adapter disconnect stops only this wait and never restarts or replays the extension task.",
      inputSchema: waitForCollaborationResultInputSchema,
      outputSchema: waitForCollaborationResultOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args: Record<string, unknown>, extra) => {
      try {
        return formatMcpToolResult(
          await daemonClient.callTool(
            COLLABORATION_TOOL_NAMES.WAIT_FOR_TASK_RESULT,
            args,
            { signal: extra.signal },
          ),
        );
      } catch (error) {
        return formatMcpToolResult(
          {
            error:
              error instanceof Error
                ? error.message
                : "Failed while waiting for the local collaboration task.",
          },
          true,
        );
      }
    },
  );
  server.registerTool(
    COLLABORATION_TOOL_NAMES.UPDATE_TASK,
    {
      title: "Update a delegated collaboration task",
      description:
        "Append one idempotent progress, clarification, requirement, or evidence event to a durable delegated task. eventId is immutable.",
      inputSchema: updateCollaborationTaskInputSchema,
      outputSchema: updateCollaborationTaskOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args: Record<string, unknown>, extra) => {
      try {
        return formatMcpToolResult(
          await daemonClient.callTool(
            COLLABORATION_TOOL_NAMES.UPDATE_TASK,
            args,
            {
              signal: extra.signal,
              idempotencyKey: `mcp:${String(extra.requestId)}`,
            },
          ),
        );
      } catch (error) {
        return formatMcpToolResult(
          {
            error:
              error instanceof Error
                ? error.message
                : "Failed to update the collaboration task.",
          },
          true,
        );
      }
    },
  );
  server.registerTool(
    COLLABORATION_TOOL_NAMES.CANCEL_TASK,
    {
      title: "Cancel a delegated collaboration task",
      description:
        "Cancel one non-terminal delegated task without replaying or undoing browser writes.",
      inputSchema: cancelCollaborationTaskInputSchema,
      outputSchema: cancelCollaborationTaskOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args: Record<string, unknown>, extra) => {
      try {
        return formatMcpToolResult(
          await daemonClient.callTool(
            COLLABORATION_TOOL_NAMES.CANCEL_TASK,
            args,
            {
              signal: extra.signal,
              idempotencyKey: `mcp:${String(extra.requestId)}`,
            },
          ),
        );
      } catch (error) {
        return formatMcpToolResult(
          {
            error:
              error instanceof Error
                ? error.message
                : "Failed to cancel the collaboration task.",
          },
          true,
        );
      }
    },
  );
}

function registerAdapterRoutingTool(
  server: McpServer,
  toolName: AdapterRoutingToolName,
  title: string,
  description: string,
): void {
  server.registerTool(
    toolName,
    {
      title,
      description,
      inputSchema: ADAPTER_ROUTING_TOOL_INPUT_SCHEMAS[toolName],
      outputSchema: adapterRoutingToolOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args: Record<string, unknown>) => {
      try {
        const data = await daemonClient.callTool(
          toolName,
          args as Record<string, unknown>,
        );
        return formatMcpToolResult(data);
      } catch (error) {
        return formatMcpToolResult(
          {
            error:
              error instanceof Error
                ? error.message
                : "Adapter session routing failed.",
          },
          true,
        );
      }
    },
  );
}

function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "analyze-selected-element-with-source",
    {
      title: "Analyze selected element with source",
      description:
        "Use selected DOM details plus local project source to analyze a UI issue.",
    },
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: "Call browser_list_sessions and browser_set_session for the intended Chrome Profile. From resources/list, read the selected-element resource URI for that selected session and current target, inspect the relevant local source files, and explain the likely UI issue and fix.",
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "analyze-last-plugin-message-with-source",
    {
      title: "Analyze last plugin message with source",
      description:
        "Use the latest plugin chat message and local source to continue debugging.",
    },
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: "Call browser_list_sessions and browser_set_session for the intended Chrome Profile. Call the approval-gated browser_get_last_plugin_message tool, then read the context-digest resource URI listed for that selected session and current target. Inspect local source files for the most relevant fix.",
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "debug-current-page-ui",
    {
      title: "Debug current page UI",
      description:
        "Use plugin page context, selected element, and local source to debug the active page UI.",
    },
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: "Call browser_list_sessions and browser_set_session for the intended Chrome Profile. From resources/list, read the active-tab, selected-element, and context-digest resource URIs for that selected session and current target. If an image is necessary, call the approval-gated browser_take_screenshot tool. Combine the approved browser evidence with local source inspection and propose a concrete fix.",
          },
        },
      ],
    }),
  );
}
