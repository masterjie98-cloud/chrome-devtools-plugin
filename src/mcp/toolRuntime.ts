import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, type ZodTypeAny } from "zod";
import { createMessageId } from "../shared/messaging";
import {
  MCP_EXPOSED_TOOL_DEFINITIONS,
  MCP_TOOL_NAMES,
  normalizeMcpToolName,
  type McpToolName,
} from "../shared/mcpTools";
import {
  getToolPolicy,
  getToolPolicyAnnotations,
  type ToolPolicyClass,
} from "../shared/toolPolicy";
import { TOOL_NAMES, type AnyToolCall } from "../shared/tools";
import {
  getBrowserStateSnapshot,
  readBrowserStateResource,
  readContextDigestResource,
  readSelectedElementResource,
  toResourceJson,
} from "./state";
import type { PluginWebSocketServer } from "./wsServer";
import type { McpAvailableTool } from "../shared/wsProtocol";
import {
  MCP_TOOL_OUTPUT_SCHEMAS,
  mcpToolOutputJsonSchema,
} from "./toolOutputSchemas";
import { paginateCollection } from "../shared/collectionPagination";
import type {
  AuditEventType,
  RedactedAuditEvent,
} from "../daemon/store/stateStore";
import { isSupportedTrustedKey } from "../shared/trustedKeyboard";

const noArgSchema = z.object({});
const semanticSnapshotInputSchema = z
  .object({
    cursor: z.string().regex(/^ss1_[a-f0-9]{8}_\d{1,6}$/).optional(),
    limit: z.number().int().min(1).max(100).optional(),
    mode: z.enum(["interactive", "outline", "full"]).optional(),
    sourceLimit: z.number().int().min(100).max(10000).optional(),
    sinceRevision: z.number().int().nonnegative().optional(),
  })
  .strict();
