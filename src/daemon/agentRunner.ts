import { createMessageId } from "../shared/messaging";
import type { AgentSessionSnapshot } from "../shared/agentSession";
import { finalizeAgentSession } from "../shared/agentSession";
import { toAgentPageSnapshot } from "../shared/agentPageContext";
import type {
  DaemonAgentEventPayload,
  DaemonAgentStartPayload,
} from "../shared/daemonAgent";
import type { ScreenshotCaptureResult } from "../shared/dom";
import { MCP_TOOL_NAMES } from "../shared/mcpTools";
import { assertSafeAiProviderUrl } from "../sidepanel/services/aiEndpointPolicy";
import { executeAgentToolBatch } from "../sidepanel/services/agentToolBatch";
import { isSuccessfulAgentToolResultContent } from "../sidepanel/services/agentToolResult";
import type {
  AiRequestedToolCall,
  AiToolResultMessage,
} from "../sidepanel/services/aiClient";
import { runAutonomousAgentSession } from "../sidepanel/services/autonomousAgent";
import { presentToolResult } from "../sidepanel/toolResultPresentation";
import type { ChatImageAttachment } from "../sidepanel/types";

export interface DaemonAgentToolRequest {
  sessionId: string;
  runId: string;
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

interface ActiveDaemonAgentRun {
  runId: string;
  conversationId: string;
  controller: AbortController;
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
    const active = {
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

  close(): void {
    for (const active of this.activeByConversation.values()) {
      active.controller.abort(
        new DOMException("Local daemon is shutting down.", "AbortError"),
      );
    }
    this.activeByConversation.clear();
  }

  private async run(
    sessionId: string,
    payload: DaemonAgentStartPayload,
    controller: AbortController,
    callbacks: DaemonAgentRunnerCallbacks,
  ): Promise<void> {
    let latestVisibleContent = "";
    let latestSession: AgentSessionSnapshot | undefined;
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
        requestBudgetExtension: async () => "summarize",
        prepareContext: async (context) => {
          if (!payload.config.includePageContext) {
            return context;
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
          ),
        onVisibleContent: (content) => {
          latestVisibleContent = content.slice(0, 12_000);
          callbacks.emit({
            runId: payload.runId,
            conversationId: payload.conversationId,
            kind: "visible_content",
            content,
          });
        },
        onStatusUpdate: (status) => {
          callbacks.emit({
            runId: payload.runId,
            conversationId: payload.conversationId,
            kind: "status",
            status,
          });
        },
        onSessionUpdate: (session) => {
          const durableSession = {
            ...session,
            id: payload.runId,
            assistantMessageId: payload.assistantMessageId,
            executionOwner: "daemon" as const,
            ...(latestVisibleContent ? { visibleContent: latestVisibleContent } : {}),
          };
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
      callbacks.emit({
        runId: payload.runId,
        conversationId: payload.conversationId,
        kind: "completed",
        result: {
          ...result,
          session: durableResultSession,
        },
      });
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : "Daemon Agent failed.";
      if (latestSession) {
        const status = controller.signal.aborted ? "cancelled" : "failed";
        const finalContent = latestVisibleContent || detail;
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
  ): Promise<AiToolResultMessage[]> {
    type Prepared = { result: AiToolResultMessage; success: boolean };
    const prepared = await executeAgentToolBatch<Prepared>(
      calls,
      async (call) => {
        if (signal.aborted) {
          throw signal.reason;
        }
        let content: string;
        let attachments: ChatImageAttachment[] | undefined;
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
            toolName: call.name,
            args: call.arguments,
            executionBinding: payload.executionBinding,
            egressDestinations: payload.egressDestinations,
            signal,
          });
          if (isScreenshot(data)) {
            const redacted = { ...data, dataUrl: `[image:${data.mimeType};base64 omitted]` };
            content = presentToolResult(redacted).content;
            attachments = [screenshotAttachment(data, false)];
          } else {
            content = presentToolResult(data).content;
          }
        } catch (error) {
          if (signal.aborted) {
            throw error;
          }
          content = JSON.stringify(
            { error: error instanceof Error ? error.message : "MCP tool execution failed." },
            null,
            2,
          );
        }
        callbacks.emit({
          runId: payload.runId,
          conversationId: payload.conversationId,
          kind: "tool_message",
          message: {
            id: createMessageId(),
            assistantMessageId,
            toolCallId: call.id,
            toolName: call.name,
            content,
            createdAt: new Date().toISOString(),
            attachments,
          },
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

  private key(sessionId: string, conversationId: string): string {
    return `${sessionId}:${conversationId}`;
  }
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
