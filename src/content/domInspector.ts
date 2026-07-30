import type {
  ComputedStyleProperty,
  DomElementInfo,
  DomQueryInput,
  DomQueryResult,
  DomRectSnapshot,
  DomSetValueInput,
  DomSetValueResult,
  DomSetValueTarget,
  DomSummaryNode,
  HighlightElementInput,
  HighlightElementResult,
  PageSnapshotInput,
  PageSnapshot,
} from "../shared/dom";
import { DEFAULT_COMPUTED_STYLE_PROPERTIES } from "../shared/dom";
import {
  paginateSemanticSnapshot,
  type SemanticCheckedState,
  type SemanticSnapshotCandidate,
} from "../shared/semanticSnapshot";
import {
  SANITIZE_LIMITS,
  sanitizeAttributeValue,
  sanitizeHtmlSnippet,
  sanitizeText,
  sanitizeUrl,
  truncateText,
} from "../shared/sanitize";
import { isAgentPointerHost } from "./agentPointer";
import { classifyActionTarget } from "../shared/actionRisk";

const SKIPPED_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEMPLATE",
  "META",
  "LINK",
]);
const HIGHLIGHT_CLASS = "ai-devtools-assistant-highlight";
const HIGHLIGHT_STYLE_ID = "ai-devtools-assistant-highlight-style";
type ResolvedDomSetValueTarget = Exclude<DomSetValueTarget, "auto">;
interface DomElementInfoOptions {
  includeText?: boolean;
  includeOuterHTML?: boolean;
  includeComputedStyle?: boolean;
  computedStyleProperties?: ComputedStyleProperty[];
  maxTextLength?: number;
  maxOuterHTMLLength?: number;
}

interface DomMutationJournalEntry {
  revision: number;
  added: number;
  removed: number;
  attributes: number;
  characterData: number;
  domSamples: Array<{
    changeType: "added" | "removed" | "attribute" | "text";
    selector?: string;
    text?: string;
  }>;
  domSamplesOmitted: number;
}

const DOM_MUTATION_JOURNAL_LIMIT = 100;
const DOM_ACTIVITY_BATCH_MS = 120;
let domRevision = 1;
let domMutationObserver: MutationObserver | null = null;
const domMutationJournal: DomMutationJournalEntry[] = [];
let domActivityEnabled = false;
let domActivityTimer: ReturnType<typeof setTimeout> | null = null;
let domActivityPending: Omit<DomMutationJournalEntry, "revision"> | null = null;
let domActivityEmitter:
  | ((entry: DomMutationJournalEntry) => void)
  | null = null;

export function configureDomActivityEmitter(
  emitter: (entry: DomMutationJournalEntry) => void,
): void {
  domActivityEmitter = emitter;
}

export function setDomActivityMonitoring(
  enabled: boolean,
): { enabled: boolean } {
  domActivityEnabled = enabled;
  if (enabled) {
    ensureDomMutationObserver();
  } else {
    flushDomActivity();
  }
  return { enabled };
}

export function getPageSnapshot(input: PageSnapshotInput = {}): PageSnapshot {
  const totalStartedAt = performance.now();
  ensureDomMutationObserver();
  const mode = input.mode ?? "interactive";
  const sourceLimit = normalizeSnapshotSourceLimit(input.sourceLimit);
  const scanStartedAt = performance.now();
  const observation = buildBoundedPageObservation(
    mode,
    sourceLimit,
    input.compact !== true,
  );
  const scanMs = performance.now() - scanStartedAt;
  const visibleText =
    mode === "full"
      ? sanitizeText(document.body?.innerText ?? "", SANITIZE_LIMITS.visibleText)
      : sanitizeText(
          observation.candidates
            .flatMap((candidate) => [candidate.name, candidate.description ?? ""])
            .filter(Boolean)
            .join("\n"),
          mode === "interactive" ? 2400 : 4000,
        );

  return {
    url: sanitizeUrl(location.href),
    title: sanitizeText(document.title, 300),
    origin: sanitizeUrl(location.origin),
    capturedAt: new Date().toISOString(),
    visibleText,
    domSummary: observation.nodes,
    nodeCount: observation.retained,
    truncated: observation.truncated,
    mode,
    sourceVisited: observation.sourceVisited,
    sourceLimit,
    domRevision,
    delta: readDomMutationDelta(input.sinceRevision),
    semanticSnapshot: paginateSemanticSnapshot(
      observation.candidates,
      input,
      `${location.href}\n${document.title}`,
      observation.truncated,
    ),
    timing: {
      totalMs: roundTiming(performance.now() - totalStartedAt),
      scanMs: roundTiming(scanMs),
    },
  };
}

