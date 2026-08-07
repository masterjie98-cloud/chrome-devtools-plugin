import { createMessageId } from "../shared/messaging";
import type { AgentSessionSnapshot } from "../shared/agentSession";
import {
  appendAgentSessionEvent,
  finalizeAgentSession,
  updateAgentSessionRuntime,
  type AgentRunPhase,
} from "../shared/agentSession";
import { toAgentPageSnapshot } from "../shared/agentPageContext";
import type {
  DaemonAgentBudgetDecisionPayload,
  DaemonAgentEventPayload,
  DaemonAgentStartPayload,
  DaemonAgentToolMessage,
} from "../shared/daemonAgent";
import type {
  AgentRunBudgetExtensionDecision,
  AgentRunBudgetExtensionRequest,
} from "../shared/agentRunBudget";
import type { ScreenshotCaptureResult } from "../shared/dom";
import { MCP_TOOL_NAMES } from "../shared/mcpTools";
import { isExternalMcpToolName } from "../shared/externalMcp";
import { redactApprovalArguments } from "../shared/sensitiveData";
import { sanitizeMultilineText } from "../shared/sanitize";
import { assertSafeAiProviderUrl } from "../sidepanel/services/aiEndpointPolicy";
import { executeAgentToolBatch } from "../sidepanel/services/agentToolBatch";
import { isSuccessfulAgentToolResultContent } from "../sidepanel/services/agentToolResult";
import type {
  AiRequestedToolCall,
  AiToolResultMessage,
} from "../sidepanel/services/aiClient";
import { runAutonomousAgentSession } from "../sidepanel/services/autonomousAgent";
import {
  compactToolResultForModel,
  presentToolResult,
  toolResultModelCharLimit,
} from "../sidepanel/toolResultPresentation";
import type { ToolResultPresentationMeta } from "../sidepanel/toolResultPresentation";
import type { ChatImageAttachment } from "../sidepanel/types";
import { RUNTIME_BUILD_ID } from "../shared/runtimeIdentity";
import type { AgentRuntimeEnvironmentSnapshot } from "../shared/agentSession";
import {
  buildDeterministicConversationMemoryPatch,
  extractConversationMemory,
} from "./conversationMemoryExtractor";
import {
  requestNeedsBrowserContext,
  sanitizeConversationMemory,
} from "../shared/conversationMemory";

export interface DaemonAgentToolRequest {
  sessionId: string;
  runId: string;
  turnId?: string;
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  executionBinding?: DaemonAgentStartPayload["executionBinding"];
  egressDestinations: string[];
  signal: AbortSignal;
}

export interface DaemonAgentRunnerCallbacks {
  executeTool: (request: DaemonAgentToolRequest) => Promise<unknown>;
  emit: (event: DaemonAgentEventPayload) => void;
  persistSession: (session: DaemonAgentEventPayload & { kind: "session" }) => void;
}

const MAX_TOOL_REQUEST_DISPLAY_CHARS = 16_000;

function formatToolRequestArguments(args: Record<string, unknown>): string {
  try {
    return sanitizeMultilineText(
      JSON.stringify(redactApprovalArguments(args), null, 2),
      MAX_TOOL_REQUEST_DISPLAY_CHARS,
    );
  } catch {
    return "{\n  \"error\": \"请求参数无法序列化。\"\n}";
  }
}

interface ActiveDaemonAgentRun {
  runId: string;
  conversationId: string;
  controller: AbortController;
  pendingBudget?: {
    id: string;
    request: AgentRunBudgetExtensionRequest;
    resolve: (decision: AgentRunBudgetExtensionDecision) => void;
    reject: (error: unknown) => void;
    cleanup: () => void;
  };
}

export class DaemonAgentRunner {
  private readonly activeByConversation = new Map<string, ActiveDaemonAgentRun>();

  constructor(
    private readonly runSession: typeof runAutonomousAgentSession =
      runAutonomousAgentSession,
  ) {}

