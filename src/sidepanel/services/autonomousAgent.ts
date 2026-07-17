import type { DomElementInfo, PageSnapshot } from "../../shared/dom";
import type { CollaborationWorkspaceSnapshot } from "../../shared/collaborationWorkspace";
import type { AgentTaskStatePatch } from "../../shared/agentTaskState";
import {
  appendAgentSessionEvent,
  createAgentSessionSnapshot,
  finalizeAgentSession,
  sanitizeAgentToolCallForPersistence,
  sanitizeAgentToolResultForPersistence,
  updateAgentSessionTaskState,
  type AgentSessionSnapshot,
  type AgentSessionToolCallSnapshot,
  type AgentSessionToolResultSnapshot,
} from "../../shared/agentSession";
import {
  AgentRunBudget,
  AgentRunBudgetExceededError,
  createAgentRunBudgetExtensionRequest,
  describeAgentRunBudgetExceeded,
  type AgentRunBudgetExtensionDecision,
  type AgentRunBudgetExtensionRequest,
  type AgentRunBudgetLimits,
} from "../../shared/agentRunBudget";
import { createMessageId } from "../../shared/messaging";
import {
  MCP_TOOL_NAMES,
  normalizeMcpToolName,
} from "../../shared/mcpTools";
import { getToolPolicy } from "../../shared/toolPolicy";
import { TOOL_NAMES } from "../../shared/tools";
import type { ChatImageAttachment, ChatMessage } from "../types";
import type { AiConfig } from "./aiConfig";
import { toAbortError } from "./abortError";
import {
  EMPTY_ASSISTANT_CONTENT_FALLBACK,
  stripAssistantToolMarkup,
} from "./assistantContent";
import {
  streamAiChat,
  streamAiChatAfterToolSummary,
  streamAiChatAfterTools,
  type AiChatStreamResult,
  type AiChatStreamEvent,
  type AiFunctionToolDefinition,
  type AiRequestedToolCall,
  type AiToolExchange,
  type AiToolResultMessage,
  type AiVisualCheckpoint,
} from "./aiClient";
import {
  describeAgentToolBatchPlan,
  initialAgentPlanningSteps,
  MAX_AGENT_TOOL_BATCH_SIZE,
} from "./agentExecutionStrategy";
import {
  isAgentToolResultDefinitelyNotExecuted,
  isSuccessfulAgentToolResultContent,
} from "./agentToolResult";
import { isMcpToolTransportError } from "./mcpTransport";
import {
  acceptFastAgentVisualCheckpoint,
  createFastAgentVisualCheckpointState,
  describeFastAgentVisualCheckpointReason,
  planFastAgentVisualCheckpoint,
  type FastAgentVisualCheckpointReason,
} from "./fastAgentVisualCheckpoints";

export interface AgentContext {
  pageSnapshot?: PageSnapshot;
  selectedElement?: DomElementInfo;
  collaborationWorkspace?: CollaborationWorkspaceSnapshot;
  contextReadError?: string;
}

const READ_ONLY_NO_PROGRESS_NOTICE =
  "检测到相同只读工具和参数已连续两次返回相同的语义结果。为避免无进展循环，Agent 已停止重复调用；请基于已有结果总结，或调整工具、参数后再继续。";
const CROSS_ROUND_NO_PROGRESS_THRESHOLD = 3;

interface RepeatedReadOnlyObservation {
  toolName: string;
  count: number;
}

class AgentRunBudgetSummaryRequestedError extends Error {
  constructor(readonly budgetError: AgentRunBudgetExceededError) {
    super("The user requested a summary at the agent run budget boundary.");
    this.name = "AgentRunBudgetSummaryRequestedError";
  }
}

type ReserveAgentRunBudget = <T>(reservation: () => T) => Promise<T>;

export interface RunAutonomousAgentSessionParams {
  config: AiConfig;
  messages: ChatMessage[];
  input: string;
  attachments: ChatImageAttachment[];
  context: AgentContext;
  tools?: AiFunctionToolDefinition[];
  assistantMessageId: string;
  abortSignal?: AbortSignal;
  runBudgetLimits?: Partial<AgentRunBudgetLimits>;
  requestBudgetExtension?: (
    request: AgentRunBudgetExtensionRequest,
  ) => Promise<AgentRunBudgetExtensionDecision>;
  prepareContext?: (currentContext: AgentContext) => Promise<AgentContext>;
  prepareVisualCheckpoint?: (params: {
    reason: FastAgentVisualCheckpointReason;
    captureImage: boolean;
    currentContext: AgentContext;
  }) => Promise<{
    context?: AgentContext;
    attachment?: ChatImageAttachment;
    error?: string;
  }>;
  executeToolCalls: (
    toolCalls: AiRequestedToolCall[],
    assistantMessageId: string,
  ) => Promise<AiToolResultMessage[]>;
  onVisibleContent: (content: string) => void;
  onStatusUpdate?: (status: string) => void;
  onSessionUpdate?: (session: AgentSessionSnapshot) => void;
}

export interface RunAutonomousAgentSessionResult {
  finalContent: string;
  session: AgentSessionSnapshot;
  status: "completed" | "blocked" | "failed" | "cancelled";
  errorDetail?: string;
}

