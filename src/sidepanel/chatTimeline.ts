export function mergeChatTimelineMessages<T extends { createdAt: string }>(
  chatMessages: readonly T[],
  externalMessages: readonly T[],
): T[] {
  const merged = [...chatMessages];
  const orderedExternal = externalMessages
    .map((message, index) => ({ message, index }))
    .sort(
      (left, right) =>
        left.message.createdAt.localeCompare(right.message.createdAt) ||
        left.index - right.index,
    );

  for (const { message } of orderedExternal) {
    const insertionIndex = merged.findIndex(
      (candidate) => candidate.createdAt.localeCompare(message.createdAt) > 0,
    );
    if (insertionIndex === -1) {
      merged.push(message);
    } else {
      merged.splice(insertionIndex, 0, message);
    }
  }

  return merged;
}
