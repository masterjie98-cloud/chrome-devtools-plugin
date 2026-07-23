import { z, type ZodTypeAny } from "zod";
import {
  MCP_TOOL_NAMES,
  type McpToolName,
} from "../shared/mcpTools";

const OUTPUT_STRING_LIMIT = 20_032;
const OUTPUT_COLLECTION_LIMIT = 201;

const outputString = z.string().max(OUTPUT_STRING_LIMIT);
const outputArray = z.array(z.unknown()).max(OUTPUT_COLLECTION_LIMIT);
const nullableUnknown = z.unknown().nullable();

function collectionPaginationSchema(kind: "conversation" | "network" | "audit") {
  return z
    .object({
      version: z.literal("collection-page-v1"),
      kind: z.literal(kind),
      fingerprint: z.string().regex(/^[a-f0-9]{8}$/),
      offset: z.number().int().nonnegative(),
      limit: z.number().int().positive(),
      returnedCount: z.number().int().nonnegative(),
      totalCount: z.number().int().nonnegative(),
      hasMore: z.boolean(),
      nextCursor: outputString.optional(),
    })
    .strict();
}

const pluginMessageSchema = z
  .object({
    id: outputString,
    conversationId: outputString.optional(),
    role: z.enum(["user", "assistant", "tool"]),
    content: outputString,
    createdAt: outputString,
  })
  .strict();

const redactedAuditEventSchema = z
  .object({
    id: outputString,
    eventType: z.enum([
      "approval.requested",
      "approval.approved",
      "approval.denied",
      "grant.created",
      "grant.revoked",
      "tool.completed",
      "tool.failed",
    ]),
    timestamp: outputString,
    requestId: outputString,
    sessionId: outputString,
    toolName: outputString,
    policyClass: outputString,
    argumentsSha256: z.string().regex(/^[a-f0-9]{64}$/),
    revision: z.number().int().nonnegative(),
    outcome: z
      .enum(["approved", "denied", "completed", "failed"])
      .optional(),
    errorCode: outputString.optional(),
    egressClass: z
      .enum([
        "cookies",
        "storage",
        "network_metadata",
        "response_body",
        "screenshot",
        "dom",
        "conversation",
        "audit_metadata",
        "page_runtime",
        "evaluated_page_data",
        "external_tool",
        "sensitive_result",
        "screenshot_artifact",
        "payload_artifact",
      ])
      .optional(),
    egressBytes: z.number().int().nonnegative().max(64 * 1024 * 1024).optional(),
    egressDestination: z
      .enum(["extension_agent", "mcp_adapter"])
      .optional(),
    approvalWaitMs: z.number().int().nonnegative().max(64 * 1024 * 1024).optional(),
    queueWaitMs: z.number().int().nonnegative().max(64 * 1024 * 1024).optional(),
    executorMs: z.number().int().nonnegative().max(64 * 1024 * 1024).optional(),
    transportMs: z.number().int().nonnegative().max(64 * 1024 * 1024).optional(),
    totalMs: z.number().int().nonnegative().max(64 * 1024 * 1024).optional(),
    resultChars: z.number().int().nonnegative().max(64 * 1024 * 1024).optional(),
    payloadBytes: z.number().int().nonnegative().max(64 * 1024 * 1024).optional(),
  })
  .strict();

function outputObject<T extends z.ZodRawShape>(shape: T) {
  return z.object(shape).passthrough();
}

const stateMetadataShape = {
  lastSeenAt: outputString.optional(),
  stateUpdatedAt: outputString.optional(),
  artifactCapturedAt: outputString.optional(),
  updatedAt: outputString.optional(),
};

const stateResourceSchema = outputObject({
  browserConnected: z.boolean(),
  pluginConnected: z.boolean(),
  sessionId: outputString,
  value: nullableUnknown,
  ...stateMetadataShape,
});

const selectedElementSchema = outputObject({
  browserConnected: z.boolean(),
  pluginConnected: z.boolean(),
  sessionId: outputString,
  selectedElement: nullableUnknown,
  ...stateMetadataShape,
});

