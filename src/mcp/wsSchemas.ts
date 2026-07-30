import { z } from "zod";
import {
  DAEMON_STATE_RESOURCE_KEYS,
  WS_COMMANDS,
} from "../shared/wsProtocol";
import {
  COLLABORATION_ACTORS,
  COLLABORATION_ITEM_KINDS,
  COLLABORATION_WORKSPACE_VERSION,
  MAX_COLLABORATION_ITEMS,
} from "../shared/collaborationWorkspace";
import {
  AGENT_TASK_PHASES,
  AGENT_TASK_STATE_VERSION,
} from "../shared/agentTaskState";

const rectSchema = z.object({
  x: z.number(),
  y: z.number(),
  top: z.number(),
  right: z.number(),
  bottom: z.number(),
  left: z.number(),
  width: z.number(),
  height: z.number(),
});

const selectedElementSchema = z.object({
  selector: z.string(),
  tagName: z.string(),
  id: z.string().optional(),
  className: z.string().optional(),
  text: z.string().optional(),
  outerHTML: z.string().max(9000),
  attributes: z.record(z.string(), z.string()),
  computedStyle: z.record(z.string(), z.string()),
  rect: rectSchema,
});

const activeTabSchema = z.object({
  url: z.string(),
  title: z.string(),
  targetId: z.string().optional(),
  tabId: z.number().int().optional(),
  windowId: z.number().int().optional(),
  frameId: z.number().int().optional(),
  documentId: z.string().optional(),
  navigationId: z.string().optional(),
  revision: z.number().int().nonnegative().optional(),
});

const semanticSnapshotNodeSchema = z.object({
  ref: z.string().regex(/^s\d{1,6}$/),
  targetRef: z.string().regex(/^sr1_[a-f0-9]{8}_s\d{1,6}$/),
  role: z.string().max(80),
  name: z.string().max(240),
  selector: z.string().max(400),
  tagName: z.string().max(60),
  description: z.string().max(300).optional(),
  href: z.string().max(1200).optional(),
  value: z.string().max(4000).optional(),
  selectedValues: z.array(z.string().max(4000)).max(50).optional(),
  disabled: z.boolean().optional(),
  checked: z.union([z.boolean(), z.literal("mixed")]).optional(),
  pressed: z.union([z.boolean(), z.literal("mixed")]).optional(),
  expanded: z.boolean().optional(),
  selected: z.boolean().optional(),
  required: z.boolean().optional(),
  readOnly: z.boolean().optional(),
  focused: z.boolean().optional(),
  level: z.number().int().positive().optional(),
  bounds: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number().nonnegative(),
    height: z.number().nonnegative(),
  }),
});

const semanticSnapshotSchema = z.object({
  version: z.literal("semantic-snapshot-v1"),
  fingerprint: z.string().regex(/^[a-f0-9]{8}$/),
  nodes: z.array(semanticSnapshotNodeSchema).max(100),
  pagination: z.object({
    offset: z.number().int().nonnegative(),
    limit: z.number().int().min(1).max(100),
    returnedCount: z.number().int().nonnegative(),
    collectedCount: z.number().int().nonnegative(),
    totalKnown: z.boolean(),
    hasMore: z.boolean(),
    nextCursor: z.string().regex(/^ss1_[a-f0-9]{8}_\d{1,6}$/).optional(),
  }),
  stats: z.object({
    sourceTruncated: z.boolean(),
    outputChars: z.number().int().nonnegative(),
  }),
});

const pageSnapshotProvenanceSchema = z.object({
  source: z.literal("chrome-content-script"),
  observedAt: z.string().max(80),
  target: z.object({
    url: z.string().max(1200),
    title: z.string().max(300),
    targetId: z.string().max(160),
    tabId: z.number().int(),
    windowId: z.number().int().optional(),
    frameId: z.number().int(),
    documentId: z.string().max(300).optional(),
    navigationId: z.string().max(300),
    revision: z.number().int().nonnegative(),
  }),
});

