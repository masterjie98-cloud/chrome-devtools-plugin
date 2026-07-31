import type {
  BrowserRuntimeErrorsInput,
  BrowserRuntimeErrorsResult,
} from "./sourceLocation";

export interface RuntimeErrorCursorRecord {
  sequence: number;
  level: "error" | "warning";
  revoked?: boolean;
}

export interface RuntimeErrorWindow<T extends RuntimeErrorCursorRecord> {
  cursorStatus: BrowserRuntimeErrorsResult["cursorStatus"];
  effectiveAfter: number;
  nextSequence: number;
  oldestSequence: number;
  latestSequence: number;
  missedEvents: number;
  candidates: T[];
  selected: T[];
}

export function selectRuntimeErrorWindow<T extends RuntimeErrorCursorRecord>(
  records: readonly T[],
  streamId: string,
  latestSequence: number,
  input: Pick<
    BrowserRuntimeErrorsInput,
    | "afterStreamId"
    | "afterSequence"
    | "limit"
    | "includeWarnings"
    | "includeRevoked"
  >,
): RuntimeErrorWindow<T> {
  const requestedAfter = input.afterSequence ?? 0;
  const streamRestarted =
    typeof input.afterStreamId === "string" &&
    input.afterStreamId !== streamId;
  const oldestSequence = records[0]?.sequence ?? latestSequence + 1;
  const cursorAhead = !streamRestarted && requestedAfter > latestSequence;
  const effectiveAfter = streamRestarted ? 0 : requestedAfter;
  const missedEvents =
    !streamRestarted && effectiveAfter < oldestSequence - 1
      ? oldestSequence - effectiveAfter - 1
      : 0;
  const cursorStatus: BrowserRuntimeErrorsResult["cursorStatus"] =
    streamRestarted
      ? "stream_restarted"
      : cursorAhead
        ? "cursor_ahead"
        : missedEvents > 0
          ? "events_dropped"
          : "ok";
  const candidates = cursorAhead
    ? []
    : records.filter(
        (error) =>
          error.sequence > effectiveAfter &&
          (input.includeWarnings === true || error.level === "error") &&
          (input.includeRevoked === true || error.revoked !== true),
      );
  const selected = candidates.slice(0, input.limit ?? 10);
  const nextSequence =
    candidates.length > selected.length
      ? selected.at(-1)?.sequence ?? effectiveAfter
      : latestSequence;

  return {
    cursorStatus,
    effectiveAfter,
    nextSequence,
    oldestSequence,
    latestSequence,
    missedEvents,
    candidates,
    selected,
  };
}