export async function runAutonomousAgentSession(
  params: RunAutonomousAgentSessionParams,
): Promise<RunAutonomousAgentSessionResult> {
  const runBudget = new AgentRunBudget(params.runBudgetLimits);
  const reserveBudget: ReserveAgentRunBudget = (reservation) =>
    reserveAgentRunBudget(params, runBudget, reservation);
  let visibleContent = "";
  let session = createAgentSessionSnapshot(createMessageId(), params.input);
  let context = params.context;
  const activeAttachments = [...params.attachments];
  const toolExchanges: AiToolExchange[] = [];
  let latestVisualCheckpoint: AiVisualCheckpoint | undefined;
  session = publishEvent(
    session,
    params.onSessionUpdate,
    "started",
    "Agent 已接管本轮请求。",
  );

  try {
    let visualCheckpointState = createFastAgentVisualCheckpointState();
    let visualObservationActive = false;
    const userProvidedScreenshot = findLatestScreenshotAttachment(
      activeAttachments,
    );
    if (userProvidedScreenshot) {
      visualObservationActive = true;
      visualCheckpointState = {
        ...visualCheckpointState,
        lastImageFingerprint: undefined,
      };
    }
    throwIfAborted(params.abortSignal);
    if (params.prepareContext && params.config.autoReadPage) {
      context = await params.prepareContext(context);
      throwIfAborted(params.abortSignal);
    }
    session = publishEvent(
      session,
      params.onSessionUpdate,
      "context",
      summarizeContext(context),
      context.contextReadError
        ? {
            contextReadError: context.contextReadError,
          }
        : undefined,
    );
    session = updateTaskState(session, params.onSessionUpdate, {
      phase: "plan",
      observations: [summarizeContext(context)],
      plannedActions: initialAgentPlanningSteps(),
    });

    const toolExecutionEnabled =
      params.config.enableTools && params.config.maxToolRounds > 0;
    let streamedContent = "";
    let initialDeltaReceived = false;
    await reserveBudget(() => runBudget.consumeModelRequest());
    let aiResult = await withStatusTicks(
      () =>
        streamAiChat({
          config: params.config,
          messages: params.messages,
          input: params.input,
          attachments: activeAttachments,
          context,
          tools: params.tools,
          abortSignal: params.abortSignal,
          onDelta: (delta) => {
            initialDeltaReceived = true;
            streamedContent += delta;
            if (!toolExecutionEnabled) {
              params.onVisibleContent(
                sanitizeAssistantVisibleContent(streamedContent, false),
              );
            }
          },
          onStreamEvent: createModelProgressHandler({
            getBaseContent: () =>
              toolExecutionEnabled ? visibleContent : streamedContent,
            onVisibleContent: params.onVisibleContent,
            onStatusUpdate: params.onStatusUpdate,
            markProgressReceived: () => {
              initialDeltaReceived = true;
            },
            phase: "planning",
          }),
        }),
      (elapsedSeconds) => {
        if (initialDeltaReceived) {
          return;
        }
        emitStatus(
          params,
          `正在请求 AI 规划下一步…（已等待 ${elapsedSeconds}s）`,
        );
      },
    );

    const initialAssistantContent = sanitizeAssistantVisibleContent(
      aiResult.content || streamedContent,
      toolExecutionEnabled,
    );
    const initialContentIsTransient =
      toolExecutionEnabled && aiResult.toolCalls.length > 0;
    visibleContent = initialContentIsTransient ? "" : initialAssistantContent;
    if (initialAssistantContent || initialContentIsTransient) {
      params.onVisibleContent(visibleContent);
    }

    let currentAssistantContent = initialAssistantContent;
    const maxToolRounds = params.config.maxToolRounds;
    const seenToolSignatures = new Map<string, number>();
    const toolNameCounts = new Map<string, number>();
    let lastReadOnlyBatchCallSignature = "";
    let lastReadOnlyBatchResultFingerprint = "";
    let consecutiveIdenticalReadOnlyBatches = 0;
    const readOnlyObservationCounts = new Map<string, number>();
    let postMutationVerificationRequired = false;
    let blockedReason = "";

    for (
      let round = 0;
      toolExecutionEnabled &&
      aiResult.toolCalls.length > 0 &&
      (params.config.autoContinueAfterToolRoundLimit || round < maxToolRounds);
      round += 1
    ) {
      throwIfAborted(params.abortSignal);
      const requestedToolCalls = aiResult.toolCalls.slice(
        0,
        MAX_AGENT_TOOL_BATCH_SIZE,
      );
      const requestedBatchCallSignature = getToolBatchCallSignature(
        requestedToolCalls,
      );
      const blockNoProgressReadOnlyBatch =
        consecutiveIdenticalReadOnlyBatches >= 2 &&
        requestedBatchCallSignature === lastReadOnlyBatchCallSignature &&
        isNoProgressObservationBatch(requestedToolCalls);
      const blockedRepeatResults: AiToolResultMessage[] = [];
      let preBlockedReadOnlyObservation:
        | RepeatedReadOnlyObservation
        | undefined;
      const executableToolCalls = requestedToolCalls.filter((toolCall) => {
        if (blockNoProgressReadOnlyBatch) {
          blockedRepeatResults.push({
            toolCallId: toolCall.id,
            name: toolCall.name,
            content: JSON.stringify(
              {
                blocked: true,
                reason: READ_ONLY_NO_PROGRESS_NOTICE,
              },
              null,
              2,
            ),
          });
          return false;
        }

        const priorRepeatCount = getReadOnlyObservationRepeatCount(
          toolCall,
          readOnlyObservationCounts,
        );
        if (priorRepeatCount >= 2) {
          const observation = {
            toolName: toolCall.name,
            count: priorRepeatCount,
          };
          preBlockedReadOnlyObservation ??= observation;
          blockedRepeatResults.push({
            toolCallId: toolCall.id,
            name: toolCall.name,
            content: JSON.stringify(
              {
                blocked: true,
                reason: describeCrossRoundNoProgress(observation),
              },
              null,
              2,
            ),
          });
          return false;
        }

        const signature = getToolCallSignature(toolCall);
        const seenCount = seenToolSignatures.get(signature) ?? 0;
        seenToolSignatures.set(signature, seenCount + 1);
        const toolNameCount = toolNameCounts.get(toolCall.name) ?? 0;
        toolNameCounts.set(toolCall.name, toolNameCount + 1);

        if (seenCount > 0 && isScreenshotToolCall(toolCall)) {
          blockedRepeatResults.push({
            toolCallId: toolCall.id,
            name: toolCall.name,
            content: JSON.stringify(
              {
                blocked: true,
                reason:
                  "重复截图请求已被阻止。你已经拿到当前页面截图，请基于已有截图和上下文给出结论，不要再次调用 browser_take_screenshot。",
              },
              null,
              2,
            ),
          });
          return false;
        }

        if (toolNameCount >= 3 && isWebSearchToolCall(toolCall)) {
          blockedRepeatResults.push({
            toolCallId: toolCall.id,
            name: toolCall.name,
            content: JSON.stringify(
              {
                blocked: true,
                reason:
                  "联网搜索次数已达到本轮上限。请基于已有搜索结果直接给出答案，不要继续更换关键词搜索。",
              },
              null,
              2,
            ),
          });
          return false;
        }

        return true;
      });
      if (!visibleContent.trim()) {
        emitStatus(
          params,
          `第 ${round + 1} 轮：正在执行页面工具 ${summarizeToolNames(
            executableToolCalls,
          )}…`,
        );
      }

      session = updateTaskState(session, params.onSessionUpdate, {
        phase: "execute",
        activeAction: {
          toolNames: requestedToolCalls.map((toolCall) => toolCall.name),
          expectedOutcome: describeExpectedToolOutcome(requestedToolCalls),
        },
        plannedActions: describeAgentToolBatchPlan(requestedToolCalls),
      });

      session = publishEvent(
        session,
        params.onSessionUpdate,
        "tool_calls",
        summarizeToolCalls(requestedToolCalls, aiResult.toolCalls.length),
        {
          toolCalls: requestedToolCalls.map(toAgentToolCallSnapshot),
        },
      );
      await reserveBudget(() => runBudget.consumeToolCalls(requestedToolCalls));

      const executedToolResults =
        executableToolCalls.length > 0
          ? await withStatusTicks(
              () =>
                waitForPromiseOrAbort(
                  params.executeToolCalls(
                    executableToolCalls,
                    params.assistantMessageId,
                  ),
                  params.abortSignal,
                ),
              (elapsedSeconds) => {
                emitStatus(
                  params,
                  `第 ${round + 1} 轮：正在执行页面工具 ${summarizeToolNames(
                    executableToolCalls,
                  )}…（已等待 ${elapsedSeconds}s）`,
                );
              },
            )
          : [];
      throwIfAborted(params.abortSignal);
      const toolResults = mergeToolResultsInRequestOrder(
        requestedToolCalls,
        executedToolResults,
        blockedRepeatResults,
      );
      const modelRequestedScreenshot = findSuccessfulScreenshotAttachment(
        executableToolCalls,
        executedToolResults,
      );
      if (modelRequestedScreenshot) {
        visualObservationActive = true;
        visualCheckpointState = acceptFastAgentVisualCheckpoint(
          visualCheckpointState,
          modelRequestedScreenshot,
        ).state;
      }
      const executedResultsById = new Map(
        executedToolResults.map((result) => [result.toolCallId, result]),
      );
      const mutationMayHaveExecuted = executableToolCalls.some((toolCall) => {
        const result = executedResultsById.get(toolCall.id);
        return Boolean(
          !isReadOnlyToolCall(toolCall) &&
          result &&
          !isAgentToolResultDefinitelyNotExecuted(result.content),
        );
      });
      const repeatedReadOnlyObservation = recordReadOnlyToolObservations(
        executableToolCalls,
        executedToolResults,
        readOnlyObservationCounts,
      );
      const successfulReadObservation =
        executableToolCalls.length > 0 &&
        executableToolCalls.every(isReadOnlyToolCall) &&
        executableToolCalls.some((toolCall) => {
          const result = executedResultsById.get(toolCall.id);
          return Boolean(
            result &&
            !isTimingOnlyWaitCall(toolCall) &&
            !isTimingOnlyWaitResult(toolCall, result),
          );
        }) &&
        executedToolResults.length === executableToolCalls.length &&
        executedToolResults.every(isSuccessfulToolResult);
      if (mutationMayHaveExecuted) {
        postMutationVerificationRequired = true;
      } else if (
        postMutationVerificationRequired &&
        successfulReadObservation
      ) {
        postMutationVerificationRequired = false;
      }
      if (
        !blockNoProgressReadOnlyBatch &&
        isNoProgressObservationBatch(requestedToolCalls)
      ) {
        const resultFingerprint = getToolBatchResultFingerprint(toolResults);
        if (
          requestedBatchCallSignature === lastReadOnlyBatchCallSignature &&
          resultFingerprint === lastReadOnlyBatchResultFingerprint
        ) {
          consecutiveIdenticalReadOnlyBatches += 1;
        } else {
          consecutiveIdenticalReadOnlyBatches = 1;
        }
        lastReadOnlyBatchCallSignature = requestedBatchCallSignature;
        lastReadOnlyBatchResultFingerprint = resultFingerprint;
      } else if (!blockNoProgressReadOnlyBatch) {
        consecutiveIdenticalReadOnlyBatches = 0;
        lastReadOnlyBatchCallSignature = "";
        lastReadOnlyBatchResultFingerprint = "";
      }
      const visualCheckpointPlan = planFastAgentVisualCheckpoint({
        enabled: Boolean(
          params.config.fastAgentMode &&
            params.config.supportsVision &&
            params.prepareVisualCheckpoint,
        ),
        captureEnabled: visualObservationActive,
        state: visualCheckpointState,
        toolCalls: executableToolCalls,
        toolResults: executedToolResults,
      });
      visualCheckpointState = visualCheckpointPlan.state;
      if (visualCheckpointPlan.decision && params.prepareVisualCheckpoint) {
        const { decision } = visualCheckpointPlan;
        const reasonLabel = describeFastAgentVisualCheckpointReason(
          decision.reason,
        );
        if (decision.invalidatePriorVisual) {
          latestVisualCheckpoint = undefined;
        }
        emitStatus(
          params,
          !decision.captureEnabled
            ? `页面状态已变化，正在刷新 DOM 上下文…`
            : decision.captureAllowed
            ? `页面状态已变化，正在刷新 DOM 与视觉检查点…`
            : `视觉检查点已达上限，正在刷新 DOM 上下文…`,
        );

        let checkpointSummary = "";
        try {
          const preparedCheckpoint = await waitForPromiseOrAbort(
            params.prepareVisualCheckpoint({
              reason: decision.reason,
              captureImage: decision.captureAllowed,
              currentContext: context,
            }),
            params.abortSignal,
          );
          throwIfAborted(params.abortSignal);
          if (preparedCheckpoint.context) {
            context = preparedCheckpoint.context;
          }
          if (!decision.captureEnabled) {
            checkpointSummary = `极速模式检测到${reasonLabel}；Agent 尚未请求视觉观察，本轮只刷新 DOM 上下文。`;
          } else if (
            decision.captureAllowed &&
            preparedCheckpoint.attachment
          ) {
            const attachment: ChatImageAttachment = {
              ...preparedCheckpoint.attachment,
              visualPurpose: "fast_checkpoint",
            };
            const acceptance = acceptFastAgentVisualCheckpoint(
              visualCheckpointState,
              attachment,
            );
            visualCheckpointState = acceptance.state;
            if (acceptance.accepted) {
              latestVisualCheckpoint = {
                attachment,
                reason: reasonLabel,
              };
              checkpointSummary = `极速模式已因${reasonLabel}更新最新视觉检查点。`;
            } else {
              checkpointSummary = `极速模式检测到${reasonLabel}，但截图与上一检查点相同；仅刷新 DOM 上下文。`;
            }
          } else if (decision.captureAllowed) {
            checkpointSummary = `极速模式检测到${reasonLabel}，但截图不可用；已降级为最新 DOM 上下文${preparedCheckpoint.error ? `（${preparedCheckpoint.error}）` : ""}。`;
          } else {
            checkpointSummary = `极速模式检测到${reasonLabel}；视觉检查点已达每任务上限，本轮仅刷新 DOM 上下文。`;
          }
        } catch (error) {
          throwIfAborted(params.abortSignal);
          checkpointSummary = `极速模式检测到${reasonLabel}，但视觉上下文刷新失败；继续使用工具结果重新规划（${error instanceof Error ? error.message : "未知错误"}）。`;
        }
        session = publishEvent(
          session,
          params.onSessionUpdate,
          "context",
          checkpointSummary,
        );
      }
      emitStatus(
        params,
        `第 ${round + 1} 轮：已收到工具结果 ${summarizeToolResultsForStatus(
          toolResults,
        )}，正在让 AI 分析…`,
      );
      toolExchanges.push({
        assistantContent: currentAssistantContent,
        // DeepSeek thinking mode: preserve reasoning_content for echo-back.
        assistantReasoningContent: aiResult.reasoningContent,
        toolCalls: requestedToolCalls,
        toolResults,
      });
      session = publishEvent(
        session,
        params.onSessionUpdate,
        "tool_results",
        `收到 ${toolResults.length} 个 MCP 工具结果。`,
        {
          toolResults: toolResults.map(toAgentToolResultSnapshot),
        },
      );
      session = updateTaskState(session, params.onSessionUpdate, {
        phase: "verify",
        observations: [
          ...session.taskState.observations,
          summarizeToolResultsForStatus(toolResults),
        ],
        activeAction: undefined,
        verification: {
          required: postMutationVerificationRequired,
          evidence: [
            ...session.taskState.verification.evidence,
            ...executedToolResults.map(
              (result) => `${result.name}: ${isSuccessfulToolResult(result) ? "result received" : "result requires review"}`,
            ),
          ],
          summary: postMutationVerificationRequired
            ? "页面或浏览器状态已修改，仍需独立只读观察验证目标结果。"
            : "当前操作结果已有只读证据，或本轮未发生页面修改。",
        },
      });

      if (blockNoProgressReadOnlyBatch) {
        blockedReason = READ_ONLY_NO_PROGRESS_NOTICE;
        visibleContent = appendParagraph(
          visibleContent,
          READ_ONLY_NO_PROGRESS_NOTICE,
        );
        params.onVisibleContent(
          sanitizeAssistantVisibleContent(visibleContent),
        );
        session = publishEvent(
          session,
          params.onSessionUpdate,
          "context",
          READ_ONLY_NO_PROGRESS_NOTICE,
        );
      }

      const crossRoundNoProgressObservation =
        preBlockedReadOnlyObservation ?? repeatedReadOnlyObservation;
      if (crossRoundNoProgressObservation) {
        const notice = describeCrossRoundNoProgress(
          crossRoundNoProgressObservation,
        );
        blockedReason = notice;
        visibleContent = appendParagraph(
          visibleContent,
          notice,
        );
        params.onVisibleContent(
          sanitizeAssistantVisibleContent(visibleContent),
        );
        session = publishEvent(
          session,
          params.onSessionUpdate,
          "context",
          notice,
        );
      }

      if (
        blockedRepeatResults.length > 0 ||
        crossRoundNoProgressObservation
      ) {
        const summaryContent = await summarizeAfterToolLoopStop({
          config: params.config,
          messages: params.messages,
          input: params.input,
          attachments: activeAttachments,
          context,
          toolExchanges,
          visualCheckpoint: latestVisualCheckpoint,
          tools: params.tools,
          abortSignal: params.abortSignal,
          visibleContent,
          onVisibleContent: params.onVisibleContent,
          onStatusUpdate: params.onStatusUpdate,
          runBudget,
          reserveBudget,
        });
        if (summaryContent) {
          visibleContent = appendParagraph(visibleContent, summaryContent);
          params.onVisibleContent(
            sanitizeAssistantVisibleContent(visibleContent),
          );
        }
        currentAssistantContent = summaryContent;
        aiResult = {
          content: summaryContent,
          rawContent: summaryContent,
          toolCalls: [],
        };
        break;
      }

      const reachedToolSegmentBoundary =
        (round + 1) % maxToolRounds === 0;
      if (
        reachedToolSegmentBoundary &&
        !params.config.autoContinueAfterToolRoundLimit
      ) {
        const limitNotice = `已执行完第 ${maxToolRounds} 轮工具调用，并达到本轮工具轮次上限。后续不会再执行新工具，正在基于已有结果生成阶段性总结。你可以提高最大工具轮数后重新发起，或继续追问让 Agent 接着做。`;
        visibleContent = appendParagraph(visibleContent, limitNotice);
        params.onVisibleContent(sanitizeAssistantVisibleContent(visibleContent));
        session = publishEvent(
          session,
          params.onSessionUpdate,
          "context",
          limitNotice,
        );
        blockedReason = limitNotice;
        const summaryContent = await summarizeAfterToolLoopStop({
          config: params.config,
          messages: params.messages,
          input: params.input,
          attachments: activeAttachments,
          context,
          toolExchanges,
          visualCheckpoint: latestVisualCheckpoint,
          tools: params.tools,
          abortSignal: params.abortSignal,
          visibleContent,
          onVisibleContent: params.onVisibleContent,
          onStatusUpdate: params.onStatusUpdate,
          runBudget,
          reserveBudget,
        });
        if (summaryContent) {
          visibleContent = appendParagraph(visibleContent, summaryContent);
          params.onVisibleContent(
            sanitizeAssistantVisibleContent(visibleContent),
          );
        }
        currentAssistantContent = summaryContent;
        aiResult = {
          content: summaryContent,
          rawContent: summaryContent,
          toolCalls: [],
        };
        break;
      }

      if (reachedToolSegmentBoundary) {
        const checkpointNotice = `已完成 ${round + 1} 轮工具调用，正在使用压缩后的工具上下文进入下一执行段。任务会继续，直到完成、被你停止或触发总安全预算。`;
        emitStatus(params, checkpointNotice);
        session = publishEvent(
          session,
          params.onSessionUpdate,
          "context",
          checkpointNotice,
        );
      }

      // ── Ask model what to do next (tools still enabled) ──────────────────
      // Standard ReAct loop: tool results → model decides next action or done.
      let firstChunk = "";
      let firstDeltaReceived = false;
      await reserveBudget(() => runBudget.consumeModelRequest());
      const firstResult = await withStatusTicks(
        () =>
          streamAiChatAfterTools({
            config: params.config,
            messages: params.messages,
            input: params.input,
            attachments: activeAttachments,
            context,
            toolExchanges,
            visualCheckpoint: latestVisualCheckpoint,
            tools: params.tools,
            enableTools: true,
            abortSignal: params.abortSignal,
            onDelta: (delta) => {
              firstDeltaReceived = true;
              firstChunk += delta;
            },
            onStreamEvent: createModelProgressHandler({
              getBaseContent: () => visibleContent,
              onVisibleContent: params.onVisibleContent,
              onStatusUpdate: params.onStatusUpdate,
              markProgressReceived: () => {
                firstDeltaReceived = true;
              },
              phase: "after_tools",
              round: round + 1,
            }),
          }),
        (elapsedSeconds) => {
          if (firstDeltaReceived) {
            return;
          }
          emitStatus(
            params,
            `工具结果已返回，正在等待 AI 分析…（已等待 ${elapsedSeconds}s）`,
          );
        },
      );

      const firstContent = sanitizeAssistantVisibleContent(
        firstResult.content || firstChunk,
      );

      if (firstResult.toolCalls.length > 0) {
        // Text accompanying a tool call describes work in progress. Keep it in
        // the provider exchange, but do not commit it to the durable reply.
        params.onVisibleContent(
          sanitizeAssistantVisibleContent(visibleContent),
        );
        currentAssistantContent = firstContent;
        aiResult = firstResult;
        continue;
      }

      // Text without tool calls is final unless it is only a plan for another
      // page action. Some local models narrate the next step instead of
      // emitting the function call, so give those cases one tool-call retry.
      if (firstContent.trim()) {
        if (postMutationVerificationRequired) {
          params.onVisibleContent(
            sanitizeAssistantVisibleContent(visibleContent),
          );
          session = publishEvent(
            session,
            params.onSessionUpdate,
            "context",
            "模型尝试结束任务，但修改后的页面尚未验证；Agent 正在请求独立只读检查。",
          );
          const verification = await requestToolContinuationAfterPlanningText({
            config: params.config,
            messages: params.messages,
            input: params.input,
            attachments: activeAttachments,
            context,
            toolExchanges,
            visualCheckpoint: latestVisualCheckpoint,
            tools: params.tools,
            abortSignal: params.abortSignal,
            visibleContent,
            onVisibleContent: params.onVisibleContent,
            onStatusUpdate: params.onStatusUpdate,
            runBudget,
            reserveBudget,
            continuationInstruction:
              "The browser state was mutated but the outcome has not been independently verified. Call the narrowest available read-only DOM, snapshot, wait, network, or console tool now to verify the observable success criterion. Do not repeat the mutation merely to check it.",
          });
          const verificationContent = sanitizeAssistantVisibleContent(
            verification.result.content || verification.chunk,
          );
          if (verification.result.toolCalls.length > 0) {
            currentAssistantContent = verificationContent || firstContent;
            aiResult = verification.result;
            continue;
          }
          blockedReason =
            "页面修改后没有获得独立验证证据，Agent 未将任务标记为完成。";
          visibleContent = appendParagraph(visibleContent, blockedReason);
          params.onVisibleContent(
            sanitizeAssistantVisibleContent(visibleContent),
          );
          break;
        }
        if (
          shouldContinueAfterPlanningText(firstContent) &&
          params.config.enableTools &&
          params.config.maxToolRounds > 0
        ) {
          params.onVisibleContent(
            sanitizeAssistantVisibleContent(visibleContent),
          );
          session = publishEvent(
            session,
            params.onSessionUpdate,
            "context",
            "模型只描述了下一步，Agent 已要求它直接调用工具继续执行。",
          );

          const continuation = await requestToolContinuationAfterPlanningText({
            config: params.config,
            messages: params.messages,
            input: params.input,
            attachments: activeAttachments,
            context,
            toolExchanges,
            visualCheckpoint: latestVisualCheckpoint,
            tools: params.tools,
            abortSignal: params.abortSignal,
            visibleContent,
            onVisibleContent: params.onVisibleContent,
            onStatusUpdate: params.onStatusUpdate,
            runBudget,
            reserveBudget,
          });
          const continuationContent = sanitizeAssistantVisibleContent(
            continuation.result.content || continuation.chunk,
          );

          if (continuation.result.toolCalls.length > 0) {
            params.onVisibleContent(
              sanitizeAssistantVisibleContent(visibleContent),
            );
            currentAssistantContent = continuationContent || firstContent;
            aiResult = continuation.result;
            continue;
          }

          if (continuationContent.trim()) {
            visibleContent = appendParagraph(
              visibleContent,
              continuationContent,
            );
            params.onVisibleContent(
              sanitizeAssistantVisibleContent(visibleContent),
            );
            currentAssistantContent = continuationContent;
            aiResult = {
              content: continuationContent,
              rawContent: continuation.chunk,
              toolCalls: [],
            };
            break;
          }

          visibleContent = appendParagraph(visibleContent, firstContent);
          params.onVisibleContent(
            sanitizeAssistantVisibleContent(visibleContent),
          );
          currentAssistantContent = firstContent;
          aiResult = {
            content: firstContent,
            rawContent: firstChunk,
            toolCalls: [],
          };
          break;
        }

        visibleContent = appendParagraph(visibleContent, firstContent);
        params.onVisibleContent(
          sanitizeAssistantVisibleContent(visibleContent),
        );
        currentAssistantContent = firstContent;
        aiResult = {
          content: firstContent,
          rawContent: firstChunk,
          toolCalls: [],
        };
        break;
      }

      // Completely empty response — nudge the model once with an explicit prompt.
      let nudgeChunk = "";
      let nudgeDeltaReceived = false;
      await reserveBudget(() => runBudget.consumeModelRequest());
      const nudgeResult = await withStatusTicks(
        () =>
          streamAiChatAfterTools({
            config: params.config,
            messages: params.messages,
            input: params.input,
            attachments: activeAttachments,
            context,
            toolExchanges,
            visualCheckpoint: latestVisualCheckpoint,
            tools: params.tools,
            enableTools: true,
            requireContinuation: true,
            abortSignal: params.abortSignal,
            onDelta: (delta) => {
              nudgeDeltaReceived = true;
              nudgeChunk += delta;
            },
            onStreamEvent: createModelProgressHandler({
              getBaseContent: () => visibleContent,
              onVisibleContent: params.onVisibleContent,
              onStatusUpdate: params.onStatusUpdate,
              markProgressReceived: () => {
                nudgeDeltaReceived = true;
              },
              phase: "continuation",
              round: round + 1,
            }),
          }),
        (elapsedSeconds) => {
          if (nudgeDeltaReceived) {
            return;
          }
          emitStatus(
            params,
            `AI 暂时没有返回文本，正在请求它继续…（已等待 ${elapsedSeconds}s）`,
          );
        },
      );

      const nudgeContent = sanitizeAssistantVisibleContent(
        nudgeResult.content || nudgeChunk,
      );
      if (nudgeContent && nudgeResult.toolCalls.length === 0) {
        visibleContent = appendParagraph(visibleContent, nudgeContent);
        params.onVisibleContent(
          sanitizeAssistantVisibleContent(visibleContent),
        );
      } else if (nudgeResult.toolCalls.length > 0) {
        params.onVisibleContent(
          sanitizeAssistantVisibleContent(visibleContent),
        );
      }
      currentAssistantContent = nudgeContent;
      aiResult = nudgeResult;
      if (aiResult.toolCalls.length === 0) {
        break;
      }
    }

    const sanitizedFinalContent = sanitizeAssistantVisibleContent(
      visibleContent,
      toolExecutionEnabled,
    );
    if (!sanitizedFinalContent && !blockedReason) {
      blockedReason = "模型没有返回可显示的最终内容。";
    }
    const finalContent =
      sanitizedFinalContent || EMPTY_ASSISTANT_CONTENT_FALLBACK;
    await reserveBudget(() => runBudget.assertDuration());
    params.onVisibleContent(finalContent);
    const terminalStatus = blockedReason ? "blocked" : "completed";
    session = finalizeWithEvent(
      session,
      params.onSessionUpdate,
      terminalStatus,
      finalContent,
      blockedReason
        ? "Agent 已保留当前进度并停止，任务尚未验证完成。"
        : "Agent 已完成本轮自治执行。",
    );
    return {
      finalContent,
      session,
      status: terminalStatus,
    };
  } catch (error) {
    if (params.abortSignal?.aborted) {
      const finalContent = "Agent 已取消。";
      params.onVisibleContent(finalContent);
      session = finalizeWithEvent(
        session,
        params.onSessionUpdate,
        "cancelled",
        finalContent,
        "Agent 已由用户取消。",
      );
      return {
        finalContent,
        session,
        status: "cancelled",
      };
    }

    if (error instanceof AgentRunBudgetSummaryRequestedError) {
      const budgetNotice = `${describeAgentRunBudgetExceeded(error.budgetError)} 你选择了停止继续执行，Agent 正在基于当前结果收尾。`;
      let summaryContent = "";
      try {
        summaryContent = await summarizeAfterToolLoopStop({
          config: params.config,
          messages: params.messages,
          input: params.input,
          attachments: activeAttachments,
          context,
          toolExchanges,
          visualCheckpoint: latestVisualCheckpoint,
          tools: params.tools,
          abortSignal: params.abortSignal,
          visibleContent,
          onVisibleContent: params.onVisibleContent,
          onStatusUpdate: params.onStatusUpdate,
          runBudget,
          reserveBudget,
          skipBudgetReservation: true,
        });
      } catch (summaryError) {
        if (params.abortSignal?.aborted) {
          throw summaryError;
        }
      }
      const finalContent = appendParagraph(
        appendParagraph(visibleContent, summaryContent),
        budgetNotice,
      );
      params.onVisibleContent(finalContent);
      session = publishEvent(
        session,
        params.onSessionUpdate,
        "context",
        budgetNotice,
      );
      session = finalizeWithEvent(
        session,
        params.onSessionUpdate,
        "blocked",
        finalContent,
        "Agent 已按用户选择在预算边界停止并保留进度。",
      );
      return {
        finalContent,
        session,
        status: "blocked",
      };
    }

    if (error instanceof AgentRunBudgetExceededError) {
      const budgetNotice = `${describeAgentRunBudgetExceeded(error)} 当前运行入口没有提供续期确认通道，Agent 已停止并保留进度。`;
      const finalContent = appendParagraph(visibleContent, budgetNotice);
      params.onVisibleContent(finalContent);
      session = publishEvent(
        session,
        params.onSessionUpdate,
        "context",
        budgetNotice,
      );
      session = finalizeWithEvent(
        session,
        params.onSessionUpdate,
        "blocked",
        finalContent,
        "Agent 已在本轮安全预算边界停止并保留进度，任务尚未完成。",
      );
      return {
        finalContent,
        session,
        status: "blocked",
      };
    }

    if (isMcpToolTransportError(error)) {
      const transportNotice =
        "本地浏览器工具连接中断，安全只读重试仍未恢复，或当前调用可能已经产生副作用但结果未返回。本轮已停止并保留进度；恢复本地 daemon 后，应先重新读取页面状态，再决定是否继续，不能直接重放上一次操作。";
      const finalContent = appendParagraph(visibleContent, transportNotice);
      params.onVisibleContent(finalContent);
      session = publishEvent(
        session,
        params.onSessionUpdate,
        "context",
        transportNotice,
      );
      session = finalizeWithEvent(
        session,
        params.onSessionUpdate,
        "blocked",
        finalContent,
        "Agent 因本地工具连接中断而停止，任务尚未验证完成。",
      );
      return {
        finalContent,
        session,
        status: "blocked",
      };
    }

    const detail =
      error instanceof Error ? error.message : "AI request failed.";
    const finalContent = `AI 请求失败：${detail}`;
    params.onVisibleContent(finalContent);
    session = finalizeWithEvent(
      session,
      params.onSessionUpdate,
      "failed",
      finalContent,
      "Agent 执行失败。",
    );
    return {
      finalContent,
      session,
      status: "failed",
      errorDetail: detail,
    };
  }
}

