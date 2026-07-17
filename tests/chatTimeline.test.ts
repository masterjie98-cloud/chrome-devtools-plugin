import assert from "node:assert/strict";
import test from "node:test";
import { mergeChatTimelineMessages } from "../src/sidepanel/chatTimeline";

type TimelineItem = {
  id: string;
  createdAt: string;
};

test("external task cards are inserted without moving tool results below the final reply", () => {
  const chatMessages: TimelineItem[] = [
    { id: "tool", createdAt: "2026-07-16T05:51:22.000Z" },
    { id: "assistant", createdAt: "2026-07-16T05:51:20.000Z" },
  ];
  const taskCards: TimelineItem[] = [
    { id: "task", createdAt: "2026-07-16T05:51:19.000Z" },
  ];

  assert.deepEqual(
    mergeChatTimelineMessages(chatMessages, taskCards).map((item) => item.id),
    ["task", "tool", "assistant"],
  );
  assert.deepEqual(
    chatMessages.map((item) => item.id),
    ["tool", "assistant"],
  );
});

test("multiple external cards keep deterministic chronological order", () => {
  const chatMessages: TimelineItem[] = [
    { id: "user", createdAt: "2026-07-16T05:51:10.000Z" },
    { id: "assistant", createdAt: "2026-07-16T05:51:30.000Z" },
  ];
  const taskCards: TimelineItem[] = [
    { id: "task-later", createdAt: "2026-07-16T05:51:25.000Z" },
    { id: "task-earlier", createdAt: "2026-07-16T05:51:20.000Z" },
  ];

  assert.deepEqual(
    mergeChatTimelineMessages(chatMessages, taskCards).map((item) => item.id),
    ["user", "task-earlier", "task-later", "assistant"],
  );
});