  start(
    sessionId: string,
    payload: DaemonAgentStartPayload,
    callbacks: DaemonAgentRunnerCallbacks,
  ): void {
    assertSafeAiProviderUrl(payload.config.apiUrl);
    if (!payload.config.model.trim()) {
      throw new Error("AI model is required.");
    }
    if (this.activeByConversation.has(this.key(sessionId, payload.conversationId))) {
      throw new Error(
        `AGENT_CONVERSATION_BUSY: ${payload.conversationId} already has a daemon run.`,
      );
    }

    const controller = new AbortController();
    const active: ActiveDaemonAgentRun = {
      runId: payload.runId,
      conversationId: payload.conversationId,
      controller,
    };
    this.activeByConversation.set(this.key(sessionId, payload.conversationId), active);

    void this.run(sessionId, payload, controller, callbacks).finally(() => {
      const key = this.key(sessionId, payload.conversationId);
      if (this.activeByConversation.get(key)?.runId === payload.runId) {
        this.activeByConversation.delete(key);
      }
    });
  }

  cancel(
    sessionId: string,
    conversationId: string,
    runId: string,
    reason?: string,
  ): boolean {
    const active = this.activeByConversation.get(this.key(sessionId, conversationId));
    if (!active || active.runId !== runId) {
      return false;
    }
    active.controller.abort(
      new DOMException(reason || "Agent run cancelled by user.", "AbortError"),
    );
    return true;
  }

  resolveBudgetDecision(
    sessionId: string,
    payload: DaemonAgentBudgetDecisionPayload,
  ): boolean {
    const active = this.activeByConversation.get(
      this.key(sessionId, payload.conversationId),
    );
    const pending = active?.pendingBudget;
    if (
      !active ||
      active.runId !== payload.runId ||
      !pending ||
      pending.id !== payload.budgetRequestId
    ) {
      return false;
    }
    active.pendingBudget = undefined;
    pending.cleanup();
    pending.resolve(payload.decision);
    return true;
  }

  close(): void {
    for (const active of this.activeByConversation.values()) {
      active.controller.abort(
        new DOMException("Local daemon is shutting down.", "AbortError"),
      );
    }
    this.activeByConversation.clear();
  }

  listPendingBudgetRequests(
    sessionId: string,
  ): Array<Extract<DaemonAgentEventPayload, { kind: "budget_request" }>> {
    const prefix = `${sessionId}:`;
    return Array.from(this.activeByConversation.entries()).flatMap(
      ([key, active]) => {
        if (!key.startsWith(prefix) || !active.pendingBudget) {
          return [];
        }
        return [
          {
            runId: active.runId,
            conversationId: active.conversationId,
            kind: "budget_request" as const,
            budgetRequestId: active.pendingBudget.id,
            request: active.pendingBudget.request,
          },
        ];
      },
    );
  }