function buildBoundedPageObservation(
  mode: "interactive" | "outline" | "full",
  sourceLimit: number,
  includeDomSummary: boolean,
): {
  nodes: DomSummaryNode[];
  candidates: SemanticSnapshotCandidate[];
  sourceVisited: number;
  retained: number;
  truncated: boolean;
} {
  const nodes: DomSummaryNode[] = [];
  const candidates: SemanticSnapshotCandidate[] = [];
  const root = document.body;
  if (!root) {
    return {
      nodes,
      candidates,
      sourceVisited: 0,
      retained: 0,
      truncated: false,
    };
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let sourceVisited = 0;
  let retained = 0;
  let current = walker.nextNode();
  while (current && sourceVisited < sourceLimit) {
    sourceVisited += 1;
    const element = current as Element;
    current = walker.nextNode();
    if (SKIPPED_TAGS.has(element.tagName) || isAgentPointerHost(element)) {
      continue;
    }
    const role = getSemanticRole(element);
    const shouldRetain =
      mode === "full" ||
      (Boolean(role) &&
        (mode === "outline" || INTERACTIVE_SEMANTIC_ROLES.has(role ?? "")));
    const visibleRect = shouldRetain ? getVisibleElementRect(element) : undefined;
    if (!shouldRetain || !visibleRect) {
      continue;
    }
    retained += 1;
    const canCollectCandidate =
      Boolean(role) &&
      SEMANTIC_ROLES.has(role ?? "") &&
      candidates.length < MAX_SEMANTIC_CANDIDATES;
    const selector =
      includeDomSummary || canCollectCandidate ? getCssSelector(element) : "";
    if (includeDomSummary && nodes.length < SANITIZE_LIMITS.domSummaryNodes) {
      const text = directText(element);
      nodes.push({
        tagName: element.tagName.toLowerCase(),
        selector,
        id: element.id ? sanitizeText(element.id, 100) : undefined,
        className:
          element instanceof HTMLElement
            ? sanitizeText(element.className, 160)
            : undefined,
        role: role ?? element.getAttribute("role") ?? undefined,
        ariaLabel: element.getAttribute("aria-label")
          ? sanitizeText(element.getAttribute("aria-label") ?? "", 160)
          : undefined,
        text: text
          ? sanitizeText(text, SANITIZE_LIMITS.domSummaryText)
          : undefined,
        childElementCount: element.childElementCount,
      });
    }
    if (role && canCollectCandidate) {
      candidates.push(
        toSemanticSnapshotCandidate(element, role, selector, visibleRect),
      );
    }
  }
  return {
    nodes,
    candidates,
    sourceVisited,
    retained,
    truncated:
      Boolean(current) ||
      (includeDomSummary && nodes.length >= SANITIZE_LIMITS.domSummaryNodes) ||
      candidates.length >= MAX_SEMANTIC_CANDIDATES,
  };
}

function roundTiming(value: number): number {
  return Math.max(0, Math.round(value * 100) / 100);
}

function normalizeSnapshotSourceLimit(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(10_000, Math.max(100, Math.round(value)))
    : 2_000;
}

function ensureDomMutationObserver(): void {
  if (domMutationObserver || !document.documentElement) {
    return;
  }
  domMutationObserver = new MutationObserver((records) => {
    let added = 0;
    let removed = 0;
    let attributes = 0;
    let characterData = 0;
    const domSamples: DomMutationJournalEntry["domSamples"] = [];
    let domSamplesOmitted = 0;
    for (const record of records) {
      if (record.type === "childList") {
        added += record.addedNodes.length;
        removed += record.removedNodes.length;
        for (const node of Array.from(record.addedNodes)) {
          if (domSamples.length < 12) {
            domSamples.push(toDomActivitySample("added", node));
          } else {
            domSamplesOmitted += 1;
          }
        }
        for (const node of Array.from(record.removedNodes)) {
          if (domSamples.length < 12) {
            domSamples.push(toDomActivitySample("removed", node));
          } else {
            domSamplesOmitted += 1;
          }
        }
      } else if (record.type === "attributes") {
        attributes += 1;
        if (domSamples.length < 12) {
          domSamples.push(
            toDomActivitySample("attribute", record.target, record.attributeName),
          );
        } else {
          domSamplesOmitted += 1;
        }
      } else {
        characterData += 1;
        if (domSamples.length < 12) {
          domSamples.push(toDomActivitySample("text", record.target));
        } else {
          domSamplesOmitted += 1;
        }
      }
    }
    domRevision += 1;
    domMutationJournal.push({
      revision: domRevision,
      added,
      removed,
      attributes,
      characterData,
      domSamples,
      domSamplesOmitted,
    });
    if (domMutationJournal.length > DOM_MUTATION_JOURNAL_LIMIT) {
      domMutationJournal.splice(
        0,
        domMutationJournal.length - DOM_MUTATION_JOURNAL_LIMIT,
      );
    }
    if (domActivityEnabled) {
      domActivityPending = {
        added: (domActivityPending?.added ?? 0) + added,
        removed: (domActivityPending?.removed ?? 0) + removed,
        attributes: (domActivityPending?.attributes ?? 0) + attributes,
        characterData:
          (domActivityPending?.characterData ?? 0) + characterData,
        domSamples: [
          ...(domActivityPending?.domSamples ?? []),
          ...domSamples,
        ].slice(0, 12),
        domSamplesOmitted:
          (domActivityPending?.domSamplesOmitted ?? 0) +
          domSamplesOmitted +
          Math.max(
            0,
            (domActivityPending?.domSamples.length ?? 0) +
              domSamples.length -
              12,
          ),
      };
      if (!domActivityTimer) {
        domActivityTimer = setTimeout(flushDomActivity, DOM_ACTIVITY_BATCH_MS);
      }
    }
  });
  domMutationObserver.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
}

function toDomActivitySample(
  changeType: "added" | "removed" | "attribute" | "text",
  node: Node,
  attributeName?: string | null,
): DomMutationJournalEntry["domSamples"][number] {
  const element =
    node instanceof Element
      ? node
      : node.parentElement;
  const selector = element ? getCssSelector(element) : undefined;
  const rawText =
    changeType === "attribute" && element && attributeName
      ? `${attributeName}=${element.getAttribute(attributeName) ?? ""}`
      : node.textContent ?? element?.textContent ?? "";
  const text = sanitizeText(rawText.replace(/\s+/g, " ").trim(), 240);
  return {
    changeType,
    ...(selector ? { selector: sanitizeText(selector, 500) } : {}),
    ...(text ? { text } : {}),
  };
}

function flushDomActivity(): void {
  if (domActivityTimer) {
    clearTimeout(domActivityTimer);
    domActivityTimer = null;
  }
  const pending = domActivityPending;
  domActivityPending = null;
  if (!pending || !domActivityEmitter) {
    return;
  }
  domActivityEmitter({
    revision: domRevision,
    ...pending,
  });
}

function readDomMutationDelta(sinceRevision: number | undefined) {
  if (sinceRevision === undefined) {
    return undefined;
  }
  const earliest = domMutationJournal[0]?.revision ?? domRevision;
  if (sinceRevision > domRevision || sinceRevision < earliest - 1) {
    return {
      fromRevision: sinceRevision,
      toRevision: domRevision,
      available: false,
      added: 0,
      removed: 0,
      attributes: 0,
      characterData: 0,
      truncated: true,
    };
  }
  const entries = domMutationJournal.filter(
    (entry) => entry.revision > sinceRevision,
  );
  return {
    fromRevision: sinceRevision,
    toRevision: domRevision,
    available: true,
    added: entries.reduce((sum, entry) => sum + entry.added, 0),
    removed: entries.reduce((sum, entry) => sum + entry.removed, 0),
    attributes: entries.reduce((sum, entry) => sum + entry.attributes, 0),
    characterData: entries.reduce((sum, entry) => sum + entry.characterData, 0),
    truncated: false,
  };
}

export function queryDom(input: DomQueryInput): DomQueryResult {
  const limit = normalizeQueryLimit(input.limit);
  const query = input.query.trim();

  try {
    const elements = (
      input.queryType === "className"
        ? Array.from(document.getElementsByClassName(normalizeClassName(query)))
        : input.queryType === "xpath"
          ? queryXPath(query)
          : Array.from(document.querySelectorAll(query))
    ).filter((element) => !isAgentPointerHost(element));

    return {
      query,
      queryType: input.queryType,
      count: elements.length,
      returnedCount: Math.min(elements.length, limit),
      truncated: elements.length > limit,
      elements: elements
        .slice(0, limit)
        .map((element) =>
          getElementInfo(element, {
            includeText: input.includeText,
            includeOuterHTML: input.includeOuterHTML,
            includeComputedStyle: input.includeComputedStyle,
            computedStyleProperties: input.computedStyleProperties,
            maxTextLength: input.maxTextLength,
            maxOuterHTMLLength: input.maxOuterHTMLLength,
          }),
        ),
    };
  } catch (error) {
    return {
      query,
      queryType: input.queryType,
      count: 0,
      returnedCount: 0,
      truncated: false,
      elements: [],
      error: error instanceof Error ? error.message : "Invalid DOM query.",
    };
  }
}

function queryXPath(query: string): Element[] {
  const result = document.evaluate(
    query,
    document,
    null,
    XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
    null,
  );
  const elements: Element[] = [];

  for (let index = 0; index < result.snapshotLength; index += 1) {
    const node = result.snapshotItem(index);
    if (node instanceof Element) {
      elements.push(node);
    }
  }

  return elements;
}

export function getElementInfo(
  element: Element,
  options: DomElementInfoOptions = {},
): DomElementInfo {
  const rect = element.getBoundingClientRect();
  const includeText = options.includeText !== false;
  const includeOuterHTML = options.includeOuterHTML !== false;
  const includeComputedStyle = options.includeComputedStyle !== false;

  return {
    selector: getCssSelector(element),
    tagName: element.tagName.toLowerCase(),
    id: element.id ? sanitizeText(element.id, 160) : undefined,
    className:
      element instanceof HTMLElement
        ? sanitizeText(element.className, 240)
        : undefined,
    text: includeText
      ? sanitizeText(
          element.textContent ?? "",
          normalizeSnapshotLimit(
            options.maxTextLength,
            SANITIZE_LIMITS.elementText,
          ),
        )
      : undefined,
    outerHTML: includeOuterHTML
      ? sanitizeOuterHtml(element, options.maxOuterHTMLLength)
      : "",
    attributes: getSanitizedAttributes(element),
    computedStyle: includeComputedStyle
      ? getComputedStyleSubset(element, options.computedStyleProperties)
      : {},
    rect: toRectSnapshot(rect),
  };
}

export function highlightElement(
  input: HighlightElementInput,
): HighlightElementResult {
  const element = document.querySelector(input.selector);
  if (!element) {
    return {
      selector: input.selector,
      highlighted: false,
    };
  }

  ensureHighlightStyle();
  const overlay = createOverlayForElement(element, HIGHLIGHT_CLASS);
  document.documentElement.appendChild(overlay);

  const durationMs = Math.max(600, Math.min(input.durationMs ?? 3000, 15000));
  window.setTimeout(() => {
    overlay.remove();
  }, durationMs);

  return {
    selector: input.selector,
    highlighted: true,
  };
}

export function clearHighlights(): void {
  document
    .querySelectorAll(`.${HIGHLIGHT_CLASS}`)
    .forEach((node) => node.remove());
}

export function setDomValue(input: DomSetValueInput): DomSetValueResult {
  const selector = input.selector.trim();
  const element = document.querySelector(selector);
  const requestedTarget = input.target ?? "auto";
  const value = truncateText(input.value, SANITIZE_LIMITS.domMutationValue);

  if (!element) {
    return {
      selector,
      matched: false,
      target: requestedTarget === "auto" ? "textContent" : requestedTarget,
    };
  }

  const target = resolveSetValueTarget(element, requestedTarget);
  const previousValue = readElementMutationValue(element, target, input.attributeName);

  writeElementMutationValue(element, target, value, input.attributeName);
  if (input.dispatchEvents !== false) {
    dispatchMutationEvents(element, target);
  }

  return {
    selector,
    matched: true,
    target,
    tagName: element.tagName.toLowerCase(),
    attributeName: target === "attribute" ? input.attributeName : undefined,
    previousValue: sanitizeMutationValue(element, target, previousValue),
    currentValue: sanitizeMutationValue(
      element,
      target,
      readElementMutationValue(element, target, input.attributeName),
    ),
  };
}

export function getCssSelector(element: Element): string {
  if (element.id && document.getElementById(element.id) === element) {
    return `#${escapeCss(element.id)}`;
  }

  const suffix: string[] = [];
  let current: Element | null = element;

  while (current && current.nodeType === Node.ELEMENT_NODE) {
    const tagName = current.tagName.toLowerCase();
    const stableAnchor = compactUniqueAnchor(current, tagName);
    if (stableAnchor) {
      return [stableAnchor, ...suffix].join(" > ");
    }

    let part = tagName;
    const parent: Element | null = current.parentElement;
    if (parent) {
      const currentTagName = current.tagName;
      const siblings = Array.from(parent.children).filter(
        (sibling) => sibling.tagName === currentTagName,
      );
      if (siblings.length > 1) {
        part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      }
    }
    suffix.unshift(part);
    if (current === document.body) {
      break;
    }
    current = parent;
  }

  return suffix.join(" > ");
}

function compactUniqueAnchor(
  element: Element,
  tagName: string,
): string | undefined {
  if (element.id && document.getElementById(element.id) === element) {
    return `#${escapeCss(element.id)}`;
  }

  for (const attributeName of ["data-testid", "data-test", "data-cy", "data-qa"]) {
    const value = element.getAttribute(attributeName)?.trim();
    if (!value || value.length > 120) {
      continue;
    }
    const selector = `${tagName}[${attributeName}="${escapeCssAttribute(value)}"]`;
    if (isUniqueSelectorForElement(selector, element)) {
      return selector;
    }
  }

  for (const className of Array.from(element.classList)) {
    if (!isCompactSelectorClass(className)) {
      continue;
    }
    if (document.getElementsByClassName(className).length === 1) {
      return `${tagName}.${escapeCss(className)}`;
    }
  }
  return undefined;
}

function isCompactSelectorClass(className: string): boolean {
  return (
    className.length > 0 &&
    className.length <= 80 &&
    !className.startsWith("ant-") &&
    !className.startsWith("css-") &&
    !/^(?:active|disabled|selected|open|focused|loading)$/i.test(className)
  );
}

function isUniqueSelectorForElement(selector: string, element: Element): boolean {
  try {
    const matches = document.querySelectorAll(selector);
    return matches.length === 1 && matches[0] === element;
  } catch {
    return false;
  }
}

function escapeCssAttribute(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function resolveSetValueTarget(
  element: Element,
  target: DomSetValueInput["target"] = "auto",
): ResolvedDomSetValueTarget {
  if (target && target !== "auto") {
    return target;
  }

  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  ) {
    return "value";
  }

  if (element instanceof HTMLElement && element.isContentEditable) {
    return "textContent";
  }

  return "textContent";
}

function readElementMutationValue(
  element: Element,
  target: ResolvedDomSetValueTarget,
  attributeName?: string,
): string {
  switch (target) {
    case "value":
      if (
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLSelectElement
      ) {
        return element.value;
      }
      return element.getAttribute("value") ?? "";
    case "innerText":
      return element instanceof HTMLElement ? element.innerText : element.textContent ?? "";
    case "attribute":
      return attributeName ? element.getAttribute(attributeName) ?? "" : "";
    case "textContent":
    default:
      return element.textContent ?? "";
  }
}

function writeElementMutationValue(
  element: Element,
  target: ResolvedDomSetValueTarget,
  value: string,
  attributeName?: string,
): void {
  switch (target) {
    case "value":
      if (
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLSelectElement
      ) {
        element.value = value;
        return;
      }
      element.setAttribute("value", value);
      return;
    case "innerText":
      if (element instanceof HTMLElement) {
        element.innerText = value;
        return;
      }
      element.textContent = value;
      return;
    case "attribute":
      if (!attributeName?.trim()) {
        throw new Error("attributeName is required when target is attribute.");
      }
      element.setAttribute(attributeName.trim(), value);
      return;
    case "textContent":
    default:
      element.textContent = value;
  }
}

function dispatchMutationEvents(
  element: Element,
  target: ResolvedDomSetValueTarget,
): void {
  if (target === "value") {
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }

  element.dispatchEvent(new Event("input", { bubbles: true }));
}

function sanitizeMutationValue(
  element: Element,
  target: ResolvedDomSetValueTarget,
  value: string,
): string {
  if (
    target === "value" &&
    element instanceof HTMLInputElement &&
    element.type === "password" &&
    value.length > 0
  ) {
    return "[REDACTED]";
  }

  return sanitizeText(value, SANITIZE_LIMITS.elementText);
}

const MAX_SEMANTIC_CANDIDATES = 1000;
const SEMANTIC_ROLES = new Set([
  "banner",
  "button",
  "checkbox",
  "combobox",
  "complementary",
  "contentinfo",
  "dialog",
  "form",
  "heading",
  "img",
  "link",
  "list",
  "listbox",
  "listitem",
  "main",
  "menu",
  "menuitem",
  "navigation",
  "option",
  "radio",
  "search",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "table",
  "textbox",
]);
const INTERACTIVE_SEMANTIC_ROLES = new Set([
  "button",
  "checkbox",
  "combobox",
  "link",
  "listbox",
  "menuitem",
  "option",
  "radio",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "textbox",
]);

function toSemanticSnapshotCandidate(
  element: Element,
  role: string,
  selector: string,
  rect: DOMRect,
): SemanticSnapshotCandidate {
  const interactive = INTERACTIVE_SEMANTIC_ROLES.has(role);
  const name = getAccessibleName(element);
  const controlValues = readSafeControlValues(element, name);
  const headingLevel = /^h([1-6])$/i.exec(element.tagName)?.[1];
  const disabled = interactive && isElementDisabled(element);
  const required = interactive && isElementRequired(element);
  const readOnly = interactive && isElementReadOnly(element);
  const focused = interactive && document.activeElement === element;
  return {
    role: sanitizeText(role, 80),
    name,
    selector: sanitizeText(selector, 400),
    tagName: element.tagName.toLowerCase(),
    description: getAccessibleDescription(element),
    href:
      element instanceof HTMLAnchorElement && element.href
        ? sanitizeUrl(element.href)
        : undefined,
    ...controlValues,
    disabled: disabled ? true : undefined,
    checked: readCheckedState(element),
    pressed: readAriaTriState(element, "aria-pressed"),
    expanded: readAriaBoolean(element, "aria-expanded"),
    selected:
      element instanceof HTMLOptionElement
        ? element.selected
        : readAriaBoolean(element, "aria-selected"),
    required: required ? true : undefined,
    readOnly: readOnly ? true : undefined,
    focused: focused ? true : undefined,
    level: headingLevel
      ? Number(headingLevel)
      : role === "heading"
        ? readPositiveInteger(element.getAttribute("aria-level"))
        : undefined,
    bounds: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
  };
}

function readSafeControlValues(
  element: Element,
  accessibleName: string,
): Pick<SemanticSnapshotCandidate, "value" | "selectedValues"> {
  const descriptor = {
    tagName: element.tagName.toLowerCase(),
    role: getSemanticRole(element),
    inputType:
      element instanceof HTMLInputElement ? element.type : undefined,
    accessibleName,
    id: element.id || undefined,
    name:
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement
        ? element.name || undefined
        : undefined,
    autocomplete:
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement
        ? element.autocomplete || undefined
        : undefined,
    placeholder:
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement
        ? element.placeholder || undefined
        : undefined,
    testId: element.getAttribute("data-testid") ?? undefined,
  };
  if (classifyActionTarget(descriptor).dataSensitivity === "sensitive") {
    return {};
  }
  if (element instanceof HTMLSelectElement) {
    return {
      value: sanitizeText(element.value, SANITIZE_LIMITS.elementText),
      selectedValues: Array.from(element.selectedOptions, (option) =>
        sanitizeText(option.value, SANITIZE_LIMITS.elementText),
      ).slice(0, 50),
    };
  }
  if (
    element instanceof HTMLInputElement &&
    !["checkbox", "radio", "file"].includes(element.type)
  ) {
    return {
      value: sanitizeText(element.value, SANITIZE_LIMITS.elementText),
    };
  }
  if (element instanceof HTMLTextAreaElement) {
    return {
      value: sanitizeText(element.value, SANITIZE_LIMITS.elementText),
    };
  }
  return {};
}

function getSemanticRole(element: Element): string | undefined {
  const explicitRole = element.getAttribute("role")?.trim().toLowerCase();
  if (explicitRole && explicitRole !== "none" && explicitRole !== "presentation") {
    return explicitRole.split(/\s+/)[0];
  }

  const tagName = element.tagName.toLowerCase();
  if (tagName === "a" && element.hasAttribute("href")) return "link";
  if (tagName === "button" || tagName === "summary") return "button";
  if (tagName === "textarea") return "textbox";
  if (tagName === "select") {
    return element instanceof HTMLSelectElement && element.multiple
      ? "listbox"
      : "combobox";
  }
  if (tagName === "option") return "option";
  if (tagName === "img" && element.getAttribute("alt") !== "") return "img";
  if (/^h[1-6]$/.test(tagName)) return "heading";
  if (tagName === "nav") return "navigation";
  if (tagName === "main") return "main";
  if (tagName === "header") return "banner";
  if (tagName === "footer") return "contentinfo";
  if (tagName === "aside") return "complementary";
  if (tagName === "dialog") return "dialog";
  if (tagName === "form") return "form";
  if (tagName === "table") return "table";
  if (tagName === "ul" || tagName === "ol") return "list";
  if (tagName === "li") return "listitem";
  if (tagName === "input" && element instanceof HTMLInputElement) {
    switch (element.type) {
      case "hidden":
        return undefined;
      case "button":
      case "reset":
      case "submit":
        return "button";
      case "checkbox":
        return "checkbox";
      case "radio":
        return "radio";
      case "range":
        return "slider";
      case "number":
        return "spinbutton";
      case "search":
        return "searchbox";
      default:
        return "textbox";
    }
  }
  return undefined;
}

function getAccessibleName(element: Element): string {
  const ariaLabel = element.getAttribute("aria-label")?.trim();
  if (ariaLabel) return sanitizeText(ariaLabel, 240);

  const labelledBy = element.getAttribute("aria-labelledby")?.trim();
  if (labelledBy) {
    const label = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ")
      .trim();
    if (label) return sanitizeText(label, 240);
  }

  const controlLabels = getControlLabels(element);
  if (controlLabels) return sanitizeText(controlLabels, 240);
  if (element instanceof HTMLImageElement && element.alt.trim()) {
    return sanitizeText(element.alt, 240);
  }
  if (
    element instanceof HTMLInputElement &&
    ["button", "reset", "submit"].includes(element.type) &&
    element.value.trim()
  ) {
    return sanitizeText(element.value, 240);
  }
  const title = element.getAttribute("title")?.trim();
  if (title) return sanitizeText(title, 240);
  const placeholder = element.getAttribute("placeholder")?.trim();
  if (placeholder) return sanitizeText(placeholder, 240);
  return sanitizeText(element.textContent ?? "", 240);
}

function getControlLabels(element: Element): string {
  let labels: NodeListOf<HTMLLabelElement> | null = null;
  if (
    element instanceof HTMLButtonElement ||
    element instanceof HTMLInputElement ||
    element instanceof HTMLMeterElement ||
    element instanceof HTMLOutputElement ||
    element instanceof HTMLProgressElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
  ) {
    labels = element.labels;
  }
  return labels
    ? Array.from(labels)
        .map((label) => label.textContent ?? "")
        .join(" ")
        .trim()
    : "";
}

function getAccessibleDescription(element: Element): string | undefined {
  const describedBy = element.getAttribute("aria-describedby")?.trim();
  if (!describedBy) return undefined;
  const description = describedBy
    .split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ")
    .trim();
  return description ? sanitizeText(description, 300) : undefined;
}

function isElementDisabled(element: Element): boolean {
  return (
    ("disabled" in element && Boolean((element as { disabled?: boolean }).disabled)) ||
    element.getAttribute("aria-disabled") === "true"
  );
}

function isElementRequired(element: Element): boolean {
  return (
    ("required" in element && Boolean((element as { required?: boolean }).required)) ||
    element.getAttribute("aria-required") === "true"
  );
}

function isElementReadOnly(element: Element): boolean {
  return (
    ("readOnly" in element && Boolean((element as { readOnly?: boolean }).readOnly)) ||
    element.getAttribute("aria-readonly") === "true"
  );
}

function readCheckedState(element: Element): SemanticCheckedState | undefined {
  if (
    element instanceof HTMLInputElement &&
    (element.type === "checkbox" || element.type === "radio")
  ) {
    return element.indeterminate ? "mixed" : element.checked;
  }
  return readAriaTriState(element, "aria-checked");
}

function readAriaTriState(
  element: Element,
  attribute: "aria-checked" | "aria-pressed",
): SemanticCheckedState | undefined {
  const value = element.getAttribute(attribute);
  if (value === "mixed") return "mixed";
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function readAriaBoolean(
  element: Element,
  attribute: "aria-expanded" | "aria-selected",
): boolean | undefined {
  const value = element.getAttribute(attribute);
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function readPositiveInteger(value: string | null): number | undefined {
  const parsed = value ? Number(value) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function getVisibleElementRect(element: Element): DOMRect | undefined {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);

  return rect.width > 0 &&
    rect.height > 0 &&
    style.visibility !== "hidden" &&
    style.display !== "none" &&
    Number(style.opacity || "1") > 0
      ? rect
      : undefined;
}

function directText(element: Element): string {
  const parts: string[] = [];
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      parts.push(child.textContent ?? "");
    }
  }

  return parts.join(" ");
}

function getSanitizedAttributes(element: Element): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const attribute of Array.from(element.attributes)) {
    attributes[attribute.name] = sanitizeAttributeValue(
      attribute.name,
      attribute.value,
    );
  }

  return attributes;
}

function normalizeQueryLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) {
    return 5;
  }
  return Math.max(
    1,
    Math.min(Math.floor(limit ?? 5), SANITIZE_LIMITS.queryResults),
  );
}

function normalizeSnapshotLimit(
  limit: number | undefined,
  fallback: number,
): number {
  if (limit === 0) {
    return Number.MAX_SAFE_INTEGER;
  }
  if (!Number.isFinite(limit)) {
    return fallback;
  }
  return Math.max(1, Math.floor(limit ?? fallback));
}

function sanitizeOuterHtml(
  element: Element,
  maxLength?: number,
): string {
  const clone = element.cloneNode(true) as Element;

  clone
    .querySelectorAll("script, style, noscript, template")
    .forEach((node) => node.remove());

  return sanitizeHtmlSnippet(
    clone.outerHTML,
    normalizeSnapshotLimit(maxLength, SANITIZE_LIMITS.outerHTML),
  );
}

function getComputedStyleSubset(
  element: Element,
  properties: readonly ComputedStyleProperty[] = DEFAULT_COMPUTED_STYLE_PROPERTIES,
): Record<string, string> {
  const style = window.getComputedStyle(element);
  const subset: Record<string, string> = {};

  for (const key of properties) {
    subset[key] = sanitizeText(style.getPropertyValue(key), 240);
  }

  return subset;
}

