import {
  AimOutlined,
  ApiOutlined,
  ArrowDownOutlined,
  CameraOutlined,
  CheckOutlined,
  ClockCircleOutlined,
  ClearOutlined,
  CloseOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  DownOutlined,
  EditOutlined,
  ExclamationCircleOutlined,
  FileSearchOutlined,
  GlobalOutlined,
  HistoryOutlined,
  InboxOutlined,
  LeftOutlined,
  PictureOutlined,
  RedoOutlined,
  RightOutlined,
  SafetyCertificateOutlined,
  SendOutlined,
  SettingOutlined,
  StopOutlined,
  ThunderboltOutlined,
  ToolOutlined,
} from "@ant-design/icons";
import Button from "antd/es/button";
import Drawer from "antd/es/drawer";
import Dropdown from "antd/es/dropdown";
import Empty from "antd/es/empty";
import Image from "antd/es/image";
import Input from "antd/es/input";
import Popconfirm from "antd/es/popconfirm";
import Switch from "antd/es/switch";
import Tag from "antd/es/tag";
import Tooltip from "antd/es/tooltip";
import Typography from "antd/es/typography";
import type { ReactNode } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createMessageId } from "../../shared/messaging";
import type { ToolName } from "../../shared/tools";
import type { BrowserTargetTab } from "../../shared/dom";
import {
  isDelegatedTaskOrphaned,
  type DelegatedTaskSnapshot,
} from "../../shared/collaborationTasks";
import type { ActiveTabSnapshot } from "../../shared/wsProtocol";
import type { BrowserActivityCursor } from "../../shared/browserActivity";
import {
  formatAgentRunBudgetAmount,
  type AgentRunBudgetExtensionDecision,
  type AgentRunBudgetExtensionRequest,
} from "../../shared/agentRunBudget";
import type {
  ExecutionApprovalMode,
  ToolApprovalDecision,
} from "../agentRunApprovals";
import { getChatShortcutState } from "../chatShortcutState";
import { getAssistantDisplayContent } from "../services/assistantContent";
import type { BackgroundConversationWork } from "../services/backgroundConversationWork";
import type {
  ChatImageAttachment,
  ChatConversationSummary,
  ChatMessage,
  ChatSendMode,
  ExecutionTaskBinding,
  PendingToolApproval,
  QueuedChatSubmission,
} from "../types";
import { MarkdownContent } from "./MarkdownContent";

interface ChatPanelProps {
  messages: ChatMessage[];
  busy: boolean;
  agentBusy: boolean;
  aiConfigured: boolean;
  supportsVision: boolean;
  hubConnected: boolean;
  permissions: {
    supportsWebSearch: boolean;
    enableWebSearch: boolean;
    enableTools: boolean;
    includePageContext: boolean;
  };
  contextLabel: string;
  streamingMessageId?: string;
  pendingToolApprovals: PendingToolApproval[];
  pendingBudgetExtension?: AgentRunBudgetExtensionRequest | null;
  executionApprovalMode: ExecutionApprovalMode;
  executionApprovalScopeLabel?: string;
  activeExecutionBinding?: ExecutionTaskBinding;
  backgroundConversationWork?: BackgroundConversationWork;
  selectedToolTarget?: ActiveTabSnapshot;
  foregroundTab?: BrowserTargetTab;
  activityMonitor?: {
    cursor: BrowserActivityCursor;
    target?: {
      tabId: number;
      title?: string;
      url?: string;
    };
    health: "active" | "offline" | "stopped" | "restarted";
    latestSequence?: number;
    action?: "restart" | "stop";
  };
  queuedMessages: QueuedChatSubmission[];
  delegatedTasks: DelegatedTaskSnapshot[];
  delegatedInboxTasks: DelegatedTaskSnapshot[];
  activeDelegatedTaskId?: string;
  delegatedTaskActionIds: Set<string>;
  conversations: ChatConversationSummary[];
  activeConversationId: string;
  draftValue: string;
  elementPickerActive: boolean;
  runningTool?: ToolName;
  onSend: (
    value: string,
    attachments: ChatImageAttachment[],
    mode: ChatSendMode,
  ) => boolean;
  onStop: () => void;
  onRemoveQueuedMessage: (submissionId: string) => void;
  onClearQueuedMessages: () => void;
  onRunQueuedMessageNow: (submissionId: string) => void;
  onAcceptDelegatedTask: (taskId: string, resume: boolean) => void;
  onRestoreDelegatedTask: (taskId: string) => void;
  onRejectDelegatedTask: (taskId: string) => void;
  onOpenConversation: (conversationId: string) => boolean;
  onDeleteConversation: (conversationId: string) => boolean;
  onRetryMessage: (assistantMessageId: string) => boolean;
  onForkMessage: (
    userMessageId: string,
    value: string,
    attachments: ChatImageAttachment[],
    sourceDraft: string,
  ) => boolean;
  onDraftChange: (value: string) => void;
  onResolveToolApproval: (
    approvalId: string,
    decision: ToolApprovalDecision,
  ) => void;
  onResolveBudgetExtension: (
    decision: AgentRunBudgetExtensionDecision,
  ) => void;
  onChangeExecutionApprovalMode: (mode: ExecutionApprovalMode) => void;
  onFocusExecutionTarget: (tabId: number) => void;
  onRestartActivityMonitor: () => void;
  onStopActivityMonitor: () => void;
  onReadPage: () => void;
  onPickElement: () => void;
  onCancelElementPick: () => void;
  onCaptureScreenshot: () => Promise<ChatImageAttachment | undefined>;
  onAttachmentRejected: (reason: string) => void;
  onUpdatePermission: (patch: {
    enableWebSearch?: boolean;
    enableTools?: boolean;
    includePageContext?: boolean;
  }) => void;
  onClearChat: () => void;
  onOpenSettings: () => void;
}

