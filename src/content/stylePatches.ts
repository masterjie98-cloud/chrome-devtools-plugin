import type { CssPatchInput, CssPatchResult, RemoveCssPatchInput, RemoveCssPatchResult } from "../shared/dom";
import { SANITIZE_LIMITS, truncateText } from "../shared/sanitize";

const STYLE_NODE_PREFIX = "ai-devtools-assistant-css-patch-";

export function applyCssPatch(input: CssPatchInput): CssPatchResult {
  const patchId = normalizePatchId(input.patchId);
  const styleId = `${STYLE_NODE_PREFIX}${patchId}`;
  const existing = document.getElementById(styleId);
  const style = existing instanceof HTMLStyleElement ? existing : document.createElement("style");

  style.id = styleId;
  style.dataset.aiDevtoolsPatchId = patchId;
  style.textContent = truncateText(input.css, SANITIZE_LIMITS.cssPatch);

  if (!existing) {
    document.documentElement.appendChild(style);
  }

  return {
    patchId,
    active: true
  };
}

export function removeCssPatch(input: RemoveCssPatchInput): RemoveCssPatchResult {
  const patchId = normalizePatchId(input.patchId);
  const style = document.getElementById(`${STYLE_NODE_PREFIX}${patchId}`);
  const removed = Boolean(style);
  style?.remove();

  return {
    patchId,
    removed
  };
}

function normalizePatchId(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80) || "default";
}