const conversationPageInputSchema = z
  .object({
    cursor: z
      .string()
      .regex(/^cp1_conversation_[a-f0-9]{8}_\d{1,6}_\d{1,6}$/)
      .optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();
const auditPageInputSchema = z
  .object({
    cursor: z
      .string()
      .regex(/^cp1_audit_[a-f0-9]{8}_\d{1,6}_\d{1,6}$/)
      .optional(),
    limit: z.number().int().min(1).max(100).optional(),
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
    toolName: z.string().trim().min(1).max(200).optional(),
    outcome: z.enum(["approved", "denied", "completed", "failed"]).optional(),
  })
  .strict();
const queryDomSchema = z
  .object({
    query: z.string().min(1).optional(),
    selector: z.string().min(1).optional(),
    queryType: z.enum(["selector", "className", "xpath"]).optional(),
    limit: z.number().int().positive().max(100).optional(),
    includeText: z.boolean().optional(),
    includeOuterHTML: z.boolean().optional(),
    includeComputedStyle: z.boolean().optional(),
    maxTextLength: z.number().int().min(0).optional(),
    maxOuterHTMLLength: z.number().int().min(0).optional(),
  })
  .refine((value) => Boolean(value.query || value.selector), {
    message: "query or selector is required",
  });

const highlightElementSchema = z.object({
  selector: z.string().min(1),
  durationMs: z.number().int().positive().max(15000).optional(),
});

const screenshotSchema = z.object({
  type: z.enum(["png", "jpeg"]).optional(),
  selector: z.string().min(1).optional(),
  target: z.string().min(1).optional(),
  element: z.string().min(1).optional(),
  fullPage: z.boolean().optional(),
  quality: z.number().int().min(0).max(100).optional(),
  filename: z.string().min(1).optional(),
  saveToDownloads: z.boolean().optional(),
});

const elementTargetShape = {
  selector: z.string().min(1).optional(),
  target: z.string().min(1).optional(),
  element: z.string().min(1).optional(),
};

const formControlTargetShape = {
  selector: z.string().min(1).max(2000).optional(),
  target: z.string().min(1).max(2000).optional(),
  element: z.string().min(1).max(2000).optional(),
};

const elementTargetSchema = z.object(elementTargetShape).refine(
  (value) => Boolean(value.selector || value.target || value.element),
  {
    message: "selector or target is required",
  },
);

const clickSchema = z
  .object({
    ...elementTargetShape,
    button: z.enum(["left", "right", "middle"]).optional(),
    doubleClick: z.boolean().optional(),
    decisionBarrier: z.boolean().optional(),
  })
  .refine((value) => Boolean(value.selector || value.target || value.element), {
    message: "selector or target is required",
  });

const hoverSchema = elementTargetSchema;

const typeTextSchema = z
  .object({
    ...elementTargetShape,
    text: z.string().max(4000),
    submit: z.boolean().optional(),
    slowly: z.boolean().optional(),
    replace: z.boolean().optional(),
    decisionBarrier: z.boolean().optional(),
  })
  .refine((value) => Boolean(value.selector || value.target || value.element), {
    message: "selector or target is required",
  })
  .refine((value) => !value.slowly || Array.from(value.text).length <= 500, {
    message: "slowly typed text is limited to 500 Unicode characters",
  });

const pressKeySchema = z.object({
  selector: z.string().min(1).optional(),
  target: z.string().min(1).optional(),
  key: z.string().min(1).max(40),
  decisionBarrier: z.boolean().optional(),
}).refine((value) => isSupportedTrustedKey(value.key), {
  message:
    "key must be one character or a supported named key such as Enter, Tab, Escape, Backspace, Delete, ArrowLeft, Space, or F1-F12",
});

const selectOptionSchema = z
  .object({
    ...formControlTargetShape,
    values: z.array(z.string().min(1).max(4000)).min(1).max(50),
  })
  .strict()
  .refine((value) => Boolean(value.selector || value.target || value.element), {
    message: "selector or target is required",
  })
  .refine((value) => new Set(value.values).size === value.values.length, {
    message: "option values must be unique",
  });

const waitForSchema = z
  .object({
    time: z.number().positive().optional(),
    text: z.string().min(1).optional(),
    textGone: z.string().min(1).optional(),
    selector: z.string().min(1).optional(),
    timeoutMs: z.number().int().min(100).max(60000).optional(),
  })
  .refine(
    (value) =>
      value.time !== undefined ||
      Boolean(value.text || value.textGone || value.selector),
    {
      message: "time, text, textGone, or selector is required",
    },
  );

const navigateSchema = z.object({
  url: z.string().min(1),
});

const dialogSchema = z.object({
  action: z.enum(["accept", "dismiss"]),
  promptText: z.string().max(4000).optional(),
});

const resizeSchema = z.object({
  width: z.number().int().min(320),
  height: z.number().int().min(240),
});

const targetTabSchema = z.object({
  tabId: z.number().int().nonnegative(),
});

const targetFrameSchema = z.object({
  frameId: z.number().int().nonnegative(),
  documentId: z.string().min(1).optional(),
});

const dragSchema = z
  .object({
    source: z.string().min(1).optional(),
    sourceSelector: z.string().min(1).optional(),
    target: z.string().min(1).optional(),
    targetSelector: z.string().min(1).optional(),
  })
  .refine((value) => Boolean(value.source || value.sourceSelector), {
    message: "source or sourceSelector is required",
  })
  .refine((value) => Boolean(value.target || value.targetSelector), {
    message: "target or targetSelector is required",
  });

const fillFormFieldSchema = z
  .object({
    ...formControlTargetShape,
    name: z.string().min(1).max(500).optional(),
    value: z.union([
      z.string().max(4000),
      z.boolean(),
      z.array(z.string().min(1).max(4000)).min(1).max(50),
    ]),
    type: z.enum(["text", "checkbox", "radio", "select"]).optional(),
  })
  .strict()
  .refine(
    (value) =>
      Boolean(value.selector || value.target || value.element || value.name),
    { message: "field selector, target, element, or name is required" },
  )
  .refine(
    (value) =>
      value.type !== "text" || typeof value.value === "string",
    { message: "text fields require a string value" },
  )
  .refine(
    (value) =>
      (value.type !== "checkbox" && value.type !== "radio") ||
      typeof value.value === "boolean",
    { message: "checkbox and radio fields require a boolean value" },
  )
  .refine(
    (value) => value.type !== "select" || typeof value.value !== "boolean",
    { message: "select fields require a string or string-array value" },
  )
  .refine(
    (value) =>
      !Array.isArray(value.value) ||
      new Set(value.value).size === value.value.length,
    { message: "field option values must be unique" },
  );

const fillFormSchema = z
  .object({
    fields: z.array(fillFormFieldSchema).min(1).max(50),
    decisionBarrier: z.boolean().optional(),
  })
  .strict();

const actionStageMetadataSchema = z.object({
  dependsOn: z.array(z.string().min(1).max(80)).max(20).optional(),
  expectedOutcome: z.string().min(1).max(500).optional(),
  barrier: z.boolean().optional(),
});
const actionStageSchema = z
  .object({
    actions: z
      .array(
        z.discriminatedUnion("type", [
          actionStageMetadataSchema.extend({
            id: z.string().min(1).max(80),
            type: z.literal("fill"),
            selector: z.string().min(1).max(1000),
            value: z.union([
              z.string().max(4000),
              z.boolean(),
              z.array(z.string().max(4000)).min(1).max(50),
            ]),
          }).strict(),
          actionStageMetadataSchema.extend({
            id: z.string().min(1).max(80),
            type: z.literal("select"),
            selector: z.string().min(1).max(1000),
            values: z.array(z.string().max(4000)).min(1).max(50),
          }).strict(),
          actionStageMetadataSchema.extend({
            id: z.string().min(1).max(80),
            type: z.literal("click"),
            selector: z.string().min(1).max(1000),
          }).strict(),
          actionStageMetadataSchema.extend({
            id: z.string().min(1).max(80),
            type: z.literal("press_key"),
            selector: z.string().min(1).max(1000).optional(),
            key: z.string().min(1).max(40),
          }).strict(),
          actionStageMetadataSchema.extend({
            id: z.string().min(1).max(80),
            type: z.literal("wait"),
            selector: z.string().min(1).max(1000).optional(),
            time: z.number().positive().max(60).optional(),
            timeoutMs: z.number().int().min(100).max(60000).optional(),
          }).strict().refine(
            (value) => value.selector !== undefined || value.time !== undefined,
            { message: "wait action requires selector or time" },
          ),
        ]),
      )
      .min(1)
      .max(20),
    stopOnFailure: z.boolean().optional(),
    decisionBarrier: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const ids = new Set<string>();
    value.actions.forEach((action, index) => {
      if (ids.has(action.id)) {
        context.addIssue({
          code: "custom",
          path: ["actions", index, "id"],
          message: `duplicate action id: ${action.id}`,
        });
      }
      ids.add(action.id);
    });
    value.actions.forEach((action, index) => {
      for (const dependency of action.dependsOn ?? []) {
        if (!ids.has(dependency) || dependency === action.id) {
          context.addIssue({
            code: "custom",
            path: ["actions", index, "dependsOn"],
            message: `invalid action dependency: ${dependency}`,
          });
        }
      }
    });
  });

const coordinateSchema = z.object({
  x: z.number(),
  y: z.number(),
});

const coordinateClickSchema = coordinateSchema.extend({
  button: z.enum(["left", "right", "middle"]).optional(),
  doubleClick: z.boolean().optional(),
});

const coordinateDragSchema = z.object({
  startX: z.number(),
  startY: z.number(),
  endX: z.number(),
  endY: z.number(),
  steps: z.number().int().min(1).max(50).optional(),
});

const wheelSchema = z
  .object({
    deltaX: z.number().optional(),
    deltaY: z.number().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
  })
  .refine(
    (value) => value.deltaX !== undefined || value.deltaY !== undefined,
    {
      message: "deltaX or deltaY is required",
    },
  );

const evaluateSchema = z.object({
  expression: z.string().min(1).max(4000),
  selector: z.string().min(1).optional(),
  timeoutMs: z.number().int().min(100).max(10000).optional(),
});

const storageStateSchema = z.object({
  includeLocalStorage: z.boolean().optional(),
  includeSessionStorage: z.boolean().optional(),
  includeCookies: z.boolean().optional(),
  includeValues: z.boolean().optional(),
});

const cookieListSchema = z.object({
  url: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  domain: z.string().min(1).optional(),
  includeValues: z.boolean().optional(),
});

const cookieSetSchema = z.object({
  url: z.string().min(1).optional(),
  name: z.string().min(1),
  value: z.string(),
  domain: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
  secure: z.boolean().optional(),
  httpOnly: z.boolean().optional(),
  sameSite: z.enum(["no_restriction", "lax", "strict", "unspecified"]).optional(),
  expirationDate: z.number().optional(),
});

const cookieDeleteSchema = z.object({
  url: z.string().min(1).optional(),
  name: z.string().min(1),
});

const consoleMessagesSchema = z.object({
  level: z.enum(["error", "warning", "info", "debug"]).optional(),
  all: z.boolean().optional(),
  limit: z.number().int().positive().max(500).optional(),
});

const applyCssPatchSchema = z.object({
  patchId: z.string().min(1).optional(),
  css: z.string().min(1).max(6000),
});

const setDomValueSchema = z
  .object({
    selector: z.string().min(1),
    value: z.string().max(4000),
    target: z
      .enum(["auto", "value", "textContent", "innerText", "attribute"])
      .optional(),
    attributeName: z.string().min(1).optional(),
    dispatchEvents: z.boolean().optional(),
  })
  .refine(
    (value) => value.target !== "attribute" || Boolean(value.attributeName),
    {
      message: "attributeName is required when target is attribute",
    },
  );

const networkStartSchema = z.object({
  preserveLog: z.boolean().optional(),
  maxEntries: z.number().int().min(10).max(5000).optional(),
});

const networkListSchema = z.object({
  cursor: z
    .string()
    .regex(/^cp1_network_[a-f0-9]{8}_\d{1,6}_\d{1,6}$/)
    .optional(),
  limit: z.number().int().positive().max(100).optional(),
  urlContains: z.string().optional(),
  method: z.string().optional(),
  resourceType: z.string().optional(),
  statusMin: z.number().int().min(100).max(599).optional(),
  statusMax: z.number().int().min(100).max(599).optional(),
  digestOnly: z.boolean().optional(),
});

const networkGetSchema = z.object({
  requestId: z.string().min(1),
  includeBody: z.boolean().optional(),
});

const networkGetBodySchema = z.object({
  requestId: z.string().min(1),
});

const debuggerDetachSchema = z.object({
  tabId: z.number().int().optional(),
});

const headerModificationSchema = z
  .object({
    header: z.string().min(1),
    operation: z.enum(["set", "append", "remove"]),
    value: z.string().optional(),
  })
  .refine(
    (value) => value.operation === "remove" || value.value !== undefined,
    {
      message: "value is required for set and append header operations",
    },
  );

const networkRuleMatcherSchema = {
  ruleId: z.number().int().positive().optional(),
  priority: z.number().int().positive().optional(),
  urlFilter: z.string().min(1).optional(),
  regexFilter: z.string().min(1).optional(),
  resourceTypes: z.array(z.string().min(1)).optional(),
};

const upsertHeaderRuleSchema = z
  .object({
    ...networkRuleMatcherSchema,
    target: z.enum(["request", "response"]).optional(),
    headers: z.array(headerModificationSchema).min(1),
  })
  .refine((value) => Boolean(value.urlFilter || value.regexFilter), {
    message: "urlFilter or regexFilter is required",
  });

const upsertGetMockSchema = z
  .object({
    ...networkRuleMatcherSchema,
    extensionPath: z.string().min(1).optional(),
  })
  .refine((value) => Boolean(value.urlFilter || value.regexFilter), {
    message: "urlFilter or regexFilter is required",
  });

const removeNetworkRuleSchema = z.object({
  ruleId: z.number().int().positive(),
});

const proxyRuleSchema = z
  .object({
    id: z.string().min(1).optional(),
    enabled: z.boolean().optional(),
    priority: z.number().int().positive().optional(),
    urlPattern: z.string().min(1).optional(),
    urlContains: z.string().min(1).optional(),
    regexFilter: z.string().min(1).optional(),
    method: z.string().min(1).optional(),
    resourceType: z.string().min(1).optional(),
    requestHeaders: z.array(headerModificationSchema).optional(),
    responseHeaders: z.array(headerModificationSchema).optional(),
    responseBody: z.string().optional(),
    responseBodyBase64: z.string().min(1).optional(),
    statusCode: z.number().int().min(100).max(599).optional(),
    responsePhrase: z.string().min(1).optional(),
    contentType: z.string().min(1).optional(),
    mockStage: z.enum(["request", "response"]).optional(),
  })
  .refine(
    (value) =>
      Boolean(value.urlPattern || value.urlContains || value.regexFilter),
    {
      message: "urlPattern, urlContains, or regexFilter is required",
    },
  )
  .refine(
    (value) =>
      Boolean(
        value.requestHeaders?.length ||
          value.responseHeaders?.length ||
          value.responseBody !== undefined ||
          value.responseBodyBase64 ||
          value.statusCode !== undefined ||
          value.contentType,
      ),
    {
      message: "at least one proxy action is required",
    },
  );

const removeProxyRuleSchema = z.object({
  id: z.string().min(1),
});

const listProxyHitsSchema = z.object({
  limit: z.number().int().positive().max(500).optional(),
  ruleId: z.string().min(1).optional(),
});

const removeCssPatchSchema = z.object({
  patchId: z.string().min(1),
});

const MCP_TOOL_INPUT_SCHEMA_BASE: Record<McpToolName, ZodTypeAny> = {
  [MCP_TOOL_NAMES.BROWSER_GET_SELECTED_ELEMENT]: noArgSchema,
  [MCP_TOOL_NAMES.BROWSER_GET_CONTEXT_DIGEST]: noArgSchema,
  [MCP_TOOL_NAMES.BROWSER_GET_PLUGIN_CONVERSATION]: conversationPageInputSchema,
  [MCP_TOOL_NAMES.BROWSER_GET_AUDIT_EVENTS]: auditPageInputSchema,
  [MCP_TOOL_NAMES.BROWSER_GET_LAST_PLUGIN_MESSAGE]: noArgSchema,
  [MCP_TOOL_NAMES.BROWSER_GET_PAGE_CONTEXT]: noArgSchema,
  [MCP_TOOL_NAMES.BROWSER_SNAPSHOT]: semanticSnapshotInputSchema,
  [MCP_TOOL_NAMES.BROWSER_QUERY_DOM]: queryDomSchema,
  [MCP_TOOL_NAMES.BROWSER_START_ELEMENT_PICKER]: noArgSchema,
  [MCP_TOOL_NAMES.BROWSER_CANCEL_ELEMENT_PICKER]: noArgSchema,
  [MCP_TOOL_NAMES.BROWSER_HIGHLIGHT_ELEMENT]: highlightElementSchema,
  [MCP_TOOL_NAMES.BROWSER_CLEAR_HIGHLIGHTS]: noArgSchema,
  [MCP_TOOL_NAMES.BROWSER_TAKE_SCREENSHOT]: screenshotSchema,
  [MCP_TOOL_NAMES.BROWSER_LIST_TABS]: noArgSchema,
  [MCP_TOOL_NAMES.BROWSER_SET_TARGET_TAB]: targetTabSchema,
  [MCP_TOOL_NAMES.BROWSER_LIST_FRAMES]: noArgSchema,
  [MCP_TOOL_NAMES.BROWSER_SET_TARGET_FRAME]: targetFrameSchema,
  [MCP_TOOL_NAMES.BROWSER_NAVIGATE]: navigateSchema,
  [MCP_TOOL_NAMES.BROWSER_NAVIGATE_BACK]: noArgSchema,
  [MCP_TOOL_NAMES.BROWSER_NAVIGATE_FORWARD]: noArgSchema,
  [MCP_TOOL_NAMES.BROWSER_RELOAD]: noArgSchema,
  [MCP_TOOL_NAMES.BROWSER_CLOSE]: noArgSchema,
  [MCP_TOOL_NAMES.BROWSER_RESIZE]: resizeSchema,
  [MCP_TOOL_NAMES.BROWSER_CLICK]: clickSchema,
  [MCP_TOOL_NAMES.BROWSER_HOVER]: hoverSchema,
  [MCP_TOOL_NAMES.BROWSER_DRAG]: dragSchema,
  [MCP_TOOL_NAMES.BROWSER_FILL_FORM]: fillFormSchema,
  [MCP_TOOL_NAMES.BROWSER_EXECUTE_ACTION_STAGE]: actionStageSchema,
  [MCP_TOOL_NAMES.BROWSER_TYPE]: typeTextSchema,
  [MCP_TOOL_NAMES.BROWSER_PRESS_KEY]: pressKeySchema,
  [MCP_TOOL_NAMES.BROWSER_SELECT_OPTION]: selectOptionSchema,
  [MCP_TOOL_NAMES.BROWSER_MOUSE_MOVE_XY]: coordinateSchema,
  [MCP_TOOL_NAMES.BROWSER_MOUSE_CLICK_XY]: coordinateClickSchema,
  [MCP_TOOL_NAMES.BROWSER_MOUSE_DOWN]: coordinateClickSchema,
  [MCP_TOOL_NAMES.BROWSER_MOUSE_UP]: coordinateClickSchema,
  [MCP_TOOL_NAMES.BROWSER_MOUSE_DRAG_XY]: coordinateDragSchema,
  [MCP_TOOL_NAMES.BROWSER_MOUSE_WHEEL_XY]: wheelSchema,
  [MCP_TOOL_NAMES.BROWSER_WAIT_FOR]: waitForSchema,
  [MCP_TOOL_NAMES.BROWSER_EVALUATE]: evaluateSchema,
  [MCP_TOOL_NAMES.BROWSER_HANDLE_DIALOG]: dialogSchema,
  [MCP_TOOL_NAMES.BROWSER_STORAGE_STATE]: storageStateSchema,
  [MCP_TOOL_NAMES.BROWSER_COOKIE_LIST]: cookieListSchema,
  [MCP_TOOL_NAMES.BROWSER_COOKIE_SET]: cookieSetSchema,
  [MCP_TOOL_NAMES.BROWSER_COOKIE_DELETE]: cookieDeleteSchema,
  [MCP_TOOL_NAMES.BROWSER_CONSOLE_MESSAGES]: consoleMessagesSchema,
  [MCP_TOOL_NAMES.BROWSER_SET_DOM_VALUE]: setDomValueSchema,
  [MCP_TOOL_NAMES.BROWSER_NETWORK_START_RECORDING]: networkStartSchema,
  [MCP_TOOL_NAMES.BROWSER_NETWORK_STOP_RECORDING]: noArgSchema,
  [MCP_TOOL_NAMES.BROWSER_NETWORK_CLEAR]: noArgSchema,
  [MCP_TOOL_NAMES.BROWSER_NETWORK_REQUESTS]: networkListSchema,
  [MCP_TOOL_NAMES.BROWSER_NETWORK_LIST_REQUESTS]: networkListSchema,
  [MCP_TOOL_NAMES.BROWSER_NETWORK_GET_REQUEST]: networkGetSchema,
  [MCP_TOOL_NAMES.BROWSER_NETWORK_GET_RESPONSE_BODY]: networkGetBodySchema,
  [MCP_TOOL_NAMES.BROWSER_DEBUGGER_DETACH]: debuggerDetachSchema,
  [MCP_TOOL_NAMES.BROWSER_PROXY_ENABLE]: noArgSchema,
  [MCP_TOOL_NAMES.BROWSER_PROXY_DISABLE]: noArgSchema,
  [MCP_TOOL_NAMES.BROWSER_PROXY_LIST_RULES]: noArgSchema,
  [MCP_TOOL_NAMES.BROWSER_PROXY_UPSERT_RULE]: proxyRuleSchema,
  [MCP_TOOL_NAMES.BROWSER_PROXY_REMOVE_RULE]: removeProxyRuleSchema,
  [MCP_TOOL_NAMES.BROWSER_PROXY_CLEAR_RULES]: noArgSchema,
  [MCP_TOOL_NAMES.BROWSER_PROXY_LIST_HITS]: listProxyHitsSchema,
  [MCP_TOOL_NAMES.BROWSER_LIST_NETWORK_RULES]: noArgSchema,
  [MCP_TOOL_NAMES.BROWSER_UPSERT_HEADER_RULE]: upsertHeaderRuleSchema,
  [MCP_TOOL_NAMES.BROWSER_UPSERT_GET_MOCK]: upsertGetMockSchema,
  [MCP_TOOL_NAMES.BROWSER_REMOVE_NETWORK_RULE]: removeNetworkRuleSchema,
  [MCP_TOOL_NAMES.BROWSER_APPLY_CSS_PATCH]: applyCssPatchSchema,
  [MCP_TOOL_NAMES.BROWSER_REMOVE_CSS_PATCH]: removeCssPatchSchema,
};

export const MCP_TOOL_INPUT_SCHEMAS = Object.fromEntries(
  Object.entries(MCP_TOOL_INPUT_SCHEMA_BASE).map(([name, schema]) => [
    name,
    makeStrictInputSchema(schema),
  ]),
) as Record<McpToolName, ZodTypeAny>;

export interface McpRuntimeToolRegistration {
  definition: (typeof MCP_EXPOSED_TOOL_DEFINITIONS)[number];
  inputSchema: ZodTypeAny;
  outputSchema: ZodTypeAny;
  annotations: ReturnType<typeof getToolPolicyAnnotations>;
  policyClass: ToolPolicyClass;
  execute: (
    args: Record<string, unknown>,
    pluginBridge: PluginWebSocketServer,
  ) => Promise<unknown>;
}

export const MCP_RUNTIME_TOOL_REGISTRY: readonly McpRuntimeToolRegistration[] =
  MCP_EXPOSED_TOOL_DEFINITIONS.map((definition) => ({
    definition,
    inputSchema: MCP_TOOL_INPUT_SCHEMAS[definition.name],
    outputSchema: MCP_TOOL_OUTPUT_SCHEMAS[definition.name],
    annotations: getToolPolicyAnnotations(definition.name),
    policyClass: getToolPolicy(definition.name).policyClass,
    execute: (args, pluginBridge) =>
      executeMcpToolData(definition.name, args, pluginBridge),
  }));

export type McpToolProfile = "inspect" | "read" | "full";

export function parseMcpToolProfile(value: string | undefined): McpToolProfile {
  const normalized = value?.trim().toLowerCase() || "full";
  if (normalized === "inspect" || normalized === "read" || normalized === "full") {
    return normalized;
  }
  throw new Error(
    `Invalid AI_DEVTOOLS_MCP_TOOL_PROFILE: ${value}. Expected inspect, read, or full.`,
  );
}

export function runtimeToolsForProfile(
  profile: McpToolProfile,
): readonly McpRuntimeToolRegistration[] {
  if (profile === "full") {
    return MCP_RUNTIME_TOOL_REGISTRY;
  }
  const allowed =
    profile === "inspect"
      ? new Set<ToolPolicyClass>(["safe_read"])
      : new Set<ToolPolicyClass>(["safe_read", "sensitive_read"]);
  return MCP_RUNTIME_TOOL_REGISTRY.filter((registration) =>
    allowed.has(registration.policyClass),
  );
}

export function listRuntimeMcpTools(): McpAvailableTool[] {
  return MCP_RUNTIME_TOOL_REGISTRY.map(({ definition }) => ({
    name: definition.name,
    title: definition.title,
    description: definition.description,
    inputSchema: definition.parameters as McpAvailableTool["inputSchema"],
    outputSchema: mcpToolOutputJsonSchema(
      definition.name,
    ) as McpAvailableTool["outputSchema"],
  }));
}

export function registerSharedMcpTools(
  server: McpServer,
  pluginBridge: PluginWebSocketServer,
): void {
  for (const registration of MCP_RUNTIME_TOOL_REGISTRY) {
    const { definition } = registration;
    server.registerTool(
      definition.name,
      {
        title: definition.title,
        description: definition.description,
        inputSchema: registration.inputSchema,
        outputSchema: registration.outputSchema,
        annotations: registration.annotations,
      },
      async (args) => {
        try {
          const data = await registration.execute(
            args as Record<string, unknown>,
            pluginBridge,
          );

          return formatMcpToolResult(data, isToolDataError(data));
        } catch (error) {
          return formatMcpToolResult(
            {
              error:
                error instanceof Error ? error.message : "MCP tool failed.",
            },
            true,
          );
        }
      },
    );
  }
}

export function registerProxyMcpTools(
  server: McpServer,
  backend: {
    callTool: (
      toolName: string,
      args: Record<string, unknown>,
      options?: {
        signal?: AbortSignal;
        idempotencyKey?: string;
      },
    ) => Promise<unknown>;
  },
  options: { profile?: McpToolProfile } = {},
): void {
  for (const registration of runtimeToolsForProfile(options.profile ?? "full")) {
    const { definition } = registration;
    server.registerTool(
      definition.name,
      {
        title: definition.title,
        description: definition.description,
        inputSchema: registration.inputSchema,
        outputSchema: registration.outputSchema,
        annotations: registration.annotations,
      },
      async (args, extra) => {
        try {
          const data = await backend.callTool(
            definition.name,
            args as Record<string, unknown>,
            {
              signal: extra.signal,
              idempotencyKey: `mcp:${String(extra.requestId)}`,
            },
          );
          return formatMcpToolResult(data, isToolDataError(data));
        } catch (error) {
          return formatMcpToolResult(
            {
              error:
                error instanceof Error ? error.message : "Daemon tool call failed.",
            },
            true,
          );
        }
      },
    );
  }
}

export async function executeMcpToolData(
  toolName: string,
  rawArgs: Record<string, unknown>,
  pluginBridge: PluginWebSocketServer,
  context: {
    sessionId?: string;
    listAuditEvents?: () => Promise<RedactedAuditEvent[]>;
  } = {},
): Promise<unknown> {
  const normalizedToolName = normalizeMcpToolName(toolName);
  if (!normalizedToolName) {
    throw new Error(`Unsupported MCP tool: ${toolName}`);
  }

  const parsedArgs = parseMcpToolArgs(normalizedToolName, rawArgs);

  switch (normalizedToolName) {
    case MCP_TOOL_NAMES.BROWSER_GET_SELECTED_ELEMENT:
      return readSelectedElementResource(context.sessionId);
    case MCP_TOOL_NAMES.BROWSER_GET_CONTEXT_DIGEST:
      return readContextDigestResource(context.sessionId);
    case MCP_TOOL_NAMES.BROWSER_GET_PLUGIN_CONVERSATION:
      return readPluginConversationPage(parsedArgs, context.sessionId);
    case MCP_TOOL_NAMES.BROWSER_GET_AUDIT_EVENTS:
      return readAuditEventPage(
        parsedArgs,
        context.sessionId,
        context.listAuditEvents,
      );
    case MCP_TOOL_NAMES.BROWSER_GET_LAST_PLUGIN_MESSAGE:
      return readBrowserStateResource("lastPluginMessage", context.sessionId);
    case MCP_TOOL_NAMES.BROWSER_GET_PAGE_CONTEXT:
      return readPageContext(pluginBridge, context.sessionId);
    case MCP_TOOL_NAMES.BROWSER_SNAPSHOT:
      return readSemanticSnapshot(pluginBridge, parsedArgs, context.sessionId);
    case MCP_TOOL_NAMES.BROWSER_QUERY_DOM:
      return proxyBrowserTool(pluginBridge, {
        id: createMessageId(),
        toolName: TOOL_NAMES.DOM_QUERY,
        args: {
          query:
            (parsedArgs.query as string | undefined) ??
            (parsedArgs.selector as string),
          queryType:
            parsedArgs.queryType === "className"
              ? "className"
              : parsedArgs.queryType === "xpath"
                ? "xpath"
                : "selector",
          limit:
            typeof parsedArgs.limit === "number" ? parsedArgs.limit : undefined,
          includeText:
            typeof parsedArgs.includeText === "boolean"
              ? parsedArgs.includeText
              : undefined,
          includeOuterHTML:
            typeof parsedArgs.includeOuterHTML === "boolean"
              ? parsedArgs.includeOuterHTML
              : undefined,
          includeComputedStyle:
            typeof parsedArgs.includeComputedStyle === "boolean"
              ? parsedArgs.includeComputedStyle
              : undefined,
          maxTextLength:
            typeof parsedArgs.maxTextLength === "number"
              ? parsedArgs.maxTextLength
              : undefined,
          maxOuterHTMLLength:
            typeof parsedArgs.maxOuterHTMLLength === "number"
              ? parsedArgs.maxOuterHTMLLength
              : undefined,
        },
      });
    case MCP_TOOL_NAMES.BROWSER_START_ELEMENT_PICKER:
      return proxyBrowserTool(pluginBridge, {
        id: createMessageId(),
        toolName: TOOL_NAMES.DOM_START_ELEMENT_PICK,
        args: {},
      });
    case MCP_TOOL_NAMES.BROWSER_CANCEL_ELEMENT_PICKER:
      return proxyBrowserTool(pluginBridge, {
        id: createMessageId(),
        toolName: TOOL_NAMES.DOM_CANCEL_ELEMENT_PICK,
        args: {},
      });
    case MCP_TOOL_NAMES.BROWSER_HIGHLIGHT_ELEMENT:
      return proxyBrowserTool(pluginBridge, {
        id: createMessageId(),
        toolName: TOOL_NAMES.DOM_HIGHLIGHT_ELEMENT,
        args: {
          selector: parsedArgs.selector as string,
          durationMs:
            typeof parsedArgs.durationMs === "number"
              ? parsedArgs.durationMs
              : undefined,
        },
      });
    case MCP_TOOL_NAMES.BROWSER_CLEAR_HIGHLIGHTS:
      return proxyBrowserTool(pluginBridge, {
        id: createMessageId(),
        toolName: TOOL_NAMES.DOM_CLEAR_HIGHLIGHTS,
        args: {},
      });
    case MCP_TOOL_NAMES.BROWSER_TAKE_SCREENSHOT:
      return proxyBrowserTool(pluginBridge, {
        id: createMessageId(),
        toolName: TOOL_NAMES.BROWSER_TAKE_SCREENSHOT,
        args: parsedArgs,
      } as unknown as AnyToolCall);
    case MCP_TOOL_NAMES.BROWSER_LIST_TABS:
      return proxyBrowserTool(pluginBridge, {
        id: createMessageId(),
        toolName: TOOL_NAMES.BROWSER_LIST_TABS,
        args: {},
      });
    case MCP_TOOL_NAMES.BROWSER_SET_TARGET_TAB:
      return proxyBrowserTool(pluginBridge, {
        id: createMessageId(),
        toolName: TOOL_NAMES.BROWSER_SET_TARGET_TAB,
        args: { tabId: parsedArgs.tabId as number },
      });
    case MCP_TOOL_NAMES.BROWSER_LIST_FRAMES:
      return proxyBrowserTool(pluginBridge, {
        id: createMessageId(),
        toolName: TOOL_NAMES.BROWSER_LIST_FRAMES,
        args: {},
      });
    case MCP_TOOL_NAMES.BROWSER_SET_TARGET_FRAME:
      return proxyBrowserTool(pluginBridge, {
        id: createMessageId(),
        toolName: TOOL_NAMES.BROWSER_SET_TARGET_FRAME,
        args: {
          frameId: parsedArgs.frameId as number,
          documentId: parsedArgs.documentId as string | undefined,
        },
      });
    case MCP_TOOL_NAMES.BROWSER_NAVIGATE:
      return proxyBrowserTool(pluginBridge, {
        id: createMessageId(),
        toolName: TOOL_NAMES.BROWSER_NAVIGATE,
        args: {
          url: parsedArgs.url as string,
        },
      });
    case MCP_TOOL_NAMES.BROWSER_NAVIGATE_BACK:
      return proxyBrowserTool(pluginBridge, {
        id: createMessageId(),
        toolName: TOOL_NAMES.BROWSER_NAVIGATE_BACK,
        args: {},
      });
    case MCP_TOOL_NAMES.BROWSER_NAVIGATE_FORWARD:
      return proxyBrowserTool(pluginBridge, {
        id: createMessageId(),
        toolName: TOOL_NAMES.BROWSER_NAVIGATE_FORWARD,
        args: {},
      });
    case MCP_TOOL_NAMES.BROWSER_RELOAD:
      return proxyBrowserTool(pluginBridge, {
        id: createMessageId(),
        toolName: TOOL_NAMES.BROWSER_RELOAD,
        args: {},
      });
    case MCP_TOOL_NAMES.BROWSER_CLOSE:
      return proxyBrowserTool(pluginBridge, {
        id: createMessageId(),
        toolName: TOOL_NAMES.BROWSER_CLOSE,
        args: {},
      });
    case MCP_TOOL_NAMES.BROWSER_RESIZE:
      return proxyBrowserTool(pluginBridge, {
        id: createMessageId(),
        toolName: TOOL_NAMES.BROWSER_RESIZE,
        args: {
          width: parsedArgs.width as number,
          height: parsedArgs.height as number,
        },
      });
    case MCP_TOOL_NAMES.BROWSER_CLICK:
      return proxyBrowserTool(pluginBridge, {
        id: createMessageId(),
        toolName: TOOL_NAMES.BROWSER_CLICK,
        args: parsedArgs,
      } as unknown as AnyToolCall);
    case MCP_TOOL_NAMES.BROWSER_HOVER:
      return proxyBrowserTool(pluginBridge, {
        id: createMessageId(),
        toolName: TOOL_NAMES.BROWSER_HOVER,
        args: parsedArgs,
      } as unknown as AnyToolCall);
    case MCP_TOOL_NAMES.BROWSER_DRAG:
      return proxyBrowserTool(pluginBridge, {
        id: createMessageId(),
        toolName: TOOL_NAMES.BROWSER_DRAG,
        args: parsedArgs,
      } as unknown as AnyToolCall);
    case MCP_TOOL_NAMES.BROWSER_FILL_FORM:
      return proxyBrowserTool(pluginBridge, {
        id: createMessageId(),
        toolName: TOOL_NAMES.BROWSER_FILL_FORM,
        args: parsedArgs,
      } as unknown as AnyToolCall);
    case MCP_TOOL_NAMES.BROWSER_EXECUTE_ACTION_STAGE:
      return executeActionStage(pluginBridge, parsedArgs);
    case MCP_TOOL_NAMES.BROWSER_TYPE:
      return proxyBrowserTool(pluginBridge, {
        id: createMessageId(),
        toolName: TOOL_NAMES.BROWSER_TYPE,
        args: parsedArgs,
      } as unknown as AnyToolCall);
    case MCP_TOOL_NAMES.BROWSER_PRESS_KEY:
      return proxyBrowserTool(pluginBridge, {
        id: createMessageId(),
        toolName: TOOL_NAMES.BROWSER_PRESS_KEY,
        args: parsedArgs,
      } as unknown as AnyToolCall);
    case MCP_TOOL_NAMES.BROWSER_SELECT_OPTION:
      return proxyBrowserTool(pluginBridge, {
        id: createMessageId(),
        toolName: TOOL_NAMES.BROWSER_SELECT_OPTION,
        args: parsedArgs,
      } as unknown as AnyToolCall);
    case MCP_TOOL_NAMES.BROWSER_MOUSE_MOVE_XY:
      return proxyBrowserTool(pluginBridge, {
        id: createMessageId(),
        toolName: TOOL_NAMES.BROWSER_MOUSE_MOVE,
        args: parsedArgs,
      } as unknown as AnyToolCall);
    case MCP_TOOL_NAMES.BROWSER_MOUSE_CLICK_XY:
      return proxyBrowserTool(pluginBridge, {
        id: createMessageId(),
        toolName: TOOL_NAMES.BROWSER_MOUSE_CLICK,
        args: parsedArgs,
      } as unknown as AnyToolCall);
    case MCP_TOOL_NAMES.BROWSER_MOUSE_DOWN:
      return proxyBrowserTool(pluginBridge, {
        id: createMessageId(),
        toolName: TOOL_NAMES.BROWSER_MOUSE_DOWN,
        args: parsedArgs,
      } as unknown as AnyToolCall);
    case MCP_TOOL_NAMES.BROWSER_MOUSE_UP:
      return proxyBrowserTool(pluginBridge, {
        id: createMessageId(),
        toolName: TOOL_NAMES.BROWSER_MOUSE_UP,
        args: parsedArgs,
      } as unknown as AnyToolCall);
    case MCP_TOOL_NAMES.BROWSER_MOUSE_DRAG_XY:
      return proxyBrowserTool(pluginBridge, {
        id: createMessageId(),
        toolName: TOOL_NAMES.BROWSER_MOUSE_DRAG,
        args: parsedArgs,
      } as unknown as AnyToolCall);
    case MCP_TOOL_NAMES.BROWSER_MOUSE_WHEEL_XY:
      return proxyBrowserTool(pluginBridge, {
        id: createMessageId(),
        toolName: TOOL_NAMES.BROWSER_MOUSE_WHEEL,
        args: parsedArgs,
      } as unknown as AnyToolCall);
    case MCP_TOOL_NAMES.BROWSER_WAIT_FOR:
      return proxyBrowserTool(pluginBridge, {
        id: createMessageId(),
        toolName: TOOL_NAMES.BROWSER_WAIT_FOR,
        args: parsedArgs,
      } as unknown as AnyToolCall);
    case MCP_TOOL_NAMES.BROWSER_EVALUATE:
      return proxyBrowserTool(pluginBridge, {
        id: createMessageId(),
        toolName: TOOL_NAMES.BROWSER_EVALUATE,
        args: parsedArgs,
      } as unknown as AnyToolCall);
    case MCP_TOOL_NAMES.BROWSER_HANDLE_DIALOG:
      return proxyBrowserTool(pluginBridge, {
        id: createMessageId(),
        toolName: TOOL_NAMES.BROWSER_HANDLE_DIALOG,
        args: parsedArgs,
      } as unknown as AnyToolCall);
    case MCP_TOOL_NAMES.BROWSER_STORAGE_STATE:
      return proxyBrowserTool(pluginBridge, {
        id: createMessageId(),
        toolName: TOOL_NAMES.BROWSER_STORAGE_STATE,
        args: parsedArgs,
      } as unknown as AnyToolCall);
    case MCP_TOOL_NAMES.BROWSER_COOKIE_LIST:
      return proxyBrowserTool(pluginBridge, {
        id: createMessageId(),
        toolName: TOOL_NAMES.BROWSER_COOKIE_LIST,
        args: parsedArgs,
      } as unknown as AnyToolCall);
    case MCP_TOOL_NAMES.BROWSER_COOKIE_SET:
      return proxyBrowserTool(pluginBridge, {
        id: createMessageId(),
        toolName: TOOL_NAMES.BROWSER_COOKIE_SET,
        args: parsedArgs,
      } as unknown as AnyToolCall);
    case MCP_TOOL_NAMES.BROWSER_COOKIE_DELETE:
      return proxyBrowserTool(pluginBridge, {
        id: createMessageId(),
        toolName: TOOL_NAMES.BROWSER_COOKIE_DELETE,
        args: parsedArgs,
      } as unknown as AnyToolCall);
    case MCP_TOOL_NAMES.BROWSER_CONSOLE_MESSAGES:
      return proxyBrowserTool(pluginBridge, {
        id: createMessageId(),
        toolName: TOOL_NAMES.BROWSER_CONSOLE_MESSAGES,
        args: parsedArgs,
      });
    case MCP_TOOL_NAMES.BROWSER_SET_DOM_VALUE:
      return proxyBrowserTool(pluginBridge, {
        id: createMessageId(),
        toolName: TOOL_NAMES.DOM_SET_VALUE,
        args: {
          selector: parsedArgs.selector as string,
          value: parsedArgs.value as string,
          target:
            typeof parsedArgs.target === "string"
              ? (parsedArgs.target as
                  | "auto"
                  | "value"
                  | "textContent"
                  | "innerText"
                  | "attribute")
              : undefined,
          attributeName:
            typeof parsedArgs.attributeName === "string"
              ? parsedArgs.attributeName
              : undefined,
          dispatchEvents:
            typeof parsedArgs.dispatchEvents === "boolean"
              ? parsedArgs.dispatchEvents
              : undefined,
        },
      });
    case MCP_TOOL_NAMES.BROWSER_NETWORK_START_RECORDING:
      return proxyBrowserTool(pluginBridge, {
        id: createMessageId(),
        toolName: TOOL_NAMES.DEBUGGER_NETWORK_START,
        args: {
          preserveLog:
            typeof parsedArgs.preserveLog === "boolean"
              ? parsedArgs.preserveLog
              : undefined,
          maxEntries:
            typeof parsedArgs.maxEntries === "number"
              ? parsedArgs.maxEntries
              : undefined,
        },
      });
    case MCP_TOOL_NAMES.BROWSER_NETWORK_STOP_RECORDING:
      return proxyBrowserTool(pluginBridge, {
        id: createMessageId(),
        toolName: TOOL_NAMES.DEBUGGER_NETWORK_STOP,
        args: {},
      });
    case MCP_TOOL_NAMES.BROWSER_NETWORK_CLEAR:
      return proxyBrowserTool(pluginBridge, {
        id: createMessageId(),
        toolName: TOOL_NAMES.DEBUGGER_NETWORK_CLEAR,
        args: {},
      });
    case MCP_TOOL_NAMES.BROWSER_NETWORK_REQUESTS:
    case MCP_TOOL_NAMES.BROWSER_NETWORK_LIST_REQUESTS:
      return proxyBrowserTool(pluginBridge, {
        id: createMessageId(),
        toolName: TOOL_NAMES.DEBUGGER_NETWORK_LIST,
        args: {
          cursor:
            typeof parsedArgs.cursor === "string"
              ? parsedArgs.cursor
              : undefined,
          limit:
            typeof parsedArgs.limit === "number" ? parsedArgs.limit : undefined,
          urlContains:
            typeof parsedArgs.urlContains === "string"
              ? parsedArgs.urlContains
              : undefined,
          method:
            typeof parsedArgs.method === "string" ? parsedArgs.method : undefined,
          resourceType:
            typeof parsedArgs.resourceType === "string"
              ? parsedArgs.resourceType
              : undefined,
          statusMin:
            typeof parsedArgs.statusMin === "number"
              ? parsedArgs.statusMin
              : undefined,
          statusMax:
            typeof parsedArgs.statusMax === "number"
              ? parsedArgs.statusMax
              : undefined,
          digestOnly:
            typeof parsedArgs.digestOnly === "boolean"
              ? parsedArgs.digestOnly
              : undefined,
        },
      });
    case MCP_TOOL_NAMES.BROWSER_NETWORK_GET_REQUEST:
      return proxyBrowserTool(pluginBridge, {
        id: createMessageId(),
        toolName: TOOL_NAMES.DEBUGGER_NETWORK_GET,
        args: {
          requestId: parsedArgs.requestId as string,
          includeBody:
            typeof parsedArgs.includeBody === "boolean"
              ? parsedArgs.includeBody
              : undefined,
        },
      });
    case MCP_TOOL_NAMES.BROWSER_NETWORK_GET_RESPONSE_BODY:
      return proxyBrowserTool(pluginBridge, {
        id: createMessageId(),
        toolName: TOOL_NAMES.DEBUGGER_NETWORK_GET_BODY,
        args: {
          requestId: parsedArgs.requestId as string,
        },
      });
    case MCP_TOOL_NAMES.BROWSER_DEBUGGER_DETACH:
      return proxyBrowserTool(pluginBridge, {
        id: createMessageId(),
        toolName: TOOL_NAMES.DEBUGGER_DETACH,
        args: {
          tabId:
            typeof parsedArgs.tabId === "number" ? parsedArgs.tabId : undefined,
        },
      });
    case MCP_TOOL_NAMES.BROWSER_PROXY_ENABLE:
      return proxyBrowserTool(pluginBridge, {
        id: createMessageId(),
        toolName: TOOL_NAMES.DEBUGGER_PROXY_ENABLE,
        args: {},
      });
    case MCP_TOOL_NAMES.BROWSER_PROXY_DISABLE:
      return proxyBrowserTool(pluginBridge, {
        id: createMessageId(),
        toolName: TOOL_NAMES.DEBUGGER_PROXY_DISABLE,
        args: {},
      });
    case MCP_TOOL_NAMES.BROWSER_PROXY_LIST_RULES:
      return proxyBrowserTool(pluginBridge, {
        id: createMessageId(),
        toolName: TOOL_NAMES.DEBUGGER_PROXY_LIST_RULES,
        args: {},
      });
    case MCP_TOOL_NAMES.BROWSER_PROXY_UPSERT_RULE:
      return proxyBrowserTool(pluginBridge, {
        id: createMessageId(),
        toolName: TOOL_NAMES.DEBUGGER_PROXY_UPSERT_RULE,
        args: parsedArgs,
      } as unknown as AnyToolCall);
    case MCP_TOOL_NAMES.BROWSER_PROXY_REMOVE_RULE:
      return proxyBrowserTool(pluginBridge, {
        id: createMessageId(),
        toolName: TOOL_NAMES.DEBUGGER_PROXY_REMOVE_RULE,
        args: {
          id: parsedArgs.id as string,
        },
      });
    case MCP_TOOL_NAMES.BROWSER_PROXY_CLEAR_RULES:
      return proxyBrowserTool(pluginBridge, {
        id: createMessageId(),
        toolName: TOOL_NAMES.DEBUGGER_PROXY_CLEAR_RULES,
        args: {},
      });
    case MCP_TOOL_NAMES.BROWSER_PROXY_LIST_HITS:
      return proxyBrowserTool(pluginBridge, {
        id: createMessageId(),
        toolName: TOOL_NAMES.DEBUGGER_PROXY_LIST_HITS,
        args: {
          limit:
            typeof parsedArgs.limit === "number" ? parsedArgs.limit : undefined,
          ruleId:
            typeof parsedArgs.ruleId === "string"
              ? parsedArgs.ruleId
              : undefined,
        },
      });
    case MCP_TOOL_NAMES.BROWSER_LIST_NETWORK_RULES:
      return proxyBrowserTool(pluginBridge, {
        id: createMessageId(),
        toolName: TOOL_NAMES.DNR_LIST_RULES,
        args: {},
      });
    case MCP_TOOL_NAMES.BROWSER_UPSERT_HEADER_RULE:
      return proxyBrowserTool(pluginBridge, {
        id: createMessageId(),
        toolName: TOOL_NAMES.DNR_UPSERT_HEADER_RULE,
        args: parsedArgs,
      } as unknown as AnyToolCall);
    case MCP_TOOL_NAMES.BROWSER_UPSERT_GET_MOCK:
      return proxyBrowserTool(pluginBridge, {
        id: createMessageId(),
        toolName: TOOL_NAMES.MOCK_UPSERT_GET,
        args: parsedArgs,
      } as unknown as AnyToolCall);
    case MCP_TOOL_NAMES.BROWSER_REMOVE_NETWORK_RULE:
      return proxyBrowserTool(pluginBridge, {
        id: createMessageId(),
        toolName: TOOL_NAMES.DNR_REMOVE_RULE,
        args: {
          ruleId: parsedArgs.ruleId as number,
        },
      });
    case MCP_TOOL_NAMES.BROWSER_APPLY_CSS_PATCH:
      return proxyBrowserTool(pluginBridge, {
        id: createMessageId(),
        toolName: TOOL_NAMES.CSS_APPLY_PATCH,
        args: {
          patchId:
            typeof parsedArgs.patchId === "string"
              ? parsedArgs.patchId
              : `mcp-css-${Date.now()}`,
          css: parsedArgs.css as string,
        },
      });
    case MCP_TOOL_NAMES.BROWSER_REMOVE_CSS_PATCH:
      return proxyBrowserTool(pluginBridge, {
        id: createMessageId(),
        toolName: TOOL_NAMES.CSS_REMOVE_PATCH,
        args: {
          patchId: parsedArgs.patchId as string,
        },
      });
    default:
      throw new Error(`Unsupported MCP tool: ${normalizedToolName}`);
  }
}

export function parseMcpToolArgs(
  toolName: McpToolName,
  rawArgs: Record<string, unknown>,
): Record<string, unknown> {
  const parsed = MCP_TOOL_INPUT_SCHEMAS[toolName].safeParse(rawArgs ?? {});
  if (parsed.success) {
    return parsed.data as Record<string, unknown>;
  }

  const detail = parsed.error.issues.map((issue) => issue.message).join("; ");
  throw new Error(`${toolName} arguments invalid: ${detail}`);
}

export function readPluginConversationPage(
  args: Record<string, unknown>,
  sessionId?: string,
): Record<string, unknown> {
  const state = getBrowserStateSnapshot(sessionId);
  const messages = state.pluginConversation.filter(
    (message) =>
      !message.conversationId ||
      message.conversationId === state.currentConversationId,
  );
  const page = paginateCollection(
    messages,
    {
      ...(typeof args.cursor === "string" ? { cursor: args.cursor } : {}),
      ...(typeof args.limit === "number" ? { limit: args.limit } : {}),
    },
    {
      kind: "conversation",
      sourceKey: `${state.sessionId}:${state.currentConversationId}`,
      defaultLimit: 20,
      maxLimit: 50,
    },
  );

  return {
    browserConnected: state.browserConnected,
    pluginConnected: state.pluginConnected,
    sessionId: state.sessionId,
    currentConversationId: state.currentConversationId,
    messages: page.items,
    pagination: page.pagination,
    lastSeenAt: state.lastSeenAt,
    stateUpdatedAt: state.stateUpdatedAt,
    artifactCapturedAt: state.artifactCapturedAt,
    updatedAt: state.stateUpdatedAt,
  };
}

export async function readAuditEventPage(
  args: Record<string, unknown>,
  sessionId: string | undefined,
  listAuditEvents: (() => Promise<RedactedAuditEvent[]>) | undefined,
): Promise<Record<string, unknown>> {
  if (!sessionId) {
    throw new Error(
      "AUDIT_SESSION_UNBOUND: select a Chrome Profile session before reading audit events.",
    );
  }
  if (!listAuditEvents) {
    throw new Error(
      "AUDIT_STORE_UNAVAILABLE: daemon audit storage is not available on this MCP transport.",
    );
  }

  const eventType = args.eventType as AuditEventType | undefined;
  const toolName = args.toolName as string | undefined;
  const outcome = args.outcome as RedactedAuditEvent["outcome"] | undefined;
  const events = (await listAuditEvents()).filter(
    (event) =>
      event.sessionId === sessionId &&
      (!eventType || event.eventType === eventType) &&
      (!toolName || event.toolName === toolName) &&
      (!outcome || event.outcome === outcome),
  );
  const filters = {
    ...(eventType ? { eventType } : {}),
    ...(toolName ? { toolName } : {}),
    ...(outcome ? { outcome } : {}),
  };
  const page = paginateCollection(
    events,
    {
      ...(typeof args.cursor === "string" ? { cursor: args.cursor } : {}),
      ...(typeof args.limit === "number" ? { limit: args.limit } : {}),
    },
    {
      kind: "audit",
      sourceKey: `${sessionId}:${JSON.stringify(filters)}`,
      defaultLimit: 50,
      maxLimit: 100,
    },
  );

  return {
    sessionId,
    filters,
    events: page.items,
    pagination: page.pagination,
  };
}

async function readPageContext(
  pluginBridge: PluginWebSocketServer,
  sessionId?: string,
): Promise<unknown> {
  if (pluginBridge.connectedPluginClients() > 0) {
    try {
      return await proxyBrowserTool(pluginBridge, {
        id: createMessageId(),
        toolName: TOOL_NAMES.DOM_GET_PAGE_INFO,
        args: {},
      });
    } catch (error) {
      const cached = cachedPageContextPayload(sessionId);
      if (!isToolDataError(cached)) {
        return {
          ...cached,
          warning:
            error instanceof Error
              ? `Fresh page read failed, returning cached page context: ${error.message}`
              : "Fresh page read failed, returning cached page context.",
        };
      }
      throw error;
    }
  }

  return cachedPageContextPayload(sessionId);
}

async function readSemanticSnapshot(
  pluginBridge: PluginWebSocketServer,
  args: Record<string, unknown>,
  sessionId?: string,
): Promise<unknown> {
  const stateBeforeRead = getBrowserStateSnapshot(sessionId);
  const value = await proxyBrowserTool(pluginBridge, {
    id: createMessageId(),
    toolName: TOOL_NAMES.DOM_GET_PAGE_INFO,
    args: {
      ...(typeof args.cursor === "string" ? { cursor: args.cursor } : {}),
      ...(typeof args.limit === "number" ? { limit: args.limit } : {}),
      ...(args.mode === "interactive" ||
      args.mode === "outline" ||
      args.mode === "full"
        ? { mode: args.mode }
        : {}),
      ...(typeof args.sourceLimit === "number"
        ? { sourceLimit: args.sourceLimit }
        : {}),
      ...(typeof args.sinceRevision === "number"
        ? { sinceRevision: args.sinceRevision }
        : {}),
    },
  });
  if (!isSemanticPageSnapshot(value)) {
    throw new Error(
      "SEMANTIC_SNAPSHOT_UNAVAILABLE: reload the current extension build and retry browser_snapshot.",
    );
  }
  const stateAfterRead = getBrowserStateSnapshot(sessionId);
  const capturedTarget = value.provenance?.target;
  if (
    stateBeforeRead.activeTab &&
    !sameBrowserTarget(stateBeforeRead.activeTab, stateAfterRead.activeTab)
  ) {
    throw new Error(
      "STALE_CONTEXT: the selected browser target changed while the semantic snapshot was captured; retry browser_snapshot.",
    );
  }
  if (
    capturedTarget &&
    stateBeforeRead.activeTab &&
    !sameBrowserTarget(stateBeforeRead.activeTab, capturedTarget)
  ) {
    throw new Error(
      "STALE_CONTEXT: semantic snapshot provenance does not match the selected browser target; retry browser_snapshot.",
    );
  }
  if (
    capturedTarget &&
    stateAfterRead.activeTab &&
    !sameBrowserTarget(stateAfterRead.activeTab, capturedTarget)
  ) {
    throw new Error(
      "STALE_CONTEXT: semantic snapshot provenance does not match the browser session state; retry browser_snapshot.",
    );
  }
  return {
    version: "browser-semantic-snapshot-v1",
    page: {
      url: value.url,
      title: value.title,
      origin: value.origin,
      capturedAt: value.capturedAt,
    },
    target:
      capturedTarget ??
      stateBeforeRead.activeTab ??
      stateAfterRead.activeTab ??
      null,
    freshness: {
      source: "live-browser",
      capturedAt: value.capturedAt,
      observedAt: value.provenance?.observedAt ?? new Date().toISOString(),
      revision:
        stateBeforeRead.activeTab
          ? stateBeforeRead.revision
          : stateAfterRead.revision,
      navigationRevision: capturedTarget?.revision,
      stale: false,
    },
    snapshot: value.semanticSnapshot,
    observation: {
      mode: value.mode ?? "interactive",
      sourceVisited: value.sourceVisited ?? value.nodeCount,
      sourceLimit: value.sourceLimit ?? 2000,
      domRevision: value.domRevision ?? 0,
      delta: value.delta ?? null,
      truncated: value.truncated,
    },
  };
}

type ParsedActionStage = z.infer<typeof actionStageSchema>;

async function executeActionStage(
  pluginBridge: PluginWebSocketServer,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const stage = args as unknown as ParsedActionStage;
  for (const action of stage.actions) {
    if (
      "selector" in action &&
      action.selector &&
      !isNativeStageSelector(action.selector)
    ) {
      throw new Error(
        `INVALID_NATIVE_CSS_SELECTOR: action ${action.id} must use an exact native CSS selector from fresh page evidence.`,
      );
    }
  }

  const results: Array<Record<string, unknown>> = [];
  const succeeded = new Set<string>();
  let stoppedAt: string | undefined;
  let barrierReached = false;
  const stopOnFailure = stage.stopOnFailure !== false;

  for (let index = 0; index < stage.actions.length; ) {
    const action = stage.actions[index];
    if (!action) {
      break;
    }
    const dependenciesMet = (action.dependsOn ?? []).every((dependency) =>
      succeeded.has(dependency),
    );
    if (!dependenciesMet) {
      results.push({
        id: action.id,
        type: action.type,
        status: "skipped",
        error: "DEPENDENCY_NOT_SATISFIED",
      });
      index += 1;
      continue;
    }

    if (action.type === "fill" || action.type === "select") {
      const batch: Array<Extract<ParsedActionStage["actions"][number], { type: "fill" | "select" }>> = [];
      let cursor = index;
      while (cursor < stage.actions.length) {
        const candidate = stage.actions[cursor];
        if (!candidate) {
          break;
        }
        if (
          candidate.type !== "fill" &&
          candidate.type !== "select"
        ) {
          break;
        }
        if (
          candidate.barrier ||
          !(candidate.dependsOn ?? []).every((dependency) =>
            succeeded.has(dependency),
          )
        ) {
          break;
        }
        batch.push(candidate);
        cursor += 1;
      }
      if (batch.length === 0) {
        batch.push(action);
        cursor = index + 1;
      }
      try {
        const data = await proxyBrowserTool(pluginBridge, {
          id: createMessageId(),
          toolName: TOOL_NAMES.BROWSER_FILL_FORM,
          args: {
            fields: batch.map((entry) => ({
              selector: entry.selector,
              value: entry.type === "select" ? entry.values : entry.value,
            })),
          },
        } as unknown as AnyToolCall);
        for (const entry of batch) {
          succeeded.add(entry.id);
          results.push({
            id: entry.id,
            type: entry.type,
            status: "completed",
            expectedOutcome: entry.expectedOutcome,
          });
        }
        results.push({
          type: "batch_evidence",
          actionIds: batch.map((entry) => entry.id),
          data,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        for (const entry of batch) {
          results.push({
            id: entry.id,
            type: entry.type,
            status: "failed",
            error: message,
          });
        }
        stoppedAt = batch[0]?.id;
        if (stopOnFailure) break;
      }
      index = cursor;
      continue;
    }

    try {
      let data: unknown;
      if (action.type === "click") {
        data = await proxyBrowserTool(pluginBridge, {
          id: createMessageId(),
          toolName: TOOL_NAMES.BROWSER_CLICK,
          args: { selector: action.selector },
        } as unknown as AnyToolCall);
      } else if (action.type === "press_key") {
        data = await proxyBrowserTool(pluginBridge, {
          id: createMessageId(),
          toolName: TOOL_NAMES.BROWSER_PRESS_KEY,
          args: { key: action.key, selector: action.selector },
        } as unknown as AnyToolCall);
      } else if (action.type === "wait") {
        data = await proxyBrowserTool(pluginBridge, {
          id: createMessageId(),
          toolName: TOOL_NAMES.BROWSER_WAIT_FOR,
          args: {
            selector: action.selector,
            time: action.time,
            timeoutMs: action.timeoutMs,
          },
        } as unknown as AnyToolCall);
      } else {
        throw new Error("Unsupported action stage primitive.");
      }
      succeeded.add(action.id);
      results.push({
        id: action.id,
        type: action.type,
        status: "completed",
        data,
        expectedOutcome: action.expectedOutcome,
      });
      if (action.barrier) {
        barrierReached = true;
        stoppedAt = action.id;
        break;
      }
    } catch (error) {
      results.push({
        id: action.id,
        type: action.type,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
      stoppedAt = action.id;
      if (stopOnFailure) break;
    }
    index += 1;
  }

  return {
    version: "action-stage-v1",
    completed: succeeded.size,
    requested: stage.actions.length,
    stoppedAt: stoppedAt ?? null,
    barrierReached,
    requiresVerification: stage.actions.some(
      (action) => Boolean(action.expectedOutcome) || action.type !== "wait",
    ),
    results,
  };
}

function isNativeStageSelector(selector: string): boolean {
  const value = selector.trim();
  return Boolean(
    value &&
      !/(?:^|[\s>+~,])(?:text|xpath)\s*=|:has-text\s*\(|:contains\s*\(|>>|locator\s*\(/i.test(
        value,
      ),
  );
}

function sameBrowserTarget(
  left: import("../shared/wsProtocol").ActiveTabSnapshot | undefined,
  right: import("../shared/wsProtocol").ActiveTabSnapshot | undefined,
): boolean {
  if (!left || !right) return left === right;
  return (
    left.tabId === right.tabId &&
    left.targetId === right.targetId &&
    left.frameId === right.frameId &&
    left.documentId === right.documentId &&
    left.navigationId === right.navigationId &&
    left.url === right.url
  );
}

function isSemanticPageSnapshot(
  value: unknown,
): value is import("../shared/dom").PageSnapshot & {
  semanticSnapshot: import("../shared/semanticSnapshot").SemanticSnapshotCollection;
} {
  if (!value || typeof value !== "object") return false;
  const page = value as Record<string, unknown>;
  const semantic = page.semanticSnapshot;
  return (
    typeof page.url === "string" &&
    typeof page.title === "string" &&
    typeof page.origin === "string" &&
    typeof page.capturedAt === "string" &&
    Boolean(semantic) &&
    typeof semantic === "object" &&
    (semantic as { version?: unknown }).version === "semantic-snapshot-v1"
  );
}

function cachedPageContextPayload(sessionId?: string): Record<string, unknown> {
  const state = getBrowserStateSnapshot(sessionId);
  if (!state.pageContext) {
    return {
      pluginConnected: state.pluginConnected,
      error: state.pluginConnected
        ? "Chrome plugin is connected, but page context has not been synced yet."
        : "Chrome plugin is not connected to ws://127.0.0.1:17321, and no cached page context is available.",
      activeTab: state.activeTab ?? null,
      pageContext: null,
      lastSeenAt: state.lastSeenAt,
      stateUpdatedAt: state.stateUpdatedAt,
      artifactCapturedAt: state.artifactCapturedAt,
      updatedAt: state.stateUpdatedAt,
    };
  }

  return {
    pluginConnected: state.pluginConnected,
    warning: state.pluginConnected
      ? undefined
      : "Chrome plugin is not currently connected; returning the last cached page context.",
    activeTab: state.activeTab ?? null,
    pageContext: state.pageContext,
    lastSeenAt: state.lastSeenAt,
    stateUpdatedAt: state.stateUpdatedAt,
    artifactCapturedAt: state.artifactCapturedAt,
    updatedAt: state.stateUpdatedAt,
  };
}

async function proxyBrowserTool(
  pluginBridge: PluginWebSocketServer,
  call: AnyToolCall,
): Promise<unknown> {
  return pluginBridge.callBrowserTool(call);
}

function isToolDataError(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "string"
  );
}

type McpFormattedContent = Array<
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
>;

type McpSuccessToolResult = {
  isError: false;
  content: McpFormattedContent;
  structuredContent: Record<string, unknown>;
};

type McpErrorToolResult = {
  isError: true;
  content: McpFormattedContent;
};

export function formatMcpToolResult(value: unknown): McpSuccessToolResult;
export function formatMcpToolResult(
  value: unknown,
  isError: false,
): McpSuccessToolResult;
export function formatMcpToolResult(
  value: unknown,
  isError: true,
): McpErrorToolResult;
export function formatMcpToolResult(
  value: unknown,
  isError: boolean,
): McpSuccessToolResult | McpErrorToolResult;
export function formatMcpToolResult(
  value: unknown,
  isError = false,
): McpSuccessToolResult | McpErrorToolResult {
  const image = extractScreenshotImage(value);
  const structuredContent = toBoundedStructuredContent(value);
  const content: McpFormattedContent = [
    {
      type: "text",
      text: summarizeToolResult(structuredContent, image),
    },
  ];
  if (image) {
    content.push({
      type: "image",
      data: image.data,
      mimeType: image.mimeType,
    });
  }
  if (isError) {
    // MCP clients validate structuredContent against the tool's success
    // output schema. Error payloads intentionally have a different shape, so
    // keep them in textual content instead of turning the useful error into a
    // secondary output-schema validation failure.
    return {
      isError: true,
      content,
    };
  }
  return {
    isError: false,
    content,
    structuredContent,
  };
}

function makeStrictInputSchema(schema: ZodTypeAny): ZodTypeAny {
  const candidate = schema as ZodTypeAny & { strict?: () => ZodTypeAny };
  return typeof candidate.strict === "function" ? candidate.strict() : schema;
}

interface ScreenshotImageContent {
  data: string;
  mimeType: string;
  byteLength?: number;
  artifactUri?: string;
}

function extractScreenshotImage(value: unknown): ScreenshotImageContent | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const screenshot = value as Record<string, unknown>;
  if (
    (screenshot.mimeType !== "image/png" &&
      screenshot.mimeType !== "image/jpeg") ||
    typeof screenshot.dataUrl !== "string"
  ) {
    return undefined;
  }
  const prefix = `data:${screenshot.mimeType};base64,`;
  if (!screenshot.dataUrl.startsWith(prefix)) {
    return undefined;
  }
  const data = screenshot.dataUrl.slice(prefix.length);
  if (!data) {
    return undefined;
  }
  const artifact =
    screenshot.artifact && typeof screenshot.artifact === "object"
      ? (screenshot.artifact as Record<string, unknown>)
      : undefined;
  return {
    data,
    mimeType: screenshot.mimeType,
    byteLength:
      typeof artifact?.byteLength === "number"
        ? artifact.byteLength
        : undefined,
    artifactUri:
      typeof artifact?.uri === "string" ? artifact.uri : undefined,
  };
}

function toBoundedStructuredContent(value: unknown): Record<string, unknown> {
  const bounded = boundStructuredValue(value, 0, new WeakSet<object>());
  if (bounded && typeof bounded === "object" && !Array.isArray(bounded)) {
    return bounded as Record<string, unknown>;
  }
  return { value: bounded };
}

function boundStructuredValue(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    if (/^data:image\/(?:png|jpeg);base64,/.test(value)) {
      return "[binary image omitted from structuredContent]";
    }
    return value.length > 20_000
      ? `${value.slice(0, 20_000)}\n[truncated]`
      : value;
  }
  if (value === undefined) {
    return null;
  }
  if (typeof value !== "object") {
    return String(value);
  }
  if (depth >= 12) {
    return "[maximum structured output depth reached]";
  }
  if (seen.has(value)) {
    return "[circular value omitted]";
  }
  seen.add(value);
  if (Array.isArray(value)) {
    const entries = value
      .slice(0, 200)
      .map((entry) => boundStructuredValue(entry, depth + 1, seen));
    if (value.length > 200) {
      entries.push(`[${value.length - 200} additional entries omitted]`);
    }
    return entries;
  }

  const entries = Object.entries(value as Record<string, unknown>);
  const bounded = Object.fromEntries(
    entries
      .slice(0, 200)
      .map(([key, entry]) => [
        key,
        boundStructuredValue(entry, depth + 1, seen),
      ]),
  );
  if (entries.length > 200) {
    bounded._truncatedFields = entries.length - 200;
  }
  return bounded;
}

function summarizeToolResult(
  structuredContent: Record<string, unknown>,
  image: ScreenshotImageContent | undefined,
): string {
  if (image) {
    const byteSummary = image.byteLength
      ? `${image.byteLength} bytes`
      : "binary image";
    const artifactSummary = image.artifactUri
      ? ` Artifact: ${image.artifactUri}.`
      : "";
    return `Screenshot captured (${image.mimeType}, ${byteSummary}).${artifactSummary}`;
  }
  const serialized = toResourceJson(structuredContent);
  return serialized.length > 6_000
    ? `${serialized.slice(0, 6_000)}\n[tool result summary truncated; use structuredContent]`
    : serialized;
}
