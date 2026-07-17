import { z } from "zod";
import type { McpAvailableTool } from "../shared/wsProtocol";

export const ADAPTER_ROUTING_TOOL_NAMES = {
  LIST_SESSIONS: "browser_list_sessions",
  SET_SESSION: "browser_set_session",
} as const;

export type AdapterRoutingToolName =
  (typeof ADAPTER_ROUTING_TOOL_NAMES)[keyof typeof ADAPTER_ROUTING_TOOL_NAMES];

const noArgSchema = z.object({}).strict();
const setSessionSchema = z
  .object({
    sessionId: z.string().trim().min(1).max(200),
  })
  .strict();

export const ADAPTER_ROUTING_TOOL_INPUT_SCHEMAS = {
  [ADAPTER_ROUTING_TOOL_NAMES.LIST_SESSIONS]: noArgSchema,
  [ADAPTER_ROUTING_TOOL_NAMES.SET_SESSION]: setSessionSchema,
} as const;

const browserSessionSummarySchema = z
  .object({
    sessionId: z.string().max(200),
    browserConnected: z.boolean(),
    uiConnected: z.boolean(),
    selected: z.boolean(),
    activeTarget: z.unknown().nullable(),
    resourceTargetKey: z
      .string()
      .regex(/^t1_[a-f0-9]{32}$/)
      .nullable(),
    lastSeenAt: z.string().max(64),
    stateUpdatedAt: z.string().max(64),
    revision: z.number().int().nonnegative(),
  })
  .passthrough();

export const adapterRoutingToolOutputSchema = z
  .object({
    selectionMode: z.enum(["explicit", "active_fallback"]),
    selectedSessionId: z.string().max(200).nullable(),
    sessions: z
      .array(
        z.union([
          browserSessionSummarySchema,
          z.string().regex(/^\[\d+ additional entries omitted\]$/),
        ]),
      )
      .max(201),
  })
  .passthrough();

const adapterRoutingToolOutputJsonSchema = z.toJSONSchema(
  adapterRoutingToolOutputSchema,
  { unrepresentable: "any" },
) as McpAvailableTool["outputSchema"];

export const ADAPTER_ROUTING_AVAILABLE_TOOLS: readonly McpAvailableTool[] = [
  {
    name: ADAPTER_ROUTING_TOOL_NAMES.LIST_SESSIONS,
    title: "List Chrome Profile sessions",
    description:
      "List known local Chrome Profile sessions and show which Profile this MCP adapter currently targets.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    outputSchema: adapterRoutingToolOutputJsonSchema,
  },
  {
    name: ADAPTER_ROUTING_TOOL_NAMES.SET_SESSION,
    title: "Select Chrome Profile session",
    description:
      "Bind only this MCP adapter connection to one sessionId returned by browser_list_sessions.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description: "Chrome Profile session ID returned by browser_list_sessions.",
        },
      },
      required: ["sessionId"],
      additionalProperties: false,
    },
    outputSchema: adapterRoutingToolOutputJsonSchema,
  },
] as const;

export function isAdapterRoutingToolName(
  value: string,
): value is AdapterRoutingToolName {
  return (
    value === ADAPTER_ROUTING_TOOL_NAMES.LIST_SESSIONS ||
    value === ADAPTER_ROUTING_TOOL_NAMES.SET_SESSION
  );
}

export function parseAdapterRoutingToolArgs(
  toolName: AdapterRoutingToolName,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const parsed = ADAPTER_ROUTING_TOOL_INPUT_SCHEMAS[toolName].safeParse(args);
  if (parsed.success) {
    return parsed.data;
  }
  const detail = parsed.error.issues.map((issue) => issue.message).join("; ");
  throw new Error(`${toolName} arguments invalid: ${detail}`);
}