  private async run(
    sessionId: string,
    payload: DaemonAgentStartPayload,
    controller: AbortController,
    callbacks: DaemonAgentRunnerCallbacks,
  ): Promise<void> {
    let latestVisibleContent = "";
    let latestSession: AgentSessionSnapshot | undefined;
    const memoryToolMessages: DaemonAgentToolMessage[] = [];
    const sanitizedMemory = sanitizeConversationMemory(payload.context.memory);
    payload.context = {
      ...payload.context,
      ...(sanitizedMemory ? { memory: sanitizedMemory } : {}),
    };
    if (!sanitizedMemory) {
      delete payload.context.memory;
    }
    const runtimeEnvironment = buildAgentRuntimeEnvironment(payload);
    try {
      const result = await this.runSession({
        config: payload.config,
        messages: payload.messages,
        input: payload.input,
        attachments: payload.attachments,
        context: payload.context,
        tools: payload.tools,
        assistantMessageId: payload.assistantMessageId,
        executionBinding: payload.executionBinding,
        abortSignal: controller.signal,
        runBudgetLimits: payload.runBudgetLimits,
        requestBudgetExtension: (request) =>
          this.requestBudgetDecision(sessionId, payload, callbacks, request),
        prepareContext: async (context) => {
          const activeAffinity = payload.context.memory?.activeTask?.affinity;
          if (!requestNeedsBrowserContext(payload.input, activeAffinity)) {
            const {
              pageSnapshot: _pageSnapshot,
              selectedElement: _selectedElement,
              contextReadError: _contextReadError,
              ...contextWithoutPage
            } = context;
            return contextWithoutPage;
          }
          if (!payload.config.includePageContext) {
            return context;
          }
          if (!payload.executionBinding) {
            const {
              pageSnapshot: _pageSnapshot,
              selectedElement: _selectedElement,
              contextReadError: _contextReadError,
              ...contextWithoutPage
            } = context;
            return contextWithoutPage;
          }
          try {
            const value = await callbacks.executeTool({
              sessionId,
              runId: payload.runId,
              toolCallId: `context-${createMessageId()}`,
              toolName: MCP_TOOL_NAMES.BROWSER_SNAPSHOT,
              args: payload.config.fastAgentMode
                ? { limit: 40, mode: "interactive", sourceLimit: 2_000 }
                : {},
              executionBinding: payload.executionBinding,
              egressDestinations: payload.egressDestinations,
              signal: controller.signal,
            });
            return {
              ...context,
              pageSnapshot:
                toAgentPageSnapshot(value, payload.executionBinding?.target) ??
                context.pageSnapshot,
              contextReadError: undefined,
            };
          } catch (error) {
            return {
              ...context,
              contextReadError:
                error instanceof Error
                  ? error.message
                  : "无法读取当前页面上下文。",
            };
          }
        },
        prepareVisualCheckpoint: async ({ captureImage, currentContext }) => {
          const errors: string[] = [];
          let nextContext = currentContext;
          let attachment: ChatImageAttachment | undefined;
          try {
            const value = await callbacks.executeTool({
              sessionId,
              runId: payload.runId,
              toolCallId: `checkpoint-${createMessageId()}`,
              toolName: MCP_TOOL_NAMES.BROWSER_SNAPSHOT,
              args: { limit: 40, mode: "interactive", sourceLimit: 2_000 },
              executionBinding: payload.executionBinding,
              egressDestinations: payload.egressDestinations,
              signal: controller.signal,
            });
            nextContext = {
              ...currentContext,
              pageSnapshot: toAgentPageSnapshot(
                value,
                payload.executionBinding?.target,
              ),
              selectedElement: undefined,
              contextReadError: undefined,
            };
          } catch (error) {
            const detail = error instanceof Error ? error.message : "DOM 上下文刷新失败";
            errors.push(detail);
            nextContext = {
              ...currentContext,
              pageSnapshot: undefined,
              selectedElement: undefined,
              contextReadError: detail,
            };
          }
          if (captureImage) {
            try {
              const screenshot = (await callbacks.executeTool({
                sessionId,
                runId: payload.runId,
                toolCallId: `screenshot-${createMessageId()}`,
                toolName: MCP_TOOL_NAMES.BROWSER_TAKE_SCREENSHOT,
                args: { type: "jpeg", quality: 72 },
                executionBinding: payload.executionBinding,
                egressDestinations: payload.egressDestinations,
                signal: controller.signal,
              })) as ScreenshotCaptureResult;
              attachment = screenshotAttachment(screenshot, true);
            } catch (error) {
              errors.push(error instanceof Error ? error.message : "页面截图刷新失败");
            }
          }
          return {
            context: nextContext,
            attachment,
            error: errors.length > 0 ? errors.join("；") : undefined,
          };
        },
        executeToolCalls: (calls, assistantMessageId) =>
          this.executeToolBatch(
            sessionId,
            payload,
            calls,
            assistantMessageId,
            controller.signal,
            callbacks,
            latestSession?.turns?.at(-1)?.id,
            memoryToolMessages,
          ),
        onVisibleContent: (content) => {
          latestVisibleContent = content.slice(0, 12_000);
          if (latestSession) {
            latestSession = updateAgentSessionRuntime(latestSession, {
              progress: true,
            });
          }
          callbacks.emit({
            runId: payload.runId,
            conversationId: payload.conversationId,
            kind: "visible_content",
            content,
          });
        },
        onStatusUpdate: (status) => {
          if (latestSession) {
            latestSession = updateAgentSessionRuntime(latestSession, {
              phase: inferAgentRunPhase(status, latestSession.phase),
              status,
              progress: isProgressStatus(status),
            });
            const heartbeatEvent = {
              runId: payload.runId,
              conversationId: payload.conversationId,
              kind: "session" as const,
              session: latestSession,
            };
            callbacks.persistSession(heartbeatEvent);
            callbacks.emit(heartbeatEvent);
          }
          callbacks.emit({
            runId: payload.runId,
            conversationId: payload.conversationId,
            kind: "status",
            status,
          });
        },
        onContextUsage: (report) => {
          if (latestSession) {
            latestSession = updateAgentSessionRuntime(latestSession, {
              modelRequestDelta: report.source === "estimated" ? 1 : 0,
              progress: report.source === "provider",
            });
            const latestCompaction = report.compactionSteps.at(-1);
            if (latestCompaction && report.source === "estimated") {
              latestSession = appendAgentSessionEvent(latestSession, {
                id: createMessageId(),
                type: "compaction",
                createdAt: report.measuredAt,
                summary: `${report.omittedMessageCount} 条消息被省略，${report.compactedMessageCount} 条消息被压缩。`,
                data: {
                  beforeTokens: latestCompaction.beforeTokens,
                  afterTokens: latestCompaction.afterTokens,
                  reason: latestCompaction.reason,
                },
              });
            }
            const usageSessionEvent = {
              runId: payload.runId,
              conversationId: payload.conversationId,
              kind: "session" as const,
              session: latestSession,
            };
            callbacks.persistSession(usageSessionEvent);
            callbacks.emit(usageSessionEvent);
          }
          callbacks.emit({
            runId: payload.runId,
            conversationId: payload.conversationId,
            kind: "context_usage",
            report,
          });
        },
        onSessionUpdate: (session) => {
          const durableSession = mergeAgentRuntimeCheckpoint({
            ...session,
            id: payload.runId,
            assistantMessageId: payload.assistantMessageId,
            executionOwner: "daemon" as const,
            runtimeEnvironment,
            ...(latestVisibleContent ? { visibleContent: latestVisibleContent } : {}),
          }, latestSession);
          latestSession = durableSession;
          const event = {
            runId: payload.runId,
            conversationId: payload.conversationId,
            kind: "session" as const,
            session: durableSession,
          };
          callbacks.persistSession(event);
          callbacks.emit(event);
        },
      });
      const durableResultSession = {
        ...result.session,
        id: payload.runId,
        assistantMessageId: payload.assistantMessageId,
        executionOwner: "daemon" as const,
        runtimeEnvironment,
        ...(latestVisibleContent ? { visibleContent: latestVisibleContent } : {}),
      };
      latestSession = durableResultSession;
      const finalSessionEvent = {
        runId: payload.runId,
        conversationId: payload.conversationId,
        kind: "session" as const,
        session: durableResultSession,
      };
      callbacks.persistSession(finalSessionEvent);
      callbacks.emit(finalSessionEvent);
      const shouldExtractMemory =
        result.status === "completed" || result.status === "blocked";
      const memoryExtractionInput = shouldExtractMemory
        ? {
            config: { ...payload.config },
            memory: payload.context.memory,
            runId: payload.runId,
            userMessageId:
              payload.userMessageId ??
              payload.messages.filter((message) => message.role === "user").at(-1)
                ?.id ??
              `user:${payload.runId}`,
            assistantMessageId: payload.assistantMessageId,
            input: payload.input,
            finalContent: result.finalContent,
            session: durableResultSession,
            toolMessages: memoryToolMessages,
          }
        : undefined;
      const memoryPatch = memoryExtractionInput
        ? buildDeterministicConversationMemoryPatch(memoryExtractionInput)
        : undefined;
      // The completion patch is merged first. The delayed semantic patch may
      // only build on that exact revision, never on a newer turn's state.
      const memoryPatchBaseRevision =
        (sanitizedMemory?.revision ?? 1) + (memoryPatch ? 1 : 0);
      callbacks.emit({
        runId: payload.runId,
        conversationId: payload.conversationId,
        kind: "completed",
        result: {
          ...result,
          session: durableResultSession,
          ...(memoryPatch ? { memoryPatch } : {}),
        },
      });
      if (memoryExtractionInput) {
        void extractConversationMemory(memoryExtractionInput).then(
          (extraction) => {
            callbacks.emit({
              runId: payload.runId,
              conversationId: payload.conversationId,
              kind: "memory_patch",
              baseRevision: memoryPatchBaseRevision,
              patch: extraction.patch,
              source: extraction.source,
              modelRequestCount: 1,
            });
          },
          () => {
            callbacks.emit({
              runId: payload.runId,
              conversationId: payload.conversationId,
              kind: "memory_patch",
              baseRevision: memoryPatchBaseRevision,
              patch: memoryPatch!,
              source: "fallback",
              modelRequestCount: 1,
            });
          },
        );
      }
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : "Daemon Agent failed.";
      if (latestSession) {
        const status = controller.signal.aborted ? "cancelled" : "failed";
        const finalContent = latestVisibleContent || detail;
        latestSession = updateAgentSessionRuntime(latestSession, {
          phase: status,
          progress: true,
          errorCode: status === "failed" ? extractAgentErrorCode(detail) : undefined,
          errorSummary: status === "failed" ? detail : undefined,
        });
        const terminalSession = finalizeAgentSession(
          latestSession,
          status,
          finalContent,
        );
        const terminalSessionEvent = {
          runId: payload.runId,
          conversationId: payload.conversationId,
          kind: "session" as const,
          session: terminalSession,
        };
        callbacks.persistSession(terminalSessionEvent);
        callbacks.emit(terminalSessionEvent);
        callbacks.emit({
          runId: payload.runId,
          conversationId: payload.conversationId,
          kind: "completed",
          result: {
            finalContent,
            session: terminalSession,
            status,
            ...(status === "failed" ? { errorDetail: detail } : {}),
          },
        });
      } else {
        callbacks.emit({
          runId: payload.runId,
          conversationId: payload.conversationId,
          kind: "failed",
          error: detail,
        });
      }
    } finally {
      payload.config.apiKey = "";
    }
  }