const pageContextSchema = z.object({
  url: z.string(),
  title: z.string(),
  origin: z.string(),
  capturedAt: z.string(),
  visibleText: z.string(),
  domSummary: z.array(z.unknown()),
  nodeCount: z.number(),
  truncated: z.boolean(),
  mode: z.enum(["interactive", "outline", "full"]).optional(),
  sourceVisited: z.number().int().nonnegative().optional(),
  sourceLimit: z.number().int().min(100).max(10000).optional(),
  domRevision: z.number().int().nonnegative().optional(),
  delta: z
    .object({
      fromRevision: z.number().int().nonnegative(),
      toRevision: z.number().int().nonnegative(),
      available: z.boolean(),
      added: z.number().int().nonnegative(),
      removed: z.number().int().nonnegative(),
      attributes: z.number().int().nonnegative(),
      characterData: z.number().int().nonnegative(),
      truncated: z.boolean(),
    })
    .strict()
    .optional(),
  semanticSnapshot: semanticSnapshotSchema.optional(),
  provenance: pageSnapshotProvenanceSchema.optional(),
});

const baseMessageSchema = z.object({
  requestId: z.string().min(1).max(200),
  sentAt: z.string(),
  deadlineAt: z.string().optional(),
  idempotencyKey: z.string().min(1).max(200).optional(),
});

const browserToolCallSchema = z.object({
  id: z.string().min(1),
  toolName: z.string().min(1),
  args: z.record(z.string(), z.unknown()),
});

const executionTargetSchema = z.object({
  targetId: z.string().optional(),
  tabId: z.number().int().optional(),
  windowId: z.number().int().optional(),
  frameId: z.number().int().optional(),
  documentId: z.string().optional(),
  navigationId: z.string().optional(),
  revision: z.number().int().nonnegative().optional(),
});

const executionGrantSchema = z.object({
  claims: z.object({
    version: z.literal(1),
    grantId: z.string().min(1).max(200),
    browserRequestId: z.string().min(1).max(200),
    requesterRequestId: z.string().min(1).max(200),
    requesterConnectionId: z.string().min(1).max(200),
    sessionId: z.string().min(1).max(300),
    toolName: z.string().min(1).max(200),
    argumentsSha256: z.string().regex(/^[a-f0-9]{64}$/),
    approvalRequired: z.boolean(),
    approvalId: z.string().min(1).max(200).optional(),
    target: executionTargetSchema,
    issuedAt: z.string(),
    expiresAt: z.string(),
  }),
  signature: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});

const mcpToolCallSchema = z.object({
  toolName: z.string().min(1),
  args: z.record(z.string(), z.unknown()),
});

const taskContextSchema = z
  .object({
    taskId: z.string().min(1).max(200),
    conversationId: z.string().min(1).max(200).optional(),
    target: z
      .object({
        tabId: z.number().int().nonnegative(),
        targetId: z.string().max(200).optional(),
      })
      .strict()
      .optional(),
    egressDestinations: z.array(z.string().min(1).max(500)).max(10),
  })
  .strict();

const agentSessionToolCallSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()),
});

const agentSessionToolResultSchema = z.object({
  toolCallId: z.string().min(1),
  name: z.string().min(1),
  content: z.string(),
});

const agentSessionEventSchema = z.object({
  id: z.string().min(1),
  type: z.enum([
    "started",
    "context",
    "tool_calls",
    "tool_results",
    "completed",
    "blocked",
    "failed",
    "cancelled",
  ]),
  createdAt: z.string(),
  summary: z.string(),
  data: z
    .object({
      contextReadError: z.string().optional(),
      toolCalls: z.array(agentSessionToolCallSchema).optional(),
      toolResults: z.array(agentSessionToolResultSchema).optional(),
    })
    .optional(),
});

const agentTaskStateSchema = z
  .object({
    version: z.literal(AGENT_TASK_STATE_VERSION),
    revision: z.number().int().positive(),
    objective: z.string().min(1).max(4000),
    phase: z.enum(AGENT_TASK_PHASES),
    successCriteria: z.array(z.string().min(1).max(800)).max(20),
    observations: z.array(z.string().min(1).max(1200)).max(20),
    plannedActions: z.array(z.string().min(1).max(800)).max(20),
    activeAction: z
      .object({
        toolNames: z.array(z.string().min(1).max(160)).max(20),
        expectedOutcome: z.string().min(1).max(800),
      })
      .strict()
      .optional(),
    verification: z
      .object({
        required: z.boolean(),
        evidence: z.array(z.string().min(1).max(800)).max(20),
        summary: z.string().min(1).max(1200).optional(),
      })
      .strict(),
    blockers: z.array(z.string().min(1).max(1200)).max(20),
    updatedAt: z.string().max(64),
  })
  .strict();

const agentSessionSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["running", "completed", "blocked", "failed", "cancelled"]),
  input: z.string(),
  startedAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().optional(),
  finalContent: z.string().optional(),
  executionBinding: z
    .object({
      taskId: z.string().min(1).max(200),
      conversationId: z.string().min(1).max(200),
      target: z
        .object({
          tabId: z.number().int().nonnegative(),
          windowId: z.number().int().nonnegative().optional(),
          targetId: z.string().max(200).optional(),
          title: z.string().max(500).optional(),
          url: z.string().max(1200).optional(),
        })
        .strict(),
    })
    .strict()
    .optional(),
  taskState: agentTaskStateSchema,
  events: z.array(agentSessionEventSchema),
});

const collaborationTargetSchema = z
  .object({
    targetId: z.string().max(200).optional(),
    tabId: z.number().int().nonnegative().optional(),
    windowId: z.number().int().nonnegative().optional(),
    frameId: z.number().int().nonnegative().optional(),
    documentId: z.string().max(300).optional(),
    navigationId: z.string().max(300).optional(),
    revision: z.number().int().nonnegative().optional(),
    url: z.string().max(1200).optional(),
  })
  .strict();

const collaborationItemInputSchema = z
  .object({
    id: z.string().regex(/^ctx_[A-Za-z0-9_-]{8,200}$/).optional(),
    kind: z.enum(COLLABORATION_ITEM_KINDS),
    title: z.string().min(1).max(240),
    summary: z.string().min(1).max(2000),
    content: z.unknown().optional(),
    tags: z.array(z.string().min(1).max(80)).max(20).optional(),
    visibility: z.enum(["shared", "private"]).optional(),
    sensitivity: z.enum(["safe", "page_content", "sensitive"]).optional(),
    status: z.enum(["active", "resolved", "superseded"]).optional(),
    target: collaborationTargetSchema.optional(),
    parentId: z.string().regex(/^ctx_[A-Za-z0-9_-]{8,200}$/).optional(),
    expectedRevision: z.number().int().positive().optional(),
    expiresAt: z.string().max(64).optional(),
  })
  .strict();

const collaborationItemSchema = collaborationItemInputSchema
  .omit({ expectedRevision: true })
  .extend({
    id: z.string().regex(/^ctx_[A-Za-z0-9_-]{8,200}$/),
    tags: z.array(z.string().min(1).max(80)).max(20),
    visibility: z.enum(["shared", "private"]),
    sensitivity: z.enum(["safe", "page_content", "sensitive"]),
    status: z.enum(["active", "resolved", "superseded"]),
    source: z
      .object({
        actor: z.enum(COLLABORATION_ACTORS),
        clientId: z.string().max(200).optional(),
      })
      .strict(),
    revision: z.number().int().positive(),
    createdAt: z.string().max(64),
    updatedAt: z.string().max(64),
  })
  .strict();

const collaborationWorkspaceSchema = z
  .object({
    version: z.literal(COLLABORATION_WORKSPACE_VERSION),
    revision: z.number().int().nonnegative(),
    items: z.array(collaborationItemSchema).max(MAX_COLLABORATION_ITEMS),
  })
  .strict();

