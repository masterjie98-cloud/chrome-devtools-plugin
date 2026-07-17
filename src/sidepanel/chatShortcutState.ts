import { TOOL_NAMES, type ToolName } from "../shared/tools";

export interface ChatShortcutState {
  disabled: boolean;
  readPageLoading: boolean;
  elementPickerLoading: boolean;
  screenshotLoading: boolean;
}

export function getChatShortcutState(
  agentBusy: boolean,
  runningTool: ToolName | undefined,
): ChatShortcutState {
  return {
    disabled: agentBusy || Boolean(runningTool),
    readPageLoading: runningTool === TOOL_NAMES.DOM_GET_PAGE_INFO,
    elementPickerLoading:
      runningTool === TOOL_NAMES.DOM_START_ELEMENT_PICK ||
      runningTool === TOOL_NAMES.DOM_CANCEL_ELEMENT_PICK,
    screenshotLoading: runningTool === TOOL_NAMES.BROWSER_TAKE_SCREENSHOT,
  };
}