  private async executeToolBatch(
    sessionId: string,
    payload: DaemonAgentStartPayload,
    calls: AiRequestedToolCall[],
    assistantMessageId: string,
    signal: AbortSignal,
    callbacks: DaemonAgentRunnerCallbacks,
    turnId?: string,
    memoryToolMessages?: DaemonAgentToolMessage[],
  ): Promise<AiToolResultMessage[]> {
    type Prepared = { result: AiToolResultMessage; success: boolean };
    const modelResultCharLimit = toolResultModelCharLimit(
      payload.config.contextWindowTokens,
      calls.length,
    );
    const prepared = await executeAgentToolBatch<Prepared>(
      calls,
      async (call) => {
        if (signal.aborted) {
          throw signal.reason;
        }
        let content: string;
        let displayContent: string;
        let attachments: ChatImageAttachment[] | undefined;
        let resultMeta: ToolResultPresentationMeta;
        const toolDefinition = payload.tools?.find(
          (tool) => tool.function.name === call.name,
        );
        const clientMetadata = toolDefinition?.clientMetadata;
        const toolSource =
          clientMetadata?.source ??
          (isExternalMcpToolName(call.name) ? "external_mcp" : "builtin");
        const requestArguments = formatToolRequestArguments(call.arguments);
        try {
          if (call.name === "web_search" || call.name === "$web_search") {
            throw new Error(
              "DAEMON_WEB_SEARCH_UNAVAILABLE: use the provider built-in web search or a registered MCP search tool.",
            );
          }
          const data = await callbacks.executeTool({
            sessionId,
            runId: payload.runId,
            toolCallId: call.id,
            turnId,
            toolName: call.name,
            args: call.arguments,
            executionBinding: payload.executionBinding,
            egressDestinations: payload.egressDestinations,
            signal,
          });
          if (isScreenshot(data)) {
            const redacted = { ...data, dataUrl: `[image:${data.mimeType};base64 omitted]` };
            const presentation = presentToolResult(redacted);
            displayContent = presentation.content;
            content = compactToolResultForModel(
              displayContent,
              modelResultCharLimit,
            );
            resultMeta = presentation.meta;
            attachments = [screenshotAttachment(data, false)];
          } else {
            const presentation = presentToolResult(data);
            displayContent = presentation.content;
            content = compactToolResultForModel(
              displayContent,
              modelResultCharLimit,
            );
            resultMeta = presentation.meta;
          }
        } catch (error) {
          if (signal.aborted) {
            throw error;
          }
          const presentation = presentToolResult({
            error:
              error instanceof Error
                ? error.message
                : "MCP tool execution failed.",
          });
          displayContent = presentation.content;
          content = compactToolResultForModel(
            displayContent,
            modelResultCharLimit,
          );
          resultMeta = presentation.meta;
        }
        const toolMessage: DaemonAgentToolMessage = {
          id: createMessageId(),
          assistantMessageId,
          toolCallId: call.id,
          toolName: call.name,
          toolSource,
          toolDisplayName:
            clientMetadata?.externalMcpToolName ??
            clientMetadata?.displayName ??
            call.name,
          toolServerName: clientMetadata?.externalMcpServerName,
          requestArguments,
          content: displayContent,
          resultMeta,
          createdAt: new Date().toISOString(),
          attachments,
        };
        memoryToolMessages?.push(toolMessage);
        callbacks.emit({
          runId: payload.runId,
          conversationId: payload.conversationId,
          kind: "tool_message",
          message: toolMessage,
        });
        return {
          result: {
            toolCallId: call.id,
            name: call.name,
            content,
            attachments,
          },
          success: isSuccessfulAgentToolResultContent(content),
        };
      },
      {
        shouldStopAfter: (result) => !result.success,
        createSkippedResult: (call, blockedBy) => {
          const content = JSON.stringify(
            {
              skipped: true,
              errorCode: "AGENT_BATCH_DEPENDENCY_SKIPPED",
              reason: `前置工具 ${blockedBy.name} 未成功；当前工具未执行，请重新规划。`,
            },
            null,
            2,
          );
          return {
            result: { toolCallId: call.id, name: call.name, content },
            success: false,
          };
        },
      },
    );
    return prepared.map((entry) => entry.result);
  }

