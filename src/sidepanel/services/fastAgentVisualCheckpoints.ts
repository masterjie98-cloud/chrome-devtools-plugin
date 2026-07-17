import { MCP_TOOL_NAMES, normalizeMcpToolName } from "../../shared/mcpTools";
import type { ChatImageAttachment } from "../types";
import type {
  AiRequestedToolCall,
  AiToolResultMessage,
} from "./aiClient";
import {
  isAgentToolResultDefinitelyNotExecuted,
  isSuccessfulAgentToolResultContent,
} from "./agentToolResult";

export const MAX_FAST_AGENT_VISUAL_CHECKPOINT_ATTEMPTS = 8;
export const MAX_FAST_AGENT_VISUAL_CHECKPOINT_BYTES = 8 * 1024 * 1024;
export const FAST_AGENT_VISUAL_CHECKPOINT_COOLDOWN_MS = 750;

export type FastAgentVisualCheckpointReason =
  | "navigation"
  | "interaction_barrier"
  | "async_state"
  | "uncertain_failure"
  | "large_dom_change";

export interface FastAgentVisualCheckpointState {
  attempts: number;
  domObservationsSinceCheckpoint: number;
  lastImageFingerprint?: string;
  imageBytes: number;
  lastCaptureAt?: number;
}

export interface FastAgentVisualCheckpointDecision {
  reason: FastAgentVisualCheckpointReason;
  invalidatePriorVisual: true;
  captureEnabled: boolean;
  captureAllowed: boolean;
}

export interface FastAgentVisualCheckpointPlan {
  state: FastAgentVisualCheckpointState;
  decision?: FastAgentVisualCheckpointDecision;
}

export interface FastAgentVisualCheckpointAcceptance {
  state: FastAgentVisualCheckpointState;
  accepted: boolean;
  duplicate: boolean;
}

const NAVIGATION_TOOLS = new Set<string>([
  MCP_TOOL_NAMES.BROWSER_NAVIGATE,
  MCP_TOOL_NAMES.BROWSER_NAVIGATE_BACK,
  MCP_TOOL_NAMES.BROWSER_NAVIGATE_FORWARD,
  MCP_TOOL_NAMES.BROWSER_RELOAD,
]);

const INTERACTION_BARRIER_TOOLS = new Set<string>([
  MCP_TOOL_NAMES.BROWSER_CLICK,
  MCP_TOOL_NAMES.BROWSER_DRAG,
  MCP_TOOL_NAMES.BROWSER_PRESS_KEY,
  MCP_TOOL_NAMES.BROWSER_MOUSE_CLICK_XY,
  MCP_TOOL_NAMES.BROWSER_MOUSE_DRAG_XY,
  MCP_TOOL_NAMES.BROWSER_HANDLE_DIALOG,
  MCP_TOOL_NAMES.BROWSER_RESIZE,
  MCP_TOOL_NAMES.BROWSER_APPLY_CSS_PATCH,
  MCP_TOOL_NAMES.BROWSER_REMOVE_CSS_PATCH,
  MCP_TOOL_NAMES.BROWSER_EXECUTE_ACTION_STAGE,
]);

const DOM_OBSERVATION_TOOLS = new Set<string>([
  MCP_TOOL_NAMES.BROWSER_SNAPSHOT,
  MCP_TOOL_NAMES.BROWSER_GET_CONTEXT_DIGEST,
]);

export function createFastAgentVisualCheckpointState(): FastAgentVisualCheckpointState {
  return {
    attempts: 0,
    domObservationsSinceCheckpoint: 0,
    imageBytes: 0,
  };
}