export function ChatPanel({
  messages,
  busy,
  agentBusy,
  aiConfigured,
  supportsVision,
  hubConnected,
  permissions,
  contextLabel,
  streamingMessageId,
  pendingToolApprovals,
  pendingBudgetExtension,
  executionApprovalMode,
  executionApprovalScopeLabel,
  activeExecutionBinding,
  backgroundConversationWork,
  selectedToolTarget,
  foregroundTab,
  activityMonitor,
  queuedMessages,
  delegatedTasks,
  delegatedInboxTasks,
  activeDelegatedTaskId,
  delegatedTaskActionIds,
  conversations,
  activeConversationId,
  draftValue,
  elementPickerActive,
  runningTool,
  onSend,
  onStop,
  onRemoveQueuedMessage,
  onClearQueuedMessages,
  onRunQueuedMessageNow,
  onAcceptDelegatedTask,
  onRestoreDelegatedTask,
  onRejectDelegatedTask,
  onOpenConversation,
  onDeleteConversation,
  onRetryMessage,
  onForkMessage,
  onDraftChange,
  onResolveToolApproval,
  onResolveBudgetExtension,
  onChangeExecutionApprovalMode,
  onFocusExecutionTarget,
  onRestartActivityMonitor,
  onStopActivityMonitor,
  onReadPage,
  onPickElement,
  onCancelElementPick,
  onCaptureScreenshot,
  onAttachmentRejected,
  onUpdatePermission,
  onClearChat,
  onOpenSettings
}: ChatPanelProps) {
  const [attachments, setAttachments] = useState<ChatImageAttachment[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [expandedToolMessages, setExpandedToolMessages] = useState<Set<string>>(() => new Set());
  const [composerFocused, setComposerFocused] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string>();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState("");
  const [delegatedInboxOpen, setDelegatedInboxOpen] = useState(false);
  const [backgroundWorkOpen, setBackgroundWorkOpen] = useState(false);
  const [activeApprovalId, setActiveApprovalId] = useState<string>();
  const [editingMessageId, setEditingMessageId] = useState<string>();
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const copyResetTimerRef = useRef<number | undefined>(undefined);
  const draftBeforeEditRef = useRef("");

  useEffect(
    () => () => {
      if (copyResetTimerRef.current) {
        window.clearTimeout(copyResetTimerRef.current);
      }
    },
    [],
  );

  useLayoutEffect(() => {
    if (!autoScroll) {
      return;
    }

    const container = scrollRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [autoScroll, messages]);

  useEffect(() => {
    setEditingMessageId(undefined);
    setAttachments([]);
    setHistoryOpen(false);
    setDelegatedInboxOpen(false);
    setBackgroundWorkOpen(false);
    draftBeforeEditRef.current = "";
  }, [activeConversationId]);

  useEffect(() => {
    if (delegatedInboxTasks.length === 0) {
      setDelegatedInboxOpen(false);
    }
  }, [delegatedInboxTasks.length]);

  useEffect(() => {
    if (!backgroundConversationWork) {
      setBackgroundWorkOpen(false);
    }
  }, [backgroundConversationWork]);

  const latestApprovalId =
    pendingToolApprovals[pendingToolApprovals.length - 1]?.id;
  useEffect(() => {
    setActiveApprovalId(latestApprovalId);
  }, [latestApprovalId]);

  const activeApprovalIndex = Math.max(
    0,
    pendingToolApprovals.findIndex(
      (approval) => approval.id === activeApprovalId,
    ),
  );
  const activeApproval = pendingToolApprovals[activeApprovalIndex];

  const handleScroll = () => {
    const container = scrollRef.current;
    if (!container) {
      return;
    }

    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    setAutoScroll(distanceFromBottom < 48);
  };

  const scrollToBottom = () => {
    const container = scrollRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
    setAutoScroll(true);
  };

  const copyMessage = async (message: ChatMessage) => {
    try {
      await navigator.clipboard.writeText(visibleMessageContent(message));
      setCopiedMessageId(message.id);
      if (copyResetTimerRef.current) {
        window.clearTimeout(copyResetTimerRef.current);
      }
      copyResetTimerRef.current = window.setTimeout(
        () => setCopiedMessageId(undefined),
        1600,
      );
    } catch {
      onAttachmentRejected("复制失败，请手动选择消息内容。");
    }
  };

  const copyText = async (copyId: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedMessageId(copyId);
      if (copyResetTimerRef.current) {
        window.clearTimeout(copyResetTimerRef.current);
      }
      copyResetTimerRef.current = window.setTimeout(
        () => setCopiedMessageId(undefined),
        1600,
      );
    } catch {
      onAttachmentRejected("复制失败，请手动选择内容。");
    }
  };

  const copyDelegatedTask = async (task: DelegatedTaskSnapshot) => {
    try {
      await navigator.clipboard.writeText(formatDelegatedTaskClipboard(task));
      setCopiedMessageId(task.requestItem.id);
      if (copyResetTimerRef.current) {
        window.clearTimeout(copyResetTimerRef.current);
      }
      copyResetTimerRef.current = window.setTimeout(
        () => setCopiedMessageId(undefined),
        1600,
      );
    } catch {
      onAttachmentRejected("复制失败，请手动选择委托内容。");
    }
  };

  const composerBlocked = busy && !agentBusy;
  const hasDraft = Boolean(draftValue.trim() || attachments.length);
  const shortcutState = getChatShortcutState(agentBusy, runningTool);
  const filteredConversations = useMemo(() => {
    const query = historyQuery.trim().toLocaleLowerCase();
    if (!query) return conversations;
    return conversations.filter((conversation) =>
      conversation.searchText.includes(query),
    );
  }, [conversations, historyQuery]);

  const submit = (mode?: ChatSendMode) => {
    if (composerBlocked) {
      return;
    }
    const next = draftValue.trim();
    const container = scrollRef.current;
    const wasAtBottom =
      autoScroll ||
      Boolean(
        container &&
          container.scrollHeight -
            container.scrollTop -
            container.clientHeight <
            64,
      );
    if (!next && attachments.length === 0) {
      return;
    }

    if (editingMessageId) {
      if (
        !onForkMessage(
          editingMessageId,
          next,
          attachments,
          draftBeforeEditRef.current,
        )
      ) {
        return;
      }
      setEditingMessageId(undefined);
      draftBeforeEditRef.current = "";
      onDraftChange("");
      setAttachments([]);
      setAutoScroll(true);
      return;
    }

    const effectiveMode = mode ?? (agentBusy ? "queue" : "normal");
    if (!onSend(next, attachments, effectiveMode)) {
      return;
    }
    onDraftChange("");
    setAttachments([]);
    if (wasAtBottom) {
      setAutoScroll(true);
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(scrollToBottom);
      });
    }
  };

  const beginMessageEdit = (message: ChatMessage) => {
    draftBeforeEditRef.current = draftValue;
    setEditingMessageId(message.id);
    onDraftChange(message.content);
    setAttachments(message.attachments ? [...message.attachments] : []);
  };

  const cancelMessageEdit = () => {
    setEditingMessageId(undefined);
    onDraftChange(draftBeforeEditRef.current);
    draftBeforeEditRef.current = "";
    setAttachments([]);
  };

  const addFiles = async (files: FileList | null) => {
    if (!files) {
      return;
    }

    const imageFiles = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length === 0) {
      return;
    }
    if (!supportsVision) {
      onAttachmentRejected("当前检测结果不支持图片输入，图片不会加入上下文。");
      return;
    }

    const images = await Promise.all(imageFiles.slice(0, 4).map(fileToAttachment));

    setAttachments((current) => [...current, ...images].slice(-6));
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const addPastedImages = async (clipboardData: DataTransfer) => {
    const files = Array.from(clipboardData.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));

    if (files.length === 0) {
      return false;
    }
    if (!supportsVision) {
      onAttachmentRejected("当前检测结果不支持图片输入，已忽略粘贴的图片。");
      return true;
    }

    const images = await Promise.all(files.slice(0, 4).map(fileToAttachment));
    setAttachments((current) => [...current, ...images].slice(-6));
    return true;
  };

  const captureScreenshot = async () => {
    if (!supportsVision) {
      onAttachmentRejected("当前检测结果不支持图片输入；保存 AI 配置会重新检测。");
      return;
    }

    const screenshot = await onCaptureScreenshot();
    if (screenshot) {
      setAttachments((current) => [...current, screenshot].slice(-6));
    }
  };

  const toggleToolMessage = (messageId: string) => {
    setExpandedToolMessages((current) => {
      const next = new Set(current);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  };

  const renderMessageContent = (message: ChatMessage) => {
    if (message.role !== "tool") {
      return (
        <div className="message-rich-content">
          {renderRichContent(
            visibleMessageContent(
              message,
              message.id === streamingMessageId,
            ),
          )}
          {message.id === streamingMessageId ? <span className="streaming-caret" /> : null}
          {message.status ? (
            <div className="agent-status-line">{message.status}</div>
          ) : null}
        </div>
      );
    }

    const expanded = expandedToolMessages.has(message.id);

    return (
      <div className="tool-message-body">
        <button
          className="tool-message-toggle"
          type="button"
          onClick={() => toggleToolMessage(message.id)}
          aria-expanded={expanded}
        >
          <RightOutlined
            className={`disclosure-chevron${expanded ? " is-expanded" : ""}`}
            aria-hidden="true"
          />
          <span>{expanded ? "收起工具结果" : getToolMessageSummary(message)}</span>
        </button>
        {expanded ? (
          <div className="tool-message-content">
            <div className="tool-result-toolbar">
              <span>{getExpandedToolResultLabel(message)}</span>
              <Button
                size="small"
                type="text"
                icon={
                  copiedMessageId === message.id ? (
                    <CheckOutlined />
                  ) : (
                    <CopyOutlined />
                  )
                }
                onClick={() => void copyMessage(message)}
                aria-label={`复制工具结果 ${message.toolName ?? ""}`.trim()}
              >
                {copiedMessageId === message.id ? "已复制" : "复制"}
              </Button>
            </div>
            {message.toolResultMeta?.truncated ? (
              <div className="tool-result-truncated-note" role="note">
                当前只保留了 {formatCharCount(
                  message.toolResultMeta.displayedSourceCharCount,
                )}
                ，原始结果为 {formatCharCount(
                  message.toolResultMeta.originalCharCount,
                )}
                。请使用工具的分页或 cursor 参数继续读取。
              </div>
            ) : null}
            {message.toolName === "browser_capture_issue_evidence" ? (
              <IssueEvidenceWorkbench
                content={message.content}
                copiedId={copiedMessageId}
                messageId={message.id}
                onCopy={copyText}
              />
            ) : (
              <ToolResultViewport content={message.content} />
            )}
          </div>
        ) : null}
        {activityMonitor ? (
          <ActivityMonitorBar
            cursor={activityMonitor.cursor}
            target={activityMonitor.target}
            health={activityMonitor.health}
            latestSequence={activityMonitor.latestSequence}
            action={activityMonitor.action}
            onRestart={onRestartActivityMonitor}
            onStop={onStopActivityMonitor}
          />
        ) : null}
      </div>
    );
  };

  return (
    <div className="chat-panel">
      <div className="chat-top-stack">
        <div className="chat-status-row">
        <Tag color={agentBusy ? "processing" : aiConfigured ? "green" : "orange"}>
          {agentBusy
            ? `AI 回复中${queuedMessages.length ? ` · 待发送 ${queuedMessages.length}` : ""}`
            : aiConfigured
              ? "AI 已就绪"
              : "需要配置 AI"}
        </Tag>
        <Tag className="context-status-tag">{contextLabel}</Tag>
        {!hubConnected ? <Tag>Hub 离线</Tag> : null}
        <div className="chat-status-actions">
          {backgroundConversationWork ? (
            <Tooltip
              title={
                backgroundConversationWork.pendingApprovalCount
                  ? `其他对话有 ${backgroundConversationWork.pendingApprovalCount} 条待审批`
                  : "其他对话正在后台执行"
              }
            >
              <Button
                className={`background-work-trigger ${
                  backgroundConversationWork.pendingApprovalCount
                    ? "is-attention"
                    : ""
                }`}
                size="small"
                type="text"
                icon={<ClockCircleOutlined />}
                onClick={() => setBackgroundWorkOpen(true)}
                aria-label={
                  backgroundConversationWork.pendingApprovalCount
                    ? `打开后台任务，${backgroundConversationWork.pendingApprovalCount} 条待审批`
                    : "打开后台任务，1 个对话正在执行"
                }
              >
                {backgroundConversationWork.pendingApprovalCount || 1}
              </Button>
            </Tooltip>
          ) : null}
          {delegatedInboxTasks.length ? (
            <Tooltip
              title={`Codex 收件箱 · ${delegatedInboxTasks.length} 条待处理`}
            >
              <Button
                className="delegated-inbox-trigger"
                size="small"
                type="text"
                icon={<InboxOutlined />}
                onClick={() => setDelegatedInboxOpen(true)}
                aria-label={`打开 Codex 收件箱，${delegatedInboxTasks.length} 条待处理`}
              >
                {delegatedInboxTasks.length}
              </Button>
            </Tooltip>
          ) : null}
          <Tooltip title="本地对话历史">
            <Button
              size="small"
              type="text"
              icon={<HistoryOutlined />}
              onClick={() => setHistoryOpen(true)}
              aria-label="打开本地对话历史"
            />
          </Tooltip>
          <Tooltip title="AI 配置">
            <Button
              size="small"
              type="text"
              icon={<SettingOutlined />}
              onClick={onOpenSettings}
              aria-label="打开 AI 配置"
            />
          </Tooltip>
          <Tooltip title="新建干净对话；当前任务会继续留在原对话和 Tab">
            <Button
              size="small"
              type="text"
              icon={<ClearOutlined />}
              onClick={onClearChat}
              aria-label="新对话"
            />
          </Tooltip>
        </div>
        </div>
        {activeExecutionBinding ? (
          <ExecutionTargetBar
            target={activeExecutionBinding.target}
            mode="task"
            foregroundTab={foregroundTab}
            queuedCount={queuedMessages.length}
            onFocus={onFocusExecutionTarget}
          />
        ) : selectedToolTarget?.tabId !== undefined &&
          selectedToolTarget.tabId !== foregroundTab?.id ? (
          <ExecutionTargetBar
            target={{
              tabId: selectedToolTarget.tabId,
              windowId: selectedToolTarget.windowId,
              targetId: selectedToolTarget.targetId,
              title: selectedToolTarget.title,
              url: selectedToolTarget.url,
            }}
            mode="tool"
            foregroundTab={foregroundTab}
            queuedCount={0}
            onFocus={onFocusExecutionTarget}
          />
        ) : null}
      </div>

      <div className="chat-permission-row">
        <PermissionSwitch
          icon={<GlobalOutlined />}
          label="联网"
          checked={permissions.enableWebSearch}
          disabled={!permissions.supportsWebSearch}
          tooltip={
            permissions.supportsWebSearch
              ? "允许本轮对话使用联网搜索"
              : "当前模型/接口未检测到联网搜索能力，保存 AI 配置会重新检测"
          }
          onChange={(checked) => onUpdatePermission({ enableWebSearch: checked })}
        />
        <PermissionSwitch
          icon={<FileSearchOutlined />}
          label="页面"
          checked={permissions.includePageContext}
          tooltip="发送前自动附带当前页面上下文"
          onChange={(checked) => onUpdatePermission({ includePageContext: checked })}
        />
        <PermissionSwitch
          icon={<ToolOutlined />}
          label="工具"
          checked={permissions.enableTools}
          tooltip="允许 AI 调用页面、网络、截图等工具"
          onChange={(checked) => onUpdatePermission({ enableTools: checked })}
        />
      </div>

      <div className="chat-messages" ref={scrollRef} onScroll={handleScroll}>
        {messages.map((message, index) => {
          const delegatedTask =
            message.source === "mcp_ai" && message.delegatedTaskId
            ? delegatedTasks.find(
                (task) => task.taskId === message.delegatedTaskId,
              )
            : undefined;
          return (
          <div
            className={`chat-message-row chat-message-row-${message.role} chat-message-row-source-${message.source ?? "unknown"}`}
            key={message.id}
          >
            <article
              className={`chat-message chat-message-${message.role} chat-message-source-${message.source ?? "unknown"}`}
              aria-label={
                message.role === "user"
                  ? "你的消息"
                  : message.role === "assistant"
                    ? "AI 回复"
                    : `工具结果 ${message.toolName ?? ""}`.trim()
              }
            >
              {delegatedTask ? (
                <DelegatedTaskCard
                  task={delegatedTask}
                  active={activeDelegatedTaskId === delegatedTask.taskId}
                  queued={queuedMessages.some(
                    (submission) =>
                      submission.delegatedTask?.taskId === delegatedTask.taskId,
                  )}
                  loading={delegatedTaskActionIds.has(delegatedTask.taskId)}
                  copied={copiedMessageId === message.id}
                  onCopy={() => void copyMessage(message)}
                  onAccept={onAcceptDelegatedTask}
                  onRestore={onRestoreDelegatedTask}
                  onReject={onRejectDelegatedTask}
                />
              ) : (
                <>
                  {message.role === "tool" ||
                  message.source === "extension_ai" ? (
                    <div className="chat-meta">
                      <div className="chat-meta-labels">
                        <Typography.Text type="secondary">
                          {message.role === "tool" ? "工具" : "插件 AI"}
                        </Typography.Text>
                        {message.role === "tool" && message.toolName ? (
                          <Typography.Text type="secondary">
                            {message.toolName}
                          </Typography.Text>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                  {renderMessageContent(message)}
                  {message.attachments?.length
                    ? renderImageAttachments(message.attachments)
                    : null}
                </>
              )}
            </article>
            {!delegatedTask && message.role !== "tool" && message.content ? (
              <div className="chat-message-actions" aria-label="消息操作">
                {message.role === "user" ? (
                  <Tooltip title="编辑并创建新分支">
                    <Button
                      className="chat-message-action"
                      size="small"
                      type="text"
                      icon={<EditOutlined />}
                      onClick={() => beginMessageEdit(message)}
                      disabled={busy || queuedMessages.length > 0}
                      aria-label="编辑消息并创建新分支"
                    />
                  </Tooltip>
                ) : message.source !== "mcp_ai" &&
                  index > 0 &&
                  messages
                    .slice(0, index)
                    .some((candidate) => candidate.role === "user") ? (
                  <RetryMessageAction
                    assistantMessageId={message.id}
                    attachmentCount={getRetrySourceAttachmentCount(messages, index)}
                    disabled={busy || queuedMessages.length > 0}
                    onRetryMessage={onRetryMessage}
                  />
                ) : null}
                <Tooltip
                  title={
                    copiedMessageId === message.id ? "已复制" : "复制消息"
                  }
                >
                  <Button
                    className="chat-message-action"
                    size="small"
                    type="text"
                    icon={
                      copiedMessageId === message.id ? (
                        <CheckOutlined />
                      ) : (
                        <CopyOutlined />
                      )
                    }
                    onClick={() => void copyMessage(message)}
                    aria-label="复制消息"
                  />
                </Tooltip>
              </div>
            ) : null}
          </div>
          );
        })}
        {!autoScroll ? (
          <Button
            className="chat-scroll-bottom"
            size="small"
            icon={<ArrowDownOutlined />}
            onClick={scrollToBottom}
          >
            回到底部
          </Button>
        ) : null}
      </div>

      <div className="chat-bottom-stack">
        {pendingBudgetExtension ? (
          <AgentBudgetExtensionCard
            request={pendingBudgetExtension}
            onResolve={onResolveBudgetExtension}
          />
        ) : null}
        {activeApproval ? (
          <div className="tool-approval-stack">
            {pendingToolApprovals.length > 1 ? (
              <div
                className="tool-approval-queue-nav"
                role="status"
                aria-live="polite"
              >
                <span>
                  待审批 {pendingToolApprovals.length} 条
                  <Typography.Text type="secondary">
                    {activeApprovalIndex + 1} / {pendingToolApprovals.length}
                  </Typography.Text>
                </span>
                <div className="tool-approval-queue-actions">
                  <Button
                    type="text"
                    size="small"
                    icon={<LeftOutlined />}
                    disabled={activeApprovalIndex === 0}
                    onClick={() =>
                      setActiveApprovalId(
                        pendingToolApprovals[activeApprovalIndex - 1]?.id,
                      )
                    }
                    aria-label="查看上一条审批"
                  />
                  <Button
                    type="text"
                    size="small"
                    icon={<RightOutlined />}
                    disabled={
                      activeApprovalIndex >= pendingToolApprovals.length - 1
                    }
                    onClick={() =>
                      setActiveApprovalId(
                        pendingToolApprovals[activeApprovalIndex + 1]?.id,
                      )
                    }
                    aria-label="查看下一条审批"
                  />
                </div>
              </div>
            ) : null}
            <ToolApprovalCard
              approval={activeApproval}
              onResolve={(decision) =>
                onResolveToolApproval(activeApproval.id, decision)
              }
            />
          </div>
        ) : null}
        <ExecutionApprovalModeBar
          mode={executionApprovalMode}
          scopeLabel={executionApprovalScopeLabel}
          onChange={onChangeExecutionApprovalMode}
        />
        <div className={`chat-composer ${composerFocused ? "chat-composer-focused" : ""}`}>
        {queuedMessages.length ? (
          <div className="chat-queue" aria-label="待发送消息队列">
            <div className="chat-queue-header">
              <span>
                <ClockCircleOutlined /> 待发送 {queuedMessages.length}/5
              </span>
              <div className="chat-queue-header-actions">
                <Typography.Text type="secondary">
                  当前回复结束后按顺序发送
                </Typography.Text>
                <Button
                  size="small"
                  type="text"
                  onClick={onClearQueuedMessages}
                  aria-label="清空待发送队列"
                >
                  清空
                </Button>
              </div>
            </div>
            <div className="chat-queue-list">
              {queuedMessages.map((submission, index) => (
                <div className="chat-queue-item" key={submission.id}>
                  <span className="chat-queue-position">{index + 1}</span>
                  <span className="chat-queue-preview">
                    {submission.input || "仅图片消息"}
                    {submission.attachments.length
                      ? ` · ${submission.attachments.length} 张图片`
                      : ""}
                    {submission.executionBinding
                      ? ` · ${formatTaskTargetHost(
                          submission.executionBinding.target.url,
                        ) ?? `Tab ${submission.executionBinding.target.tabId}`}`
                      : ""}
                  </span>
                  <Tooltip title="下一条立即发送">
                    <Button
                      size="small"
                      type="text"
                      icon={<ThunderboltOutlined />}
                      onClick={() => onRunQueuedMessageNow(submission.id)}
                      aria-label="将这条消息调整为下一条并停止当前回复"
                    />
                  </Tooltip>
                  <Tooltip title="移除">
                    <Button
                      size="small"
                      type="text"
                      icon={<DeleteOutlined />}
                      onClick={() => onRemoveQueuedMessage(submission.id)}
                      aria-label="移除待发送消息"
                    />
                  </Tooltip>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {editingMessageId ? (
          <div className="chat-edit-branch" role="status">
            <EditOutlined />
            <span>发送后会保留原对话，并从这条消息创建新分支。</span>
            <Button size="small" type="text" onClick={cancelMessageEdit}>
              取消
            </Button>
          </div>
        ) : null}
        {attachments.length ? (
          <div className="attachment-strip">
            {attachments.map((attachment) => (
              <div className="attachment-chip" key={attachment.id}>
                <img src={attachment.dataUrl} alt={attachment.name} />
                <span>{attachment.source === "screenshot" ? "screenshot" : attachment.name}</span>
                <Button
                  size="small"
                  type="text"
                  icon={<CloseOutlined />}
                  onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))}
                  aria-label={`移除附件 ${attachment.name}`}
                />
              </div>
            ))}
          </div>
        ) : null}
        <Input.TextArea
          className="composer-textarea"
          autoSize={{ minRows: 1, maxRows: 4 }}
          value={draftValue}
          onChange={(event) => onDraftChange(event.target.value)}
          onPaste={(event) => {
            const hasImage = Array.from(event.clipboardData.items).some(
              (item) => item.kind === "file" && item.type.startsWith("image/")
            );
            if (hasImage) {
              event.preventDefault();
            }
            void addPastedImages(event.clipboardData);
          }}
          onFocus={() => setComposerFocused(true)}
          onBlur={() => setComposerFocused(false)}
          onPressEnter={(event) => {
            if (!event.shiftKey) {
              event.preventDefault();
              submit(
                event.metaKey || event.ctrlKey
                  ? "interrupt"
                  : agentBusy
                    ? "queue"
                    : "normal",
              );
            }
          }}
          disabled={composerBlocked}
          placeholder={
            editingMessageId
              ? "编辑消息；发送后创建新分支"
              : agentBusy
              ? "继续输入；Enter 排队，⌘/Ctrl + Enter 强制发送"
              : composerBlocked
                ? "页面工具执行中…"
                : "询问当前页面、粘贴日志或附加图片…"
          }
        />
        <div className="composer-footer">
          <div className="composer-actions">
            <Tooltip title="读取页面">
              <Button
                type="text"
                icon={<FileSearchOutlined />}
                onClick={onReadPage}
                loading={shortcutState.readPageLoading}
                disabled={shortcutState.disabled}
                aria-label="读取页面"
              />
            </Tooltip>
            <Tooltip title={elementPickerActive ? "取消选择元素" : "选择元素"}>
              <Button
                type="text"
                danger={elementPickerActive}
                icon={elementPickerActive ? <CloseOutlined /> : <AimOutlined />}
                onClick={elementPickerActive ? onCancelElementPick : onPickElement}
                loading={shortcutState.elementPickerLoading}
                disabled={shortcutState.disabled}
                aria-label={elementPickerActive ? "取消选择元素" : "选择元素"}
              />
            </Tooltip>
            <Tooltip title={supportsVision ? "附加截图" : "当前检测结果不支持图片输入"}>
              <Button
                type="text"
                icon={<CameraOutlined />}
                onClick={captureScreenshot}
                disabled={!supportsVision || shortcutState.disabled}
                loading={shortcutState.screenshotLoading}
                aria-label="附加截图"
              />
            </Tooltip>
            <Tooltip title={supportsVision ? "上传图片" : "当前检测结果不支持图片输入"}>
              <Button
                type="text"
                icon={<PictureOutlined />}
                onClick={() => fileInputRef.current?.click()}
                disabled={!supportsVision}
                aria-label="上传图片"
              />
            </Tooltip>
          </div>
          <div className="composer-run-actions">
            {agentBusy ? (
              <>
                <Tooltip title="停止当前回复">
                  <Button
                    className="composer-control"
                    danger
                    icon={<StopOutlined />}
                    onClick={onStop}
                    aria-label="停止当前回复"
                  />
                </Tooltip>
                <Tooltip title="强制发送（⌘/Ctrl + Enter）">
                  <Button
                    className="composer-control"
                    icon={<ThunderboltOutlined />}
                    onClick={() => submit("interrupt")}
                    disabled={!hasDraft}
                    aria-label="停止当前回复并优先发送"
                  />
                </Tooltip>
                <Tooltip title="加入待发送队列（Enter）">
                  <Button
                    className="composer-send"
                    type="primary"
                    icon={<SendOutlined />}
                    onClick={() => submit("queue")}
                    disabled={!hasDraft}
                    aria-label="加入待发送队列"
                  />
                </Tooltip>
              </>
            ) : (
              <Tooltip title="发送（Enter）">
                <Button
                  className="composer-send"
                  type="primary"
                  icon={<SendOutlined />}
                  onClick={() => submit("normal")}
                  disabled={composerBlocked || !hasDraft}
                  aria-label="发送消息"
                />
              </Tooltip>
            )}
          </div>
        </div>
      </div>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => void addFiles(event.target.files)}
      />
      <Drawer
        className="background-work-drawer"
        title="后台任务"
        placement="right"
        width="min(400px, calc(100vw - 20px))"
        open={backgroundWorkOpen}
        onClose={() => setBackgroundWorkOpen(false)}
      >
        {backgroundConversationWork ? (
          <>
            <Typography.Paragraph
              type="secondary"
              className="background-work-note"
            >
              其他聊天上下文可以继续运行，但执行状态和审批不会混入当前对话。
            </Typography.Paragraph>
            <section
              className="background-work-card"
              aria-label={`后台任务：${backgroundConversationWork.conversationTitle}`}
            >
              <div className="background-work-card-header">
                <div className="background-work-card-heading">
                  <span className="background-work-card-label">
                    其他聊天上下文
                  </span>
                  <strong title={backgroundConversationWork.conversationTitle}>
                    {backgroundConversationWork.conversationTitle}
                  </strong>
                </div>
                <Tag
                  color={
                    backgroundConversationWork.pendingApprovalCount
                      ? "orange"
                      : "processing"
                  }
                >
                  {backgroundConversationWork.pendingApprovalCount
                    ? `待审批 ${backgroundConversationWork.pendingApprovalCount}`
                    : "执行中"}
                </Tag>
              </div>
              <div className="background-work-card-body">
                <span>
                  目标 Tab：{" "}
                  {backgroundConversationWork.target.title?.trim() ||
                    formatTaskTargetHost(
                      backgroundConversationWork.target.url,
                    ) ||
                    backgroundConversationWork.target.tabId}
                </span>
                {backgroundConversationWork.queuedCount ? (
                  <span>
                    同一对话还有 {backgroundConversationWork.queuedCount} 条待发送
                  </span>
                ) : null}
                {backgroundConversationWork.pendingApprovalCount ? (
                  <div className="background-work-attention">
                    任务正在原对话等待你的决定，未批准的操作不会执行。
                  </div>
                ) : null}
              </div>
              <div className="background-work-card-actions">
                <Popconfirm
                  title="停止并删除这个后台对话？"
                  description={
                    backgroundConversationWork.recoverableDelegatedTask
                      ? "本地 Agent 会停止；未结束的 MCP 任务将移入 Codex 收件箱等待恢复。"
                      : "本地 Agent 会停止，当前对话和排队消息会从本地删除。"
                  }
                  okText="停止并删除"
                  cancelText="返回"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => {
                    if (
                      onDeleteConversation(
                        backgroundConversationWork.conversationId,
                      )
                    ) {
                      setBackgroundWorkOpen(false);
                    }
                  }}
                >
                  <Button danger>停止并删除</Button>
                </Popconfirm>
                <Button
                  type="primary"
                  onClick={() => {
                    if (
                      onOpenConversation(
                        backgroundConversationWork.conversationId,
                      )
                    ) {
                      setBackgroundWorkOpen(false);
                    }
                  }}
                >
                  进入处理
                </Button>
              </div>
            </section>
          </>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="当前没有其他对话在后台执行"
          />
        )}
      </Drawer>
      <Drawer
        className="delegated-inbox-drawer"
        title="Codex 收件箱"
        placement="right"
        width="min(440px, calc(100vw - 20px))"
        open={delegatedInboxOpen}
        onClose={() => setDelegatedInboxOpen(false)}
      >
        <Typography.Paragraph type="secondary" className="delegated-inbox-note">
          每个 MCP 任务按 taskId 独立保留。原对话删除后可恢复到新的干净对话，后续更新不会串入别的聊天。
        </Typography.Paragraph>
        <div className="delegated-inbox-list">
          {delegatedInboxTasks.map((task) => (
            <div className="delegated-inbox-item" key={task.taskId}>
              <DelegatedTaskCard
                task={task}
                orphaned={isDelegatedTaskOrphaned(
                  task,
                  conversations.map((conversation) => conversation.id),
                )}
                active={activeDelegatedTaskId === task.taskId}
                queued={queuedMessages.some(
                  (submission) =>
                    submission.delegatedTask?.taskId === task.taskId,
                )}
                loading={delegatedTaskActionIds.has(task.taskId)}
                copied={copiedMessageId === task.requestItem.id}
                onCopy={() => void copyDelegatedTask(task)}
                onAccept={onAcceptDelegatedTask}
                onRestore={onRestoreDelegatedTask}
                onReject={onRejectDelegatedTask}
              />
            </div>
          ))}
        </div>
      </Drawer>
      <Drawer
        className="chat-history-drawer"
        title="本地对话"
        placement="right"
        width="min(360px, calc(100vw - 24px))"
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
      >
        <Typography.Paragraph type="secondary" className="chat-history-note">
          仅保存在当前 Chrome Profile。工具原始结果、运行状态和图片不会写入历史。
        </Typography.Paragraph>
        <Input
          allowClear
          value={historyQuery}
          onChange={(event) => setHistoryQuery(event.target.value)}
          placeholder="搜索标题、消息或草稿"
          aria-label="搜索本地对话"
          className="chat-history-search"
        />
        {conversations.length ? (
          <div className="chat-history-list">
            {filteredConversations.map((conversation) => {
              const active = conversation.id === activeConversationId;
              return (
                <div
                  className={`chat-history-item${active ? " is-active" : ""}`}
                  key={conversation.id}
                >
                  <button
                    className="chat-history-main"
                    type="button"
                    disabled={active}
                    onClick={() => {
                      if (onOpenConversation(conversation.id)) {
                        setHistoryOpen(false);
                      }
                    }}
                  >
                    <span className="chat-history-title">{conversation.title}</span>
                    <span className="chat-history-meta">
                      {formatConversationTime(conversation.updatedAt)} · {conversation.messageCount} 条
                      {conversation.hasDraft ? " · 有草稿" : ""}
                      {conversation.forked ? " · 分支" : ""}
                    </span>
                  </button>
                  <div className="chat-history-actions">
                    {active ? <Tag color="blue">当前</Tag> : null}
                    <Tooltip title="导出 Markdown">
                      <Button
                        size="small"
                        type="text"
                        icon={<DownloadOutlined />}
                        onClick={() =>
                          downloadTextFile(
                            conversation.exportMarkdown,
                            `${conversation.title}.md`,
                            "text/markdown;charset=utf-8",
                          )
                        }
                        aria-label={`导出对话 ${conversation.title} 为 Markdown`}
                      />
                    </Tooltip>
                    <Tooltip title="导出 JSON">
                      <Button
                        size="small"
                        type="text"
                        onClick={() =>
                          downloadTextFile(
                            conversation.exportJson,
                            `${conversation.title}.json`,
                            "application/json;charset=utf-8",
                          )
                        }
                        aria-label={`导出对话 ${conversation.title} 为 JSON`}
                      >
                        JSON
                      </Button>
                    </Tooltip>
                    {!active ? (
                    <Popconfirm
                      title="删除这条本地对话？"
                      description="只删除扩展本地保存的文本历史。"
                      okText="删除"
                      cancelText="取消"
                      onConfirm={() => onDeleteConversation(conversation.id)}
                    >
                      <Button
                        size="small"
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        aria-label={`删除对话 ${conversation.title}`}
                      />
                    </Popconfirm>
                    ) : null}
                  </div>
                </div>
              );
            })}
            {filteredConversations.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="没有匹配的对话"
              />
            ) : null}
          </div>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无本地对话" />
        )}
      </Drawer>
    </div>
  );
}

function formatDelegatedTaskClipboard(task: DelegatedTaskSnapshot): string {
  const criteria = task.request.acceptanceCriteria.length
    ? `\n\n完成标准：\n${task.request.acceptanceCriteria
        .map((criterion) => `- ${criterion}`)
        .join("\n")}`
    : "";
  const events = task.events.length
    ? `\n\n进度记录：\n${task.events
        .map(
          ({ content }) =>
            `- [${content.eventType}] ${content.message}${
              content.progress !== undefined ? ` (${content.progress}%)` : ""
            }`,
        )
        .join("\n")}`
    : "";
  return `${task.requestItem.title}\n\n${task.request.instruction}${criteria}${events}`;
}

function RetryMessageAction({
  assistantMessageId,
  attachmentCount,
  disabled,
  onRetryMessage,
}: {
  assistantMessageId: string;
  attachmentCount: number;
  disabled: boolean;
  onRetryMessage: (assistantMessageId: string) => boolean;
}) {
  const button = (
    <Button
      className="chat-message-action"
      size="small"
      type="text"
      icon={<RedoOutlined />}
      onClick={
        attachmentCount > 0
          ? undefined
          : () => onRetryMessage(assistantMessageId)
      }
      disabled={disabled}
      aria-label="安全重试这条回复"
    />
  );

  if (attachmentCount === 0) {
    return (
      <Tooltip title="安全重试：新分支中关闭页面、工具和联网">
        {button}
      </Tooltip>
    );
  }

  return (
    <Popconfirm
      title="重新发送原附件？"
      description={`安全重试会把原问题和 ${attachmentCount} 张图片再次发送给当前 AI；不会读取页面、调用工具或联网。`}
      okText="确认重试"
      cancelText="取消"
      onConfirm={() => onRetryMessage(assistantMessageId)}
      disabled={disabled}
    >
      <Tooltip title="安全重试需要重新发送原附件">
        {button}
      </Tooltip>
    </Popconfirm>
  );
}

function getRetrySourceAttachmentCount(
  messages: ChatMessage[],
  assistantIndex: number,
): number {
  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user") {
      return message.attachments?.length ?? 0;
    }
  }
  return 0;
}

function AgentBudgetExtensionCard({
  request,
  onResolve,
}: {
  request: AgentRunBudgetExtensionRequest;
  onResolve: (decision: AgentRunBudgetExtensionDecision) => void;
}) {
  const titleId = `agent-budget-title-${request.kind}`;
  const descriptionId = `agent-budget-description-${request.kind}`;
  const cardRef = useRef<HTMLElement>(null);

  useEffect(() => {
    cardRef.current?.focus({ preventScroll: true });
  }, [request.kind, request.limit]);

  return (
    <section
      ref={cardRef}
      className="agent-budget-extension-card"
      role="alertdialog"
      aria-live="assertive"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      tabIndex={-1}
    >
      <div className="agent-budget-extension-heading">
        <div className="tool-approval-title">
          <ClockCircleOutlined />
          <span id={titleId}>任务需要更多执行额度</span>
        </div>
        <Tag color="blue">{request.label}</Tag>
      </div>
      <div className="agent-budget-extension-body">
        <Typography.Paragraph
          id={descriptionId}
          className="agent-budget-extension-copy"
        >
          当前任务和工具结果均已保留。你可以增加
          {formatAgentRunBudgetAmount(request.kind, request.increment)} 后从当前步骤继续，
          或停止调用工具并基于已有结果总结。
        </Typography.Paragraph>
        <div className="agent-budget-extension-meter" role="note">
          已用 {formatAgentRunBudgetAmount(request.kind, request.used)} · 当前上限{" "}
          {formatAgentRunBudgetAmount(request.kind, request.limit)} · 继续后上限{" "}
          {formatAgentRunBudgetAmount(request.kind, request.nextLimit)}
        </div>
        <Typography.Text type="secondary">
          该确认不会自动消失；具体页面写操作仍按原权限规则审批。
        </Typography.Text>
        <div className="agent-budget-extension-actions">
          <Button onClick={() => onResolve("summarize")}>停止并总结</Button>
          <Button type="primary" onClick={() => onResolve("continue")}>
            增加额度并继续
          </Button>
        </div>
      </div>
    </section>
  );
}

function ToolApprovalCard({
  approval,
  onResolve,
}: {
  approval: PendingToolApproval;
  onResolve: (decision: ToolApprovalDecision) => void;
}) {
  const titleId = `tool-approval-title-${approval.id}`;
  const descriptionId = `tool-approval-description-${approval.id}`;
  const cardRef = useRef<HTMLElement>(null);
  const [argumentsExpanded, setArgumentsExpanded] = useState(false);
  const formattedArguments = useMemo(
    () => formatApprovalArguments(approval.arguments),
    [approval.arguments],
  );

  useEffect(() => {
    cardRef.current?.focus({ preventScroll: true });
    setArgumentsExpanded(false);
  }, [approval.id]);

  const isDecisionBarrier =
    approval.approvalMode === "decision_barrier" ||
    approval.approvalMode === "always";
  const policyDescription = formatApprovalPolicyDescription(
    approval,
    isDecisionBarrier,
  );

  return (
    <section
      ref={cardRef}
      className="tool-approval-card"
      role="alertdialog"
      aria-live="assertive"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      tabIndex={-1}
    >
      <div className="tool-approval-attention">
        <div className="tool-approval-title">
          <ToolOutlined />
          <span id={titleId}>需要你的确认</span>
        </div>
        <Tag color="orange">{approval.toolName}</Tag>
      </div>
      <div className="tool-approval-body">
        <Typography.Paragraph
          id={descriptionId}
          className="tool-approval-copy"
        >
          Agent 正在等待授权，确认前不会继续执行这个操作。
        </Typography.Paragraph>
        <div
          className={`tool-approval-policy ${
            isDecisionBarrier ? "is-decision-barrier" : "is-task-grant"
          }`}
          role="note"
        >
          <strong>
            {isDecisionBarrier
              ? "高风险操作 · 必须逐次确认"
              : "普通操作 · 可由当前聊天授权覆盖"}
          </strong>
          <span>{policyDescription}</span>
        </div>
        {approval.allowForConversationOriginAvailable &&
        approval.conversationOrigin ? (
          <div className="tool-approval-run-scope" role="note">
            选择“替我审批并继续”后，当前聊天可在
            <strong> {approval.conversationOrigin} </strong>
            自动批准普通页面操作、视觉观察和聚合 Network 证据。切换聊天、域名、
            Profile、Provider 或关闭开关后立即失效；提交、发送、删除、敏感字段、
            原始响应体和规则修改仍会逐次确认。
          </div>
        ) : null}
        {approval.requester ? (
          <div className="tool-approval-provenance">
            <Typography.Text type="secondary">
              来源：{approval.requester.role} · 连接 {approval.requester.connectionId.slice(0, 12)}
            </Typography.Text>
            {approval.target ? (
              <Typography.Text type="secondary">
                目标：tab {approval.target.tabId ?? "?"} / frame {approval.target.frameId ?? 0}
                {approval.target.documentId
                  ? ` / document ${approval.target.documentId.slice(0, 12)}`
                  : ""}
              </Typography.Text>
            ) : null}
          </div>
        ) : null}
        {approval.preview ? (
          <div className="tool-approval-preview">
            <Typography.Text>{approval.preview.summary}</Typography.Text>
            {[...approval.preview.sideEffects, ...approval.preview.egress].map(
              (item) => (
                <Typography.Text key={item} type="warning">
                  {item}
                </Typography.Text>
              ),
            )}
          </div>
        ) : null}
        {approval.egressDestinations?.length ? (
          <div className="tool-approval-preview">
            <Typography.Text>出站目标</Typography.Text>
            {approval.egressDestinations.map((destination) => (
              <Typography.Text key={destination} type="warning">
                {destination}
              </Typography.Text>
            ))}
          </div>
        ) : null}
        <div className="tool-approval-args-section">
          <div className="tool-approval-args-heading">
            <Typography.Text strong>操作参数</Typography.Text>
            <Typography.Text type="secondary">
              {formattedArguments.length} 字符
            </Typography.Text>
            <Button
              type="text"
              size="small"
              icon={
                <RightOutlined
                  className={`disclosure-chevron${argumentsExpanded ? " is-expanded" : ""}`}
                  aria-hidden="true"
                />
              }
              onClick={() => setArgumentsExpanded((current) => !current)}
              aria-expanded={argumentsExpanded}
              aria-controls={`tool-approval-args-${approval.id}`}
            >
              {argumentsExpanded ? "收起" : "展开"}
            </Button>
          </div>
          {argumentsExpanded ? (
            <pre
              id={`tool-approval-args-${approval.id}`}
              className="tool-approval-args"
              tabIndex={0}
              aria-label={`${approval.toolName} 操作参数`}
            >
              {formattedArguments}
            </pre>
          ) : null}
        </div>
        <div className="tool-approval-actions">
          <Button danger onClick={() => onResolve("deny")}>拒绝</Button>
          <Button onClick={() => onResolve("allow_once")}>仅本次允许</Button>
          {approval.allowForConversationOriginAvailable &&
          approval.conversationOrigin ? (
            <Tooltip title="仅当前聊天与当前域名；可随时通过输入框上方的开关关闭">
              <Button
                type="primary"
                onClick={() => onResolve("allow_conversation_origin")}
                aria-label={`此聊天在 ${approval.conversationOrigin} 自动允许页面操作`}
              >
                替我审批并继续
              </Button>
            </Tooltip>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function ExecutionTargetBar({
  target,
  mode,
  foregroundTab,
  queuedCount,
  onFocus,
}: {
  target: ExecutionTaskBinding["target"];
  mode: "task" | "tool";
  foregroundTab?: BrowserTargetTab;
  queuedCount: number;
  onFocus: (tabId: number) => void;
}) {
  const viewingAnotherTab =
    foregroundTab?.id !== undefined &&
    foregroundTab.id !== target.tabId;
  const taskTitle =
    target.title?.trim() ||
    formatTaskTargetHost(target.url) ||
    `Tab ${target.tabId}`;
  const foregroundTitle =
    foregroundTab?.title?.trim() ||
    formatTaskTargetHost(foregroundTab?.url) ||
    (foregroundTab?.id ? `Tab ${foregroundTab.id}` : undefined);

  return (
    <section
      className="execution-target-bar"
      aria-label={mode === "task" ? "运行中任务目标页" : "工具调用目标页"}
    >
      <span className="execution-target-icon" aria-hidden="true">
        <AimOutlined />
      </span>
      <span className="execution-target-copy">
        <strong title={taskTitle}>
          {mode === "task" ? "后台执行" : "工具目标"} · {taskTitle}
        </strong>
        <span>
          {viewingAnotherTab
            ? mode === "task"
              ? `当前浏览：${foregroundTitle}；新消息将作为独立任务排队到此页`
              : `当前浏览：${foregroundTitle}；后续工具调用仍发送到此页`
            : `任务固定在 Tab ${target.tabId}${
                queuedCount ? ` · 队列 ${queuedCount}` : ""
              }`}
        </span>
      </span>
      {viewingAnotherTab ? (
        <Button
          size="small"
          onClick={() => onFocus(target.tabId)}
          aria-label={`返回${mode === "task" ? "运行中的任务" : "工具目标"}页面 ${taskTitle}`}
        >
          返回
        </Button>
      ) : null}
    </section>
  );
}

function ActivityMonitorBar({
  cursor,
  target,
  health,
  latestSequence,
  action,
  onRestart,
  onStop,
}: {
  cursor: BrowserActivityCursor;
  target?: { tabId: number; title?: string; url?: string };
  health: "active" | "offline" | "stopped" | "restarted";
  latestSequence?: number;
  action?: "restart" | "stop";
  onRestart: () => void;
  onStop: () => void;
}) {
  const targetLabel =
    target?.title?.trim() ||
    formatTaskTargetHost(target?.url) ||
    (target ? `Tab ${target.tabId}` : "已绑定页面");
  const streamLabel = cursor.streamId.slice(-8);
  const statusLabel =
    health === "active"
      ? "页面监听中"
      : health === "offline"
        ? "Hub 离线，监听待恢复"
        : health === "restarted"
          ? "监听流已变化，需要重启"
          : "页面监听已停止";

  return (
    <section
      className={`activity-monitor-bar${health === "active" ? "" : " is-warning"}`}
      aria-label="页面变化监听状态"
    >
      <span className="activity-monitor-dot" aria-hidden="true" />
      <span className="activity-monitor-copy">
        <strong>{statusLabel}</strong>
        <span title={targetLabel}>
          {targetLabel} · seq {latestSequence ?? cursor.sequence} · {streamLabel}
        </span>
      </span>
      <div className="activity-monitor-actions">
        <Tooltip title="在当前绑定 Tab 上重新建立一条干净监听流">
          <Button
            size="small"
            type="text"
            icon={<RedoOutlined />}
            loading={action === "restart"}
            disabled={Boolean(action)}
            onClick={onRestart}
            aria-label="重启页面变化监听"
          />
        </Tooltip>
        <Tooltip title="停止这条页面变化监听">
          <Button
            size="small"
            type="text"
            icon={<StopOutlined />}
            loading={action === "stop"}
            disabled={Boolean(action)}
            onClick={onStop}
            aria-label="停止页面变化监听"
          />
        </Tooltip>
      </div>
    </section>
  );
}

function formatTaskTargetHost(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

function ExecutionApprovalModeBar({
  mode,
  scopeLabel,
  onChange,
}: {
  mode: ExecutionApprovalMode;
  scopeLabel?: string;
  onChange: (mode: ExecutionApprovalMode) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const options: Array<{
    key: ExecutionApprovalMode;
    title: string;
    description: string;
    icon: ReactNode;
  }> = [
    {
      key: "ask",
      title: "请求批准",
      description: "受控读取、页面修改和外部副作用始终询问",
      icon: <ExclamationCircleOutlined />,
    },
    {
      key: "agent",
      title: "替我审批",
      description: "普通可恢复操作自动继续，风险操作仍请求批准",
      icon: <SafetyCertificateOutlined />,
    },
    {
      key: "full",
      title: "完全访问权限",
      description: "绑定当前聊天和目标 Tab，跨域登录不重置",
      icon: <GlobalOutlined />,
    },
  ];
  const active = options.find((option) => option.key === mode) ?? options[0]!;

  return (
    <Dropdown
      open={menuOpen}
      onOpenChange={setMenuOpen}
      trigger={["click"]}
      placement="topRight"
      menu={{
        selectable: true,
        selectedKeys: [mode],
        items: options.map((option) => ({
          key: option.key,
          icon: option.icon,
          label: (
            <span className="execution-approval-menu-label">
              <strong>{option.title}</strong>
              <span>{option.description}</span>
            </span>
          ),
        })),
        onClick: ({ key }) => {
          onChange(key as ExecutionApprovalMode);
          setMenuOpen(false);
        },
      }}
    >
      <button
        type="button"
        className={`execution-approval-mode is-${mode}`}
        aria-label={`切换执行审批模式，当前为${active.title}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        <span className="execution-approval-mode-copy" aria-live="polite">
          {active.icon}
          <span>
            <strong>{active.title}</strong>
            <span className="execution-approval-mode-scope">
              {mode === "ask"
                ? active.description
                : `${scopeLabel ?? "当前页面"} · 当前聊天`}
            </span>
          </span>
        </span>
        <span
          className={`execution-approval-mode-chevron${menuOpen ? " is-expanded" : ""}`}
          aria-hidden="true"
        >
          <DownOutlined />
        </span>
      </button>
    </Dropdown>
  );
}

function formatApprovalArguments(args: Record<string, unknown>): string {
  try {
    return JSON.stringify(args ?? {}, null, 2);
  } catch {
    return "{}";
  }
}

function formatApprovalPolicyDescription(
  approval: PendingToolApproval,
  isDecisionBarrier: boolean,
): string {
  if (isDecisionBarrier) {
    return "运行时将提交、发送、删除、持久化、敏感输入或无法确认目标语义的操作视为高风险；当前聊天授权不会跳过本次确认。";
  }
  if (approval.toolName === "browser_debug_activity") {
    return "只读取聚合后的 Network 活动摘要和脱敏 Console；不包含原始请求、响应体、Header 或 Storage 值。";
  }
  if (approval.toolName === "browser_take_screenshot") {
    return "读取当前页面像素作为视觉证据，不会保存到 Chrome 下载目录。";
  }
  if (approval.policyClass === "page_action") {
    return "当前调用属于普通页面交互；授权后，同一聊天和域名内的同类低风险操作可自动执行。";
  }
  return "当前调用属于受限的页面证据读取或可撤销操作，可由同一聊天和域名的普通操作授权覆盖。";
}

function renderRichContent(content: string): ReactNode {
  return <MarkdownContent content={content} />;
}

function visibleMessageContent(
  message: ChatMessage,
  allowEmpty = false,
): string {
  return message.role === "assistant"
    ? getAssistantDisplayContent(message.content, { allowEmpty })
    : message.content;
}

function renderImageAttachments(attachments: ChatImageAttachment[]): ReactNode {
  return (
    <div className="message-images">
      {attachments.map((attachment) => (
        <div className="message-image-card" key={attachment.id}>
          <Image
            src={attachment.dataUrl}
            alt={attachment.name}
            className="message-image"
          />
          <div className="message-image-meta">
            <span title={attachment.savedAs || attachment.name}>
              {attachment.savedAs ? `已保存: ${attachment.savedAs}` : attachment.name}
            </span>
            <Tooltip title="下载图片">
              <button type="button" onClick={() => downloadDataUrl(attachment.dataUrl, attachment.name)}>
                <DownloadOutlined />
              </button>
            </Tooltip>
          </div>
        </div>
      ))}
    </div>
  );
}

function getToolMessageSummary(message: ChatMessage): string {
  const { content, toolResultMeta } = message;
  const parsed = parseJsonObject(content);
  const size = toolResultMeta
    ? toolResultMeta.truncated
      ? ` · ${formatCharCount(toolResultMeta.displayedSourceCharCount)}/${formatCharCount(toolResultMeta.originalCharCount)} · 已截断`
      : ` · ${formatCharCount(toolResultMeta.originalCharCount)} · 完整`
    : ` · ${formatCharCount(content.length)}`;
  if (parsed) {
    const count = typeof parsed.count === "number" ? ` · ${parsed.count} matches` : "";
    const returned =
      typeof parsed.returnedCount === "number"
        ? ` · ${parsed.returnedCount} returned`
        : "";
    const truncated =
      parsed.truncated === true
        ? " · 数据源已截断"
        : parsed.truncated === false
          ? " · 数据源完整"
          : "";
    const query = typeof parsed.query === "string" ? ` · ${parsed.query}` : "";
    const patchId = typeof parsed.patchId === "string" ? ` · ${parsed.patchId}` : "";
    return `工具结果已收起${count}${returned}${truncated}${query}${patchId}${size}`;
  }

  return `工具结果已收起${size}`;
}

function getExpandedToolResultLabel(message: ChatMessage): string {
  const meta = message.toolResultMeta;
  if (!meta) {
    return `结果 · ${formatCharCount(message.content.length)}`;
  }
  if (meta.truncated) {
    return `已显示 ${formatCharCount(meta.displayedSourceCharCount)} / 原始 ${formatCharCount(meta.originalCharCount)}`;
  }
  return `完整结果 · ${formatCharCount(meta.originalCharCount)}`;
}

function formatCharCount(count: number): string {
  return count >= 1000 ? `${Math.round(count / 100) / 10}k chars` : `${count} chars`;
}

const TOOL_RESULT_VIRTUAL_LINE_THRESHOLD = 240;
const TOOL_RESULT_LINE_HEIGHT = 19;
const TOOL_RESULT_VIEWPORT_HEIGHT = 342;
const TOOL_RESULT_OVERSCAN_LINES = 12;

function IssueEvidenceWorkbench({
  content,
  copiedId,
  messageId,
  onCopy,
}: {
  content: string;
  copiedId?: string;
  messageId: string;
  onCopy: (copyId: string, value: string) => Promise<void>;
}) {
  const parsed = parseJsonObject(content);
  const timeline = Array.isArray(parsed?.timeline)
    ? parsed.timeline.filter(
        (entry): entry is Record<string, unknown> =>
          typeof entry === "object" && entry !== null && !Array.isArray(entry),
      )
    : [];
  const exportValue =
    parsed?.export &&
    typeof parsed.export === "object" &&
    !Array.isArray(parsed.export)
      ? (parsed.export as Record<string, unknown>)
      : {};
  const markdown =
    typeof exportValue.markdown === "string" ? exportValue.markdown : "";
  const markdownCopyId = `${messageId}:markdown`;
  const jsonCopyId = `${messageId}:json`;

  if (!parsed || timeline.length === 0) {
    return <ToolResultViewport content={content} />;
  }

  return (
    <div className="issue-evidence-workbench">
      <div className="issue-evidence-summary">
        <div>
          <strong>{String(parsed.title ?? "问题证据包")}</strong>
          <span>{String(parsed.workflowStatus ?? "unknown")}</span>
        </div>
        <div className="issue-evidence-actions">
          <Button
            size="small"
            onClick={() => void onCopy(markdownCopyId, markdown)}
            disabled={!markdown}
          >
            {copiedId === markdownCopyId ? "Markdown 已复制" : "复制 Markdown"}
          </Button>
          <Button
            size="small"
            onClick={() => void onCopy(jsonCopyId, content)}
          >
            {copiedId === jsonCopyId ? "JSON 已复制" : "复制 JSON"}
          </Button>
        </div>
      </div>
      <ol className="issue-evidence-timeline">
        {timeline.map((entry, index) => (
          <li key={`${String(entry.id ?? entry.type ?? "event")}:${index}`}>
            <span
              className={`issue-evidence-dot is-${String(
                entry.status ?? "unknown",
              )}`}
              aria-hidden="true"
            />
            <div>
              <strong>{String(entry.label ?? entry.type ?? "事件")}</strong>
              <span>{String(entry.status ?? "unknown")}</span>
              {typeof entry.detail === "string" ? (
                <p>{entry.detail}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
      <details className="issue-evidence-raw">
        <summary>查看原始证据 JSON</summary>
        <ToolResultViewport content={content} />
      </details>
    </div>
  );
}

function ToolResultViewport({ content }: { content: string }) {
  const lines = useMemo(() => content.split("\n"), [content]);
  const [scrollTop, setScrollTop] = useState(0);
  const virtualized = lines.length > TOOL_RESULT_VIRTUAL_LINE_THRESHOLD;

  if (!virtualized) {
    return (
      <pre className="tool-result-viewport" tabIndex={0}>
        <code>{content}</code>
      </pre>
    );
  }

  const firstVisibleLine = Math.floor(scrollTop / TOOL_RESULT_LINE_HEIGHT);
  const visibleLineCount = Math.ceil(
    TOOL_RESULT_VIEWPORT_HEIGHT / TOOL_RESULT_LINE_HEIGHT,
  );
  const start = Math.max(0, firstVisibleLine - TOOL_RESULT_OVERSCAN_LINES);
  const end = Math.min(
    lines.length,
    firstVisibleLine + visibleLineCount + TOOL_RESULT_OVERSCAN_LINES,
  );

  return (
    <div
      className="tool-result-viewport is-virtualized"
      role="region"
      aria-label={`虚拟滚动工具结果，共 ${lines.length} 行`}
      tabIndex={0}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div
        className="tool-result-virtual-surface"
        style={{ height: lines.length * TOOL_RESULT_LINE_HEIGHT }}
      >
        {lines.slice(start, end).map((line, index) => {
          const lineNumber = start + index;
          return (
            <div
              className="tool-result-line"
              key={lineNumber}
              style={{
                transform: `translateY(${lineNumber * TOOL_RESULT_LINE_HEIGHT}px)`,
              }}
            >
              {line || " "}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatConversationTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "时间未知";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function parseJsonObject(content: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(content) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function DelegatedTaskCard({
  task,
  orphaned = false,
  active,
  queued,
  loading,
  copied,
  onCopy,
  onAccept,
  onRestore,
  onReject,
}: {
  task: DelegatedTaskSnapshot;
  orphaned?: boolean;
  active: boolean;
  queued: boolean;
  loading: boolean;
  copied: boolean;
  onCopy: () => void;
  onAccept: (taskId: string, resume: boolean) => void;
  onRestore: (taskId: string) => void;
  onReject: (taskId: string) => void;
}) {
  const phaseLabels = {
    pending: "待确认",
    claimed: active ? "执行中" : queued ? "排队中" : "待恢复",
    completed: "已完成",
    failed: "未完成",
    rejected: "已拒绝",
    cancelled: "已取消",
  } as const;
  const requestTypeLabel = task.request.requestType === "question" ? "问题" : "任务";
  const isInterrupted =
    task.phase === "claimed" && !active && !queued && !orphaned;

  return (
    <div className={`delegated-task-card is-${task.phase}`}>
      <div className="delegated-task-header">
        <span className="delegated-task-source-icon" aria-hidden="true">
          <ApiOutlined />
        </span>
        <div className="delegated-task-heading">
          <span className="delegated-task-source">Codex · MCP / {requestTypeLabel}</span>
          <Typography.Text className="delegated-task-title" strong>
            {task.requestItem.title}
          </Typography.Text>
        </div>
        <Tag className={`delegated-task-phase is-${task.phase}`}>
          {phaseLabels[task.phase]}
        </Tag>
        <Tooltip title={copied ? "已复制" : "复制委托内容"}>
          <Button
            className="delegated-task-copy"
            size="small"
            type="text"
            icon={copied ? <CheckOutlined /> : <CopyOutlined />}
            onClick={onCopy}
            aria-label="复制委托内容"
          />
        </Tooltip>
      </div>

      <div className="delegated-task-body">
        <div className="delegated-task-instruction">
          <MarkdownContent content={task.request.instruction} />
        </div>
        {task.request.acceptanceCriteria.length ? (
          <div className="delegated-task-criteria">
            <span className="delegated-task-criteria-label">完成标准</span>
            <ul>
              {task.request.acceptanceCriteria.map((criterion, index) => (
                <li key={`${index}:${criterion}`}>{criterion}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {task.events.length ? (
          <div className="delegated-task-events" aria-label="委托任务进度">
            <span className="delegated-task-criteria-label">协作进度</span>
            {task.events.map(({ item, content }) => (
              <div className="delegated-task-event" key={item.id}>
                <div className="delegated-task-event-heading">
                  <span>{delegatedTaskEventLabel(content.eventType)}</span>
                  {content.progress !== undefined ? (
                    <span>{Math.round(content.progress)}%</span>
                  ) : null}
                </div>
                <div>{content.message}</div>
                {content.requirements?.length ? (
                  <ul>
                    {content.requirements.map((requirement) => (
                      <li key={requirement}>{requirement}</li>
                    ))}
                  </ul>
                ) : null}
                {content.artifactUris?.length ? (
                  <div className="delegated-task-artifacts">
                    {content.artifactUris.map((uri) => (
                      <code key={uri}>{uri}</code>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
        {isInterrupted ? (
          <div className="delegated-task-notice is-warning">
            上次运行已中断。恢复时会先重新观察页面，不会自动重放结果未知的写操作。
          </div>
        ) : null}
        {orphaned ? (
          <div className="delegated-task-notice is-warning">
            原本地对话已删除。MCP 任务和后续更新仍按 taskId 保留；可恢复到新的干净对话，也可直接关闭任务。
          </div>
        ) : null}
        {task.result?.summary ? (
          <div
            className={`delegated-task-notice is-${task.phase === "completed" ? "success" : "neutral"}`}
          >
            {task.phase === "completed" ? (
              "插件 AI 已完成，结果已返回 Codex。"
            ) : (
              <MarkdownContent content={task.result.summary} />
            )}
          </div>
        ) : null}
      </div>

      <div className="delegated-task-footer">
        <div className="delegated-task-scope">
          <span>
            <AimOutlined />
            {task.requestItem.target ? "当前页面" : "当前 Profile"}
          </span>
          <span>
            <SafetyCertificateOutlined />
            写操作仍需审批
          </span>
        </div>
        {task.phase === "pending" ? (
          <div className="delegated-task-buttons">
            <Button disabled={loading} onClick={() => onReject(task.taskId)}>
              拒绝
            </Button>
            <Button
              type="primary"
              loading={loading}
              onClick={() => onAccept(task.taskId, false)}
            >
              接受并运行
            </Button>
          </div>
        ) : null}
        {orphaned ? (
          <div className="delegated-task-buttons">
            <Popconfirm
              title="关闭这个任务？"
              description="任务会标记为已取消并通知 Codex，不会删除已产生的浏览器操作。"
              okText="关闭任务"
              cancelText="返回"
              okButtonProps={{ danger: true }}
              onConfirm={() => onReject(task.taskId)}
            >
              <Button danger disabled={loading} icon={<DeleteOutlined />}>
                关闭任务
              </Button>
            </Popconfirm>
            <Button
              type="primary"
              loading={loading}
              onClick={() => onRestore(task.taskId)}
            >
              恢复到新对话
            </Button>
          </div>
        ) : isInterrupted ? (
          <Button
            loading={loading}
            onClick={() => onAccept(task.taskId, true)}
          >
            重新检查并恢复
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function delegatedTaskEventLabel(
  eventType: DelegatedTaskSnapshot["events"][number]["content"]["eventType"],
): string {
  return {
    progress: "进度",
    clarification: "澄清问题",
    requirement: "追加要求",
    evidence: "证据附件",
  }[eventType];
}

function PermissionSwitch({
  icon,
  label,
  checked,
  disabled,
  tooltip,
  onChange,
}: {
  icon: ReactNode;
  label: string;
  checked: boolean;
  disabled?: boolean;
  tooltip: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <Tooltip title={tooltip}>
      <label className={`permission-switch${disabled ? " is-disabled" : ""}`}>
        <span className="permission-switch-label">
          {icon}
          <span>{label}</span>
        </span>
        <Switch
          size="small"
          checked={checked}
          disabled={disabled}
          onChange={onChange}
        />
      </label>
    </Tooltip>
  );
}

function downloadDataUrl(dataUrl: string, filename: string): void {
  const anchor = document.createElement("a");
  anchor.href = dataUrl;
  anchor.download = sanitizeDownloadName(filename);
  anchor.rel = "noreferrer";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function downloadTextFile(
  content: string,
  filename: string,
  mimeType: string,
): void {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = sanitizeDownloadName(filename);
  anchor.rel = "noreferrer";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function sanitizeDownloadName(filename: string): string {
  const trimmed = filename.trim() || "image.png";
  return trimmed.replace(/[<>:"|?*\x00-\x1f]/g, "-");
}

function fileToAttachment(file: File): Promise<ChatImageAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve({
        id: createMessageId(),
        name: file.name,
        mimeType: file.type || "image/png",
        dataUrl: String(reader.result),
        createdAt: new Date().toISOString(),
        source: "upload"
      });
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read image."));
    reader.readAsDataURL(file);
  });
}
