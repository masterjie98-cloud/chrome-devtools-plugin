import type { ChatMessage } from "../types";

export const CHAT_WORKSPACE_STORAGE_KEY = "aiDevtools.chatWorkspaceV1";
export const MAX_STORED_CONVERSATIONS = 20;
export const MAX_STORED_MESSAGES = 80;
export const MAX_STORED_MESSAGE_CHARS = 12_000;
export const MAX_STORED_DRAFT_CHARS = 12_000;
const MAX_CONVERSATION_CHARS = 240_000;
const FALLBACK_STORAGE_KEY = "ai-devtools-assistant.chat-workspace-v1";
let workspaceSaveQueue: Promise<void> = Promise.resolve();

export interface StoredChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  source?: "user" | "extension_ai" | "system";
}

export interface StoredChatConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: StoredChatMessage[];
  draft: string;
  forkedFromConversationId?: string;
  forkedFromMessageId?: string;
}

export interface ChatWorkspaceState {
  version: 1;
  activeConversationId?: string;
  conversations: StoredChatConversation[];
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
      `## ${message.role === "user" ? "用户" : "插件 AI"}`,
      "",
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
  forkedFromConversationId?: string;
  forkedFromMessageId?: string;
}): StoredChatConversation {
  const messages = sanitizeMessages(params.messages);
  return {
    id: sanitizeIdentifier(params.id),
    title: deriveConversationTitle(messages),
    createdAt: sanitizeTimestamp(params.createdAt),
    updatedAt: sanitizeTimestamp(params.updatedAt),
    messages,
    draft: sanitizeText(params.draft, MAX_STORED_DRAFT_CHARS),
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

export function normalizeChatWorkspace(value: unknown): ChatWorkspaceState {
  if (!isRecord(value) || !Array.isArray(value.conversations)) {
    return createEmptyChatWorkspace();
  }

  const seenIds = new Set<string>();
  const conversations = value.conversations
    .map(normalizeStoredConversation)
    .filter((conversation): conversation is StoredChatConversation => {
      if (!conversation || seenIds.has(conversation.id)) {
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
  return {
    id,
    title: deriveConversationTitle(messages),
    createdAt,
    updatedAt,
    messages,
    draft: sanitizeText(value.draft, MAX_STORED_DRAFT_CHARS),
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

function sanitizeMessages(values: unknown[]): StoredChatMessage[] {
  const accepted: StoredChatMessage[] = [];
  let acceptedChars = 0;
  const candidates = values
    .filter(
      (value) =>
        isRecord(value) &&
        (value.role === "user" || value.role === "assistant"),
    )
    .slice(-MAX_STORED_MESSAGES);

  for (const value of candidates) {
    if (!isRecord(value) || (value.role !== "user" && value.role !== "assistant")) {
      continue;
    }
    const id = sanitizeOptionalIdentifier(value.id);
    const content = sanitizeText(value.content, MAX_STORED_MESSAGE_CHARS);
    if (!id || !content || acceptedChars + content.length > MAX_CONVERSATION_CHARS) {
      continue;
    }
    acceptedChars += content.length;
    accepted.push({
      id,
      role: value.role,
      content,
      createdAt: sanitizeTimestamp(value.createdAt),
      ...(value.source === "user" ||
      value.source === "extension_ai" ||
      value.source === "system"
        ? { source: value.source }
        : {}),
    });
  }

  return accepted;
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