const contextDigestSchema = outputObject({
  browserConnected: z.boolean(),
  pluginConnected: z.boolean(),
  sessionId: outputString,
  contextDigest: nullableUnknown,
  ...stateMetadataShape,
});

const pageContextSchema = outputObject({
  pluginConnected: z.boolean().optional(),
  activeTab: nullableUnknown.optional(),
  pageContext: nullableUnknown.optional(),
  url: outputString.optional(),
  title: outputString.optional(),
  origin: outputString.optional(),
  capturedAt: outputString.optional(),
  visibleText: outputString.optional(),
  domSummary: outputArray.optional(),
  nodeCount: z.number().int().nonnegative().optional(),
  truncated: z.boolean().optional(),
  ...stateMetadataShape,
});

const semanticSnapshotSchema = outputObject({
  version: z.literal("browser-semantic-snapshot-v1"),
  page: outputObject({
    url: outputString,
    title: outputString,
    origin: outputString,
    capturedAt: outputString,
  }),
  target: nullableUnknown,
  freshness: outputObject({
    source: z.literal("live-browser"),
    capturedAt: outputString,
    observedAt: outputString,
    revision: z.number().int().nonnegative(),
    stale: z.literal(false),
  }),
  snapshot: outputObject({
    version: z.literal("semantic-snapshot-v1"),
    fingerprint: outputString,
    nodes: outputArray,
    pagination: z.unknown(),
    stats: z.unknown(),
  }),
  frameScope: z.enum(["auto", "all-accessible"]).optional(),
  complete: z.boolean().optional(),
  omittedFrameCount: z.number().int().nonnegative().max(10_000).optional(),
  frames: z
    .array(
      outputObject({
        frame: z.unknown(),
        page: z.unknown(),
        target: nullableUnknown,
        snapshot: z.unknown(),
        observation: z.unknown(),
        actionable: z.literal(false),
      }),
    )
    .max(11)
    .optional(),
  unavailableFrames: z.array(z.unknown()).max(12).optional(),
});

const domQueryResultSchema = outputObject({
  query: outputString,
  queryType: z.enum(["selector", "className", "xpath"]),
  count: z.number().int().nonnegative(),
  elements: outputArray,
});

const domQuerySchema = outputObject({
  query: outputString.optional(),
  queryType: z.enum(["selector", "className", "xpath"]).optional(),
  count: z.number().int().nonnegative().optional(),
  elements: outputArray.optional(),
  version: z.literal("dom-query-batch-v1").optional(),
  results: z.array(domQueryResultSchema).min(1).max(12).optional(),
}).superRefine((value, context) => {
  const isSingle = value.query !== undefined;
  const isBatch = value.version === "dom-query-batch-v1";
  if (isSingle === isBatch) {
    context.addIssue({
      code: "custom",
      message: "DOM query output must be either one result or a batch result.",
    });
  }
  if (
    isSingle &&
    (value.queryType === undefined ||
      value.count === undefined ||
      value.elements === undefined)
  ) {
    context.addIssue({
      code: "custom",
      message: "Single DOM query output is incomplete.",
    });
  }
  if (isBatch && value.results === undefined) {
    context.addIssue({
      code: "custom",
      message: "Batch DOM query output requires results.",
    });
  }
});

const screenshotSchema = outputObject({
  capturedAt: outputString,
  mimeType: z.enum(["image/png", "image/jpeg"]),
});

