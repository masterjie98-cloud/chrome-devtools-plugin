import type { DomElementInfo, DomSummaryNode, PageSnapshot } from "./dom";
import type { SemanticSnapshotNode } from "./semanticSnapshot";
import {
  SANITIZE_LIMITS,
  sanitizeHtmlSnippet,
  sanitizeText,
  sanitizeUrl,
} from "./sanitize";
import { sanitizeElementForMcp } from "./wsProtocol";

export interface ContextCompressionOptions {
  visibleTextLimit?: number;
  outlineCharLimit?: number;
  outlineNodeLimit?: number;
  interactiveLimit?: number;
  selectedElementHtmlLimit?: number;
  includeExecutionMap?: boolean;
  executionMapLimit?: number;
}

export interface CompressedDomNode {
  depth: number;
  tagName: string;
  selector: string;
  id?: string;
  className?: string;
  role?: string;
  ariaLabel?: string;
  text?: string;
  childElementCount: number;
}

export interface CompressedSelectedElement {
  selector: string;
  tagName: string;
  id?: string;
  className?: string;
  text?: string;
  attributes: Record<string, string>;
  computedStyle: Record<string, string>;
  rect: DomElementInfo["rect"];
  outerHTML: string;
}

export interface CompressedExecutionControl {
  ref: string;
  role: string;
  name: string;
  selector: string;
  tagName: string;
  description?: string;
  disabled?: boolean;
  checked?: SemanticSnapshotNode["checked"];
  expanded?: boolean;
  required?: boolean;
  readOnly?: boolean;
  bounds: SemanticSnapshotNode["bounds"];
}

export interface CompressedPageContext {
  version: "page-context-digest-v1";
  generatedAt: string;
  page: {
    url: string;
    title: string;
    origin: string;
    capturedAt: string;
    nodeCount: number;
    truncated: boolean;
  };
  visibleTextExcerpt: string;
  outline: CompressedDomNode[];
  interactiveElements: CompressedDomNode[];
  executionMap?: CompressedExecutionControl[];
  selectedElement?: CompressedSelectedElement;
  stats: {
    sourceVisibleTextChars: number;
    sourceDomNodeCount: number;
    outlineNodes: number;
    interactiveNodes: number;
    executionNodes: number;
    outputChars: number;
    truncated: boolean;
  };
}

const DEFAULT_OUTLINE_CHAR_LIMIT = 6000;
const DEFAULT_OUTLINE_NODE_LIMIT = 60;
const DEFAULT_INTERACTIVE_LIMIT = 30;
const DEFAULT_SELECTED_HTML_LIMIT = 3000;
const DEFAULT_EXECUTION_MAP_LIMIT = 80;

const INTERACTIVE_TAGS = new Set([
  "a",
  "button",
  "details",
  "dialog",
  "form",
  "input",
  "label",
  "option",
  "select",
  "summary",
  "textarea",
]);

const INTERACTIVE_ROLES = new Set([
  "button",
  "checkbox",
  "combobox",
  "dialog",
  "link",
  "listbox",
  "menu",
  "menuitem",
  "option",
  "radio",
  "searchbox",
  "switch",
  "tab",
  "textbox",
]);

const EXECUTION_ROLES = new Set([
  "button",
  "checkbox",
  "combobox",
  "listbox",
  "radio",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "textbox",
]);

export function buildCompressedPageContext(
  pageSnapshot: PageSnapshot,
  selectedElement?: DomElementInfo,
  options: ContextCompressionOptions = {},
): CompressedPageContext {
  const flattenedNodes = flattenDomSummary(pageSnapshot.domSummary);
  const outline = buildOutline(flattenedNodes, options);
  const interactiveElements = flattenedNodes
    .filter(isInteractiveNode)
    .slice(0, options.interactiveLimit ?? DEFAULT_INTERACTIVE_LIMIT)
    .map(({ node, depth }) => compressDomNode(node, depth));
  const executionMap = options.includeExecutionMap
    ? (pageSnapshot.semanticSnapshot?.nodes ?? [])
        .filter((node) => EXECUTION_ROLES.has(node.role))
        .slice(0, options.executionMapLimit ?? DEFAULT_EXECUTION_MAP_LIMIT)
        .map(compressExecutionControl)
    : undefined;

  const baseDigest: Omit<CompressedPageContext, "stats"> = {
    version: "page-context-digest-v1",
    generatedAt: new Date().toISOString(),
    page: {
      url: sanitizeUrl(pageSnapshot.url),
      title: sanitizeText(pageSnapshot.title, 300),
      origin: sanitizeUrl(pageSnapshot.origin),
      capturedAt: pageSnapshot.capturedAt,
      nodeCount: pageSnapshot.nodeCount,
      truncated: pageSnapshot.truncated,
    },
    visibleTextExcerpt: sanitizeText(
      pageSnapshot.visibleText,
      options.visibleTextLimit ?? SANITIZE_LIMITS.visibleText,
    ),
    outline,
    interactiveElements,
    executionMap,
    selectedElement: selectedElement
      ? compressSelectedElement(selectedElement, options)
      : undefined,
  };

  const stats = {
    sourceVisibleTextChars: pageSnapshot.visibleText.length,
    sourceDomNodeCount: pageSnapshot.nodeCount,
    outlineNodes: outline.length,
    interactiveNodes: interactiveElements.length,
    executionNodes: executionMap?.length ?? 0,
    outputChars: JSON.stringify(baseDigest).length,
    truncated:
      pageSnapshot.truncated ||
      outline.length < flattenedNodes.length ||
      pageSnapshot.visibleText.length >
        (options.visibleTextLimit ?? SANITIZE_LIMITS.visibleText) ||
      Boolean(
        options.includeExecutionMap &&
          pageSnapshot.semanticSnapshot?.pagination.hasMore,
      ),
  };

  return {
    ...baseDigest,
    stats,
  };
}