  private requestBudgetDecision(
    sessionId: string,
    payload: DaemonAgentStartPayload,
    callbacks: DaemonAgentRunnerCallbacks,
    request: AgentRunBudgetExtensionRequest,
  ): Promise<AgentRunBudgetExtensionDecision> {
    const active = this.activeByConversation.get(
      this.key(sessionId, payload.conversationId),
    );
    if (!active || active.runId !== payload.runId) {
      throw new Error("AGENT_RUN_NOT_ACTIVE: budget decision target is no longer active.");
    }
    if (active.pendingBudget) {
      throw new Error("AGENT_BUDGET_DECISION_PENDING: resolve the current request first.");
    }
    const budgetRequestId = createMessageId();
    return new Promise<AgentRunBudgetExtensionDecision>((resolve, reject) => {
      const signal = active.controller.signal;
      const cleanup = () => signal.removeEventListener("abort", handleAbort);
      const handleAbort = () => {
        cleanup();
        if (active.pendingBudget?.id === budgetRequestId) {
          active.pendingBudget = undefined;
        }
        reject(
          signal.reason ??
            new DOMException("Agent run cancelled while awaiting budget approval.", "AbortError"),
        );
      };
      signal.addEventListener("abort", handleAbort, { once: true });
      active.pendingBudget = {
        id: budgetRequestId,
        request,
        resolve,
        reject,
        cleanup,
      };
      try {
        callbacks.emit({
          runId: payload.runId,
          conversationId: payload.conversationId,
          kind: "budget_request",
          budgetRequestId,
          request,
        });
      } catch (error) {
        active.pendingBudget = undefined;
        cleanup();
        reject(error);
      }
    });
  }