const tabListSchema = outputObject({ tabs: outputArray });
const tabSelectionSchema = outputObject({
  tabs: outputArray,
  selectedTab: z.unknown(),
});
const frameListSchema = outputObject({
  tabId: z.number().int().nonnegative(),
  selectedFrameId: z.number().int().nonnegative(),
  frames: outputArray,
});
const frameSelectionSchema = outputObject({
  tabId: z.number().int().nonnegative(),
  selectedFrameId: z.number().int().nonnegative(),
  frames: outputArray,
  selectedFrame: z.unknown(),
});
const navigationSchema = outputObject({
  tabId: z.number().int().nonnegative(),
  action: z.enum(["navigate", "back", "forward", "reload"]),
});
const elementActionSchema = outputObject({
  selector: outputString,
  matched: z.boolean(),
  action: outputString,
});
const trustedElementActionSchema = outputObject({
  selector: outputString,
  matched: z.literal(true),
  action: outputString,
  inputMode: z.literal("cdp"),
  x: z.number(),
  y: z.number(),
});
const trustedKeyboardActionSchema = outputObject({
  selector: outputString,
  matched: z.literal(true),
  action: outputString,
  inputMode: z.literal("cdp"),
  x: z.number().optional(),
  y: z.number().optional(),
});
const scopedDomElementActionSchema = outputObject({
  selector: outputString,
  matched: z.literal(true),
  action: outputString,
  inputMode: z.literal("dom"),
  changed: z.boolean(),
  x: z.number(),
  y: z.number(),
});
const formFieldActionSchema = z
  .object({
    selector: outputString,
    matched: z.literal(true),
    action: z.literal("fillForm"),
    inputMode: z.enum(["cdp", "dom"]),
    changed: z.boolean(),
    controlKind: z.enum([
      "text",
      "checkbox",
      "radio",
      "select-one",
      "select-multiple",
    ]),
    name: outputString.optional(),
    tagName: outputString.optional(),
    text: outputString.optional(),
    rect: z.unknown().optional(),
    x: z.number(),
    y: z.number(),
  })
  .strict();
const mouseActionSchema = outputObject({
  action: z.enum(["move", "click", "down", "up", "drag", "wheel"]),
});

const cookieSchema = outputObject({
  name: outputString,
  valueIncluded: z.boolean(),
  domain: outputString,
  path: outputString,
  secure: z.boolean(),
  httpOnly: z.boolean(),
});

const networkStatusSchema = outputObject({
  attached: z.boolean(),
  networkEnabled: z.boolean(),
  protocolVersion: outputString,
  requestCount: z.number().int().nonnegative(),
  maxEntries: z.number().int().positive(),
  preservedLog: z.boolean(),
});
const networkActivityGroupSchema = z
  .object({
    method: outputString,
    url: outputString,
    resourceType: outputString.optional(),
    status: z.number().int().min(0).max(599).optional(),
    count: z.number().int().positive(),
    failedCount: z.number().int().nonnegative(),
    latestStartedAt: z.number(),
    latestDurationMs: z.number().nonnegative().optional(),
    heartbeatLike: z.boolean(),
  })
  .strict();
const networkActivityDigestSchema = z
  .object({
    observedRequests: z.number().int().nonnegative(),
    totalGroups: z.number().int().nonnegative(),
    returnedGroups: z.number().int().nonnegative().max(12),
    heartbeatRequestsCollapsed: z.number().int().nonnegative(),
    groups: z.array(networkActivityGroupSchema).max(12),
  })
  .strict();
const networkListResultSchema = outputObject({
  attached: z.boolean(),
  digestOnly: z.boolean(),
  total: z.number().int().nonnegative(),
  returned: z.number().int().nonnegative(),
  requests: outputArray,
  activityDigest: networkActivityDigestSchema,
  pagination: collectionPaginationSchema("network"),
}).superRefine((value, context) => {
  if (
    value.returned !== value.requests.length ||
    value.pagination.returnedCount !== value.requests.length
  ) {
    context.addIssue({
      code: "custom",
      message: "Network returned counts must match the raw requests array.",
    });
  }
  if (
    value.digestOnly &&
    (value.requests.length !== 0 ||
      value.pagination.hasMore ||
      value.pagination.nextCursor !== undefined)
  ) {
    context.addIssue({
      code: "custom",
      message: "Digest-only Network results cannot expose raw-page state.",
    });
  }
});
const proxyStatusSchema = outputObject({
  attached: z.boolean(),
  fetchEnabled: z.boolean(),
  protocolVersion: outputString,
  ruleCount: z.number().int().nonnegative(),
  hitCount: z.number().int().nonnegative(),
});
const proxyMutationSchema = outputObject({
  status: proxyStatusSchema,
  rules: outputArray,
});
const dnrMutationSchema = outputObject({
  ruleId: z.number().int().nonnegative(),
  rules: outputArray,
});

