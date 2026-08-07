import {
  MAX_CSS_PATCH_CHARS,
  SUPPORTED_COMPUTED_STYLE_PROPERTIES,
} from "./dom";

export const MCP_TOOL_NAMES = {
  BROWSER_STATUS: "browser_status",
  BROWSER_WORKFLOW: "browser_workflow",
  BROWSER_CAPTURE_ISSUE_EVIDENCE: "browser_capture_issue_evidence",
  BROWSER_OBSERVE: "browser_observe",
  BROWSER_ACT: "browser_act",
  BROWSER_VERIFY: "browser_verify",
  BROWSER_DEBUG_ACTIVITY: "browser_debug_activity",
  BROWSER_DIAGNOSE_RUNTIME_ERRORS: "browser_diagnose_runtime_errors",
  BROWSER_ACTIVITY_START: "browser_activity_start",
  BROWSER_ACTIVITY_STOP: "browser_activity_stop",
  BROWSER_GET_SELECTED_ELEMENT: "browser_get_selected_element",
  BROWSER_GET_CONTEXT_DIGEST: "browser_get_context_digest",
  BROWSER_GET_PLUGIN_CONVERSATION: "browser_get_plugin_conversation",
  BROWSER_GET_AUDIT_EVENTS: "browser_get_audit_events",
  BROWSER_GET_LAST_PLUGIN_MESSAGE: "browser_get_last_plugin_message",
  BROWSER_GET_PAGE_CONTEXT: "browser_get_page_context",
  BROWSER_SNAPSHOT: "browser_snapshot",
  BROWSER_QUERY_DOM: "browser_query_dom",
  BROWSER_LOCATE_SOURCE: "browser_locate_source",
  BROWSER_EXPLAIN_CSS: "browser_explain_css",
  BROWSER_CREATE_REPRODUCTION_RECIPE: "browser_create_reproduction_recipe",
  BROWSER_RUN_REPRODUCTION_RECIPE: "browser_run_reproduction_recipe",
  BROWSER_READ_ARTIFACT: "browser_read_artifact",
  BROWSER_PERFORMANCE_DIAGNOSTICS: "browser_performance_diagnostics",
  BROWSER_REALTIME_ACTIVITY: "browser_realtime_activity",
  BROWSER_START_ELEMENT_PICKER: "browser_start_element_picker",
  BROWSER_CANCEL_ELEMENT_PICKER: "browser_cancel_element_picker",
  BROWSER_HIGHLIGHT_ELEMENT: "browser_highlight_element",
  BROWSER_CLEAR_HIGHLIGHTS: "browser_clear_highlights",
  BROWSER_TAKE_SCREENSHOT: "browser_take_screenshot",
  BROWSER_LIST_TABS: "browser_list_tabs",
  BROWSER_SET_TARGET_TAB: "browser_set_target_tab",
  BROWSER_LIST_FRAMES: "browser_list_frames",
  BROWSER_SET_TARGET_FRAME: "browser_set_target_frame",
  BROWSER_NAVIGATE: "browser_navigate",
  BROWSER_NAVIGATE_BACK: "browser_navigate_back",
  BROWSER_NAVIGATE_FORWARD: "browser_navigate_forward",
  BROWSER_RELOAD: "browser_reload",
  BROWSER_CLOSE: "browser_close",
  BROWSER_RESIZE: "browser_resize",
  BROWSER_CLICK: "browser_click",
  BROWSER_HOVER: "browser_hover",
  BROWSER_DRAG: "browser_drag",
  BROWSER_FILL_FORM: "browser_fill_form",
  BROWSER_EXECUTE_ACTION_STAGE: "browser_execute_action_stage",
  BROWSER_TYPE: "browser_type",
  BROWSER_PRESS_KEY: "browser_press_key",
  BROWSER_SELECT_OPTION: "browser_select_option",
  BROWSER_MOUSE_MOVE_XY: "browser_mouse_move_xy",
  BROWSER_MOUSE_CLICK_XY: "browser_mouse_click_xy",
  BROWSER_MOUSE_DOWN: "browser_mouse_down",
  BROWSER_MOUSE_UP: "browser_mouse_up",
  BROWSER_MOUSE_DRAG_XY: "browser_mouse_drag_xy",
  BROWSER_MOUSE_WHEEL_XY: "browser_mouse_wheel_xy",
  BROWSER_WAIT_FOR: "browser_wait_for",
  BROWSER_EVALUATE: "browser_evaluate",
  BROWSER_DEBUGGER_BREAKPOINT: "browser_debugger_breakpoint",
  BROWSER_DEBUGGER_CONTROL: "browser_debugger_control",
  BROWSER_HANDLE_DIALOG: "browser_handle_dialog",
  BROWSER_STORAGE_STATE: "browser_storage_state",
  BROWSER_COOKIE_LIST: "browser_cookie_list",
  BROWSER_COOKIE_SET: "browser_cookie_set",
  BROWSER_COOKIE_DELETE: "browser_cookie_delete",
  BROWSER_CONSOLE_MESSAGES: "browser_console_messages",
  BROWSER_SET_DOM_VALUE: "browser_set_dom_value",
  BROWSER_NETWORK_REQUESTS: "browser_network_requests",
  BROWSER_NETWORK_START_RECORDING: "browser_network_start_recording",
  BROWSER_NETWORK_STOP_RECORDING: "browser_network_stop_recording",
  BROWSER_NETWORK_CLEAR: "browser_network_clear",
  BROWSER_NETWORK_LIST_REQUESTS: "browser_network_list_requests",
  BROWSER_NETWORK_GET_REQUEST: "browser_network_get_request",
  BROWSER_NETWORK_GET_RESPONSE_BODY: "browser_network_get_response_body",
  BROWSER_DEBUGGER_DETACH: "browser_debugger_detach",
  BROWSER_PROXY_ENABLE: "browser_proxy_enable",
  BROWSER_PROXY_DISABLE: "browser_proxy_disable",
  BROWSER_PROXY_LIST_RULES: "browser_proxy_list_rules",
  BROWSER_PROXY_UPSERT_RULE: "browser_proxy_upsert_rule",
  BROWSER_PROXY_REMOVE_RULE: "browser_proxy_remove_rule",
  BROWSER_PROXY_CLEAR_RULES: "browser_proxy_clear_rules",
  BROWSER_PROXY_LIST_HITS: "browser_proxy_list_hits",
  BROWSER_LIST_NETWORK_RULES: "browser_list_network_rules",
  BROWSER_UPSERT_HEADER_RULE: "browser_upsert_header_rule",
  BROWSER_UPSERT_GET_MOCK: "browser_upsert_get_mock",
  BROWSER_REMOVE_NETWORK_RULE: "browser_remove_network_rule",
  BROWSER_APPLY_CSS_PATCH: "browser_apply_css_patch",
  BROWSER_REMOVE_CSS_PATCH: "browser_remove_css_patch",
} as const;

export type McpToolName = (typeof MCP_TOOL_NAMES)[keyof typeof MCP_TOOL_NAMES];

interface JsonSchemaObject {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  [key: string]: unknown;
}

export interface McpToolDefinition {
  name: McpToolName;
  title: string;
  description: string;
  parameters: JsonSchemaObject;
}

export interface McpAiToolDefinition {
  type: "function";
  function: {
    name: McpToolName;
    description: string;
    parameters: JsonSchemaObject;
  };
}

const NO_ARG_PARAMETERS: JsonSchemaObject = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

const COMPUTED_STYLE_PROPERTIES_SCHEMA = {
  type: "array",
  minItems: 1,
  maxItems: SUPPORTED_COMPUTED_STYLE_PROPERTIES.length,
  uniqueItems: true,
  items: {
    type: "string",
    enum: [...SUPPORTED_COMPUTED_STYLE_PROPERTIES],
  },
  description:
    "Optional exact computed-style projection. Omit for the default layout subset.",
};

const DOM_QUERY_ITEM_PROPERTIES = {
  query: {
    type: "string",
    description: "CSS selector, className, or xpath to query.",
  },
  queryType: {
    type: "string",
    enum: ["selector", "className", "xpath"],
    description:
      "Use selector for CSS selectors, className for raw class names, and xpath for XPath expressions.",
  },
  limit: {
    type: "number",
    description: "Maximum number of matched elements to return.",
  },
  includeText: {
    type: "boolean",
    description: "Whether to include element text. Defaults to true.",
  },
  includeOuterHTML: {
    type: "boolean",
    description: "Whether to include outerHTML. Defaults to true.",
  },
  includeComputedStyle: {
    type: "boolean",
    description: "Whether to include computed styles. Defaults to true.",
  },
  computedStyleProperties: COMPUTED_STYLE_PROPERTIES_SCHEMA,
  maxTextLength: {
    type: "number",
    description: "Max text chars per element. Set 0 to disable truncation.",
  },
  maxOuterHTMLLength: {
    type: "number",
    description:
      "Max outerHTML chars per element. Set 0 to disable truncation and retrieve full DOM for html/body.",
  },
} as const;