function compressExecutionControl(
  node: SemanticSnapshotNode,
): CompressedExecutionControl {
  return {
    ref: node.ref,
    role: node.role,
    name: node.name,
    selector: node.selector,
    tagName: node.tagName,
    description: node.description,
    disabled: node.disabled,
    checked: node.checked,
    expanded: node.expanded,
    required: node.required,
    readOnly: node.readOnly,
    bounds: node.bounds,
  };
}

function buildOutline(
  nodes: Array<{ node: DomSummaryNode; depth: number }>,
  options: ContextCompressionOptions,
): CompressedDomNode[] {
  const limit = options.outlineNodeLimit ?? DEFAULT_OUTLINE_NODE_LIMIT;
  const charLimit = options.outlineCharLimit ?? DEFAULT_OUTLINE_CHAR_LIMIT;
  const outline: CompressedDomNode[] = [];
  let usedChars = 0;

  for (const { node, depth } of nodes) {
    if (outline.length >= limit) {
      break;
    }

    const compressed = compressDomNode(node, depth);
    const entryChars = JSON.stringify(compressed).length;
    if (outline.length > 0 && usedChars + entryChars > charLimit) {
      break;
    }

    outline.push(compressed);
    usedChars += entryChars;
  }

  return outline;
}

function compressDomNode(node: DomSummaryNode, depth: number): CompressedDomNode {
  return {
    depth,
    tagName: sanitizeText(node.tagName, 60),
    selector: sanitizeText(node.selector, 400),
    id: node.id ? sanitizeText(node.id, 100) : undefined,
    className: node.className ? sanitizeText(node.className, 160) : undefined,
    role: node.role ? sanitizeText(node.role, 120) : undefined,
    ariaLabel: node.ariaLabel ? sanitizeText(node.ariaLabel, 160) : undefined,
    text: node.text
      ? sanitizeText(node.text, SANITIZE_LIMITS.domSummaryText)
      : undefined,
    childElementCount: node.childElementCount,
  };
}

function compressSelectedElement(
  selectedElement: DomElementInfo,
  options: ContextCompressionOptions,
): CompressedSelectedElement {
  const element = sanitizeElementForMcp(selectedElement);
  const attributes = Object.fromEntries(
    Object.entries(element.attributes).slice(0, 20),
  );

  return {
    selector: element.selector,
    tagName: element.tagName,
    id: element.id,
    className: element.className,
    text: element.text,
    attributes,
    computedStyle: element.computedStyle,
    rect: element.rect,
    outerHTML: sanitizeHtmlSnippet(
      element.outerHTML,
      options.selectedElementHtmlLimit ?? DEFAULT_SELECTED_HTML_LIMIT,
    ),
  };
}

function flattenDomSummary(
  nodes: DomSummaryNode[],
  depth = 0,
): Array<{ node: DomSummaryNode; depth: number }> {
  const flattened: Array<{ node: DomSummaryNode; depth: number }> = [];

  for (const node of nodes) {
    flattened.push({ node, depth });
    if (node.children?.length) {
      flattened.push(...flattenDomSummary(node.children, depth + 1));
    }
  }

  return flattened;
}

function isInteractiveNode({
  node,
}: {
  node: DomSummaryNode;
  depth: number;
}): boolean {
  return (
    INTERACTIVE_TAGS.has(node.tagName.toLowerCase()) ||
    (node.role ? INTERACTIVE_ROLES.has(node.role.toLowerCase()) : false) ||
    Boolean(node.ariaLabel)
  );
}