export const pluginToMcpMessageSchema = z.discriminatedUnion("command", [
  baseMessageSchema.extend({
    command: z.literal(WS_COMMANDS.CLIENT_HELLO),
    payload: z
      .object({
        protocolVersion: z.number().int().positive(),
        // Optional only so older clients reach the explicit compatibility
        // rejection path instead of a generic schema error. Authentication
        // cannot proceed unless both exactly match the daemon identity.
        buildId: z.string().min(1).max(120).optional(),
        schemaHash: z.string().regex(/^[a-f0-9]{8}$/).optional(),
        clientRole: z.enum(["plugin", "observer", "browser", "ui", "mcp"]),
        clientName: z.string().min(1).max(100).optional(),
        installationId: z.string().min(1).max(200).optional(),
        sessionId: z.string().min(1).max(200).optional(),
        bridgeToken: z.string().max(512).optional(),
      })
      .strict(),
  }),
  baseMessageSchema.extend({
    command: z.literal(WS_COMMANDS.HEARTBEAT),
    payload: z.object({
      sessionId: z.string().optional(),
    }),
  }),
  baseMessageSchema.extend({
    command: z.literal(WS_COMMANDS.ACTIVE_TAB_UPDATED),
    payload: z.object({
      activeTab: activeTabSchema,
    }),
  }),
  baseMessageSchema.extend({
    command: z.literal(WS_COMMANDS.ELEMENT_SELECTED),
    payload: z.object({
      activeTab: activeTabSchema,
      selectedElement: selectedElementSchema,
    }),
  }),
  baseMessageSchema.extend({
    command: z.literal(WS_COMMANDS.PLUGIN_CHAT_MESSAGE_CREATED),
    payload: z.object({
      message: z.object({
        id: z.string(),
        conversationId: z.string().min(1).max(200).optional(),
        role: z.enum(["user", "assistant", "tool"]),
        content: z.string(),
        createdAt: z.string(),
      }),
    }),
  }),
  baseMessageSchema.extend({
    command: z.literal(WS_COMMANDS.PLUGIN_CONVERSATION_STARTED),
    payload: z.object({
      conversationId: z.string().min(1).max(200),
      startedAt: z.string(),
    }),
  }),
  baseMessageSchema.extend({
    command: z.literal(WS_COMMANDS.SCREENSHOT_CAPTURED),
    payload: z.object({
      screenshot: z.object({
        capturedAt: z.string(),
        mimeType: z.enum(["image/png", "image/jpeg"]),
        dataUrl: z.string(),
        artifact: z.object({
          id: z.string().regex(/^art_[a-f0-9]{32}$/),
          uri: z.string().startsWith("ai-devtools://artifact/"),
          kind: z.enum(["screenshot", "payload"]),
          mimeType: z.string().min(1).max(100),
          byteLength: z.number().int().positive(),
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
          createdAt: z.string(),
          expiresAt: z.string(),
        }).optional(),
        method: z.enum(["cdp", "visibleTab"]).optional(),
        fullPage: z.boolean().optional(),
        selector: z.string().optional(),
        width: z.number().optional(),
        height: z.number().optional(),
        filename: z.string().optional(),
        savedAs: z.string().optional(),
      }),
    }),
  }),
  baseMessageSchema.extend({
    command: z.literal(WS_COMMANDS.PAGE_CONTEXT_UPDATED),
    payload: z.object({
      activeTab: activeTabSchema,
      pageContext: pageContextSchema,
    }),
  }),
  baseMessageSchema.extend({
    command: z.literal(WS_COMMANDS.AGENT_SESSION_SYNC),
    payload: z.object({
      session: agentSessionSchema,
    }),
  }),
  baseMessageSchema.extend({
    command: z.literal(WS_COMMANDS.COLLABORATION_ITEM_UPSERT),
    payload: z
      .object({
        item: collaborationItemInputSchema,
      })
      .strict(),
  }),
  baseMessageSchema.extend({
    command: z.literal(WS_COMMANDS.COLLABORATION_WORKSPACE_UPDATED),
    payload: z
      .object({
        workspace: collaborationWorkspaceSchema,
        item: collaborationItemSchema.optional(),
      })
      .strict(),
  }),
  baseMessageSchema.extend({
    command: z.literal(WS_COMMANDS.BROWSER_ACTIVITY_EVENT),
    payload: z
      .object({
        event: z
          .object({
            kind: z.enum(["dom", "network", "console", "navigation"]),
            observedAt: z.string().max(64).optional(),
            target: activeTabSchema.optional(),
            summary: z
              .object({
                message: z.string().max(2_000).optional(),
                level: z.string().max(40).optional(),
                method: z.string().max(20).optional(),
                url: z.string().max(4_000).optional(),
                resourceType: z.string().max(80).optional(),
                status: z.number().int().min(0).max(999).optional(),
                failed: z.boolean().optional(),
                requestId: z.string().max(200).optional(),
                initiatorType: z.string().max(80).optional(),
                source: z
                  .object({
                    url: z.string().max(4_000).optional(),
                    functionName: z.string().max(160).optional(),
                    lineNumber: z.number().int().nonnegative().optional(),
                    columnNumber: z.number().int().nonnegative().optional(),
                  })
                  .strict()
                  .optional(),
                fromRevision: z.number().int().nonnegative().optional(),
                toRevision: z.number().int().nonnegative().optional(),
                added: z.number().int().nonnegative().optional(),
                removed: z.number().int().nonnegative().optional(),
                attributes: z.number().int().nonnegative().optional(),
                characterData: z.number().int().nonnegative().optional(),
                domSamples: z
                  .array(
                    z
                      .object({
                        changeType: z.enum([
                          "added",
                          "removed",
                          "attribute",
                          "text",
                        ]),
                        selector: z.string().max(500).optional(),
                        text: z.string().max(240).optional(),
                      })
                      .strict(),
                  )
                  .max(12)
                  .optional(),
                domSamplesOmitted: z.number().int().nonnegative().optional(),
                transportDroppedEvents: z
                  .number()
                  .int()
                  .nonnegative()
                  .optional(),
                reason: z.string().max(240).optional(),
              })
              .strict(),
          })
          .strict(),
      })
      .strict(),
  }),
  baseMessageSchema.extend({
    command: z.literal(WS_COMMANDS.MCP_LIST_TOOLS),
    payload: z.object({
      includeExternal: z.boolean().optional(),
    }),
  }),
  baseMessageSchema.extend({
    command: z.literal(WS_COMMANDS.MCP_TOOL_CALL),
    payload: z
      .object({
        call: mcpToolCallSchema,
        taskContext: taskContextSchema.optional(),
      })
      .strict(),
  }),
  baseMessageSchema.extend({
    command: z.literal(WS_COMMANDS.STATE_GET),
    payload: z.object({
      key: z.enum(DAEMON_STATE_RESOURCE_KEYS),
      sessionId: z.string().optional(),
    }),
  }),
  baseMessageSchema.extend({
    command: z.literal(WS_COMMANDS.ARTIFACT_GET),
    payload: z.object({
      artifactId: z.string().regex(/^art_[a-f0-9]{32}$/),
    }),
  }),
  baseMessageSchema.extend({
    command: z.literal(WS_COMMANDS.APPROVAL_RESPONSE),
    payload: z
      .object({
        approvalId: z.string().min(1),
        approved: z.boolean(),
        respondedAt: z.string(),
        rememberForTask: z
          .object({
            taskId: z.string().min(1).max(200),
            principals: z.array(z.enum(["ui", "mcp"])).min(1).max(2),
            egressDestinations: z.array(z.string().min(1).max(500)).max(10),
            ttlMs: z.number().int().min(60_000).max(3_600_000).optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
  }),
  baseMessageSchema.extend({
    command: z.literal(WS_COMMANDS.TASK_GRANT_REVOKE),
    payload: z
      .object({
        taskId: z.string().min(1).max(200),
        reason: z.string().min(1).max(500),
      })
      .strict(),
  }),
  baseMessageSchema.extend({
    command: z.literal(WS_COMMANDS.REQUEST_CANCEL),
    payload: z.object({
      targetRequestId: z.string().min(1),
      reason: z.string().max(500).optional(),
    }),
  }),
  baseMessageSchema.extend({
    command: z.literal(WS_COMMANDS.BROWSER_TOOL_CALL),
    payload: z.object({
      call: browserToolCallSchema,
      executionGrant: executionGrantSchema,
    }),
  }),
  baseMessageSchema.extend({
    command: z.literal(WS_COMMANDS.BROWSER_TOOL_RESULT),
    payload: z.discriminatedUnion("ok", [
      z.object({
        ok: z.literal(true),
        toolName: z.string().min(1),
        data: z.unknown(),
      }),
      z.object({
        ok: z.literal(false),
        errorCode: z
          .enum([
            "APPROVAL_DENIED",
            "APPROVAL_REQUIRED",
            "EXECUTION_GRANT_INVALID",
            "IDEMPOTENCY_CONFLICT",
            "PAYLOAD_TOO_LARGE",
            "RATE_LIMITED",
            "REQUEST_CANCELLED",
            "REQUEST_DEADLINE_EXCEEDED",
            "ROLE_FORBIDDEN",
            "STALE_CONTEXT",
            "TOOL_FAILED",
          ])
          .optional(),
        error: z.string(),
        details: z.unknown().optional(),
      }),
    ]),
  }),
]);

export type ValidPluginToMcpMessage = z.infer<typeof pluginToMcpMessageSchema>;
