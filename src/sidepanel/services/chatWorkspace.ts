import type { ChatMessage } from "../types";
import type { BrowserActivityCursor } from "../../shared/browserActivity";
import {
  normalizeExternalMcpSelection,
  type ExternalMcpSelection,
} from "../../shared/externalMcp";
import { isGeneratedMcpCapabilityGreeting } from "./mcpCapabilityGreeting";
import { redactSensitiveData } from "../../shared/sensitiveData";
import { sanitizeMultilineText } from "../../shared/sanitize";

export const CHAT_WORKSPACE_STORAGE_KEY = "aiDevtools.chatWorkspaceV1";
export const MAX_STORED_CONVERSATIONS = 20;
export const MAX_STORED_MESSAGES = 80;
export const MAX_STORED_MESSAGE_CHARS = 12_000;
export const MAX_STORED_DRAFT_CHARS = 12_000;
export const DEFAULT_CHAT_GREETING = "AI DevTools Assistant 已就绪。";
const MAX_CONVERSATION_CHARS = 240_000;
const MAX_STORED_TOOL_MESSAGES = 48;
const FALLBACK_STORAGE_KEY = "ai-devtools-assistant.chat-workspace-v1";
let workspaceSaveQueue: Promise<void> = Promise.resolve();

export interface StoredChatMessage {
  id: string;
  runId?: string;
  turnId?: string;
  toolCallId?: string;
  assistantMessageId?: string;
  conversationId?: string;
  role: "user" | "assistant" | "tool";
  content: string;
  createdAt: string;
  model?: string;
  source?: "user" | "extension_ai" | "mcp_ai" | "system";
  toolName?: string;
  toolSource?: "builtin" | "external_mcp";
  toolDisplayName?: string;
  toolServerName?: string;
  toolRequestArguments?: string;
  toolResultMeta?: ChatMessage["toolResultMeta"];
}

export interface StoredConversationTarget {
  tabId: number;
  windowId?: number;
  targetId?: string;
  title?: string;
  url?: string;
}

export interface StoredChatConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: StoredChatMessage[];
  draft: string;
  target?: StoredConversationTarget;
  activityCursor?: BrowserActivityCursor;
  externalMcpSelection?: ExternalMcpSelection;
  forkedFromConversationId?: string;
  forkedFromMessageId?: string;
}

export interface ChatWorkspaceState {
  version: 1;
  activeConversationId?: string;
  conversations: StoredChatConversation[];
}

export function clearUnavailableConversationTarget(
  conversation: StoredChatConversation,
  expectedTabId: number,
): StoredChatConversation {
  if (conversation.target?.tabId !== expectedTabId) {
    return conversation;
  }
  const {
    target: _unavailableTarget,
    activityCursor: _unavailableActivityCursor,
    ...rest
  } = conversation;
  return rest;
}

export function conversationSearchText(
  conversation: StoredChatConversation,
): string {
  return [
    conversation.title,
    conversation.draft,
    ...conversation.messages.map((message) => message.content),
  ]
    .join("\n")
    .toLocaleLowerCase();
}

export function exportStoredConversation(
  conversation: StoredChatConversation,
  format: "markdown" | "json",
): string {
  if (format === "json") {
    return JSON.stringify(
      {
        version: "ai-devtools-conversation-export-v1",
        exportedAt: new Date().toISOString(),
        conversation,
      },
      null,
      2,
    );
  }
  const lines = [
    `# ${conversation.title}`,
    "",
    `- Created: ${conversation.createdAt}`,
    `- Updated: ${conversation.updatedAt}`,
    ...(conversation.forkedFromConversationId
      ? [`- Forked from: ${conversation.forkedFromConversationId}`]
      : []),
    "",
    ...conversation.messages.flatMap((message) => [
      `## ${
        message.role === "user"
          ? "用户"
          : message.role === "tool"
            ? `${message.toolSource === "external_mcp" ? "MCP" : "内置工具"} · ${message.toolDisplayName ?? message.toolName ?? "调用"}`
            : "插件 AI"
      }`,
      "",
      ...(message.role === "tool" && message.toolRequestArguments
        ? ["### 请求参数", "", "```json", message.toolRequestArguments, "```", ""]
        : []),
      message.content,
      "",
    ]),
    ...(conversation.draft
      ? ["## 未发送草稿", "", conversation.draft, ""]
      : []),
  ];
  return lines.join("\n").trimEnd();
}

export function createEmptyChatWorkspace(): ChatWorkspaceState {
  return { version: 1, conversations: [] };
}

