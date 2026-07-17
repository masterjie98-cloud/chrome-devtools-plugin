import type { AiConfig } from "./services/aiConfig";
import type { ChatImageAttachment, ChatMessage } from "./types";

export interface ChatBranchPlan {
  sourceMessageId: string;
  input: string;
  attachments: ChatImageAttachment[];
  seedMessages: ChatMessage[];
}

export function createRetryBranchPlan(
  messages: ChatMessage[],
  assistantMessageId: string,
): ChatBranchPlan | null {
  const assistantIndex = messages.findIndex(
    (message) =>
      message.id === assistantMessageId && message.role === "assistant",
  );
  if (assistantIndex < 0) {
    return null;
  }

  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    const candidate = messages[index];
    if (candidate?.role === "user") {
      return createBranchPlan(messages, candidate.id, candidate.content, candidate.attachments ?? []);
    }
  }
  return null;
}

export function createEditedBranchPlan(
  messages: ChatMessage[],
  userMessageId: string,
  input: string,
  attachments: ChatImageAttachment[],
): ChatBranchPlan | null {
  return createBranchPlan(messages, userMessageId, input, attachments);
}

export function createSafeRetryConfig(config: AiConfig): AiConfig {
  return {
    ...config,
    fastAgentMode: false,
    autoReadPage: false,
    enableTools: false,
    enableWebSearch: false,
    includePageContext: false,
    includeDomSummary: false,
    includeSelectedElement: false,
  };
}

function createBranchPlan(
  messages: ChatMessage[],
  userMessageId: string,
  input: string,
  attachments: ChatImageAttachment[],
): ChatBranchPlan | null {
  const sourceIndex = messages.findIndex(
    (message) => message.id === userMessageId && message.role === "user",
  );
  if (sourceIndex < 0 || (!input.trim() && attachments.length === 0)) {
    return null;
  }

  return {
    sourceMessageId: userMessageId,
    input: input.trim(),
    attachments: [...attachments],
    seedMessages: messages
      .slice(0, sourceIndex)
      .filter(
        (message): message is ChatMessage =>
          message.role === "user" || message.role === "assistant",
      )
      .map((message) => ({
        ...message,
        attachments: message.attachments
          ? [...message.attachments]
          : undefined,
        status: undefined,
      })),
  };
}
