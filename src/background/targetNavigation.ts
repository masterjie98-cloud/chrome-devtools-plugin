import { createMessageId } from "../shared/messaging";

export interface TargetNavigationState {
  navigationId: string;
  revision: number;
}

const targetNavigationState = new Map<number, TargetNavigationState>();

export function getTargetNavigationState(
  tabId: number,
  navigationChanged: boolean,
): TargetNavigationState {
  const current = targetNavigationState.get(tabId);
  if (current && !navigationChanged) {
    return current;
  }
  const next = {
    navigationId: createMessageId(),
    revision: (current?.revision ?? -1) + 1,
  };
  targetNavigationState.set(tabId, next);
  return next;
}

export function clearTargetNavigationState(tabId: number): void {
  targetNavigationState.delete(tabId);
}