export const MCP_TOOL_OUTPUT_SCHEMAS = {
  [MCP_TOOL_NAMES.BROWSER_STATUS]: outputObject({
    version: z.literal("browser-status-v1"),
    sessionId: outputString,
    browserConnected: z.boolean(),
    pluginConnected: z.boolean(),
    pageContextSynced: z.boolean(),
    activeTab: nullableUnknown,
    currentConversationId: outputString,
    revision: z.number().int().nonnegative(),
  }),
  [MCP_TOOL_NAMES.BROWSER_OBSERVE]: semanticSnapshotSchema,
  [MCP_TOOL_NAMES.BROWSER_ACT]: outputObject({
    version: z.literal("action-stage-v1"),
    completed: z.number().int().nonnegative(),
    requested: z.number().int().positive().max(20),
    stoppedAt: outputString.nullable(),
    barrierReached: z.boolean(),
    requiresVerification: z.boolean(),
    results: outputArray,
  }),
  [MCP_TOOL_NAMES.BROWSER_VERIFY]: outputObject({
    version: z.literal("browser-verification-v1"),
    passed: z.boolean(),
    page: z.unknown(),
    target: nullableUnknown,
    domRevision: z.number().int().nonnegative(),
    delta: nullableUnknown,
    checks: outputArray,
  }),
  [MCP_TOOL_NAMES.BROWSER_DEBUG_ACTIVITY]: outputObject({
    version: z.literal("browser-debug-activity-v1"),
    capturedAt: outputString,
    network: nullableUnknown,
    console: nullableUnknown,
  }),
  [MCP_TOOL_NAMES.BROWSER_GET_SELECTED_ELEMENT]: selectedElementSchema,
  [MCP_TOOL_NAMES.BROWSER_GET_CONTEXT_DIGEST]: contextDigestSchema,
  [MCP_TOOL_NAMES.BROWSER_GET_PLUGIN_CONVERSATION]: outputObject({
    browserConnected: z.boolean(),
    pluginConnected: z.boolean(),
    sessionId: outputString,
    currentConversationId: outputString,
    messages: z.array(pluginMessageSchema).max(50),
    pagination: collectionPaginationSchema("conversation"),
    ...stateMetadataShape,
  }),
  [MCP_TOOL_NAMES.BROWSER_GET_AUDIT_EVENTS]: z.object({
    sessionId: outputString,
    filters: z.object({
      eventType: z
        .enum([
          "approval.requested",
          "approval.approved",
          "approval.denied",
          "grant.created",
          "grant.revoked",
          "tool.completed",
          "tool.failed",
        ])
        .optional(),
      toolName: outputString.optional(),
      outcome: z
        .enum(["approved", "denied", "completed", "failed"])
        .optional(),
    }).strict(),
    events: z.array(redactedAuditEventSchema).max(100),
    pagination: collectionPaginationSchema("audit"),
  }).strict(),
  [MCP_TOOL_NAMES.BROWSER_GET_LAST_PLUGIN_MESSAGE]: stateResourceSchema,
  [MCP_TOOL_NAMES.BROWSER_GET_PAGE_CONTEXT]: pageContextSchema,
  [MCP_TOOL_NAMES.BROWSER_SNAPSHOT]: semanticSnapshotSchema,
  [MCP_TOOL_NAMES.BROWSER_QUERY_DOM]: domQuerySchema,
  [MCP_TOOL_NAMES.BROWSER_START_ELEMENT_PICKER]: outputObject({
    started: z.boolean(),
  }),
  [MCP_TOOL_NAMES.BROWSER_CANCEL_ELEMENT_PICKER]: outputObject({
    cancelled: z.boolean(),
  }),
  [MCP_TOOL_NAMES.BROWSER_HIGHLIGHT_ELEMENT]: outputObject({
    selector: outputString,
    highlighted: z.boolean(),
  }),
  [MCP_TOOL_NAMES.BROWSER_CLEAR_HIGHLIGHTS]: outputObject({
    cleared: z.boolean(),
  }),
  [MCP_TOOL_NAMES.BROWSER_TAKE_SCREENSHOT]: screenshotSchema,
  [MCP_TOOL_NAMES.BROWSER_LIST_TABS]: tabListSchema,
  [MCP_TOOL_NAMES.BROWSER_SET_TARGET_TAB]: tabSelectionSchema,
  [MCP_TOOL_NAMES.BROWSER_LIST_FRAMES]: frameListSchema,
  [MCP_TOOL_NAMES.BROWSER_SET_TARGET_FRAME]: frameSelectionSchema,
  [MCP_TOOL_NAMES.BROWSER_NAVIGATE]: navigationSchema,
  [MCP_TOOL_NAMES.BROWSER_NAVIGATE_BACK]: navigationSchema,
  [MCP_TOOL_NAMES.BROWSER_NAVIGATE_FORWARD]: navigationSchema,
  [MCP_TOOL_NAMES.BROWSER_RELOAD]: navigationSchema,
  [MCP_TOOL_NAMES.BROWSER_CLOSE]: outputObject({ closed: z.boolean() }),
  [MCP_TOOL_NAMES.BROWSER_RESIZE]: outputObject({
    width: z.number().int().optional(),
    height: z.number().int().optional(),
  }),
  [MCP_TOOL_NAMES.BROWSER_CLICK]: trustedElementActionSchema,
  [MCP_TOOL_NAMES.BROWSER_HOVER]: trustedElementActionSchema,
  [MCP_TOOL_NAMES.BROWSER_DRAG]: outputObject({
    dragged: z.boolean(),
    source: trustedElementActionSchema,
    target: trustedElementActionSchema,
  }),
  [MCP_TOOL_NAMES.BROWSER_FILL_FORM]: outputObject({
    filled: z.literal(true),
    fields: z.array(formFieldActionSchema).min(1).max(50),
  }),
  [MCP_TOOL_NAMES.BROWSER_EXECUTE_ACTION_STAGE]: outputObject({
    version: z.literal("action-stage-v1"),
    completed: z.number().int().nonnegative(),
    requested: z.number().int().positive().max(20),
    stoppedAt: outputString.nullable(),
    barrierReached: z.boolean(),
    requiresVerification: z.boolean(),
    results: outputArray,
  }),
  [MCP_TOOL_NAMES.BROWSER_TYPE]: trustedElementActionSchema,
  [MCP_TOOL_NAMES.BROWSER_PRESS_KEY]: trustedKeyboardActionSchema,
  [MCP_TOOL_NAMES.BROWSER_SELECT_OPTION]: scopedDomElementActionSchema,
  [MCP_TOOL_NAMES.BROWSER_MOUSE_MOVE_XY]: mouseActionSchema,
  [MCP_TOOL_NAMES.BROWSER_MOUSE_CLICK_XY]: mouseActionSchema,
  [MCP_TOOL_NAMES.BROWSER_MOUSE_DOWN]: mouseActionSchema,
  [MCP_TOOL_NAMES.BROWSER_MOUSE_UP]: mouseActionSchema,
  [MCP_TOOL_NAMES.BROWSER_MOUSE_DRAG_XY]: mouseActionSchema,
  [MCP_TOOL_NAMES.BROWSER_MOUSE_WHEEL_XY]: mouseActionSchema,
  [MCP_TOOL_NAMES.BROWSER_WAIT_FOR]: outputObject({
    waited: z.boolean(),
    reason: z.enum(["time", "text", "textGone", "selector", "timeout"]),
    elapsedMs: z.number().nonnegative(),
  }),
  [MCP_TOOL_NAMES.BROWSER_EVALUATE]: outputObject({
    evaluated: z.boolean(),
  }),
  [MCP_TOOL_NAMES.BROWSER_HANDLE_DIALOG]: outputObject({
    handled: z.literal(true),
    action: z.enum(["accept", "dismiss"]),
    promptText: outputString.optional(),
  }),
  [MCP_TOOL_NAMES.BROWSER_STORAGE_STATE]: outputObject({
    url: outputString,
    origin: outputString,
    valuesIncluded: z.boolean(),
  }),
  [MCP_TOOL_NAMES.BROWSER_COOKIE_LIST]: outputObject({
    total: z.number().int().nonnegative(),
    cookies: outputArray,
    valuesIncluded: z.boolean(),
  }),
  [MCP_TOOL_NAMES.BROWSER_COOKIE_SET]: outputObject({ cookie: cookieSchema }),
  [MCP_TOOL_NAMES.BROWSER_COOKIE_DELETE]: outputObject({
    deleted: z.boolean(),
    name: outputString,
  }),
  [MCP_TOOL_NAMES.BROWSER_CONSOLE_MESSAGES]: outputObject({
    attached: z.boolean(),
    total: z.number().int().nonnegative(),
    returned: z.number().int().nonnegative(),
    messages: outputArray,
  }),
  [MCP_TOOL_NAMES.BROWSER_SET_DOM_VALUE]: outputObject({
    selector: outputString,
    matched: z.boolean(),
    target: z.enum(["value", "textContent", "innerText", "attribute"]),
  }),
  [MCP_TOOL_NAMES.BROWSER_NETWORK_REQUESTS]: networkListResultSchema,
  [MCP_TOOL_NAMES.BROWSER_NETWORK_START_RECORDING]: networkStatusSchema,
  [MCP_TOOL_NAMES.BROWSER_NETWORK_STOP_RECORDING]: networkStatusSchema,
  [MCP_TOOL_NAMES.BROWSER_NETWORK_CLEAR]: networkStatusSchema,
  [MCP_TOOL_NAMES.BROWSER_NETWORK_LIST_REQUESTS]: networkListResultSchema,
  [MCP_TOOL_NAMES.BROWSER_NETWORK_GET_REQUEST]: outputObject({
    requestId: outputString,
    url: outputString,
    method: outputString,
    startedAt: z.number(),
  }),
  [MCP_TOOL_NAMES.BROWSER_NETWORK_GET_RESPONSE_BODY]: outputObject({
    requestId: outputString,
    body: outputString,
    base64Encoded: z.boolean(),
    truncated: z.boolean(),
  }),
  [MCP_TOOL_NAMES.BROWSER_DEBUGGER_DETACH]: outputObject({
    detached: z.boolean(),
  }),
  [MCP_TOOL_NAMES.BROWSER_PROXY_ENABLE]: proxyStatusSchema,
  [MCP_TOOL_NAMES.BROWSER_PROXY_DISABLE]: proxyStatusSchema,
  [MCP_TOOL_NAMES.BROWSER_PROXY_LIST_RULES]: outputObject({
    status: proxyStatusSchema,
    rules: outputArray,
  }),
  [MCP_TOOL_NAMES.BROWSER_PROXY_UPSERT_RULE]: proxyMutationSchema,
  [MCP_TOOL_NAMES.BROWSER_PROXY_REMOVE_RULE]: proxyMutationSchema,
  [MCP_TOOL_NAMES.BROWSER_PROXY_CLEAR_RULES]: proxyMutationSchema,
  [MCP_TOOL_NAMES.BROWSER_PROXY_LIST_HITS]: outputObject({
    total: z.number().int().nonnegative(),
    returned: z.number().int().nonnegative(),
    hits: outputArray,
  }),
  [MCP_TOOL_NAMES.BROWSER_LIST_NETWORK_RULES]: outputObject({
    value: outputArray,
  }),
  [MCP_TOOL_NAMES.BROWSER_UPSERT_HEADER_RULE]: dnrMutationSchema,
  [MCP_TOOL_NAMES.BROWSER_UPSERT_GET_MOCK]: dnrMutationSchema,
  [MCP_TOOL_NAMES.BROWSER_REMOVE_NETWORK_RULE]: dnrMutationSchema,
  [MCP_TOOL_NAMES.BROWSER_APPLY_CSS_PATCH]: outputObject({
    patchId: outputString,
    active: z.boolean(),
  }),
  [MCP_TOOL_NAMES.BROWSER_REMOVE_CSS_PATCH]: outputObject({
    patchId: outputString,
    removed: z.boolean(),
  }),
} satisfies Record<McpToolName, ZodTypeAny>;

export function mcpToolOutputJsonSchema(
  toolName: McpToolName,
): Record<string, unknown> {
  return z.toJSONSchema(MCP_TOOL_OUTPUT_SCHEMAS[toolName], {
    unrepresentable: "any",
  }) as Record<string, unknown>;
}