export function createStoredConversation(params: {
  id: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  draft: string;
  target?: StoredConversationTarget;
  activityCursor?: BrowserActivityCursor;
  externalMcpSelection?: ExternalMcpSelection;
  forkedFromConversationId?: string;
  forkedFromMessageId?: string;
}): StoredChatConversation {
  const messages = sanitizeMessages(params.messages);
  const target = sanitizeConversationTarget(params.target);
  const activityCursor = sanitizeActivityCursor(params.activityCursor);
  const externalMcpSelection = normalizeExternalMcpSelection(
    params.externalMcpSelection,
  );
  return {
    id: sanitizeIdentifier(params.id),
    title: deriveConversationTitle(messages),
    createdAt: sanitizeTimestamp(params.createdAt),
    updatedAt: sanitizeTimestamp(params.updatedAt),
    messages,
    draft: sanitizeText(params.draft, MAX_STORED_DRAFT_CHARS),
    ...(target ? { target } : {}),
    ...(activityCursor !== undefined ? { activityCursor } : {}),
    externalMcpSelection,
    ...(params.forkedFromConversationId
      ? {
          forkedFromConversationId: sanitizeIdentifier(
            params.forkedFromConversationId,
          ),
        }
      : {}),
    ...(params.forkedFromMessageId
      ? { forkedFromMessageId: sanitizeIdentifier(params.forkedFromMessageId) }
      : {}),
  };
}

export function upsertStoredConversation(
  conversations: StoredChatConversation[],
  conversation: StoredChatConversation,
): StoredChatConversation[] {
  return normalizeChatWorkspace({
    version: 1,
    conversations: [
      conversation,
      ...conversations.filter((candidate) => candidate.id !== conversation.id),
    ],
  }).conversations;
}

export function isEmptyStoredConversation(
  conversation: StoredChatConversation,
): boolean {
  if (
    conversation.draft.trim() ||
    conversation.target ||
    conversation.activityCursor ||
    conversation.forkedFromConversationId ||
    conversation.forkedFromMessageId
  ) {
    return false;
  }
  if (conversation.messages.length === 0) {
    return true;
  }
  if (conversation.messages.length !== 1) {
    return false;
  }
  const message = conversation.messages[0];
  return (
    message?.role === "assistant" &&
    (message.source === undefined || message.source === "extension_ai") &&
    (message.content === DEFAULT_CHAT_GREETING ||
      isGeneratedMcpCapabilityGreeting(
        message.content,
        DEFAULT_CHAT_GREETING,
      ))
  );
}

export function upsertPersistableConversation(
  conversations: StoredChatConversation[],
  conversation: StoredChatConversation,
): StoredChatConversation[] {
  if (isEmptyStoredConversation(conversation)) {
    return conversations.filter(
      (candidate) => candidate.id !== conversation.id,
    );
  }
  return upsertStoredConversation(conversations, conversation);
}

export function normalizeChatWorkspace(value: unknown): ChatWorkspaceState {
  if (!isRecord(value) || !Array.isArray(value.conversations)) {
    return createEmptyChatWorkspace();
  }

  const seenIds = new Set<string>();
  const conversations = value.conversations
    .map(normalizeStoredConversation)
    .filter((conversation): conversation is StoredChatConversation => {
      if (
        !conversation ||
        isEmptyStoredConversation(conversation) ||
        seenIds.has(conversation.id)
      ) {
        return false;
      }
      seenIds.add(conversation.id);
      return true;
    })
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, MAX_STORED_CONVERSATIONS);
  const activeConversationId = sanitizeOptionalIdentifier(
    value.activeConversationId,
  );

  return {
    version: 1,
    ...(activeConversationId &&
    conversations.some((conversation) => conversation.id === activeConversationId)
      ? { activeConversationId }
      : {}),
    conversations,
  };
}

export async function loadChatWorkspace(): Promise<ChatWorkspaceState> {
  if (hasExtensionStorage()) {
    const stored = await chrome.storage.local.get(CHAT_WORKSPACE_STORAGE_KEY);
    return normalizeChatWorkspace(stored[CHAT_WORKSPACE_STORAGE_KEY]);
  }
  if (typeof localStorage === "undefined") {
    return createEmptyChatWorkspace();
  }

  try {
    return normalizeChatWorkspace(
      JSON.parse(localStorage.getItem(FALLBACK_STORAGE_KEY) ?? "null"),
    );
  } catch {
    return createEmptyChatWorkspace();
  }
}

export async function saveChatWorkspace(
  workspace: ChatWorkspaceState,
): Promise<void> {
  const normalized = normalizeChatWorkspace(workspace);
  workspaceSaveQueue = workspaceSaveQueue
    .catch(() => undefined)
    .then(async () => {
      if (hasExtensionStorage()) {
        await chrome.storage.local.set({
          [CHAT_WORKSPACE_STORAGE_KEY]: normalized,
        });
        return;
      }
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(FALLBACK_STORAGE_KEY, JSON.stringify(normalized));
      }
    });
  return workspaceSaveQueue;
}

