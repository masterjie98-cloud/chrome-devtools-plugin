import assert from "node:assert/strict";
import test from "node:test";
import {
  enqueueChatSubmission,
  MAX_QUEUED_CHAT_SUBMISSIONS,
  moveChatSubmissionToFront,
  removeChatSubmission,
  takeNextChatSubmission,
} from "../src/sidepanel/chatQueue";
import type { QueuedChatSubmission } from "../src/sidepanel/types";

function submission(id: string): QueuedChatSubmission {
  return {
    id,
    conversationId: `conversation-${id}`,
    input: `message ${id}`,
    attachments: [],
    createdAt: "2026-07-14T00:00:00.000Z",
  };
}

test("chat queue appends normal messages in FIFO order", () => {
  const first = enqueueChatSubmission([], submission("1"));
  const second = enqueueChatSubmission(first.queue, submission("2"));

  assert.equal(first.accepted, true);
  assert.equal(second.accepted, true);
  assert.deepEqual(second.queue.map((item) => item.id), ["1", "2"]);
});

test("interrupt messages can be placed at the front without losing queued work", () => {
  const result = enqueueChatSubmission(
    [submission("1"), submission("2")],
    submission("urgent"),
    "front",
  );

  assert.equal(result.accepted, true);
  assert.deepEqual(result.queue.map((item) => item.id), [
    "urgent",
    "1",
    "2",
  ]);
});

test("chat queue enforces the in-memory capacity limit", () => {
  const fullQueue = Array.from(
    { length: MAX_QUEUED_CHAT_SUBMISSIONS },
    (_, index) => submission(String(index)),
  );
  const result = enqueueChatSubmission(fullQueue, submission("overflow"));

  assert.equal(result.accepted, false);
  assert.equal(result.queue, fullQueue);
});

test("queued messages can be removed and promoted", () => {
  const queue = [submission("1"), submission("2"), submission("3")];

  assert.deepEqual(
    removeChatSubmission(queue, "2").map((item) => item.id),
    ["1", "3"],
  );
  assert.deepEqual(
    moveChatSubmissionToFront(queue, "3").map((item) => item.id),
    ["3", "1", "2"],
  );
  assert.equal(moveChatSubmissionToFront(queue, "missing"), queue);
});

test("taking the next message preserves FIFO order", () => {
  const result = takeNextChatSubmission([
    submission("1"),
    submission("2"),
  ]);

  assert.equal(result.submission?.id, "1");
  assert.deepEqual(result.queue.map((item) => item.id), ["2"]);
  const empty = takeNextChatSubmission([]);
  assert.equal(empty.submission, undefined);
  assert.deepEqual(empty.queue, []);
});