function appendParagraph(base: string, next: string): string {
  const trimmedBase = base.trim();
  const trimmedNext = next.trim();

  if (!trimmedBase) {
    return trimmedNext;
  }
  if (!trimmedNext) {
    return trimmedBase;
  }
  return `${trimmedBase}\n\n${trimmedNext}`;
}

function emitStatus(
  params: Pick<RunAutonomousAgentSessionParams, "onStatusUpdate" | "onVisibleContent">,
  status: string,
): void {
  if (params.onStatusUpdate) {
    params.onStatusUpdate(status);
    return;
  }
  params.onVisibleContent(status);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new Error("AI 请求已取消。");
  }
}

function waitForPromiseOrAbort<T>(
  operation: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (!signal) {
    return operation;
  }
  if (signal.aborted) {
    return Promise.reject(toAbortError(signal, "AI 请求已取消。"));
  }

  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", handleAbort);
    const handleAbort = () => {
      cleanup();
      reject(toAbortError(signal, "AI 请求已取消。"));
    };

    signal.addEventListener("abort", handleAbort, { once: true });
    operation.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

async function reserveAgentRunBudget<T>(
  params: Pick<
    RunAutonomousAgentSessionParams,
    | "abortSignal"
    | "requestBudgetExtension"
    | "onStatusUpdate"
    | "onVisibleContent"
  >,
  runBudget: AgentRunBudget,
  reservation: () => T,
): Promise<T> {
  while (true) {
    try {
      return reservation();
    } catch (error) {
      if (
        !(error instanceof AgentRunBudgetExceededError) ||
        !params.requestBudgetExtension
      ) {
        throw error;
      }

      const request = createAgentRunBudgetExtensionRequest(error);
      emitStatus(
        params,
        `${describeAgentRunBudgetExceeded(error)} 正在等待你选择继续增加额度，或停止并总结；不会自动超时。`,
      );
      const decision = await waitForPromiseOrAbort(
        params.requestBudgetExtension(request),
        params.abortSignal,
      );
      throwIfAborted(params.abortSignal);
      if (decision === "summarize") {
        throw new AgentRunBudgetSummaryRequestedError(error);
      }
      runBudget.extend(request.kind, request.increment);
      emitStatus(
        params,
        `${request.label}额度已增加，Agent 将从当前步骤继续。`,
      );
    }
  }
}

function withStatusTicks<T>(
  run: () => Promise<T>,
  onTick: (elapsedSeconds: number) => void,
  intervalMs = 4000,
): Promise<T> {
  const startedAt = Date.now();
  onTick(0);

  const timer = window.setInterval(() => {
    onTick(Math.max(1, Math.round((Date.now() - startedAt) / 1000)));
  }, intervalMs);

  return run().finally(() => {
    window.clearInterval(timer);
  });
}

function createModelProgressHandler(params: {
  getBaseContent: () => string;
  onVisibleContent: (content: string) => void;
  onStatusUpdate?: (status: string) => void;
  markProgressReceived?: () => void;
  phase: "planning" | "after_tools" | "continuation" | "summary";
  round?: number;
}): (event: AiChatStreamEvent) => void {
  let lastRenderedAt = 0;
  let lastStatus = "";

  return (event) => {
    params.markProgressReceived?.();

    const status = describeModelStreamEvent(event, params.phase, params.round);
    const now = Date.now();
    const shouldRender =
      status !== lastStatus || now - lastRenderedAt > 800;
    if (!shouldRender) {
      return;
    }

    lastStatus = status;
    lastRenderedAt = now;
    if (params.onStatusUpdate) {
      params.onStatusUpdate(status);
      return;
    }
    params.onVisibleContent(
      sanitizeAssistantVisibleContent(
        appendParagraph(params.getBaseContent(), status),
      ),
    );
  };
}

function describeModelStreamEvent(
  event: AiChatStreamEvent,
  phase: "planning" | "after_tools" | "continuation" | "summary",
  round?: number,
): string {
  if (event.type === "tool_call") {
    const prefix = round ? `第 ${round} 轮：` : "";
    if (!event.name) {
      return `${prefix}AI 正在选择下一步工具…`;
    }
    if (event.argumentLength > 0) {
      return `${prefix}AI 正在生成 ${event.name} 的调用参数…（${formatCharCount(
        event.argumentLength,
      )}）`;
    }
    return `${prefix}AI 准备调用 ${event.name}…`;
  }

  if (phase === "after_tools") {
    return round
      ? `第 ${round} 轮：AI 正在分析工具结果…`
      : "AI 正在分析工具结果…";
  }
  if (phase === "continuation") {
    return round
      ? `第 ${round} 轮：AI 正在决定是否继续调用工具…`
      : "AI 正在决定是否继续调用工具…";
  }
  if (phase === "summary") {
    return "AI 正在整理已有工具结果并生成阶段性总结…";
  }
  return "AI 正在分析请求并规划下一步…";
}

function summarizeToolNames(toolCalls: AiRequestedToolCall[]): string {
  if (toolCalls.length === 0) {
    return "无可执行工具";
  }
  return toolCalls.map((toolCall) => toolCall.name).join(", ");
}

function summarizeToolResultsForStatus(
  toolResults: AiToolResultMessage[],
): string {
  if (toolResults.length === 0) {
    return "0 个";
  }

  return toolResults
    .map((result) => {
      const parsed = parseToolResultJson(result.content);
      const size = formatCharCount(result.content.length);
      if (parsed) {
        const count =
          typeof parsed.count === "number" ? `${parsed.count} matches` : "";
        const returned =
          typeof parsed.returnedCount === "number"
            ? `${parsed.returnedCount} returned`
            : "";
        const truncated =
          parsed.truncated === true
            ? "truncated"
            : parsed.truncated === false
              ? "not truncated"
              : "";
        const details = [count, returned, truncated, size]
          .filter(Boolean)
          .join(", ");
        return details ? `${result.name}（${details}）` : `${result.name}（${size}）`;
      }

      return `${result.name}（${size}）`;
    })
    .join("；");
}

function describeExpectedToolOutcome(
  toolCalls: AiRequestedToolCall[],
): string {
  if (toolCalls.every(isReadOnlyToolCall)) {
    return "获得能减少不确定性的页面、网络或运行状态证据。";
  }
  return "完成用户要求的最小状态变更；随后必须通过独立只读观察验证结果。";
}

function isSuccessfulToolResult(result: AiToolResultMessage): boolean {
  return isSuccessfulAgentToolResultContent(result.content);
}

function parseToolResultJson(content: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(content) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function formatCharCount(count: number): string {
  return count >= 1000 ? `${Math.round(count / 100) / 10}k chars` : `${count} chars`;
}

async function summarizeAfterToolLoopStop(params: {
  config: AiConfig;
  messages: ChatMessage[];
  input: string;
  attachments: ChatImageAttachment[];
  context: AgentContext;
  toolExchanges: AiToolExchange[];
  visualCheckpoint?: AiVisualCheckpoint;
  tools?: AiFunctionToolDefinition[];
  abortSignal?: AbortSignal;
  visibleContent: string;
  onVisibleContent: (content: string) => void;
  onStatusUpdate?: (status: string) => void;
  runBudget: AgentRunBudget;
  reserveBudget: ReserveAgentRunBudget;
  skipBudgetReservation?: boolean;
}): Promise<string> {
  let summaryChunk = "";
  if (!params.skipBudgetReservation) {
    await params.reserveBudget(() => params.runBudget.consumeModelRequest());
  }
  const summaryResult = await streamAiChatAfterToolSummary({
    config: params.config,
    messages: params.messages,
    input: params.input,
    attachments: params.attachments,
    context: params.context,
    toolExchanges: params.toolExchanges,
    visualCheckpoint: params.visualCheckpoint,
    tools: params.tools,
    abortSignal: params.abortSignal,
    onDelta: (delta) => {
      summaryChunk += delta;
      params.onVisibleContent(
        sanitizeAssistantVisibleContent(
          appendParagraph(params.visibleContent, summaryChunk),
        ),
      );
    },
    onStreamEvent: createModelProgressHandler({
      getBaseContent: () => appendParagraph(params.visibleContent, summaryChunk),
      onVisibleContent: params.onVisibleContent,
      onStatusUpdate: params.onStatusUpdate,
      phase: "summary",
    }),
  });

  return sanitizeAssistantVisibleContent(summaryResult.content || summaryChunk);
}

async function requestToolContinuationAfterPlanningText(params: {
  config: AiConfig;
  messages: ChatMessage[];
  input: string;
  attachments: ChatImageAttachment[];
  context: AgentContext;
  toolExchanges: AiToolExchange[];
  visualCheckpoint?: AiVisualCheckpoint;
  tools?: AiFunctionToolDefinition[];
  abortSignal?: AbortSignal;
  visibleContent: string;
  onVisibleContent: (content: string) => void;
  onStatusUpdate?: (status: string) => void;
  runBudget: AgentRunBudget;
  reserveBudget: ReserveAgentRunBudget;
  continuationInstruction?: string;
}): Promise<{ result: AiChatStreamResult; chunk: string }> {
  try {
    return await streamToolContinuation(params, true);
  } catch (error) {
    if (error instanceof AgentRunBudgetExceededError) {
      throw error;
    }
    if (
      error instanceof Error &&
      /超时|timeout|timed out/i.test(error.message)
    ) {
      throw error;
    }
    return streamToolContinuation(params, false);
  }
}

async function streamToolContinuation(
  params: {
    config: AiConfig;
    messages: ChatMessage[];
    input: string;
    attachments: ChatImageAttachment[];
    context: AgentContext;
    toolExchanges: AiToolExchange[];
    visualCheckpoint?: AiVisualCheckpoint;
    tools?: AiFunctionToolDefinition[];
    abortSignal?: AbortSignal;
    visibleContent: string;
    onVisibleContent: (content: string) => void;
    onStatusUpdate?: (status: string) => void;
    runBudget: AgentRunBudget;
    reserveBudget: ReserveAgentRunBudget;
    continuationInstruction?: string;
  },
  forceToolChoice: boolean,
): Promise<{ result: AiChatStreamResult; chunk: string }> {
  let chunk = "";
  let deltaReceived = false;
  await params.reserveBudget(() => params.runBudget.consumeModelRequest());
  const result = await withStatusTicks(
    () =>
      streamAiChatAfterTools({
        config: params.config,
        messages: params.messages,
        input: params.input,
        attachments: params.attachments,
        context: params.context,
        toolExchanges: params.toolExchanges,
        visualCheckpoint: params.visualCheckpoint,
        tools: params.tools,
        abortSignal: params.abortSignal,
        enableTools: true,
        requireContinuation: true,
        continuationInstruction: params.continuationInstruction,
        forceToolChoice,
        onDelta: (delta) => {
          deltaReceived = true;
          chunk += delta;
        },
        onStreamEvent: createModelProgressHandler({
          getBaseContent: () => params.visibleContent,
          onVisibleContent: params.onVisibleContent,
          onStatusUpdate: params.onStatusUpdate,
          markProgressReceived: () => {
            deltaReceived = true;
          },
          phase: "continuation",
        }),
      }),
    (elapsedSeconds) => {
      if (deltaReceived) {
        return;
      }
      emitStatus(
        params,
        `正在要求 AI 直接调用下一步工具…（已等待 ${elapsedSeconds}s）`,
      );
    },
  );

  return { result, chunk };
}

function mergeToolResultsInRequestOrder(
  requestedToolCalls: AiRequestedToolCall[],
  executedToolResults: AiToolResultMessage[],
  blockedToolResults: AiToolResultMessage[],
): AiToolResultMessage[] {
  const resultsById = new Map<string, AiToolResultMessage>();
  for (const result of [...executedToolResults, ...blockedToolResults]) {
    resultsById.set(result.toolCallId, result);
  }

  return requestedToolCalls.flatMap((toolCall) => {
    const result = resultsById.get(toolCall.id);
    return result ? [result] : [];
  });
}

function isScreenshotToolCall(toolCall: AiRequestedToolCall): boolean {
  return (
    toolCall.name === "browser_take_screenshot" ||
    toolCall.name === "browser.takeScreenshot"
  );
}

function findSuccessfulScreenshotAttachment(
  toolCalls: readonly AiRequestedToolCall[],
  toolResults: readonly AiToolResultMessage[],
): ChatImageAttachment | undefined {
  const screenshotCallIds = new Set(
    toolCalls.filter(isScreenshotToolCall).map((call) => call.id),
  );
  for (
    let resultIndex = toolResults.length - 1;
    resultIndex >= 0;
    resultIndex -= 1
  ) {
    const result = toolResults[resultIndex];
    if (
      result &&
      screenshotCallIds.has(result.toolCallId) &&
      isSuccessfulToolResult(result)
    ) {
      const attachment = findLatestScreenshotAttachment(
        result.attachments ?? [],
      );
      if (attachment) {
        return attachment;
      }
    }
  }
  return undefined;
}

function findLatestScreenshotAttachment(
  attachments: readonly ChatImageAttachment[],
): ChatImageAttachment | undefined {
  for (let index = attachments.length - 1; index >= 0; index -= 1) {
    const attachment = attachments[index];
    if (attachment?.source === "screenshot") {
      return attachment;
    }
  }
  return undefined;
}

function isWebSearchToolCall(toolCall: AiRequestedToolCall): boolean {
  return toolCall.name === "web_search" || toolCall.name === "$web_search";
}

function shouldContinueAfterPlanningText(content: string): boolean {
  const normalized = content
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  if (!normalized) {
    return false;
  }

  const saysNextAction =
    /(我|agent|模型)?(需要|应该|准备|会|将|先|再|继续|重新|下一步|接下来).*(检查|查看|查询|读取|获取|调用|使用|执行|注入|应用|截图|分析|确认|定位|选择|点击|输入|滚动|导航|打开|刷新)/i.test(
      normalized,
    ) ||
    /(i need to|i should|i will|i'll|let me|next i|now i need to).*(inspect|check|query|read|get|call|use|run|apply|inject|take|analyze|click|type|scroll|navigate|reload)/i.test(
      normalized,
    );

  if (!saysNextAction) {
    return false;
  }

  return /工具|tool|dom|selector|选择器|样式|style|css|patch|截图|screenshot|页面|元素|element|network|console|请求|日志|注入|evaluate|浏览器|browser/.test(
    normalized,
  );
}

function getToolCallSignature(toolCall: AiRequestedToolCall): string {
  return `${toolCall.name}:${stableStringify(toolCall.arguments)}`;
}

function getToolBatchCallSignature(toolCalls: AiRequestedToolCall[]): string {
  return toolCalls.map(getToolCallSignature).join("\n");
}

function isNoProgressObservationBatch(
  toolCalls: AiRequestedToolCall[],
): boolean {
  return (
    toolCalls.length > 0 &&
    toolCalls.every(
      (toolCall) =>
        isReadOnlyToolCall(toolCall) && !isTimingOnlyWaitCall(toolCall),
    )
  );
}

function isReadOnlyToolCall(toolCall: AiRequestedToolCall): boolean {
  const policy = getToolPolicy(toolCall.name, toolCall.arguments);
  return !policy.mutatesBrowser && !policy.openWorld;
}

function recordReadOnlyToolObservations(
  toolCalls: AiRequestedToolCall[],
  toolResults: AiToolResultMessage[],
  observationCounts: Map<string, number>,
): RepeatedReadOnlyObservation | undefined {
  const resultsById = new Map(
    toolResults.map((result) => [result.toolCallId, result]),
  );
  let repeatedObservation: RepeatedReadOnlyObservation | undefined;

  for (const toolCall of toolCalls) {
    if (!isReadOnlyToolCall(toolCall) || isTimingOnlyWaitCall(toolCall)) {
      continue;
    }
    const result = resultsById.get(toolCall.id);
    if (!result || isTimingOnlyWaitResult(toolCall, result)) {
      continue;
    }

    const semanticResult = stableToolResultContent(
      result.content,
      result.name,
    );
    const observationSignature = `${getToolCallSignature(toolCall)}\n${result.name}:${compactStringFingerprint(semanticResult)}`;
    const nextCount = (observationCounts.get(observationSignature) ?? 0) + 1;
    observationCounts.set(observationSignature, nextCount);
    if (
      nextCount >= CROSS_ROUND_NO_PROGRESS_THRESHOLD &&
      !repeatedObservation
    ) {
      repeatedObservation = {
        toolName: toolCall.name,
        count: nextCount,
      };
    }
  }

  return repeatedObservation;
}

function getReadOnlyObservationRepeatCount(
  toolCall: AiRequestedToolCall,
  observationCounts: Map<string, number>,
): number {
  if (!isReadOnlyToolCall(toolCall) || isTimingOnlyWaitCall(toolCall)) {
    return 0;
  }
  const signaturePrefix = `${getToolCallSignature(toolCall)}\n`;
  let highestCount = 0;
  for (const [observationSignature, count] of observationCounts) {
    if (observationSignature.startsWith(signaturePrefix)) {
      highestCount = Math.max(highestCount, count);
    }
  }
  return highestCount;
}

function isTimingOnlyWaitCall(toolCall: AiRequestedToolCall): boolean {
  if (!isWaitToolName(toolCall.name)) {
    return false;
  }
  const time = toolCall.arguments.time;
  return typeof time === "number" && Number.isFinite(time) && time > 0;
}

function isTimingOnlyWaitResult(
  toolCall: AiRequestedToolCall,
  result: AiToolResultMessage,
): boolean {
  if (!isWaitToolName(toolCall.name)) {
    return false;
  }
  try {
    const parsed = JSON.parse(result.content) as { reason?: unknown };
    return parsed.reason === "time";
  } catch {
    return false;
  }
}

function isWaitToolName(toolName: string): boolean {
  return (
    toolName === MCP_TOOL_NAMES.BROWSER_WAIT_FOR ||
    toolName === TOOL_NAMES.BROWSER_WAIT_FOR
  );
}

function describeCrossRoundNoProgress(
  observation: RepeatedReadOnlyObservation,
): string {
  return `检测到只读工具 ${observation.toolName} 使用相同参数已在交替执行中 ${observation.count} 次返回相同的语义结果。为避免跨轮无进展循环，Agent 已停止继续操作，并将基于已有结果总结。`;
}

function getToolBatchResultFingerprint(
  toolResults: AiToolResultMessage[],
): string {
  return toolResults
    .map(
      (result) =>
        `${result.name}:${stableToolResultContent(result.content, result.name)}`,
    )
    .join("\n");
}

function stableToolResultContent(content: string, toolName: string): string {
  try {
    return stableStringify(
      stripVolatileToolResultFields(JSON.parse(content), [], toolName),
    );
  } catch {
    return content;
  }
}

function compactStringFingerprint(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${value.length}:${(first >>> 0).toString(16).padStart(8, "0")}:${(
    second >>> 0
  )
    .toString(16)
    .padStart(8, "0")}`;
}

const VOLATILE_TOOL_RESULT_PATHS = new Set([
  "freshness.capturedAt",
  "freshness.observedAt",
  "page.capturedAt",
  "provenance.observedAt",
]);

const CONTEXT_DIGEST_VOLATILE_ROOT_FIELDS = new Set([
  "lastSeenAt",
  "stateUpdatedAt",
  "artifactCapturedAt",
  "updatedAt",
]);

const CONTEXT_DIGEST_VOLATILE_PATHS = new Set([
  "contextDigest.generatedAt",
  "contextDigest.page.capturedAt",
]);

function stripVolatileToolResultFields(
  value: unknown,
  path: string[] = [],
  toolName = "",
): unknown {
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      stripVolatileToolResultFields(
        item,
        [...path, String(index)],
        toolName,
      ),
    );
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(
        ([key]) =>
          !isVolatileToolResultField(toolName, path, key),
      )
      .map(([key, item]) => [
        key,
        stripVolatileToolResultFields(item, [...path, key], toolName),
      ]),
  );
}

function isVolatileToolResultField(
  toolName: string,
  path: string[],
  key: string,
): boolean {
  const fieldPath = [...path, key].join(".");
  if (VOLATILE_TOOL_RESULT_PATHS.has(fieldPath)) {
    return true;
  }

  const normalizedName = normalizeMcpToolName(toolName) ?? toolName;
  if (normalizedName !== MCP_TOOL_NAMES.BROWSER_GET_CONTEXT_DIGEST) {
    return false;
  }
  return (
    (path.length === 0 &&
      CONTEXT_DIGEST_VOLATILE_ROOT_FIELDS.has(key)) ||
    CONTEXT_DIGEST_VOLATILE_PATHS.has(fieldPath)
  );
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

function summarizeContext(context: AgentContext): string {
  if (context.contextReadError) {
    return "页面上下文刷新失败，agent 将继续使用现有上下文。";
  }
  if (context.pageSnapshot || context.selectedElement) {
    return "页面上下文已同步到 agent。";
  }
  return "本轮未提供额外页面上下文。";
}

function summarizeToolCalls(
  toolCalls: AiRequestedToolCall[],
  totalToolCalls: number,
): string {
  const names = toolCalls.map((toolCall) => toolCall.name).join(", ");
  const truncatedCount = totalToolCalls - toolCalls.length;
  return truncatedCount > 0
    ? `Agent 请求 ${totalToolCalls} 个工具，本轮执行前 ${toolCalls.length} 个：${names}`
    : `Agent 请求 ${toolCalls.length} 个工具：${names}`;
}

function sanitizeAssistantVisibleContent(
  content: string,
  stripToolMarkup = true,
): string {
  return (stripToolMarkup ? stripAssistantToolMarkup(content) : content).trim();
}

function publishEvent(
  session: AgentSessionSnapshot,
  onSessionUpdate: ((session: AgentSessionSnapshot) => void) | undefined,
  type: AgentSessionSnapshot["events"][number]["type"],
  summary: string,
  data?: AgentSessionSnapshot["events"][number]["data"],
): AgentSessionSnapshot {
  const nextSession = appendAgentSessionEvent(session, {
    id: createMessageId(),
    type,
    createdAt: new Date().toISOString(),
    summary,
    data,
  });
  onSessionUpdate?.(nextSession);
  return nextSession;
}

function finalizeWithEvent(
  session: AgentSessionSnapshot,
  onSessionUpdate: ((session: AgentSessionSnapshot) => void) | undefined,
  status: "completed" | "blocked" | "failed" | "cancelled",
  finalContent: string,
  summary: string,
): AgentSessionSnapshot {
  const terminalSession = updateAgentSessionTaskState(session, {
    phase: status,
    activeAction: undefined,
    blockers:
      status === "blocked" || status === "failed"
        ? [...session.taskState.blockers, summary]
        : session.taskState.blockers,
    verification: {
      ...session.taskState.verification,
      summary:
        status === "completed"
          ? "目标已完成，且不存在待处理的修改后验证。"
          : session.taskState.verification.summary,
    },
  });
  const nextSession = finalizeAgentSession(
    appendAgentSessionEvent(terminalSession, {
      id: createMessageId(),
      type: status,
      createdAt: new Date().toISOString(),
      summary,
    }),
    status,
    finalContent,
  );
  onSessionUpdate?.(nextSession);
  return nextSession;
}

function updateTaskState(
  session: AgentSessionSnapshot,
  onSessionUpdate: ((session: AgentSessionSnapshot) => void) | undefined,
  patch: AgentTaskStatePatch,
): AgentSessionSnapshot {
  const nextSession = updateAgentSessionTaskState(session, patch);
  onSessionUpdate?.(nextSession);
  return nextSession;
}

function toAgentToolCallSnapshot(
  toolCall: AiRequestedToolCall,
): AgentSessionToolCallSnapshot {
  return {
    ...sanitizeAgentToolCallForPersistence({
      id: toolCall.id,
      name: toolCall.name,
      arguments: toolCall.arguments,
    }),
  };
}

function toAgentToolResultSnapshot(
  toolResult: AiToolResultMessage,
): AgentSessionToolResultSnapshot {
  return sanitizeAgentToolResultForPersistence({
    toolCallId: toolResult.toolCallId,
    name: toolResult.name,
    content: toolResult.content,
  });
}
