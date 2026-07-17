import type { BrowserDialogInput } from "../shared/dom";

export interface JavaScriptDialogCommandParams {
  accept: boolean;
  promptText?: string;
}

export function currentJavaScriptDialogCommand(
  input: BrowserDialogInput,
): JavaScriptDialogCommandParams {
  return {
    accept: input.action === "accept",
    ...(input.action === "accept" && input.promptText !== undefined
      ? { promptText: input.promptText }
      : {}),
  };
}
