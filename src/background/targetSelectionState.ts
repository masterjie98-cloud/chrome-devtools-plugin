export type TargetTabSelectionMode = "auto" | "manual";

export interface TargetSelectionState {
  tabId?: number;
  selection: TargetTabSelectionMode;
  generation: number;
}

export interface TargetSelectionTransition {
  state: TargetSelectionState;
  committed: boolean;
  changed: boolean;
}

export function transitionTargetSelection(
  current: TargetSelectionState,
  next: Pick<TargetSelectionState, "tabId" | "selection">,
  expectedGeneration = current.generation,
): TargetSelectionTransition {
  if (expectedGeneration !== current.generation) {
    return { state: current, committed: false, changed: false };
  }
  if (current.tabId === next.tabId && current.selection === next.selection) {
    return { state: current, committed: true, changed: false };
  }
  return {
    state: {
      tabId: next.tabId,
      selection: next.selection,
      generation: current.generation + 1,
    },
    committed: true,
    changed: true,
  };
}