  private key(sessionId: string, conversationId: string): string {
    return `${sessionId}:${conversationId}`;
  }
}

function mergeAgentRuntimeCheckpoint(
  session: AgentSessionSnapshot,
  current: AgentSessionSnapshot | undefined,
): AgentSessionSnapshot {
  if (!current?.diagnostics || !session.diagnostics) {
    return session;
  }
  if (Date.parse(current.diagnostics.lastHeartbeatAt) <= Date.parse(session.diagnostics.lastHeartbeatAt)) {
    return session;
  }
  return {
    ...session,
    phase: current.phase,
    heartbeatAt: current.heartbeatAt,
    updatedAt: current.updatedAt,
    diagnostics: {
      ...session.diagnostics,
      ...current.diagnostics,
      modelRequestCount: Math.max(
        session.diagnostics.modelRequestCount,
        current.diagnostics.modelRequestCount,
      ),
      toolCallCount: Math.max(
        session.diagnostics.toolCallCount,
        current.diagnostics.toolCallCount,
      ),
      completedToolCallCount: Math.max(
        session.diagnostics.completedToolCallCount,
        current.diagnostics.completedToolCallCount,
      ),
    },
  };
}

function buildAgentRuntimeEnvironment(
  payload: DaemonAgentStartPayload,
): AgentRuntimeEnvironmentSnapshot {
  const externalMcpServerIds = Array.from(
    new Set(
      (payload.tools ?? []).flatMap((tool) =>
        tool.clientMetadata?.externalMcpServerId
          ? [tool.clientMetadata.externalMcpServerId]
          : [],
      ),
    ),
  ).sort();
  return {
    capturedAt: new Date().toISOString(),
    runtimeBuildId: RUNTIME_BUILD_ID,
    model: payload.config.model,
    providerOrigin: safeProviderOrigin(payload.config.apiUrl),
    contextWindowTokens: payload.config.contextWindowTokens,
    maxOutputTokens: Math.max(128, payload.config.maxOutputTokens ?? 8_192),
    toolScope: payload.context.toolScope ?? "mixed",
    enabledToolNames: (payload.tools ?? []).map((tool) => tool.function.name).sort(),
    externalMcpServerIds,
    targetTabId: payload.executionBinding?.target.tabId,
    targetId: payload.executionBinding?.target.targetId,
    permissionMode: payload.config.enableTools
      ? "approval_required"
      : "tools_disabled",
  };
}