const MCP_BASE_TOOL_DEFINITIONS: readonly McpToolDefinition[] = [
  {
    name: MCP_TOOL_NAMES.BROWSER_STATUS,
    title: "Browser connection status",
    description:
      "Read the current local plugin, browser, selected target, page-sync, and conversation status without using cached page content as a substitute for a live observation.",
    parameters: NO_ARG_PARAMETERS,
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_ACTIVITY_START,
    title: "Start browser activity stream",
    description:
      "Start bounded DOM, URL navigation, Network, Console, CSS/layout, rendered-visual, Storage/IndexedDB, WebSocket and SSE observation for the exact selected target. Event kinds have independent retention. Payload/body capture is off by default and requires an explicit sensitive approval. Save activityCursor.streamId and activityCursor.sequence and pass both to browser_debug_activity to read only later changes.",
    parameters: {
      type: "object",
      properties: {
        includeDom: { type: "boolean" },
        includeNetwork: { type: "boolean" },
        includeConsole: { type: "boolean" },
        includeStyle: { type: "boolean" },
        includeVisual: { type: "boolean" },
        includeStorage: { type: "boolean" },
        includeRealtime: { type: "boolean" },
        includeRealtimePayloads: {
          type: "boolean",
          description:
            "Include bounded redacted WebSocket/SSE payload previews. Defaults false and raises the approval boundary.",
        },
        includeResponseBodies: {
          type: "boolean",
          description:
            "Capture bounded textual Network response-body previews. Defaults false and raises the approval boundary.",
        },
        maxResponseBodyBytes: {
          type: "number",
          minimum: 1024,
          maximum: 120000,
        },
        visualSampleIntervalMs: {
          type: "number",
          minimum: 500,
          maximum: 10000,
        },
        preserveLog: { type: "boolean" },
        maxNetworkEntries: {
          type: "number",
          minimum: 10,
          maximum: 2000,
          description:
            "Raw Network request capacity for the monitor. Defaults to 2000; lower-priority requests are evicted first when full.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_ACTIVITY_STOP,
    title: "Stop browser activity stream",
    description:
      "Stop the activity monitor owned by this extension and restore page hooks. Retained bounded events remain readable from the activity-stream resource.",
    parameters: NO_ARG_PARAMETERS,
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_WORKFLOW,
    title: "Run browser workflow with evidence",
    description:
      "Observe the current page, optionally evaluate preconditions, execute a bounded action stage plus best-effort cleanup, verify outcomes, and return correlated DOM, URL, Network, and Console evidence in one model-visible call. wait actions, conditions and cleanup stay bounded; mutations retain the same approval and stale-document barriers as browser_act.",
    parameters: {
      type: "object",
      properties: {
        observation: {
          type: "object",
          properties: {
            mode: {
              type: "string",
              enum: ["interactive", "outline", "full"],
            },
            limit: { type: "number", minimum: 1, maximum: 100 },
            sourceLimit: { type: "number", minimum: 100, maximum: 10000 },
            frameScope: {
              type: "string",
              enum: ["selected", "auto", "all-accessible"],
            },
            maxFrames: { type: "number", minimum: 1, maximum: 12 },
            fields: {
              type: "array",
              minItems: 1,
              maxItems: 16,
              uniqueItems: true,
              items: {
                type: "string",
                enum: [
                  "role",
                  "name",
                  "description",
                  "href",
                  "value",
                  "selectedValues",
                  "disabled",
                  "checked",
                  "pressed",
                  "expanded",
                  "selected",
                  "required",
                  "readOnly",
                  "focused",
                  "level",
                ],
              },
            },
          },
          additionalProperties: false,
        },
        actions: {
          type: "array",
          minItems: 1,
          maxItems: 20,
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              type: {
                type: "string",
                enum: [
                  "fill",
                  "select",
                  "click",
                  "hover",
                  "drag",
                  "scroll",
                  "resize",
                  "press_key",
                  "wait",
                ],
              },
              frameRef: {
                type: "string",
                pattern: "^fr1_[a-f0-9]{8}$",
              },
              documentId: { type: "string" },
              ref: {
                type: "string",
                pattern: "^sr1_[a-f0-9]{8}_s[0-9]{1,6}$",
              },
              selector: { type: "string" },
              sourceRef: {
                type: "string",
                pattern: "^sr1_[a-f0-9]{8}_s[0-9]{1,6}$",
              },
              sourceSelector: { type: "string" },
              targetRef: {
                type: "string",
                pattern: "^sr1_[a-f0-9]{8}_s[0-9]{1,6}$",
              },
              targetSelector: { type: "string" },
              value: {
                oneOf: [
                  { type: "string" },
                  { type: "boolean" },
                  { type: "array", items: { type: "string" } },
                ],
              },
              values: { type: "array", items: { type: "string" } },
              button: {
                type: "string",
                enum: ["left", "right", "middle"],
              },
              doubleClick: { type: "boolean" },
              key: { type: "string" },
              time: { type: "number" },
              timeoutMs: { type: "number" },
              deltaX: { type: "number" },
              deltaY: { type: "number" },
              x: { type: "number" },
              y: { type: "number" },
              width: { type: "number", minimum: 320, maximum: 10000 },
              height: { type: "number", minimum: 240, maximum: 10000 },
              dependsOn: { type: "array", items: { type: "string" } },
              expectedOutcome: { type: "string" },
              barrier: { type: "boolean" },
            },
            required: ["id", "type"],
            additionalProperties: false,
          },
        },
        preconditions: {
          type: "object",
          description:
            "Bounded if/check gate evaluated against fresh page state before actions.",
          properties: {
            checks: {
              type: "array",
              minItems: 1,
              maxItems: 20,
              items: { type: "object" },
            },
            onFailure: {
              type: "string",
              enum: ["abort", "skip_actions"],
            },
          },
          required: ["checks"],
          additionalProperties: false,
        },
        cleanupActions: {
          type: "array",
          minItems: 1,
          maxItems: 10,
          description:
            "Bounded cleanup actions executed after the main stage without replaying failed or unknown writes.",
          items: { type: "object" },
        },
        checks: {
          type: "array",
          minItems: 1,
          maxItems: 20,
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              type: {
                type: "string",
                enum: [
                  "url_contains",
                  "title_contains",
                  "text_contains",
                  "target_present",
                  "target_state",
                ],
              },
              frameRef: {
                type: "string",
                pattern: "^fr1_[a-f0-9]{8}$",
              },
              documentId: { type: "string" },
              value: { type: "string" },
              selectedValues: {
                type: "array",
                maxItems: 50,
                uniqueItems: true,
                items: { type: "string" },
              },
              ref: {
                type: "string",
                pattern: "^sr1_[a-f0-9]{8}_s[0-9]{1,6}$",
              },
              selector: { type: "string" },
              nameContains: { type: "string" },
              disabled: { type: "boolean" },
              checked: { type: "boolean" },
              selected: { type: "boolean" },
              expanded: { type: "boolean" },
            },
            required: ["id", "type"],
            additionalProperties: false,
          },
        },
        evidence: {
          type: "object",
          properties: {
            dom: { type: "boolean" },
            url: { type: "boolean" },
            network: { type: "boolean" },
            console: { type: "boolean" },
            networkLimit: { type: "number", minimum: 1, maximum: 100 },
            consoleLimit: { type: "number", minimum: 1, maximum: 200 },
          },
          additionalProperties: false,
        },
        stopOnFailure: { type: "boolean" },
        decisionBarrier: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_OBSERVE,
    title: "Observe current page",
    description:
      "Preferred live page observation entrypoint. Returns a fresh compact semantic snapshot, actionable targetRef values for the selected frame, target freshness, DOM revision, and mutation delta. By default it also reads a bounded set of accessible child frames in parallel; child-frame observations are read-only and require selecting that frame before acting. It retries one transient target change internally and never captures a screenshot automatically. Use browser_snapshot when expert selector, tag, and geometry fields are required.",
    parameters: {
      type: "object",
      properties: {
        cursor: { type: "string" },
        limit: { type: "number", minimum: 1, maximum: 100 },
        mode: {
          type: "string",
          enum: ["interactive", "outline", "full"],
        },
        sourceLimit: { type: "number", minimum: 100, maximum: 10000 },
        sinceRevision: { type: "number", minimum: 0 },
        frameScope: {
          type: "string",
          enum: ["selected", "auto", "all-accessible"],
          description:
            "selected reads only the current frame; auto (default) includes up to 4 accessible frames; all-accessible includes up to maxFrames. Cursor pagination requires selected.",
        },
        maxFrames: {
          type: "number",
          minimum: 1,
          maximum: 12,
          description: "Maximum accessible frames included in one observation.",
        },
        fields: {
          type: "array",
          minItems: 1,
          maxItems: 16,
          uniqueItems: true,
          items: {
            type: "string",
            enum: [
              "role",
              "name",
              "description",
              "href",
              "value",
              "selectedValues",
              "disabled",
              "checked",
              "pressed",
              "expanded",
              "selected",
              "required",
              "readOnly",
              "focused",
              "level",
            ],
          },
          description:
            "Optional model-visible semantic field projection. targetRef remains included for actionable selected-frame nodes.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_LOCATE_SOURCE,
    title: "Locate element component source",
    description:
      "Map one element to bounded React/Vue component metadata and available source hints. Pass a targetRef returned by the latest browser_observe/browser_snapshot in the ref argument, or pass one exact selector. The extension runs only a fixed MAIN-world inspector; caller-supplied JavaScript is never evaluated.",
    parameters: {
      type: "object",
      properties: {
        ref: {
          type: "string",
          pattern: "^sr1_[a-f0-9]{8}_s[0-9]{1,6}$",
          description:
            "Pass the latest observed targetRef in this ref argument.",
        },
        selector: { type: "string" },
        frameRef: {
          type: "string",
          pattern: "^fr1_[a-f0-9]{8}$",
        },
        documentId: { type: "string" },
        maxDepth: { type: "number", minimum: 1, maximum: 20 },
        includeSourceExcerpt: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_EXPLAIN_CSS,
    title: "Explain element CSS",
    description:
      "Read bounded matched rules, inline declarations, computed values, inherited custom properties, box-model evidence, and stylesheet source hints for one exact element. This executes only a fixed inspector.",
    parameters: {
      type: "object",
      properties: {
        selector: { type: "string" },
        frameRef: { type: "string", pattern: "^fr1_[a-f0-9]{8}$" },
        documentId: { type: "string" },
        properties: {
          type: "array",
          maxItems: 64,
          uniqueItems: true,
          items: { type: "string" },
        },
        maxRules: { type: "number", minimum: 1, maximum: 200 },
        includeVariables: { type: "boolean" },
      },
      required: ["selector"],
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_CREATE_REPRODUCTION_RECIPE,
    title: "Create reproduction recipe",
    description:
      "Persist one bounded browser_workflow input as a session-bound replay recipe artifact. Creating the recipe does not execute page actions.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        targetUrlPattern: { type: "string" },
        workflow: { type: "object", additionalProperties: true },
      },
      required: ["name", "workflow"],
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_RUN_REPRODUCTION_RECIPE,
    title: "Run reproduction recipe",
    description:
      "Load one session-bound reproduction recipe artifact and execute its browser_workflow through the normal approval, stale-target, action, and verification barriers.",
    parameters: {
      type: "object",
      properties: {
        artifactId: { type: "string" },
        requireUrlMatch: { type: "boolean" },
      },
      required: ["artifactId"],
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_READ_ARTIFACT,
    title: "Read stored result artifact",
    description:
      "Read or search a complete session-bound JSON artifact produced when a tool result is too large for model context. Use read mode with nextOffset until hasMore is false when the whole result matters; use search mode to locate exact evidence. The artifact summary is only an index and must not be treated as the complete result.",
    parameters: {
      type: "object",
      properties: {
        artifactId: {
          type: "string",
          pattern: "^art_[a-f0-9]{32}$",
        },
        mode: {
          type: "string",
          enum: ["read", "search"],
          description: "Defaults to read.",
        },
        offset: {
          type: "number",
          minimum: 0,
          description: "Character offset for read mode. Defaults to 0.",
        },
        limit: {
          type: "number",
          minimum: 1000,
          maximum: 20000,
          description: "Maximum characters returned by read mode. Defaults to 12000.",
        },
        query: {
          type: "string",
          description: "Required in search mode; matched against the complete serialized JSON artifact.",
        },
        searchOffset: {
          type: "number",
          minimum: 0,
          description: "Character offset where search mode starts. Use nextSearchOffset to continue when hasMoreMatches is true.",
        },
        maxMatches: {
          type: "number",
          minimum: 1,
          maximum: 50,
          description: "Maximum search matches. Defaults to 20.",
        },
        contextChars: {
          type: "number",
          minimum: 40,
          maximum: 500,
          description: "Context characters on each side of a search match. Defaults to 160.",
        },
        caseSensitive: { type: "boolean" },
      },
      required: ["artifactId"],
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_PERFORMANCE_DIAGNOSTICS,
    title: "Diagnose page performance",
    description:
      "Read bounded Navigation Timing, paint, LCP, CLS, INP interaction, long-task, slow-resource, and trace-summary evidence from the selected document without running caller JavaScript.",
    parameters: {
      type: "object",
      properties: {
        frameRef: { type: "string", pattern: "^fr1_[a-f0-9]{8}$" },
        documentId: { type: "string" },
        resourceLimit: { type: "number", minimum: 1, maximum: 100 },
        longTaskLimit: { type: "number", minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_REALTIME_ACTIVITY,
    title: "Inspect realtime browser activity",
    description:
      "Summarize retained WebSocket and EventSource counters plus Service Worker and IndexedDB metadata. Message bodies and database values are never returned.",
    parameters: {
      type: "object",
      properties: {
        frameRef: { type: "string", pattern: "^fr1_[a-f0-9]{8}$" },
        documentId: { type: "string" },
        limit: { type: "number", minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_ACT,
    title: "Execute page action stage",
    description:
      "Preferred bounded action entrypoint. Executes up to 20 fill, select, click/double-click, hover, drag, scroll, resize, key, or wait operations locally after authorization, accepts targetRef from browser_observe/browser_snapshot, batches independent form controls, and stops on failure or an explicit barrier.",
    parameters: {
      type: "object",
      properties: {
        actions: {
          type: "array",
          minItems: 1,
          maxItems: 20,
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              type: {
                type: "string",
                enum: [
                  "fill",
                  "select",
                  "click",
                  "hover",
                  "drag",
                  "scroll",
                  "resize",
                  "press_key",
                  "wait",
                ],
              },
              ref: {
                type: "string",
                pattern: "^sr1_[a-f0-9]{8}_s[0-9]{1,6}$",
              },
              selector: { type: "string" },
              sourceRef: {
                type: "string",
                pattern: "^sr1_[a-f0-9]{8}_s[0-9]{1,6}$",
              },
              sourceSelector: { type: "string" },
              targetRef: {
                type: "string",
                pattern: "^sr1_[a-f0-9]{8}_s[0-9]{1,6}$",
              },
              targetSelector: { type: "string" },
              value: {
                oneOf: [
                  { type: "string" },
                  { type: "boolean" },
                  { type: "array", items: { type: "string" } },
                ],
              },
              values: { type: "array", items: { type: "string" } },
              button: {
                type: "string",
                enum: ["left", "right", "middle"],
              },
              doubleClick: { type: "boolean" },
              key: { type: "string" },
              time: { type: "number" },
              timeoutMs: { type: "number" },
              deltaX: { type: "number" },
              deltaY: { type: "number" },
              x: { type: "number" },
              y: { type: "number" },
              width: { type: "number", minimum: 320, maximum: 10000 },
              height: { type: "number", minimum: 240, maximum: 10000 },
              dependsOn: { type: "array", items: { type: "string" } },
              expectedOutcome: { type: "string" },
              barrier: { type: "boolean" },
            },
            required: ["id", "type"],
            additionalProperties: false,
          },
        },
        stopOnFailure: { type: "boolean" },
        decisionBarrier: {
          type: "boolean",
          description:
            "Set true only when retrying after DECISION_BARRIER_REQUIRED. Ordinary actions must omit it so an active current-chat grant can apply.",
        },
      },
      required: ["actions"],
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_VERIFY,
    title: "Verify browser outcome",
    description:
      "Verify URL, title, visible text, or semantic target state from one fresh bounded page read. Returns per-check evidence and the DOM mutation delta without mutating the page.",
    parameters: {
      type: "object",
      properties: {
        sinceRevision: { type: "number", minimum: 0 },
        checks: {
          type: "array",
          minItems: 1,
          maxItems: 20,
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              type: {
                type: "string",
                enum: [
                  "url_contains",
                  "title_contains",
                  "text_contains",
                  "target_present",
                  "target_state",
                ],
              },
              value: { type: "string" },
              selectedValues: {
                type: "array",
                maxItems: 50,
                uniqueItems: true,
                items: { type: "string" },
              },
              ref: {
                type: "string",
                pattern: "^sr1_[a-f0-9]{8}_s[0-9]{1,6}$",
              },
              selector: { type: "string" },
              nameContains: { type: "string" },
              disabled: { type: "boolean" },
              checked: { type: "boolean" },
              selected: { type: "boolean" },
              expanded: { type: "boolean" },
            },
            required: ["id", "type"],
            additionalProperties: false,
          },
        },
      },
      required: ["checks"],
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_DEBUG_ACTIVITY,
    title: "Read compact debug activity",
    description:
      "Read compact debug activity once. When afterSequence is present, returns only the bounded incremental page-change digest and sets legacy Network/Console snapshots to null, regardless of includeNetwork/includeConsole. If cursorStatus=events_dropped, report missedEvents; if transportDroppedEvents contains non-zero counts, report the local transport gap. Never claim complete coverage after either condition. The client commits activity.nextCursor only after the final summary succeeds. Omitting afterSequence reads only a recent legacy snapshot, never full history. Raw response bodies are never included.",
    parameters: {
      type: "object",
      properties: {
        includeNetwork: {
          type: "boolean",
          description:
            "Include the legacy current Network snapshot only when afterSequence is omitted.",
        },
        includeConsole: {
          type: "boolean",
          description:
            "Include the legacy current Console snapshot only when afterSequence is omitted.",
        },
        includeActivity: { type: "boolean" },
        networkLimit: { type: "number", minimum: 1, maximum: 100 },
        consoleLimit: { type: "number", minimum: 1, maximum: 200 },
        afterSequence: {
          type: "number",
          minimum: 0,
          description:
            "Return only activity observed after this sequence. Use activityCursor.sequence from browser_activity_start, summarize this single result, then save activity.nextCursor for the user's next request.",
        },
        afterStreamId: {
          type: "string",
          description:
            "Stream identity paired with afterSequence. Use activityCursor.streamId so daemon restarts and explicit monitor restarts are detected instead of silently returning an empty window.",
        },
        activityLimit: {
          type: "number",
          minimum: 1,
          maximum: 40,
          description:
            "Maximum notable navigation and error/warning events; DOM and Network noise is aggregated separately.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_DIAGNOSE_RUNTIME_ERRORS,
    title: "Diagnose JavaScript runtime errors",
    description:
      "Read bounded JavaScript exceptions and console error stacks captured after browser_activity_start, resolve loaded-script Source Maps, and report exact generated/original locations. In the local stdio adapter, mapped sources are additionally matched only under configured workspace roots.",
    parameters: {
      type: "object",
      properties: {
        afterStreamId: {
          type: "string",
          description:
            "runtimeErrorCursor.streamId returned by browser_activity_start.",
        },
        afterSequence: {
          type: "number",
          minimum: 0,
          description:
            "runtimeErrorCursor.sequence returned by browser_activity_start.",
        },
        limit: { type: "number", minimum: 1, maximum: 20 },
        maxFramesPerError: { type: "number", minimum: 1, maximum: 12 },
        maxWorkspaceFrames: {
          type: "number",
          minimum: 1,
          maximum: 20,
          description:
            "Adapter-local cap for Source Map frames matched against local workspace files.",
        },
        includeWarnings: { type: "boolean" },
        includeRevoked: { type: "boolean" },
        includeLocalExcerpt: { type: "boolean" },
        workspaceRoot: {
          type: "string",
          description:
            "Optional configured workspace root id, exact configured path, or unique project name returned by browser_find_workspace_source. Arbitrary paths are rejected.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_GET_SELECTED_ELEMENT,
    title: "Get selected element",
    description:
      "Read the last DOM element selected in the Chrome extension sidepanel.",
    parameters: NO_ARG_PARAMETERS,
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_GET_CONTEXT_DIGEST,
    title: "Get compressed page context",
    description:
      "Read a compact, MCP-friendly digest of the current page context, including visible text, DOM outline, important interactive elements, and the selected element.",
    parameters: NO_ARG_PARAMETERS,
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_GET_PLUGIN_CONVERSATION,
    title: "Get plugin conversation",
    description:
      "Read one fingerprint-bound snapshot page of the current plugin chat transcript. Follow nextCursor while hasMore is true. Messages appended after the first page are excluded from that snapshot; a conversation change or snapshot truncation invalidates the cursor.",
    parameters: {
      type: "object",
      properties: {
        cursor: {
          type: "string",
          description:
            "Opaque nextCursor from the previous conversation page.",
        },
        limit: {
          type: "number",
          description: "Maximum messages per page, from 1 to 50. Defaults to 20.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_GET_AUDIT_EVENTS,
    title: "Get daemon audit events",
    description:
      "Read one approval-gated, fingerprint-bound snapshot page of redacted daemon audit events for the MCP adapter's selected Chrome Profile session only. Raw arguments, results, cookies, tokens, and page content are never returned.",
    parameters: {
      type: "object",
      properties: {
        cursor: {
          type: "string",
          description: "Opaque nextCursor from the previous audit page.",
        },
        limit: {
          type: "number",
          description: "Maximum audit events per page, from 1 to 100. Defaults to 50.",
        },
        eventType: {
          type: "string",
          enum: [
            "approval.requested",
            "approval.approved",
            "approval.denied",
            "grant.created",
            "grant.revoked",
            "tool.completed",
            "tool.failed",
          ],
        },
        toolName: {
          type: "string",
          description: "Only include events whose canonical tool name matches exactly.",
        },
        outcome: {
          type: "string",
          enum: ["approved", "denied", "completed", "failed"],
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_GET_LAST_PLUGIN_MESSAGE,
    title: "Get last plugin message",
    description:
      "Read the most recent plugin chat message kept in memory by the local MCP server.",
    parameters: NO_ARG_PARAMETERS,
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_GET_PAGE_CONTEXT,
    title: "Get page context",
    description:
      "Read the current page URL, title, visible text, and sanitized DOM summary through the plugin bridge.",
    parameters: NO_ARG_PARAMETERS,
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_SNAPSHOT,
    title: "Browser semantic snapshot",
    description:
      "Read a fresh accessibility-oriented snapshot of meaningful visible page elements. Returns role, accessible name, stable selector, actionable targetRef, state, bounds, freshness, and cursor pagination. Prefer targetRef in later actions; it is bound to this tab/frame/document and rejected after semantic page changes. Follow nextCursor while hasMore is true; restart without a cursor after STALE_SNAPSHOT_CURSOR.",
    parameters: {
      type: "object",
      properties: {
        cursor: {
          type: "string",
          description:
            "Opaque nextCursor returned by the previous page. It is rejected if the page semantic structure changed.",
        },
        limit: {
          type: "number",
          description: "Maximum semantic nodes to return, from 1 to 100. Defaults to 50.",
        },
        mode: {
          type: "string",
          enum: ["interactive", "outline", "full"],
          description:
            "Observation density. interactive is the default and returns controls; outline adds landmarks/headings; full is explicitly budgeted.",
        },
        sourceLimit: {
          type: "number",
          description:
            "Maximum DOM elements visited by the source walker, from 100 to 10000. Defaults to 2000.",
        },
        sinceRevision: {
          type: "number",
          description:
            "Optional prior document-local DOM revision. Returns a bounded mutation delta when still available.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_QUERY_DOM,
    title: "Query DOM",
    description:
      "Query one DOM target or batch up to 12 independent targets in one model tool round. Returns sanitized element details and a bounded computed-style projection. Use computedStyleProperties for exact visual fields instead of repeating the same query. For full page DOM, query html or body with limit 1 and maxOuterHTMLLength 0.",
    parameters: {
      type: "object",
      properties: {
        ...DOM_QUERY_ITEM_PROPERTIES,
        selector: {
          type: "string",
          description:
            "Deprecated alias for query. Kept for compatibility with older prompts.",
        },
        queries: {
          type: "array",
          minItems: 1,
          maxItems: 12,
          description:
            "Independent bounded DOM reads executed concurrently and returned in request order.",
          items: {
            type: "object",
            properties: {
              ...DOM_QUERY_ITEM_PROPERTIES,
              maxTextLength: {
                ...DOM_QUERY_ITEM_PROPERTIES.maxTextLength,
                minimum: 1,
              },
              maxOuterHTMLLength: {
                ...DOM_QUERY_ITEM_PROPERTIES.maxOuterHTMLLength,
                minimum: 1,
              },
            },
            required: ["query"],
            additionalProperties: false,
          },
        },
      },
      anyOf: [
        { required: ["query"] },
        { required: ["selector"] },
        { required: ["queries"] },
      ],
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_START_ELEMENT_PICKER,
    title: "Start element picker",
    description:
      "Start interactive element picker mode so the user can manually choose an element from the page.",
    parameters: NO_ARG_PARAMETERS,
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_CANCEL_ELEMENT_PICKER,
    title: "Cancel element picker",
    description: "Cancel interactive element picker mode.",
    parameters: NO_ARG_PARAMETERS,
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_HIGHLIGHT_ELEMENT,
    title: "Highlight element",
    description: "Highlight an element on the current page by CSS selector.",
    parameters: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector for the element to highlight.",
        },
        durationMs: {
          type: "number",
          description: "How long the highlight should remain visible.",
        },
      },
      required: ["selector"],
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_CLEAR_HIGHLIGHTS,
    title: "Clear highlights",
    description: "Clear temporary element highlights from the page.",
    parameters: NO_ARG_PARAMETERS,
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_TAKE_SCREENSHOT,
    title: "Take screenshot",
    description:
      "Capture a fresh screenshot with the built-in Chrome CDP implementation and return it as MCP image content. For an observed element, pass its targetRef in the ref argument. Supports full-page and element screenshots and never writes to Chrome Downloads.",
    parameters: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["png", "jpeg"],
          description: "Image format. Defaults to png.",
        },
        selector: {
          type: "string",
          description: "CSS selector for an element screenshot.",
        },
        target: {
          type: "string",
          description: "Alias for selector, compatible with Playwright MCP calls.",
        },
        element: {
          type: "string",
          description: "Alias for selector when no target is provided.",
        },
        ref: {
          type: "string",
          pattern: "^sr1_[a-f0-9]{8}_s[0-9]{1,6}$",
          description:
            "Pass the latest observed targetRef in this ref argument.",
        },
        frameRef: {
          type: "string",
          pattern: "^fr1_[a-f0-9]{8}$",
          description: "Frame reference returned by browser_observe.",
        },
        documentId: {
          type: "string",
          description: "Exact documentId paired with frameRef.",
        },
        fullPage: {
          type: "boolean",
          description: "Capture the full scrollable page.",
        },
        quality: {
          type: "number",
          description: "JPEG quality from 0 to 100.",
        },
        diffAgainst: {
          type: "string",
          enum: ["previous"],
          description:
            "Compare with the previous compatible screenshot baseline.",
        },
        returnImage: {
          type: "string",
          enum: ["always", "changed", "never"],
          description:
            "Control whether image bytes are returned after comparison.",
        },
        diffThreshold: {
          type: "number",
          minimum: 0,
          maximum: 255,
          description: "Per-channel pixel difference threshold. Defaults to 16.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_LIST_TABS,
    title: "List browser tabs",
    description:
      "List scriptable Chrome tabs and show which tab is explicitly selected for this extension session.",
    parameters: NO_ARG_PARAMETERS,
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_SET_TARGET_TAB,
    title: "Select browser tab",
    description:
      "Select one listed Chrome tab as the explicit target and pre-arm native JavaScript dialog handling before a dialog can block the renderer. This changes extension/CDP routing, not page content.",
    parameters: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Tab id returned by browser_list_tabs." },
      },
      required: ["tabId"],
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_LIST_FRAMES,
    title: "List page frames",
    description:
      "List top-level and child frames discovered in the selected tab, including cross-origin OOPIF content-script targets.",
    parameters: NO_ARG_PARAMETERS,
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_SET_TARGET_FRAME,
    title: "Select page frame",
    description:
      "Select one listed frame/document for DOM and selector-based tools. Pass documentId to reject stale frame reuse after navigation.",
    parameters: {
      type: "object",
      properties: {
        frameId: { type: "number", description: "Frame id returned by browser_list_frames." },
        documentId: {
          type: "string",
          description: "Optional document id returned by browser_list_frames for stale-document protection.",
        },
      },
      required: ["frameId"],
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_NAVIGATE,
    title: "Navigate",
    description: "Navigate the active tab to a URL.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "URL to navigate to.",
        },
      },
      required: ["url"],
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_NAVIGATE_BACK,
    title: "Navigate back",
    description: "Navigate the active tab back in history.",
    parameters: NO_ARG_PARAMETERS,
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_NAVIGATE_FORWARD,
    title: "Navigate forward",
    description: "Navigate the active tab forward in history.",
    parameters: NO_ARG_PARAMETERS,
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_RELOAD,
    title: "Reload",
    description: "Reload the active tab.",
    parameters: NO_ARG_PARAMETERS,
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_CLOSE,
    title: "Close browser tab",
    description: "Close the active browser tab.",
    parameters: NO_ARG_PARAMETERS,
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_RESIZE,
    title: "Resize browser",
    description: "Resize the active Chrome window.",
    parameters: {
      type: "object",
      properties: {
        width: { type: "number", description: "Window width in pixels." },
        height: { type: "number", description: "Window height in pixels." },
      },
      required: ["width", "height"],
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_CLICK,
    title: "Click",
    description:
      "Resolve a visible, unobscured top-frame element by passing a targetRef from browser_observe/browser_snapshot in the ref argument, or by passing a native CSS selector, then click its center with trusted CDP mouse input. Prefer ref with a fresh targetRef. Playwright/jQuery text selectors such as :has-text(), :contains(), text=, locator chaining, and XPath are not supported. This page action requires confirmation.",
    parameters: {
      type: "object",
      properties: {
        ref: {
          type: "string",
          pattern: "^sr1_[a-f0-9]{8}_s[0-9]{1,6}$",
          description:
            "Pass the latest observed targetRef in this ref argument.",
        },
        selector: { type: "string", description: "Exact native CSS selector from fresh page evidence." },
        target: { type: "string", description: "Alias for selector." },
        element: { type: "string", description: "Alias for selector." },
        button: {
          type: "string",
          enum: ["left", "right", "middle"],
          description: "Mouse button. Defaults to left.",
        },
        doubleClick: {
          type: "boolean",
          description: "Whether to dispatch a double click.",
        },
        decisionBarrier: {
          type: "boolean",
          description:
            "Set true only when retrying after DECISION_BARRIER_REQUIRED. This requests a separate user approval; it does not bypass authorization.",
        },
      },
      anyOf: [
        { required: ["ref"] },
        { required: ["selector"] },
        { required: ["target"] },
        { required: ["element"] },
      ],
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_HOVER,
    title: "Hover",
    description:
      "Resolve a visible, unobscured top-frame element by an exact native browser CSS selector from fresh page evidence, then hover its center with trusted CDP mouse input. Playwright/jQuery text selectors and XPath are not supported. This page action requires confirmation.",
    parameters: {
      type: "object",
      properties: {
        ref: {
          type: "string",
          pattern: "^sr1_[a-f0-9]{8}_s[0-9]{1,6}$",
          description: "Opaque targetRef from the latest browser_snapshot.",
        },
        selector: { type: "string", description: "CSS selector to hover." },
        target: { type: "string", description: "Alias for selector." },
        element: { type: "string", description: "Alias for selector." },
      },
      anyOf: [
        { required: ["ref"] },
        { required: ["selector"] },
        { required: ["target"] },
        { required: ["element"] },
      ],
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_DRAG,
    title: "Drag",
    description:
      "Resolve visible, unobscured source and target elements by exact native browser CSS selectors from fresh page evidence, then drag between their centers with trusted CDP mouse input. Playwright/jQuery text selectors and XPath are not supported. Both endpoints must fit in the viewport and the action requires confirmation.",
    parameters: {
      type: "object",
      properties: {
        sourceRef: {
          type: "string",
          pattern: "^sr1_[a-f0-9]{8}_s[0-9]{1,6}$",
          description: "Opaque source targetRef from the latest browser_snapshot.",
        },
        source: { type: "string", description: "Source CSS selector." },
        sourceSelector: { type: "string", description: "Alias for source." },
        targetRef: {
          type: "string",
          pattern: "^sr1_[a-f0-9]{8}_s[0-9]{1,6}$",
          description: "Opaque destination targetRef from the latest browser_snapshot.",
        },
        target: { type: "string", description: "Target CSS selector." },
        targetSelector: { type: "string", description: "Alias for target." },
      },
      anyOf: [
        { required: ["sourceRef"] },
        { required: ["source"] },
        { required: ["sourceSelector"] },
      ],
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_FILL_FORM,
    title: "Fill form",
    description:
      "Preflight and fill up to 50 visible top-frame controls after one confirmation. Prefer actionable targetRef values from browser_snapshot; exact native CSS selectors remain supported. Playwright/jQuery text selectors and XPath are not supported. Text and checkbox/radio changes use trusted CDP input. Native select has no deterministic cross-platform CDP value-selection primitive, so select fields use a narrowly scoped DOM selection with synthetic input/change events and report inputMode=dom. Execution stops on the first post-preflight failure and may be partial if the page changes mid-run.",
    parameters: {
      type: "object",
      properties: {
        fields: {
          type: "array",
          minItems: 1,
          maxItems: 50,
          items: {
            type: "object",
            properties: {
              ref: {
                type: "string",
                pattern: "^sr1_[a-f0-9]{8}_s[0-9]{1,6}$",
              },
              selector: { type: "string", minLength: 1, maxLength: 2000 },
              target: { type: "string", minLength: 1, maxLength: 2000 },
              element: { type: "string", minLength: 1, maxLength: 2000 },
              name: { type: "string", minLength: 1, maxLength: 500 },
              value: {
                anyOf: [
                  { type: "string", maxLength: 4000 },
                  { type: "boolean" },
                  {
                    type: "array",
                    minItems: 1,
                    maxItems: 50,
                    uniqueItems: true,
                    items: { type: "string", minLength: 1, maxLength: 4000 },
                  },
                ],
              },
              type: {
                type: "string",
                enum: ["text", "checkbox", "radio", "select"],
              },
            },
            required: ["value"],
            anyOf: [
              { required: ["ref"] },
              { required: ["selector"] },
              { required: ["target"] },
              { required: ["element"] },
              { required: ["name"] },
            ],
            additionalProperties: false,
          },
        },
        decisionBarrier: {
          type: "boolean",
          description:
            "Set true only when retrying a sensitive resolved field after DECISION_BARRIER_REQUIRED.",
        },
      },
      required: ["fields"],
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_EXECUTE_ACTION_STAGE,
    title: "Execute bounded action stage",
    description:
      "Execute one bounded current-page stage locally after a single authorization. Independent fill/select actions are combined; ordered clicks, key presses, and waits remain barriers. Stops on the first failure and never accepts JavaScript.",
    parameters: {
      type: "object",
      properties: {
        actions: {
          type: "array",
          minItems: 1,
          maxItems: 20,
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              type: {
                type: "string",
                enum: ["fill", "select", "click", "press_key", "wait"],
              },
              ref: {
                type: "string",
                pattern: "^sr1_[a-f0-9]{8}_s[0-9]{1,6}$",
              },
              selector: { type: "string" },
              value: {
                oneOf: [
                  { type: "string" },
                  { type: "boolean" },
                  { type: "array", items: { type: "string" } },
                ],
              },
              values: { type: "array", items: { type: "string" } },
              key: { type: "string" },
              time: { type: "number" },
              dependsOn: { type: "array", items: { type: "string" } },
              expectedOutcome: { type: "string" },
              barrier: { type: "boolean" },
            },
            required: ["id", "type"],
            additionalProperties: false,
          },
        },
        stopOnFailure: {
          type: "boolean",
          description: "Stop after the first failed action. Defaults to true.",
        },
        decisionBarrier: {
          type: "boolean",
          description:
            "Set true only when retrying a stage after the executor resolved a commit-like or sensitive target.",
        },
      },
      required: ["actions"],
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_TYPE,
    title: "Type",
    description:
      "Focus a visible, unobscured, writable top-frame text target without clicking it, then insert text through CDP. Replace selects and clears existing content first; slowly is limited to 500 Unicode characters. Requires confirmation.",
    parameters: {
      type: "object",
      properties: {
        ref: {
          type: "string",
          pattern: "^sr1_[a-f0-9]{8}_s[0-9]{1,6}$",
          description: "Opaque targetRef from the latest browser_snapshot.",
        },
        selector: { type: "string", description: "CSS selector to type into." },
        target: { type: "string", description: "Alias for selector." },
        element: { type: "string", description: "Alias for selector." },
        text: { type: "string", description: "Text to type." },
        submit: { type: "boolean", description: "Press Enter after typing." },
        slowly: { type: "boolean", description: "Type one character at a time." },
        replace: {
          type: "boolean",
          description: "Replace existing value before typing.",
        },
        decisionBarrier: {
          type: "boolean",
          description:
            "Set true only when retrying a sensitive or submit-capable target after DECISION_BARRIER_REQUIRED.",
        },
      },
      required: ["text"],
      anyOf: [
        { required: ["ref"] },
        { required: ["selector"] },
        { required: ["target"] },
        { required: ["element"] },
      ],
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_PRESS_KEY,
    title: "Press key",
    description:
      "Press one supported key through trusted CDP keyboard input on the active element or a visible top-frame selector target. Key combinations are not accepted. Requires confirmation.",
    parameters: {
      type: "object",
      properties: {
        ref: {
          type: "string",
          pattern: "^sr1_[a-f0-9]{8}_s[0-9]{1,6}$",
          description: "Optional opaque targetRef from the latest browser_snapshot.",
        },
        selector: { type: "string", description: "Optional target selector." },
        target: { type: "string", description: "Alias for selector." },
        key: {
          type: "string",
          description:
            "One character or a named key: Enter, Tab, Escape, Backspace, Delete, Insert, ArrowLeft/Up/Right/Down, Home, End, PageUp/Down, Space, Control, Shift, Alt, Meta, or F1-F12.",
        },
        decisionBarrier: {
          type: "boolean",
          description:
            "Set true for Enter or when retrying after DECISION_BARRIER_REQUIRED.",
        },
      },
      required: ["key"],
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_SELECT_OPTION,
    title: "Select option",
    description:
      "Select exact option values in a visible top-frame <select> after confirmation. Reuse an exact native CSS selector from fresh page evidence; Playwright/jQuery text selectors and XPath are not supported. Values take precedence over exact label/text matches; missing, ambiguous, duplicate, or disabled options fail before mutation. Because CDP has no deterministic cross-platform select-by-value command, this bounded tool uses DOM option selection plus synthetic input/change events and reports inputMode=dom.",
    parameters: {
      type: "object",
      properties: {
        ref: {
          type: "string",
          pattern: "^sr1_[a-f0-9]{8}_s[0-9]{1,6}$",
          description: "Opaque targetRef from the latest browser_snapshot.",
        },
        selector: {
          type: "string",
          minLength: 1,
          maxLength: 2000,
          description: "CSS selector for a select element.",
        },
        target: {
          type: "string",
          minLength: 1,
          maxLength: 2000,
          description: "Alias for selector.",
        },
        element: {
          type: "string",
          minLength: 1,
          maxLength: 2000,
          description: "Alias for selector.",
        },
        values: {
          type: "array",
          minItems: 1,
          maxItems: 50,
          uniqueItems: true,
          items: { type: "string", minLength: 1, maxLength: 4000 },
          description: "Option values, labels, or visible text to select.",
        },
      },
      required: ["values"],
      anyOf: [
        { required: ["ref"] },
        { required: ["selector"] },
        { required: ["target"] },
        { required: ["element"] },
      ],
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_MOUSE_MOVE_XY,
    title: "Mouse move XY",
    description:
      "Move the mouse to viewport coordinates. Use only when selector-based tools are insufficient.",
    parameters: {
      type: "object",
      properties: {
        x: { type: "number" },
        y: { type: "number" },
      },
      required: ["x", "y"],
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_MOUSE_CLICK_XY,
    title: "Mouse click XY",
    description:
      "Click viewport coordinates. Prefer browser_click with a selector when possible.",
    parameters: {
      type: "object",
      properties: {
        x: { type: "number" },
        y: { type: "number" },
        button: { type: "string", enum: ["left", "right", "middle"] },
        doubleClick: { type: "boolean" },
      },
      required: ["x", "y"],
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_MOUSE_DOWN,
    title: "Mouse down",
    description: "Dispatch mouse down at viewport coordinates.",
    parameters: {
      type: "object",
      properties: {
        x: { type: "number" },
        y: { type: "number" },
        button: { type: "string", enum: ["left", "right", "middle"] },
      },
      required: ["x", "y"],
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_MOUSE_UP,
    title: "Mouse up",
    description: "Dispatch mouse up at viewport coordinates.",
    parameters: {
      type: "object",
      properties: {
        x: { type: "number" },
        y: { type: "number" },
        button: { type: "string", enum: ["left", "right", "middle"] },
      },
      required: ["x", "y"],
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_MOUSE_DRAG_XY,
    title: "Mouse drag XY",
    description:
      "Drag from one viewport coordinate to another. Prefer browser_drag with selectors when possible.",
    parameters: {
      type: "object",
      properties: {
        startX: { type: "number" },
        startY: { type: "number" },
        endX: { type: "number" },
        endY: { type: "number" },
        steps: { type: "number" },
      },
      required: ["startX", "startY", "endX", "endY"],
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_MOUSE_WHEEL_XY,
    title: "Mouse wheel XY",
    description: "Dispatch a wheel event and scroll the page.",
    parameters: {
      type: "object",
      properties: {
        deltaX: { type: "number" },
        deltaY: { type: "number" },
        x: { type: "number" },
        y: { type: "number" },
      },
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_WAIT_FOR,
    title: "Wait for",
    description: "Wait for time, text, text disappearance, or a selector.",
    parameters: {
      type: "object",
      properties: {
        time: { type: "number", description: "Seconds to wait." },
        text: { type: "string", description: "Text to wait for." },
        textGone: { type: "string", description: "Text to wait until gone." },
        selector: { type: "string", description: "Selector to wait for." },
        timeoutMs: { type: "number", description: "Maximum wait in milliseconds." },
      },
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_EVALUATE,
    title: "Execute page JavaScript",
    description:
      "Execute arbitrary caller-provided JavaScript in the exact task-bound page frame through Chrome DevTools Protocol. This is a real page execution context, not a sandbox: it can call page functions, mutate DOM and application state, access same-origin page data, and issue requests. Every call requires a fresh high-risk approval and is never automatically replayed after an unknown outcome.",
    parameters: {
      type: "object",
      properties: {
        expression: {
          type: "string",
          description:
            "JavaScript expression. The optional `element` variable is available when selector is provided.",
        },
        selector: {
          type: "string",
          description: "Optional selector passed to the expression as element.",
        },
        timeoutMs: {
          type: "number",
          minimum: 100,
          maximum: 10000,
          description: "Terminate execution after this many milliseconds.",
        },
        awaitPromise: {
          type: "boolean",
          description: "Await a returned Promise. Defaults to true.",
        },
        replMode: {
          type: "boolean",
          description:
            "Enable DevTools REPL behavior such as top-level await and redeclaring REPL let bindings.",
        },
        throwOnSideEffect: {
          type: "boolean",
          description:
            "Ask V8 to reject execution when it cannot prove the expression is side-effect-free. This is best-effort and not a security boundary.",
        },
        allowBreakpoints: {
          type: "boolean",
          description:
            "Allow breakpoints during this evaluation. Defaults to false to avoid blocking the tool call. To deliberately hit a breakpoint, schedule the target call asynchronously (for example with setTimeout) and set awaitPromise=false.",
        },
      },
      required: ["expression"],
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_DEBUGGER_BREAKPOINT,
    title: "Manage JavaScript breakpoints",
    description:
      "Set, remove, or list URL-based JavaScript breakpoints in the exact task-bound page frame. lineNumber is 1-based for this tool; columnNumber is 0-based. Conditional breakpoint expressions run in the page when hit, so every operation remains high-risk approval-gated.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["set", "remove", "list"] },
        breakpointId: {
          type: "string",
          description: "Breakpoint ID returned by a prior set call.",
        },
        url: {
          type: "string",
          description: "Exact generated script URL. Mutually exclusive with urlRegex.",
        },
        urlRegex: {
          type: "string",
          description: "Generated script URL regex. Mutually exclusive with url.",
        },
        lineNumber: {
          type: "number",
          minimum: 1,
          description: "1-based generated JavaScript line number.",
        },
        columnNumber: {
          type: "number",
          minimum: 0,
          description: "0-based generated JavaScript column number. Defaults to 0.",
        },
        condition: {
          type: "string",
          description: "Optional JavaScript condition evaluated when the breakpoint is hit.",
        },
      },
      required: ["action"],
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_DEBUGGER_CONTROL,
    title: "Control JavaScript debugger",
    description:
      "Inspect paused state, pause or resume execution, step over/into/out, evaluate JavaScript on a paused call frame, or configure pause-on-exceptions for the exact task-bound page frame. Pausing can freeze the page until resumed or the debugger is detached.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "status",
            "pause",
            "resume",
            "step_over",
            "step_into",
            "step_out",
            "evaluate_on_call_frame",
            "set_pause_on_exceptions",
          ],
        },
        callFrameId: {
          type: "string",
          description:
            "Ephemeral callFrameId returned by status after a pause. Invalid after resume or navigation.",
        },
        expression: {
          type: "string",
          description: "JavaScript expression for evaluate_on_call_frame.",
        },
        timeoutMs: {
          type: "number",
          minimum: 100,
          maximum: 10000,
        },
        throwOnSideEffect: {
          type: "boolean",
          description:
            "Ask V8 to reject call-frame evaluation when a side effect cannot be ruled out.",
        },
        pauseOnExceptions: {
          type: "string",
          enum: ["none", "uncaught", "caught", "all"],
        },
      },
      required: ["action"],
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_HANDLE_DIALOG,
    title: "Handle dialog",
    description:
      "Accept or dismiss the currently open JavaScript alert/confirm/prompt in the selected tab using one CDP command. Call browser_set_target_tab before the action that opens the dialog so the Page session is already armed. It does not override future dialogs and requires confirmation.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["accept", "dismiss"] },
        promptText: { type: "string" },
      },
      required: ["action"],
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_STORAGE_STATE,
    title: "Storage state",
    description:
      "Read localStorage, sessionStorage, and cookies for the active page. Values are omitted unless includeValues is explicitly true.",
    parameters: {
      type: "object",
      properties: {
        includeLocalStorage: { type: "boolean" },
        includeSessionStorage: { type: "boolean" },
        includeCookies: { type: "boolean" },
        includeValues: {
          type: "boolean",
          description: "Include raw storage and cookie values. Defaults to false.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_COOKIE_LIST,
    title: "List cookies",
    description:
      "List cookies for the active page or a provided URL. Values are omitted unless includeValues is explicitly true.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string" },
        name: { type: "string" },
        domain: { type: "string" },
        includeValues: {
          type: "boolean",
          description: "Include raw cookie values. Defaults to false.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_COOKIE_SET,
    title: "Set cookie",
    description: "Set a cookie for the active page or a provided URL.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string" },
        name: { type: "string" },
        value: { type: "string" },
        domain: { type: "string" },
        path: { type: "string" },
        secure: { type: "boolean" },
        httpOnly: { type: "boolean" },
        sameSite: {
          type: "string",
          enum: ["no_restriction", "lax", "strict", "unspecified"],
        },
        expirationDate: { type: "number" },
      },
      required: ["name", "value"],
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_COOKIE_DELETE,
    title: "Delete cookie",
    description: "Delete a cookie for the active page or a provided URL.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string" },
        name: { type: "string" },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_CONSOLE_MESSAGES,
    title: "Console messages",
    description:
      "Enable built-in CDP console collection and list console/log messages from the active tab.",
    parameters: {
      type: "object",
      properties: {
        level: {
          type: "string",
          enum: ["error", "warning", "info", "debug"],
          description: "Minimum severity. Defaults to info.",
        },
        all: {
          type: "boolean",
          description: "Include messages before the latest document navigation.",
        },
        limit: {
          type: "number",
          description: "Maximum messages to return.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_SET_DOM_VALUE,
    title: "Set DOM value",
    description:
      "Set an element's value, textContent, innerText, or attribute by CSS selector. Use this for user requests to replace DOM text or input values; do not use CSS for value changes.",
    parameters: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector for the target element.",
        },
        value: {
          type: "string",
          description: "New value or text to set.",
        },
        target: {
          type: "string",
          enum: ["auto", "value", "textContent", "innerText", "attribute"],
          description:
            "auto uses value for form fields and textContent for other elements.",
        },
        attributeName: {
          type: "string",
          description: "Attribute name when target is attribute.",
        },
        dispatchEvents: {
          type: "boolean",
          description:
            "Dispatch input/change events after setting form values. Defaults to true.",
        },
      },
      required: ["selector", "value"],
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_NETWORK_START_RECORDING,
    title: "Start Network recording",
    description:
      "Attach Chrome debugger to the active tab and collect Network events for that tab only. Use before listing Network requests.",
    parameters: {
      type: "object",
      properties: {
        preserveLog: {
          type: "boolean",
          description:
            "Keep existing collected requests when a new observation session starts. Defaults to false. Repeating start while already recording is idempotent and does not clear the active session.",
        },
        maxEntries: {
          type: "number",
          description:
            "Maximum collected request entries to keep. Defaults to 2000. When full, static successful GET noise is evicted before navigation, failures, mutations, and XHR/Fetch requests.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_NETWORK_STOP_RECORDING,
    title: "Stop Network recording",
    description:
      "Disable Network event collection for the current debugger tab without clearing collected requests.",
    parameters: NO_ARG_PARAMETERS,
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_NETWORK_CLEAR,
    title: "Clear Network requests",
    description: "Clear collected Network requests for the current debugger tab.",
    parameters: NO_ARG_PARAMETERS,
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_NETWORK_REQUESTS,
    title: "Network requests",
    description:
      "Network request list for the active tab. Start Network recording before the action, then read once after a meaningful action barrier. The result includes activityDigest, which strips query/fragment data, groups repeated method+path+status entries, collapses heartbeat-like GET/HEAD traffic, and prioritizes mutations, navigation, redirects, and failures. Prefer activityDigest over sending repetitive raw requests to the model.",
    parameters: {
      type: "object",
      properties: {
        cursor: {
          type: "string",
          description:
            "Opaque nextCursor from the previous Network page. Stop recording before multi-page reads; collection changes invalidate the cursor.",
        },
        limit: {
          type: "number",
          description: "Maximum requests per page, from 1 to 100. Defaults to 50.",
        },
        urlContains: {
          type: "string",
          description: "Only include requests whose URL contains this text.",
        },
        method: {
          type: "string",
          description: "Only include requests with this HTTP method.",
        },
        resourceType: {
          type: "string",
          description:
            "Only include requests with this CDP resource type, such as XHR, Fetch, Document, Script, or Stylesheet.",
        },
        statusMin: {
          type: "number",
          description: "Only include responses with status >= this value.",
        },
        statusMax: {
          type: "number",
          description: "Only include responses with status <= this value.",
        },
        digestOnly: {
          type: "boolean",
          description:
            "Return the bounded activityDigest without raw request rows. Use true for Agent action verification and heartbeat-heavy pages.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_NETWORK_LIST_REQUESTS,
    title: "List Network requests",
    description:
      "List collected Network requests from the active tab. Start Network recording before the action, then read once after a meaningful action barrier. Use the bounded activityDigest to distinguish business requests from repeated heartbeat traffic.",
    parameters: {
      type: "object",
      properties: {
        cursor: {
          type: "string",
          description:
            "Opaque nextCursor from the previous Network page. Stop recording before multi-page reads; collection changes invalidate the cursor.",
        },
        limit: {
          type: "number",
          description: "Maximum requests per page, from 1 to 100. Defaults to 50.",
        },
        urlContains: {
          type: "string",
          description: "Only include requests whose URL contains this text.",
        },
        method: {
          type: "string",
          description: "Only include requests with this HTTP method.",
        },
        resourceType: {
          type: "string",
          description:
            "Only include requests with this CDP resource type, such as XHR, Fetch, Document, Script, or Stylesheet.",
        },
        statusMin: {
          type: "number",
          description: "Only include responses with status >= this value.",
        },
        statusMax: {
          type: "number",
          description: "Only include responses with status <= this value.",
        },
        digestOnly: {
          type: "boolean",
          description:
            "Return the bounded activityDigest without raw request rows. Use true for Agent action verification and heartbeat-heavy pages.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_NETWORK_GET_REQUEST,
    title: "Get Network request",
    description:
      "Read details for a collected Network request by requestId. Can include the response body while Network recording remains active; read bodies before browser_network_stop_recording because Chrome may release them when recording stops.",
    parameters: {
      type: "object",
      properties: {
        requestId: {
          type: "string",
          description: "Request id returned by browser_network_requests.",
        },
        includeBody: {
          type: "boolean",
          description: "Also call Network.getResponseBody.",
        },
      },
      required: ["requestId"],
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_NETWORK_GET_RESPONSE_BODY,
    title: "Get Network response body",
    description:
      "Read response body for a collected Network request by requestId while Network recording remains active. Call this before browser_network_stop_recording because Chrome may release collected bodies when recording stops.",
    parameters: {
      type: "object",
      properties: {
        requestId: {
          type: "string",
          description: "Request id returned by browser_network_requests.",
        },
      },
      required: ["requestId"],
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_DEBUGGER_DETACH,
    title: "Detach debugger",
    description: "Detach Chrome debugger from the active tab.",
    parameters: {
      type: "object",
      properties: {
        tabId: {
          type: "number",
          description:
            "Optional tab id to detach. Defaults to the active debugger tab.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_PROXY_ENABLE,
    title: "Enable request proxy",
    description:
      "Attach Chrome debugger to the active tab, enable CDP Network monitoring, and enable Fetch interception for in-memory proxy rules.",
    parameters: NO_ARG_PARAMETERS,
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_PROXY_DISABLE,
    title: "Disable request proxy",
    description:
      "Disable CDP Fetch interception while keeping in-memory proxy rules and Network captures available.",
    parameters: NO_ARG_PARAMETERS,
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_PROXY_LIST_RULES,
    title: "List request proxy rules",
    description:
      "List in-memory CDP Fetch proxy rules that can modify request headers, response headers, status, and response bodies.",
    parameters: NO_ARG_PARAMETERS,
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_PROXY_UPSERT_RULE,
    title: "Upsert request proxy rule",
    description:
      "Create or replace a CDP Fetch proxy rule. Use requestHeaders to add/replace/remove outgoing headers. Use responseBody or responseBodyBase64 to mock/replace response data.",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Stable rule id. Omit to create a new rule.",
        },
        enabled: {
          type: "boolean",
          description: "Whether the rule is active. Defaults to true.",
        },
        priority: {
          type: "number",
          description:
            "Higher-priority rules win when several rules provide the same action. Defaults to 1.",
        },
        urlPattern: {
          type: "string",
          description:
            "CDP wildcard URL pattern, for example *://api.example.com/users*.",
        },
        urlContains: {
          type: "string",
          description:
            "Convenience substring matcher. Converted to a CDP wildcard pattern.",
        },
        regexFilter: {
          type: "string",
          description:
            "Additional JavaScript RegExp URL filter applied inside the extension.",
        },
        method: {
          type: "string",
          description: "Optional HTTP method filter such as GET or POST.",
        },
        resourceType: {
          type: "string",
          description:
            "Optional CDP resource type such as XHR, Fetch, Document, Script, or Stylesheet.",
        },
        requestHeaders: {
          type: "array",
          items: {
            type: "object",
            properties: {
              header: { type: "string" },
              operation: {
                type: "string",
                enum: ["set", "append", "remove"],
              },
              value: { type: "string" },
            },
            required: ["header", "operation"],
            additionalProperties: false,
          },
          description:
            "Outgoing request header operations. set replaces an existing header, append appends to it, remove deletes it.",
        },
        responseHeaders: {
          type: "array",
          items: {
            type: "object",
            properties: {
              header: { type: "string" },
              operation: {
                type: "string",
                enum: ["set", "append", "remove"],
              },
              value: { type: "string" },
            },
            required: ["header", "operation"],
            additionalProperties: false,
          },
          description:
            "Response header operations applied when the response is paused.",
        },
        responseBody: {
          type: "string",
          description:
            "UTF-8 response body to return. It will be base64 encoded for Fetch.fulfillRequest.",
        },
        responseBodyBase64: {
          type: "string",
          description:
            "Already base64 encoded response body for binary mocks.",
        },
        statusCode: {
          type: "number",
          description: "HTTP response code for mocked/replaced responses.",
        },
        responsePhrase: {
          type: "string",
          description: "Optional HTTP response phrase.",
        },
        contentType: {
          type: "string",
          description:
            "Convenience content-type for response body mocks, such as application/json; charset=utf-8.",
        },
        mockStage: {
          type: "string",
          enum: ["request", "response"],
          description:
            "request fulfills before the origin request is sent; response replaces the body after origin response headers arrive. Defaults to response.",
        },
        scenarioSteps: {
          type: "array",
          minItems: 1,
          maxItems: 50,
          description:
            "Ordered stateful response steps. Each successful fulfilled request advances one step.",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              responseHeaders: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    header: { type: "string" },
                    operation: {
                      type: "string",
                      enum: ["set", "append", "remove"],
                    },
                    value: { type: "string" },
                  },
                  required: ["header", "operation"],
                  additionalProperties: false,
                },
              },
              responseBody: { type: "string" },
              responseBodyBase64: { type: "string" },
              statusCode: { type: "number" },
              responsePhrase: { type: "string" },
              contentType: { type: "string" },
            },
            additionalProperties: false,
          },
        },
        scenarioRepeat: {
          type: "string",
          enum: ["hold-last", "loop"],
          description:
            "After the last response, keep returning the last step or loop to the first.",
        },
        resetScenario: {
          type: "boolean",
          description:
            "Reset the persisted scenario cursor and hit counter while upserting this rule.",
        },
      },
      anyOf: [
        { required: ["urlPattern"] },
        { required: ["urlContains"] },
        { required: ["regexFilter"] },
      ],
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_PROXY_REMOVE_RULE,
    title: "Remove request proxy rule",
    description: "Remove one in-memory CDP Fetch proxy rule by id.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_PROXY_CLEAR_RULES,
    title: "Clear request proxy rules",
    description: "Remove all in-memory CDP Fetch proxy rules.",
    parameters: NO_ARG_PARAMETERS,
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_PROXY_LIST_HITS,
    title: "List request proxy hits",
    description:
      "List recent CDP Fetch proxy rule hits, including stage, URL, action, and request id.",
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of hits to return. Defaults to 100.",
        },
        ruleId: {
          type: "string",
          description: "Optional rule id filter.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_LIST_NETWORK_RULES,
    title: "List Network rules",
    description:
      "List dynamic request header, response header, and GET mock rules managed by the extension.",
    parameters: NO_ARG_PARAMETERS,
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_UPSERT_HEADER_RULE,
    title: "Upsert header rule",
    description:
      "Create or replace a dynamic declarativeNetRequest rule that modifies request headers or response headers for matching URLs.",
    parameters: {
      type: "object",
      properties: {
        ruleId: {
          type: "number",
          description: "Optional rule id. Omit to allocate the next id.",
        },
        priority: {
          type: "number",
          description: "Rule priority. Defaults to 1.",
        },
        target: {
          type: "string",
          enum: ["request", "response"],
          description:
            "Whether to modify request headers or response headers. Defaults to request.",
        },
        urlFilter: {
          type: "string",
          description: "Chrome DNR urlFilter pattern.",
        },
        regexFilter: {
          type: "string",
          description: "Chrome DNR regexFilter pattern.",
        },
        resourceTypes: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional Chrome resource types, for example xmlhttprequest, main_frame, sub_frame.",
        },
        headers: {
          type: "array",
          items: {
            type: "object",
            properties: {
              header: { type: "string" },
              operation: {
                type: "string",
                enum: ["set", "append", "remove"],
              },
              value: { type: "string" },
            },
            required: ["header", "operation"],
            additionalProperties: false,
          },
          description: "Header modifications to apply.",
        },
      },
      anyOf: [{ required: ["urlFilter"] }, { required: ["regexFilter"] }],
      required: ["headers"],
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_UPSERT_GET_MOCK,
    title: "Upsert GET mock",
    description:
      "Create or replace a dynamic GET redirect mock rule for matching network requests.",
    parameters: {
      type: "object",
      properties: {
        ruleId: {
          type: "number",
          description: "Optional rule id. Omit to allocate the next id.",
        },
        priority: {
          type: "number",
          description: "Rule priority. Defaults to 1.",
        },
        urlFilter: {
          type: "string",
          description: "Chrome DNR urlFilter pattern.",
        },
        regexFilter: {
          type: "string",
          description: "Chrome DNR regexFilter pattern.",
        },
        resourceTypes: {
          type: "array",
          items: { type: "string" },
          description: "Optional Chrome resource types. Defaults to XHR.",
        },
        extensionPath: {
          type: "string",
          description:
            "Extension-local JSON path to redirect to, such as /mocks/default.json.",
        },
      },
      anyOf: [{ required: ["urlFilter"] }, { required: ["regexFilter"] }],
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_REMOVE_NETWORK_RULE,
    title: "Remove Network rule",
    description: "Remove one dynamic declarativeNetRequest rule by id.",
    parameters: {
      type: "object",
      properties: {
        ruleId: {
          type: "number",
          description: "Dynamic rule id to remove.",
        },
      },
      required: ["ruleId"],
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_APPLY_CSS_PATCH,
    title: "Apply CSS patch",
    description:
      `Apply a temporary CSS patch to the current page. Use this to hide, restyle, or visually adjust elements. Do not include JavaScript. Each call accepts at most ${MAX_CSS_PATCH_CHARS} characters. If more CSS is required, split only at complete rule or at-rule boundaries and apply each segment with a distinct stable patchId.`,
    parameters: {
      type: "object",
      properties: {
        patchId: {
          type: "string",
          description:
            "Stable patch identifier so the same patch can be updated or removed later.",
        },
        css: {
          type: "string",
          minLength: 1,
          maxLength: MAX_CSS_PATCH_CHARS,
          description:
            `CSS text to apply temporarily, up to ${MAX_CSS_PATCH_CHARS} characters. For larger styles, split at complete rule or at-rule boundaries; never cut inside a declaration or block.`,
        },
      },
      required: ["css"],
      additionalProperties: false,
    },
  },
  {
    name: MCP_TOOL_NAMES.BROWSER_REMOVE_CSS_PATCH,
    title: "Remove CSS patch",
    description: "Remove a previously applied temporary CSS patch.",
    parameters: {
      type: "object",
      properties: {
        patchId: {
          type: "string",
          description: "Identifier of the patch to remove.",
        },
      },
      required: ["patchId"],
      additionalProperties: false,
    },
  },
] as const;

const BROWSER_WORKFLOW_DEFINITION = MCP_BASE_TOOL_DEFINITIONS.find(
  (tool) => tool.name === MCP_TOOL_NAMES.BROWSER_WORKFLOW,
);
if (!BROWSER_WORKFLOW_DEFINITION) {
  throw new Error("Missing browser_workflow definition.");
}

export const MCP_TOOL_DEFINITIONS: readonly McpToolDefinition[] = [
  ...MCP_BASE_TOOL_DEFINITIONS,
  {
    name: MCP_TOOL_NAMES.BROWSER_CAPTURE_ISSUE_EVIDENCE,
    title: "Capture issue evidence bundle",
    description:
      "Capture before/after screenshots, run one bounded browser workflow, correlate DOM, URL, Network, Console, component/source evidence, and save a session-scoped JSON evidence artifact. Screenshot bytes stay in separate artifact references.",
    parameters: {
      ...BROWSER_WORKFLOW_DEFINITION.parameters,
      properties: {
        title: {
          type: "string",
          description: "Short issue title included in the evidence manifest.",
        },
        description: {
          type: "string",
          description: "Optional reproduction context or expected behavior.",
        },
        captureScreenshots: {
          type: "boolean",
          description:
            "Capture visual before/after evidence and a pixel diff. Defaults to true.",
        },
        ...BROWSER_WORKFLOW_DEFINITION.parameters.properties,
      },
      required: ["title"],
    },
  },
];

const MCP_TOOL_NAME_SET = new Set<string>(
  MCP_TOOL_DEFINITIONS.map((tool) => tool.name),
);

const MCP_TOOL_NAME_ALIASES: Record<string, McpToolName> = {
  capture_issue_evidence: MCP_TOOL_NAMES.BROWSER_CAPTURE_ISSUE_EVIDENCE,
  diagnose_runtime_errors:
    MCP_TOOL_NAMES.BROWSER_DIAGNOSE_RUNTIME_ERRORS,
  read_page_info: MCP_TOOL_NAMES.BROWSER_GET_PAGE_CONTEXT,
  browser_snapshot: MCP_TOOL_NAMES.BROWSER_SNAPSHOT,
  take_snapshot: MCP_TOOL_NAMES.BROWSER_SNAPSHOT,
  query_dom: MCP_TOOL_NAMES.BROWSER_QUERY_DOM,
  start_element_picker: MCP_TOOL_NAMES.BROWSER_START_ELEMENT_PICKER,
  cancel_element_picker: MCP_TOOL_NAMES.BROWSER_CANCEL_ELEMENT_PICKER,
  highlight_element: MCP_TOOL_NAMES.BROWSER_HIGHLIGHT_ELEMENT,
  clear_highlights: MCP_TOOL_NAMES.BROWSER_CLEAR_HIGHLIGHTS,
  context_digest: MCP_TOOL_NAMES.BROWSER_GET_CONTEXT_DIGEST,
  get_context_digest: MCP_TOOL_NAMES.BROWSER_GET_CONTEXT_DIGEST,
  take_screenshot: MCP_TOOL_NAMES.BROWSER_TAKE_SCREENSHOT,
  list_tabs: MCP_TOOL_NAMES.BROWSER_LIST_TABS,
  set_target_tab: MCP_TOOL_NAMES.BROWSER_SET_TARGET_TAB,
  list_frames: MCP_TOOL_NAMES.BROWSER_LIST_FRAMES,
  set_target_frame: MCP_TOOL_NAMES.BROWSER_SET_TARGET_FRAME,
  navigate: MCP_TOOL_NAMES.BROWSER_NAVIGATE,
  browser_navigate: MCP_TOOL_NAMES.BROWSER_NAVIGATE,
  navigate_back: MCP_TOOL_NAMES.BROWSER_NAVIGATE_BACK,
  browser_navigate_back: MCP_TOOL_NAMES.BROWSER_NAVIGATE_BACK,
  navigate_forward: MCP_TOOL_NAMES.BROWSER_NAVIGATE_FORWARD,
  browser_navigate_forward: MCP_TOOL_NAMES.BROWSER_NAVIGATE_FORWARD,
  reload: MCP_TOOL_NAMES.BROWSER_RELOAD,
  browser_reload: MCP_TOOL_NAMES.BROWSER_RELOAD,
  close: MCP_TOOL_NAMES.BROWSER_CLOSE,
  browser_close: MCP_TOOL_NAMES.BROWSER_CLOSE,
  resize: MCP_TOOL_NAMES.BROWSER_RESIZE,
  browser_resize: MCP_TOOL_NAMES.BROWSER_RESIZE,
  click: MCP_TOOL_NAMES.BROWSER_CLICK,
  browser_click: MCP_TOOL_NAMES.BROWSER_CLICK,
  hover: MCP_TOOL_NAMES.BROWSER_HOVER,
  browser_hover: MCP_TOOL_NAMES.BROWSER_HOVER,
  drag: MCP_TOOL_NAMES.BROWSER_DRAG,
  browser_drag: MCP_TOOL_NAMES.BROWSER_DRAG,
  fill_form: MCP_TOOL_NAMES.BROWSER_FILL_FORM,
  browser_fill_form: MCP_TOOL_NAMES.BROWSER_FILL_FORM,
  type: MCP_TOOL_NAMES.BROWSER_TYPE,
  browser_type: MCP_TOOL_NAMES.BROWSER_TYPE,
  press_key: MCP_TOOL_NAMES.BROWSER_PRESS_KEY,
  browser_press_key: MCP_TOOL_NAMES.BROWSER_PRESS_KEY,
  select_option: MCP_TOOL_NAMES.BROWSER_SELECT_OPTION,
  browser_select_option: MCP_TOOL_NAMES.BROWSER_SELECT_OPTION,
  mouse_move_xy: MCP_TOOL_NAMES.BROWSER_MOUSE_MOVE_XY,
  browser_mouse_move_xy: MCP_TOOL_NAMES.BROWSER_MOUSE_MOVE_XY,
  mouse_click_xy: MCP_TOOL_NAMES.BROWSER_MOUSE_CLICK_XY,
  browser_mouse_click_xy: MCP_TOOL_NAMES.BROWSER_MOUSE_CLICK_XY,
  mouse_down: MCP_TOOL_NAMES.BROWSER_MOUSE_DOWN,
  browser_mouse_down: MCP_TOOL_NAMES.BROWSER_MOUSE_DOWN,
  mouse_up: MCP_TOOL_NAMES.BROWSER_MOUSE_UP,
  browser_mouse_up: MCP_TOOL_NAMES.BROWSER_MOUSE_UP,
  mouse_drag_xy: MCP_TOOL_NAMES.BROWSER_MOUSE_DRAG_XY,
  browser_mouse_drag_xy: MCP_TOOL_NAMES.BROWSER_MOUSE_DRAG_XY,
  mouse_wheel_xy: MCP_TOOL_NAMES.BROWSER_MOUSE_WHEEL_XY,
  browser_mouse_wheel_xy: MCP_TOOL_NAMES.BROWSER_MOUSE_WHEEL_XY,
  wait_for: MCP_TOOL_NAMES.BROWSER_WAIT_FOR,
  browser_wait_for: MCP_TOOL_NAMES.BROWSER_WAIT_FOR,
  evaluate: MCP_TOOL_NAMES.BROWSER_EVALUATE,
  browser_evaluate: MCP_TOOL_NAMES.BROWSER_EVALUATE,
  debugger_breakpoint: MCP_TOOL_NAMES.BROWSER_DEBUGGER_BREAKPOINT,
  browser_debugger_breakpoint: MCP_TOOL_NAMES.BROWSER_DEBUGGER_BREAKPOINT,
  debugger_control: MCP_TOOL_NAMES.BROWSER_DEBUGGER_CONTROL,
  browser_debugger_control: MCP_TOOL_NAMES.BROWSER_DEBUGGER_CONTROL,
  handle_dialog: MCP_TOOL_NAMES.BROWSER_HANDLE_DIALOG,
  browser_handle_dialog: MCP_TOOL_NAMES.BROWSER_HANDLE_DIALOG,
  storage_state: MCP_TOOL_NAMES.BROWSER_STORAGE_STATE,
  browser_storage_state: MCP_TOOL_NAMES.BROWSER_STORAGE_STATE,
  cookie_list: MCP_TOOL_NAMES.BROWSER_COOKIE_LIST,
  browser_cookie_list: MCP_TOOL_NAMES.BROWSER_COOKIE_LIST,
  cookie_set: MCP_TOOL_NAMES.BROWSER_COOKIE_SET,
  browser_cookie_set: MCP_TOOL_NAMES.BROWSER_COOKIE_SET,
  cookie_delete: MCP_TOOL_NAMES.BROWSER_COOKIE_DELETE,
  browser_cookie_delete: MCP_TOOL_NAMES.BROWSER_COOKIE_DELETE,
  console_messages: MCP_TOOL_NAMES.BROWSER_CONSOLE_MESSAGES,
  browser_console_messages: MCP_TOOL_NAMES.BROWSER_CONSOLE_MESSAGES,
  set_dom_value: MCP_TOOL_NAMES.BROWSER_SET_DOM_VALUE,
  dom_set_value: MCP_TOOL_NAMES.BROWSER_SET_DOM_VALUE,
  network_start: MCP_TOOL_NAMES.BROWSER_NETWORK_START_RECORDING,
  network_stop: MCP_TOOL_NAMES.BROWSER_NETWORK_STOP_RECORDING,
  network_clear: MCP_TOOL_NAMES.BROWSER_NETWORK_CLEAR,
  network_requests: MCP_TOOL_NAMES.BROWSER_NETWORK_REQUESTS,
  browser_network_requests: MCP_TOOL_NAMES.BROWSER_NETWORK_REQUESTS,
  network_list: MCP_TOOL_NAMES.BROWSER_NETWORK_LIST_REQUESTS,
  network_get: MCP_TOOL_NAMES.BROWSER_NETWORK_GET_REQUEST,
  network_get_body: MCP_TOOL_NAMES.BROWSER_NETWORK_GET_RESPONSE_BODY,
  debugger_detach: MCP_TOOL_NAMES.BROWSER_DEBUGGER_DETACH,
  proxy_enable: MCP_TOOL_NAMES.BROWSER_PROXY_ENABLE,
  proxy_disable: MCP_TOOL_NAMES.BROWSER_PROXY_DISABLE,
  proxy_list_rules: MCP_TOOL_NAMES.BROWSER_PROXY_LIST_RULES,
  proxy_upsert_rule: MCP_TOOL_NAMES.BROWSER_PROXY_UPSERT_RULE,
  proxy_remove_rule: MCP_TOOL_NAMES.BROWSER_PROXY_REMOVE_RULE,
  proxy_clear_rules: MCP_TOOL_NAMES.BROWSER_PROXY_CLEAR_RULES,
  proxy_list_hits: MCP_TOOL_NAMES.BROWSER_PROXY_LIST_HITS,
  list_network_rules: MCP_TOOL_NAMES.BROWSER_LIST_NETWORK_RULES,
  upsert_header_rule: MCP_TOOL_NAMES.BROWSER_UPSERT_HEADER_RULE,
  upsert_get_mock: MCP_TOOL_NAMES.BROWSER_UPSERT_GET_MOCK,
  remove_network_rule: MCP_TOOL_NAMES.BROWSER_REMOVE_NETWORK_RULE,
  apply_css_patch: MCP_TOOL_NAMES.BROWSER_APPLY_CSS_PATCH,
  remove_css_patch: MCP_TOOL_NAMES.BROWSER_REMOVE_CSS_PATCH,
};

const MCP_EXPOSED_TOOL_ORDER: readonly McpToolName[] = [
  MCP_TOOL_NAMES.BROWSER_STATUS,
  MCP_TOOL_NAMES.BROWSER_ACTIVITY_START,
  MCP_TOOL_NAMES.BROWSER_ACTIVITY_STOP,
  MCP_TOOL_NAMES.BROWSER_WORKFLOW,
  MCP_TOOL_NAMES.BROWSER_CAPTURE_ISSUE_EVIDENCE,
  MCP_TOOL_NAMES.BROWSER_OBSERVE,
  MCP_TOOL_NAMES.BROWSER_LOCATE_SOURCE,
  MCP_TOOL_NAMES.BROWSER_EXPLAIN_CSS,
  MCP_TOOL_NAMES.BROWSER_PERFORMANCE_DIAGNOSTICS,
  MCP_TOOL_NAMES.BROWSER_REALTIME_ACTIVITY,
  MCP_TOOL_NAMES.BROWSER_CREATE_REPRODUCTION_RECIPE,
  MCP_TOOL_NAMES.BROWSER_RUN_REPRODUCTION_RECIPE,
  MCP_TOOL_NAMES.BROWSER_READ_ARTIFACT,
  MCP_TOOL_NAMES.BROWSER_ACT,
  MCP_TOOL_NAMES.BROWSER_VERIFY,
  MCP_TOOL_NAMES.BROWSER_DEBUG_ACTIVITY,
  MCP_TOOL_NAMES.BROWSER_DIAGNOSE_RUNTIME_ERRORS,
  MCP_TOOL_NAMES.BROWSER_SNAPSHOT,
  MCP_TOOL_NAMES.BROWSER_GET_CONTEXT_DIGEST,
  MCP_TOOL_NAMES.BROWSER_QUERY_DOM,
  MCP_TOOL_NAMES.BROWSER_GET_SELECTED_ELEMENT,
  MCP_TOOL_NAMES.BROWSER_TAKE_SCREENSHOT,
  MCP_TOOL_NAMES.BROWSER_LIST_TABS,
  MCP_TOOL_NAMES.BROWSER_SET_TARGET_TAB,
  MCP_TOOL_NAMES.BROWSER_LIST_FRAMES,
  MCP_TOOL_NAMES.BROWSER_SET_TARGET_FRAME,
  MCP_TOOL_NAMES.BROWSER_CLICK,
  MCP_TOOL_NAMES.BROWSER_TYPE,
  MCP_TOOL_NAMES.BROWSER_FILL_FORM,
  MCP_TOOL_NAMES.BROWSER_EXECUTE_ACTION_STAGE,
  MCP_TOOL_NAMES.BROWSER_PRESS_KEY,
  MCP_TOOL_NAMES.BROWSER_SELECT_OPTION,
  MCP_TOOL_NAMES.BROWSER_WAIT_FOR,
  MCP_TOOL_NAMES.BROWSER_EVALUATE,
  MCP_TOOL_NAMES.BROWSER_DEBUGGER_BREAKPOINT,
  MCP_TOOL_NAMES.BROWSER_DEBUGGER_CONTROL,
  MCP_TOOL_NAMES.BROWSER_HOVER,
  MCP_TOOL_NAMES.BROWSER_DRAG,
  MCP_TOOL_NAMES.BROWSER_NAVIGATE,
  MCP_TOOL_NAMES.BROWSER_NAVIGATE_BACK,
  MCP_TOOL_NAMES.BROWSER_NAVIGATE_FORWARD,
  MCP_TOOL_NAMES.BROWSER_RELOAD,
  MCP_TOOL_NAMES.BROWSER_CLOSE,
  MCP_TOOL_NAMES.BROWSER_RESIZE,
  MCP_TOOL_NAMES.BROWSER_CONSOLE_MESSAGES,
  MCP_TOOL_NAMES.BROWSER_NETWORK_START_RECORDING,
  MCP_TOOL_NAMES.BROWSER_NETWORK_REQUESTS,
  MCP_TOOL_NAMES.BROWSER_NETWORK_GET_REQUEST,
  MCP_TOOL_NAMES.BROWSER_NETWORK_GET_RESPONSE_BODY,
  MCP_TOOL_NAMES.BROWSER_NETWORK_CLEAR,
  MCP_TOOL_NAMES.BROWSER_NETWORK_STOP_RECORDING,
  MCP_TOOL_NAMES.BROWSER_PROXY_UPSERT_RULE,
  MCP_TOOL_NAMES.BROWSER_PROXY_ENABLE,
  MCP_TOOL_NAMES.BROWSER_PROXY_LIST_RULES,
  MCP_TOOL_NAMES.BROWSER_PROXY_LIST_HITS,
  MCP_TOOL_NAMES.BROWSER_PROXY_REMOVE_RULE,
  MCP_TOOL_NAMES.BROWSER_PROXY_CLEAR_RULES,
  MCP_TOOL_NAMES.BROWSER_PROXY_DISABLE,
  MCP_TOOL_NAMES.BROWSER_STORAGE_STATE,
  MCP_TOOL_NAMES.BROWSER_COOKIE_LIST,
  MCP_TOOL_NAMES.BROWSER_COOKIE_SET,
  MCP_TOOL_NAMES.BROWSER_COOKIE_DELETE,
  MCP_TOOL_NAMES.BROWSER_APPLY_CSS_PATCH,
  MCP_TOOL_NAMES.BROWSER_REMOVE_CSS_PATCH,
  MCP_TOOL_NAMES.BROWSER_SET_DOM_VALUE,
  MCP_TOOL_NAMES.BROWSER_START_ELEMENT_PICKER,
  MCP_TOOL_NAMES.BROWSER_CANCEL_ELEMENT_PICKER,
  MCP_TOOL_NAMES.BROWSER_HIGHLIGHT_ELEMENT,
  MCP_TOOL_NAMES.BROWSER_CLEAR_HIGHLIGHTS,
  MCP_TOOL_NAMES.BROWSER_MOUSE_MOVE_XY,
  MCP_TOOL_NAMES.BROWSER_MOUSE_CLICK_XY,
  MCP_TOOL_NAMES.BROWSER_MOUSE_DOWN,
  MCP_TOOL_NAMES.BROWSER_MOUSE_UP,
  MCP_TOOL_NAMES.BROWSER_MOUSE_DRAG_XY,
  MCP_TOOL_NAMES.BROWSER_MOUSE_WHEEL_XY,
  MCP_TOOL_NAMES.BROWSER_HANDLE_DIALOG,
  MCP_TOOL_NAMES.BROWSER_GET_PLUGIN_CONVERSATION,
  MCP_TOOL_NAMES.BROWSER_GET_AUDIT_EVENTS,
  MCP_TOOL_NAMES.BROWSER_GET_LAST_PLUGIN_MESSAGE,
  MCP_TOOL_NAMES.BROWSER_DEBUGGER_DETACH,
  MCP_TOOL_NAMES.BROWSER_LIST_NETWORK_RULES,
  MCP_TOOL_NAMES.BROWSER_UPSERT_HEADER_RULE,
  MCP_TOOL_NAMES.BROWSER_UPSERT_GET_MOCK,
  MCP_TOOL_NAMES.BROWSER_REMOVE_NETWORK_RULE,
];

const MCP_EXPOSED_TOOL_NAME_SET = new Set<McpToolName>(
  MCP_EXPOSED_TOOL_ORDER,
);

export const MCP_EXPOSED_TOOL_DEFINITIONS: readonly McpToolDefinition[] =
  MCP_EXPOSED_TOOL_ORDER.map(requireMcpToolDefinition);

export const MCP_AI_TOOL_DEFINITIONS: readonly McpAiToolDefinition[] =
  MCP_EXPOSED_TOOL_DEFINITIONS.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));

export function normalizeMcpToolName(name: string): McpToolName | null {
  if (MCP_TOOL_NAME_SET.has(name)) {
    return name as McpToolName;
  }

  return MCP_TOOL_NAME_ALIASES[name] ?? null;
}

export function isMcpToolName(name: string): name is McpToolName {
  return normalizeMcpToolName(name) !== null;
}

export function getMcpToolDefinition(name: string): McpToolDefinition | null {
  const normalizedName = normalizeMcpToolName(name);
  if (!normalizedName) {
    return null;
  }

  return (
    MCP_TOOL_DEFINITIONS.find((tool) => tool.name === normalizedName) ?? null
  );
}

export function isExposedMcpToolName(name: string): name is McpToolName {
  const normalizedName = normalizeMcpToolName(name);
  return Boolean(
    normalizedName && MCP_EXPOSED_TOOL_NAME_SET.has(normalizedName),
  );
}

function requireMcpToolDefinition(name: McpToolName): McpToolDefinition {
  const definition = MCP_TOOL_DEFINITIONS.find((tool) => tool.name === name);
  if (!definition) {
    throw new Error(`Missing MCP tool definition: ${name}`);
  }
  return definition;
}