function normalizeStoredConversation(
  value: unknown,
): StoredChatConversation | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = sanitizeOptionalIdentifier(value.id);
  if (!id || !Array.isArray(value.messages)) {
    return null;
  }
  const messages = sanitizeMessages(value.messages);
  const createdAt = sanitizeTimestamp(value.createdAt);
  const updatedAt = sanitizeTimestamp(value.updatedAt, createdAt);
  const target = sanitizeConversationTarget(value.target);
  const activityCursor = sanitizeActivityCursor(value.activityCursor);
  const externalMcpSelection = normalizeExternalMcpSelection(
    value.externalMcpSelection,
  );
  return {
    id,
    title: deriveConversationTitle(messages),
    createdAt,
    updatedAt,
    messages,
    draft: sanitizeText(value.draft, MAX_STORED_DRAFT_CHARS),
    ...(target ? { target } : {}),
    ...(activityCursor !== undefined ? { activityCursor } : {}),
    externalMcpSelection,
    ...(sanitizeOptionalIdentifier(value.forkedFromConversationId)
      ? {
          forkedFromConversationId: sanitizeIdentifier(
            value.forkedFromConversationId,
          ),
        }
      : {}),
    ...(sanitizeOptionalIdentifier(value.forkedFromMessageId)
      ? { forkedFromMessageId: sanitizeIdentifier(value.forkedFromMessageId) }
      : {}),
  };
}

function sanitizeConversationTarget(
  value: unknown,
): StoredConversationTarget | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const tabId =
    typeof value.tabId === "number" &&
    Number.isSafeInteger(value.tabId) &&
    value.tabId > 0
      ? value.tabId
      : undefined;
  if (!tabId) {
    return undefined;
  }
  const windowId =
    typeof value.windowId === "number" &&
    Number.isSafeInteger(value.windowId) &&
    value.windowId >= 0
      ? value.windowId
      : undefined;
  const targetId = sanitizeOptionalIdentifier(value.targetId);
  const title = sanitizeText(value.title, 1_000).trim() || undefined;
  const url = sanitizeStoredTargetUrl(value.url);
  return {
    tabId,
    ...(windowId !== undefined ? { windowId } : {}),
    ...(targetId ? { targetId } : {}),
    ...(title ? { title } : {}),
    ...(url ? { url } : {}),
  };
}

function sanitizeActivityCursor(
  value: unknown,
): BrowserActivityCursor | undefined {
  if (
    !isRecord(value) ||
    typeof value.streamId !== "string" ||
    !value.streamId.trim() ||
    value.streamId.length > 200 ||
    typeof value.sequence !== "number" ||
    !Number.isSafeInteger(value.sequence) ||
    value.sequence < 0
  ) {
    return undefined;
  }
  return {
    streamId: value.streamId,
    sequence: value.sequence,
  };
}