function safeProviderOrigin(apiUrl: string): string {
  try {
    return new URL(apiUrl).origin;
  } catch {
    return "invalid-provider-url";
  }
}

function inferAgentRunPhase(
  status: string,
  fallback: AgentRunPhase | undefined,
): AgentRunPhase {
  if (/审批|授权/.test(status)) return "waiting_approval";
  if (/执行.*工具|工具调用/.test(status)) return "tool_execution";
  if (/总结|报告正文/.test(status)) return "summarizing";
  if (/分析工具结果|等待 AI 分析|继续生成/.test(status)) return "model_analysis";
  if (/规划|请求 AI/.test(status)) return "model_planning";
  if (/读取|上下文|截图|观察/.test(status)) return "reading_context";
  if (/取消/.test(status)) return "cancelling";
  return fallback ?? "starting";
}

function isProgressStatus(status: string): boolean {
  return !/正在等待|等待你|等待 AI/.test(status);
}

function extractAgentErrorCode(detail: string): string {
  const match = detail.match(/^([A-Z][A-Z0-9_]{2,80}):/);
  return match?.[1] ?? "AGENT_RUN_FAILED";
}

function isScreenshot(value: unknown): value is ScreenshotCaptureResult {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as ScreenshotCaptureResult).dataUrl === "string" &&
      typeof (value as ScreenshotCaptureResult).mimeType === "string" &&
      typeof (value as ScreenshotCaptureResult).capturedAt === "string",
  );
}

function screenshotAttachment(
  screenshot: ScreenshotCaptureResult,
  visualCheckpoint: boolean,
): ChatImageAttachment {
  return {
    id: createMessageId(),
    name:
      screenshot.filename ??
      `screenshot.${screenshot.mimeType === "image/jpeg" ? "jpg" : "png"}`,
    mimeType: screenshot.mimeType,
    dataUrl: screenshot.dataUrl,
    createdAt: screenshot.capturedAt,
    source: "screenshot",
    ...(visualCheckpoint ? { visualPurpose: "fast_checkpoint" as const } : {}),
    savedAs: screenshot.savedAs,
    width: screenshot.width,
    height: screenshot.height,
  };
}
