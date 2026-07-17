import { getCssSelector, getElementInfo } from "./domInspector";
import { MESSAGE_TYPES } from "../shared/messages";
import { makeEvent, sendRuntimeEvent } from "../shared/messaging";
import { sanitizeText, sanitizeUrl, truncateText } from "../shared/sanitize";

const PICKER_OVERLAY_ID = "ai-devtools-assistant-picker-overlay";
const PICKER_STYLE_ID = "ai-devtools-assistant-picker-style";

let pickerActive = false;

export function startElementPicker(): { started: boolean } {
  if (pickerActive) {
    return { started: true };
  }

  pickerActive = true;
  ensurePickerStyle();
  window.addEventListener("mouseover", handleHover, true);
  window.addEventListener("mousemove", handleHover, true);
  window.addEventListener("click", handleClick, true);
  window.addEventListener("keydown", handleKeyDown, true);

  return { started: true };
}

export function cancelElementPicker(reason = "cancelled"): { cancelled: boolean } {
  if (!pickerActive) {
    return { cancelled: true };
  }

  cleanupPicker();
  sendRuntimeEvent(
    makeEvent("content", MESSAGE_TYPES.CONTENT_SELECTION_CANCELLED, {
      reason
    })
  );

  return { cancelled: true };
}

function handleHover(event: MouseEvent): void {
  if (!pickerActive || !(event.target instanceof Element)) {
    return;
  }

  const overlay = getOrCreateOverlay();
  const rect = event.target.getBoundingClientRect();

  overlay.style.top = `${rect.top}px`;
  overlay.style.left = `${rect.left}px`;
  overlay.style.width = `${rect.width}px`;
  overlay.style.height = `${rect.height}px`;
  overlay.style.setProperty("--ai-devtools-selector", `"${truncateText(getCssSelector(event.target), 140)}"`);
}

function handleClick(event: MouseEvent): void {
  if (!pickerActive || !(event.target instanceof Element)) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  const element = getElementInfo(event.target);
  cleanupPicker();

  sendRuntimeEvent(
    makeEvent("content", MESSAGE_TYPES.CONTENT_ELEMENT_PICKED, {
      element,
      page: {
        url: sanitizeUrl(location.href),
        title: sanitizeText(document.title, 300)
      }
    })
  );
}

function handleKeyDown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    cancelElementPicker("escape");
  }
}

function cleanupPicker(): void {
  pickerActive = false;
  window.removeEventListener("mouseover", handleHover, true);
  window.removeEventListener("mousemove", handleHover, true);
  window.removeEventListener("click", handleClick, true);
  window.removeEventListener("keydown", handleKeyDown, true);
  document.getElementById(PICKER_OVERLAY_ID)?.remove();
  document.getElementById(PICKER_STYLE_ID)?.remove();
  document.documentElement.classList.remove("ai-devtools-assistant-picking");
}

function getOrCreateOverlay(): HTMLDivElement {
  const existing = document.getElementById(PICKER_OVERLAY_ID);
  if (existing instanceof HTMLDivElement) {
    return existing;
  }

  const overlay = document.createElement("div");
  overlay.id = PICKER_OVERLAY_ID;
  document.documentElement.appendChild(overlay);
  return overlay;
}

function ensurePickerStyle(): void {
  if (document.getElementById(PICKER_STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = PICKER_STYLE_ID;
  style.textContent = `
    html.ai-devtools-assistant-picking,
    html.ai-devtools-assistant-picking * {
      cursor: crosshair !important;
    }
    #${PICKER_OVERLAY_ID} {
      position: fixed !important;
      pointer-events: none !important;
      z-index: 2147483647 !important;
      border: 2px solid #1677ff !important;
      background: rgba(22, 119, 255, 0.12) !important;
      box-sizing: border-box !important;
      transition: top 80ms ease, left 80ms ease, width 80ms ease, height 80ms ease !important;
    }
    #${PICKER_OVERLAY_ID}::after {
      content: var(--ai-devtools-selector);
      position: absolute;
      top: -24px;
      left: 0;
      max-width: min(420px, 90vw);
      padding: 2px 6px;
      overflow: hidden;
      color: #fff;
      font: 12px/18px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      text-overflow: ellipsis;
      white-space: nowrap;
      background: #1677ff;
      border-radius: 4px;
    }
  `;

  document.documentElement.appendChild(style);
  document.documentElement.classList.add("ai-devtools-assistant-picking");
}
