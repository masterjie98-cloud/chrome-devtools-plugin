import type { QueuedChatSubmission } from "./types";

export const MAX_QUEUED_CHAT_SUBMISSIONS = 5;

export interface EnqueueChatResult {
  accepted: boolean;
  queue: QueuedChatSubmission[];
}

export function enqueueChatSubmission(
  queue: QueuedChatSubmission[],
  submission: QueuedChatSubmission,
  position: "front" | "back" = "back",
): EnqueueChatResult {
  if (queue.length >= MAX_QUEUED_CHAT_SUBMISSIONS) {
    return { accepted: false, queue };
  }

  return {
    accepted: true,
    queue:
      position === "front"
        ? [submission, ...queue]
        : [...queue, submission],
  };
}

export function removeChatSubmission(
  queue: QueuedChatSubmission[],
  submissionId: string,
): QueuedChatSubmission[] {
  return queue.filter((submission) => submission.id !== submissionId);
}

export function moveChatSubmissionToFront(
  queue: QueuedChatSubmission[],
  submissionId: string,
): QueuedChatSubmission[] {
  const submission = queue.find((item) => item.id === submissionId);
  if (!submission) {
    return queue;
  }

  return [
    submission,
    ...queue.filter((item) => item.id !== submissionId),
  ];
}

export function takeNextChatSubmission(queue: QueuedChatSubmission[]): {
  submission?: QueuedChatSubmission;
  queue: QueuedChatSubmission[];
} {
  const [submission, ...remaining] = queue;
  return { submission, queue: remaining };
}