export function planFastAgentVisualCheckpoint(params: {
  enabled: boolean;
  captureEnabled: boolean;
  state: FastAgentVisualCheckpointState;
  toolCalls: readonly AiRequestedToolCall[];
  toolResults: readonly AiToolResultMessage[];
}): FastAgentVisualCheckpointPlan {
  if (!params.enabled) {
    return { state: params.state };
  }

  const resultsById = new Map(
    params.toolResults.map((result) => [result.toolCallId, result]),
  );
  let successfulNavigation = false;
  let successfulInteractionBarrier = false;
  let successfulConditionalWait = false;
  let uncertainVisualFailure = false;
  let largeDomChange = false;

  for (const call of params.toolCalls) {
    const normalizedName = normalizeMcpToolName(call.name) ?? call.name;
    const result = resultsById.get(call.id);
    if (!result) {
      continue;
    }
    const successful = isSuccessfulAgentToolResultContent(result.content);
    const definitelyNotExecuted =
      isAgentToolResultDefinitelyNotExecuted(result.content);

    if (successful && NAVIGATION_TOOLS.has(normalizedName)) {
      successfulNavigation = true;
    }
    if (successful && INTERACTION_BARRIER_TOOLS.has(normalizedName)) {
      successfulInteractionBarrier = true;
    }
    if (
      successful &&
      normalizedName === MCP_TOOL_NAMES.BROWSER_WAIT_FOR &&
      !isTimingOnlyWait(call)
    ) {
      successfulConditionalWait = true;
    }
    if (
      successful &&
      DOM_OBSERVATION_TOOLS.has(normalizedName) &&
      reportsLargeDomChange(result.content)
    ) {
      largeDomChange = true;
    }
    if (
      !successful &&
      !definitelyNotExecuted &&
      (NAVIGATION_TOOLS.has(normalizedName) ||
        INTERACTION_BARRIER_TOOLS.has(normalizedName))
    ) {
      uncertainVisualFailure = true;
    }
  }

  const reason = successfulNavigation
    ? "navigation"
    : uncertainVisualFailure
      ? "uncertain_failure"
      : successfulInteractionBarrier
        ? "interaction_barrier"
        : successfulConditionalWait
          ? "async_state"
          : largeDomChange
            ? "large_dom_change"
          : undefined;

  if (!reason) {
    return {
      state: params.state,
    };
  }

  const captureAllowed =
    params.captureEnabled &&
    params.state.attempts < MAX_FAST_AGENT_VISUAL_CHECKPOINT_ATTEMPTS &&
    params.state.imageBytes < MAX_FAST_AGENT_VISUAL_CHECKPOINT_BYTES &&
    (reason === "navigation" ||
      !params.state.lastCaptureAt ||
      Date.now() - params.state.lastCaptureAt >=
        FAST_AGENT_VISUAL_CHECKPOINT_COOLDOWN_MS);

  return {
    state: {
      ...params.state,
      attempts: params.state.attempts + (captureAllowed ? 1 : 0),
      domObservationsSinceCheckpoint: 0,
      lastCaptureAt: captureAllowed ? Date.now() : params.state.lastCaptureAt,
    },
    decision: {
      reason,
      invalidatePriorVisual: true,
      captureEnabled: params.captureEnabled,
      captureAllowed,
    },
  };
}

export function acceptFastAgentVisualCheckpoint(
  state: FastAgentVisualCheckpointState,
  attachment: ChatImageAttachment,
): FastAgentVisualCheckpointAcceptance {
  const fingerprint = fingerprintVisualCheckpoint(attachment);
  if (fingerprint === state.lastImageFingerprint) {
    return { state, accepted: false, duplicate: true };
  }

  return {
    state: {
      ...state,
      lastImageFingerprint: fingerprint,
      imageBytes: state.imageBytes + estimateDataUrlBytes(attachment.dataUrl),
    },
    accepted: true,
    duplicate: false,
  };
}

export function describeFastAgentVisualCheckpointReason(
  reason: FastAgentVisualCheckpointReason,
): string {
  switch (reason) {
    case "navigation":
      return "页面导航或路由变化";
    case "interaction_barrier":
      return "页面交互屏障可能改变可视状态";
    case "async_state":
      return "异步页面状态已满足";
    case "uncertain_failure":
      return "页面操作结果不确定";
    case "large_dom_change":
      return "页面发生较大 DOM 变化";
  }
}

function fingerprintVisualCheckpoint(attachment: ChatImageAttachment): string {
  const data = attachment.dataUrl;
  const stride = Math.max(1, Math.floor(data.length / 64));
  let hash = 0x811c9dc5;
  const sampled = `${attachment.width ?? 0}x${attachment.height ?? 0}:${data.length}:`;
  for (let index = 0; index < sampled.length; index += 1) {
    hash ^= sampled.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  for (let index = 0; index < data.length; index += stride) {
    hash ^= data.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function estimateDataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  const encodedLength = comma >= 0 ? dataUrl.length - comma - 1 : dataUrl.length;
  return Math.ceil((encodedLength * 3) / 4);
}

function isTimingOnlyWait(call: AiRequestedToolCall): boolean {
  const time = call.arguments.time;
  return typeof time === "number" && Number.isFinite(time) && time > 0;
}

function reportsLargeDomChange(content: string): boolean {
  try {
    const parsed = JSON.parse(content) as {
      observation?: {
        delta?: {
          added?: number;
          removed?: number;
          attributes?: number;
          characterData?: number;
          truncated?: boolean;
        } | null;
      };
    };
    const delta = parsed.observation?.delta;
    if (!delta) {
      return false;
    }
    const mutations =
      (delta.added ?? 0) +
      (delta.removed ?? 0) +
      (delta.attributes ?? 0) +
      (delta.characterData ?? 0);
    return delta.truncated === true || mutations >= 20;
  } catch {
    return false;
  }
}