function sanitizeStoredTargetUrl(value: unknown): string | undefined {
  const raw = sanitizeText(value, 4_000).trim();
  if (!raw) {
    return undefined;
  }
  try {
    const url = new URL(raw);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return raw.split(/[?#]/, 1)[0] || undefined;
  }
}

function sanitizeMessages(values: unknown[]): StoredChatMessage[] {
  const accepted: StoredChatMessage[] = [];
  let acceptedChars = 0;
  const indexed = values
    .map((value, index) => ({ value, index }))
    .filter(
      (entry): entry is { value: Record<string, unknown>; index: number } =>
        isRecord(entry.value) &&
        (entry.value.role === "user" ||
          entry.value.role === "assistant" ||
          entry.value.role === "tool"),
    );
  const primary = indexed
    .filter((entry) => entry.value.role !== "tool")
    .slice(-MAX_STORED_MESSAGES);
  const toolCapacity = Math.min(
    MAX_STORED_TOOL_MESSAGES,
    Math.max(0, MAX_STORED_MESSAGES - primary.length),
  );
  const tools =
    toolCapacity > 0
      ? indexed
          .filter((entry) => entry.value.role === "tool")
          .slice(-toolCapacity)
      : [];
  const candidates = [...primary, ...tools]
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.value);

  for (const value of candidates) {
    if (
      !isRecord(value) ||
      (value.role !== "user" &&
        value.role !== "assistant" &&
        value.role !== "tool")
    ) {
      continue;
    }
    const id = sanitizeOptionalIdentifier(value.id);
    const content =
      value.role === "tool"
        ? sanitizeStoredToolPayload(value.content)
        : sanitizeText(value.content, MAX_STORED_MESSAGE_CHARS);
    const toolRequestArguments = sanitizeStoredToolPayload(
      value.toolRequestArguments,
    );
    const messageChars = content.length + toolRequestArguments.length;
    if (!id || !content || acceptedChars + messageChars > MAX_CONVERSATION_CHARS) {
      continue;
    }
    acceptedChars += messageChars;
    accepted.push({
      id,
      ...(sanitizeOptionalIdentifier(value.runId)
        ? { runId: sanitizeIdentifier(value.runId) }
        : {}),
      ...(sanitizeOptionalIdentifier(value.turnId)
        ? { turnId: sanitizeIdentifier(value.turnId) }
        : {}),
      ...(sanitizeOptionalIdentifier(value.toolCallId)
        ? { toolCallId: sanitizeIdentifier(value.toolCallId) }
        : {}),
      ...(sanitizeOptionalIdentifier(value.assistantMessageId)
        ? { assistantMessageId: sanitizeIdentifier(value.assistantMessageId) }
        : {}),
      ...(sanitizeOptionalIdentifier(value.conversationId)
        ? { conversationId: sanitizeIdentifier(value.conversationId) }
        : {}),
      role: value.role,
      content,
      createdAt: sanitizeTimestamp(value.createdAt),
      ...(value.role === "assistant" && sanitizeText(value.model, 200).trim()
        ? { model: sanitizeText(value.model, 200).trim() }
        : {}),
      ...(value.source === "user" ||
      value.source === "extension_ai" ||
      value.source === "mcp_ai" ||
      value.source === "system"
        ? { source: value.source }
        : {}),
      ...(value.role === "tool" && sanitizeOptionalIdentifier(value.toolName)
        ? { toolName: sanitizeIdentifier(value.toolName) }
        : {}),
      ...(value.role === "tool" &&
      (value.toolSource === "builtin" || value.toolSource === "external_mcp")
        ? { toolSource: value.toolSource }
        : {}),
      ...(value.role === "tool" && sanitizeText(value.toolDisplayName, 200).trim()
        ? { toolDisplayName: sanitizeText(value.toolDisplayName, 200).trim() }
        : {}),
      ...(value.role === "tool" && sanitizeText(value.toolServerName, 200).trim()
        ? { toolServerName: sanitizeText(value.toolServerName, 200).trim() }
        : {}),
      ...(value.role === "tool" && toolRequestArguments
        ? { toolRequestArguments }
        : {}),
      ...(value.role === "tool" && sanitizeToolResultMeta(value.toolResultMeta)
        ? { toolResultMeta: sanitizeToolResultMeta(value.toolResultMeta) }
        : {}),
    });
  }

  return accepted;
}

function sanitizeStoredToolPayload(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  try {
    return sanitizeMultilineText(
      JSON.stringify(redactSensitiveData(JSON.parse(value)), null, 2),
      MAX_STORED_MESSAGE_CHARS,
    );
  } catch {
    return sanitizeMultilineText(value, MAX_STORED_MESSAGE_CHARS);
  }
}

function sanitizeToolResultMeta(
  value: unknown,
): ChatMessage["toolResultMeta"] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const originalCharCount = value.originalCharCount;
  const displayedSourceCharCount = value.displayedSourceCharCount;
  if (
    typeof originalCharCount !== "number" ||
    !Number.isSafeInteger(originalCharCount) ||
    originalCharCount < 0 ||
    typeof displayedSourceCharCount !== "number" ||
    !Number.isSafeInteger(displayedSourceCharCount) ||
    displayedSourceCharCount < 0 ||
    typeof value.truncated !== "boolean"
  ) {
    return undefined;
  }
  return {
    originalCharCount,
    displayedSourceCharCount,
    truncated: value.truncated,
  };
}

function deriveConversationTitle(messages: StoredChatMessage[]): string {
  const firstUserMessage = messages.find((message) => message.role === "user");
  if (!firstUserMessage) {
    return "新对话";
  }
  const compact = firstUserMessage.content.replace(/\s+/g, " ").trim();
  return compact.length > 48 ? `${compact.slice(0, 47)}…` : compact;
}

function sanitizeIdentifier(value: unknown): string {
  return sanitizeText(value, 200).trim();
}

function sanitizeOptionalIdentifier(value: unknown): string | undefined {
  const identifier = sanitizeIdentifier(value);
  return identifier || undefined;
}

function sanitizeTimestamp(value: unknown, fallback?: string): string {
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  return fallback ?? new Date(0).toISOString();
}

function sanitizeText(value: unknown, maxLength: number): string {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").slice(0, maxLength)
    : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExtensionStorage(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.storage?.local);
}
