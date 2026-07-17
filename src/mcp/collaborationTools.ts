import { z } from "zod";
import {
  COLLABORATION_ITEM_KINDS,
  type CollaborationItemInput,
} from "../shared/collaborationWorkspace";
import {
  COLLABORATION_TOOL_NAMES,
  DELEGATED_TASK_ID_PATTERN,
  DELEGATED_TASK_PHASES,
  DELEGATED_TASK_REQUEST_TYPES,
  DELEGATED_TASK_RESULT_STATUSES,
  isDelegatedTaskConversationId,
} from "../shared/collaborationTasks";
import type { McpAvailableTool } from "../shared/wsProtocol";

export { COLLABORATION_TOOL_NAMES } from "../shared/collaborationTasks";

export type CollaborationToolName =
  (typeof COLLABORATION_TOOL_NAMES)[keyof typeof COLLABORATION_TOOL_NAMES];

export type PublicCollaborationToolName =
  | typeof COLLABORATION_TOOL_NAMES.PUBLISH_ITEM
  | typeof COLLABORATION_TOOL_NAMES.DELEGATE_TASK
  | typeof COLLABORATION_TOOL_NAMES.WAIT_FOR_TASK_RESULT;

const collaborationItemOutputSchema = z
  .object({
    id: z.string(),
    kind: z.enum(COLLABORATION_ITEM_KINDS),
    title: z.string(),
    summary: z.string(),
    revision: z.number().int().positive(),
    source: z.object({
      actor: z.enum(["extension_agent", "mcp_agent"]),
      clientId: z.string().optional(),
    }),
    target: z.unknown().optional(),
    parentId: z.string().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .passthrough();

export const publishCollaborationItemInputSchema = z
  .object({
    id: z.string().regex(/^ctx_[A-Za-z0-9_-]{8,200}$/).optional(),
    kind: z.enum(COLLABORATION_ITEM_KINDS),
    title: z.string().trim().min(1).max(240),
    summary: z.string().trim().min(1).max(2000),
    content: z.unknown().optional(),
    tags: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
    sensitivity: z.enum(["safe", "page_content", "sensitive"]).optional(),
    status: z.enum(["active", "resolved", "superseded"]).optional(),
    scope: z.enum(["session", "target"]).default("session"),
    parentId: z.string().regex(/^ctx_[A-Za-z0-9_-]{8,200}$/).optional(),
    expectedRevision: z.number().int().positive().optional(),
    expiresAt: z.string().datetime().optional(),
  })
  .strict();

export const publishCollaborationItemOutputSchema = z
  .object({
    workspaceRevision: z.number().int().nonnegative(),
    item: collaborationItemOutputSchema,
  })
  .strict();

export const delegateCollaborationTaskInputSchema = z
  .object({
    taskId: z.string().regex(DELEGATED_TASK_ID_PATTERN),
    requestType: z.enum(DELEGATED_TASK_REQUEST_TYPES).default("task"),
    title: z.string().trim().min(1).max(240),
    instruction: z.string().trim().min(1).max(4000),
    acceptanceCriteria: z
      .array(z.string().trim().min(1).max(800))
      .max(12)
      .default([]),
    scope: z.enum(["session", "target"]).default("target"),
    sensitivity: z.enum(["safe", "page_content"]).default("page_content"),
    expiresAt: z.string().datetime().optional(),
  })
  .strict();

export const delegateCollaborationTaskOutputSchema = z
  .object({
    taskId: z.string().regex(DELEGATED_TASK_ID_PATTERN),
    state: z.enum(DELEGATED_TASK_PHASES),
    deduplicated: z.boolean(),
    workspaceRevision: z.number().int().nonnegative(),
    item: collaborationItemOutputSchema,
    resultItem: collaborationItemOutputSchema.optional(),
  })
  .strict();

export const waitForCollaborationResultInputSchema = z
  .object({
    taskId: z.string().regex(DELEGATED_TASK_ID_PATTERN),
  })
  .strict();

export const waitForCollaborationResultOutputSchema = z
  .object({
    taskId: z.string().regex(DELEGATED_TASK_ID_PATTERN),
    status: z.enum(DELEGATED_TASK_RESULT_STATUSES),
    workspaceRevision: z.number().int().nonnegative(),
    requestItem: collaborationItemOutputSchema,
    resultItem: collaborationItemOutputSchema,
  })
  .strict();

const delegatedTaskConversationIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine(isDelegatedTaskConversationId, "Invalid plugin conversation ID.");

export const claimCollaborationTaskInputSchema = z
  .object({
    taskId: z.string().regex(DELEGATED_TASK_ID_PATTERN),
    resume: z.boolean().default(false),
    conversationId: delegatedTaskConversationIdSchema,
  })
  .strict();

export const claimCollaborationTaskOutputSchema = z
  .object({
    taskId: z.string().regex(DELEGATED_TASK_ID_PATTERN),
    claimed: z.boolean(),
    resumed: z.boolean(),
    attempt: z.number().int().positive(),
    workspaceRevision: z.number().int().nonnegative(),
    claimItem: collaborationItemOutputSchema,
  })
  .strict();

export const completeCollaborationTaskInputSchema = z
  .object({
    taskId: z.string().regex(DELEGATED_TASK_ID_PATTERN),
    status: z.enum(DELEGATED_TASK_RESULT_STATUSES),
    summary: z.string().trim().min(1).max(2000),
    output: z.unknown().optional(),
    agentSessionId: z.string().trim().min(1).max(200).optional(),
    conversationId: delegatedTaskConversationIdSchema.optional(),
  })
  .strict();

export const completeCollaborationTaskOutputSchema = z
  .object({
    taskId: z.string().regex(DELEGATED_TASK_ID_PATTERN),
    status: z.enum(DELEGATED_TASK_RESULT_STATUSES),
    deduplicated: z.boolean(),
    workspaceRevision: z.number().int().nonnegative(),
    resultItem: collaborationItemOutputSchema,
  })
  .strict();

const publishTool: McpAvailableTool = {
  name: COLLABORATION_TOOL_NAMES.PUBLISH_ITEM,
  title: "Publish AI collaboration context",
  description:
    "Publish one bounded, sanitized context item to the selected Chrome Profile workspace. Use browser_delegate_collaboration_task instead when the extension Agent should explicitly accept and run work.",
  inputSchema: toJsonSchema(publishCollaborationItemInputSchema, "inputSchema"),
  outputSchema: toJsonSchema(
    publishCollaborationItemOutputSchema,
    "outputSchema",
  ),
};

const delegateTaskTool: McpAvailableTool = {
  name: COLLABORATION_TOOL_NAMES.DELEGATE_TASK,
  title: "Delegate a task to the extension Agent",
  description:
    "Create one durable question or task in the selected Chrome Profile inbox. It does not enter a chat or run until the user accepts it; acceptance binds it to the active plugin conversation. taskId is the idempotency key: retry with the same content to recover, never reuse it for different work. This tool grants no browser permission.",
  inputSchema: toJsonSchema(delegateCollaborationTaskInputSchema, "inputSchema"),
  outputSchema: toJsonSchema(
    delegateCollaborationTaskOutputSchema,
    "outputSchema",
  ),
};

const waitForTaskTool: McpAvailableTool = {
  name: COLLABORATION_TOOL_NAMES.WAIT_FOR_TASK_RESULT,
  title: "Wait for an extension Agent result",
  description:
    "Wait without a daemon deadline for the selected Profile's durable delegated task result. Returns immediately if a terminal result already exists. MCP cancellation or adapter disconnect only cancels this waiter; it never cancels, restarts, or replays the extension task.",
  inputSchema: toJsonSchema(
    waitForCollaborationResultInputSchema,
    "inputSchema",
  ),
  outputSchema: toJsonSchema(
    waitForCollaborationResultOutputSchema,
    "outputSchema",
  ),
};

export const SIDEPANEL_COLLABORATION_AVAILABLE_TOOLS: readonly McpAvailableTool[] =
  [publishTool] as const;

export const MCP_COLLABORATION_AVAILABLE_TOOLS: readonly McpAvailableTool[] = [
  publishTool,
  delegateTaskTool,
  waitForTaskTool,
] as const;

// Compatibility alias for tests and callers that need the full external MCP
// collaboration surface.
export const COLLABORATION_AVAILABLE_TOOLS =
  MCP_COLLABORATION_AVAILABLE_TOOLS;

export function isCollaborationToolName(
  value: string,
): value is CollaborationToolName {
  return Object.values(COLLABORATION_TOOL_NAMES).includes(
    value as CollaborationToolName,
  );
}

export function parsePublishCollaborationItemArgs(
  args: Record<string, unknown>,
): CollaborationItemInput & { scope: "session" | "target" } {
  const parsed = parseToolArgs(
    COLLABORATION_TOOL_NAMES.PUBLISH_ITEM,
    publishCollaborationItemInputSchema,
    args,
  );
  const { scope, ...item } = parsed;
  return {
    ...item,
    visibility: "shared",
    scope,
  };
}

export function parseDelegateCollaborationTaskArgs(
  args: Record<string, unknown>,
): z.infer<typeof delegateCollaborationTaskInputSchema> {
  return parseToolArgs(
    COLLABORATION_TOOL_NAMES.DELEGATE_TASK,
    delegateCollaborationTaskInputSchema,
    args,
  );
}

export function parseWaitForCollaborationResultArgs(
  args: Record<string, unknown>,
): z.infer<typeof waitForCollaborationResultInputSchema> {
  return parseToolArgs(
    COLLABORATION_TOOL_NAMES.WAIT_FOR_TASK_RESULT,
    waitForCollaborationResultInputSchema,
    args,
  );
}

export function parseClaimCollaborationTaskArgs(
  args: Record<string, unknown>,
): z.infer<typeof claimCollaborationTaskInputSchema> {
  return parseToolArgs(
    COLLABORATION_TOOL_NAMES.CLAIM_TASK,
    claimCollaborationTaskInputSchema,
    args,
  );
}

export function parseCompleteCollaborationTaskArgs(
  args: Record<string, unknown>,
): z.infer<typeof completeCollaborationTaskInputSchema> {
  return parseToolArgs(
    COLLABORATION_TOOL_NAMES.COMPLETE_TASK,
    completeCollaborationTaskInputSchema,
    args,
  );
}

function parseToolArgs<TSchema extends z.ZodTypeAny>(
  toolName: string,
  schema: TSchema,
  args: Record<string, unknown>,
): z.infer<TSchema> {
  const parsed = schema.safeParse(args);
  if (parsed.success) {
    return parsed.data;
  }
  const detail = parsed.error.issues.map((issue) => issue.message).join("; ");
  throw new Error(`${toolName} arguments invalid: ${detail}`);
}

function toJsonSchema(
  schema: z.ZodTypeAny,
  _field: "inputSchema" | "outputSchema",
): NonNullable<McpAvailableTool["inputSchema"]> {
  return z.toJSONSchema(schema, {
    unrepresentable: "any",
  }) as NonNullable<McpAvailableTool["inputSchema"]>;
}