function createOverlayForElement(
  element: Element,
  className: string,
): HTMLDivElement {
  const rect = element.getBoundingClientRect();
  const overlay = document.createElement("div");
  overlay.className = className;
  overlay.style.top = `${rect.top}px`;
  overlay.style.left = `${rect.left}px`;
  overlay.style.width = `${rect.width}px`;
  overlay.style.height = `${rect.height}px`;
  overlay.style.setProperty(
    "--ai-devtools-label",
    `"${truncateText(getCssSelector(element), 120)}"`,
  );

  return overlay;
}

function ensureHighlightStyle(): void {
  if (document.getElementById(HIGHLIGHT_STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = HIGHLIGHT_STYLE_ID;
  style.textContent = `
    .${HIGHLIGHT_CLASS} {
      position: fixed !important;
      pointer-events: none !important;
      z-index: 2147483646 !important;
      border: 2px solid #00b894 !important;
      background: rgba(0, 184, 148, 0.12) !important;
      box-shadow: 0 0 0 9999px rgba(15, 23, 42, 0.08) !important;
      box-sizing: border-box !important;
    }
    .${HIGHLIGHT_CLASS}::after {
      content: var(--ai-devtools-label);
      position: absolute;
      top: -24px;
      left: 0;
      max-width: 320px;
      padding: 2px 6px;
      overflow: hidden;
      color: #ffffff;
      font: 12px/18px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      text-overflow: ellipsis;
      white-space: nowrap;
      background: #0f172a;
      border-radius: 4px;
    }
  `;
  document.documentElement.appendChild(style);
}

function toRectSnapshot(rect: DOMRect): DomRectSnapshot {
  return {
    x: round(rect.x),
    y: round(rect.y),
    top: round(rect.top),
    right: round(rect.right),
    bottom: round(rect.bottom),
    left: round(rect.left),
    width: round(rect.width),
    height: round(rect.height),
  };
}

function normalizeClassName(value: string): string {
  return value.trim().replace(/^\./, "");
}

function escapeCss(value: string): string {
  if (globalThis.CSS?.escape) {
    return globalThis.CSS.escape(value);
  }

  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
