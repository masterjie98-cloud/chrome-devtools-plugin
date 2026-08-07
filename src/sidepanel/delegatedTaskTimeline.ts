import type { DelegatedTaskSnapshot } from "../shared/collaborationTasks";
import type { CollaborationActor } from "../shared/collaborationWorkspace";
import type { ChatMessage, ChatMessageSource } from "./types";

export interface DelegatedTaskTimelineOptions {
  includeResult: boolean;
}

export function projectDelegatedTaskTimeline(
  task: DelegatedTaskSnapshot,
  options: DelegatedTaskTimelineOptions,
): ChatMessage[] {
  const messages: ChatMessage[] = [
    {
      id: task.requestItem.id,
      role: "assistant",
      source: "mcp_ai",
      content: formatTaskRequest(task),
      createdAt: task.requestItem.createdAt,
    },
  ];

  for (const event of task.events) {
    messages.push({
      id: event.item.id,
      role: "assistant",
      source: actorSource(event.item.source.actor),
      content: formatTaskEvent(event.content),
      createdAt: event.item.createdAt,
    });
  }

  if (options.includeResult && task.resultItem && task.result) {
    messages.push({
      id: task.resultItem.id,
      role: "assistant",
      source: actorSource(task.resultItem.source.actor),
      content: task.result.summary,
      createdAt: task.resultItem.createdAt,
    });
  }

  return messages.sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id),
  );
}

export function hasPersistedPluginReply(
  messages: readonly ChatMessage[],
  task: DelegatedTaskSnapshot,
): boolean {
  return messages.some(
    (message) =>
      message.source === "extension_ai" &&
      message.role === "assistant" &&
      message.createdAt >= task.requestItem.createdAt &&
      message.content.trim().length > 0,
  );
}

function formatTaskRequest(task: DelegatedTaskSnapshot): string {
  const criteria = task.request.acceptanceCriteria.length
    ? [
        "",
        "完成标准：",
        ...task.request.acceptanceCriteria.map(
          (criterion) => `- ${criterion}`,
        ),
      ]
    : [];
  return [
    `### ${task.requestItem.title}`,
    "",
    task.request.instruction,
    ...criteria,
  ].join("\n");
}

function formatTaskEvent(
  event: DelegatedTaskSnapshot["events"][number]["content"],
): string {
  const progress =
    event.progress === undefined ? "" : ` · ${Math.round(event.progress)}%`;
  const details = [
    ...(event.requirements ?? []).map(
      (requirement) => `- 追加要求：${requirement}`,
    ),
    ...(event.artifactUris ?? []).map((uri) => `- 证据：\`${uri}\``),
  ];
  return [
    `**${eventLabel(event.eventType)}${progress}**`,
    "",
    event.message,
    ...(details.length ? ["", ...details] : []),
  ].join("\n");
}

function eventLabel(
  eventType: DelegatedTaskSnapshot["events"][number]["content"]["eventType"],
): string {
  switch (eventType) {
    case "clarification":
      return "澄清问题";
    case "requirement":
      return "追加要求";
    case "evidence":
      return "证据附件";
    default:
      return "进度更新";
  }
}

function actorSource(actor: CollaborationActor): ChatMessageSource {
  if (actor === "mcp_agent") {
    return "mcp_ai";
  }
  if (actor === "extension_agent") {
    return "extension_ai";
  }
  return actor;
}
