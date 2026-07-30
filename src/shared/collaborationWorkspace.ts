import { createMessageId } from "./messaging";
import { sanitizeText, sanitizeUrl } from "./sanitize";
import { redactSensitiveData } from "./sensitiveData";

export const COLLABORATION_WORKSPACE_VERSION = "collaboration-workspace-v1" as const;

export const COLLABORATION_ITEM_KINDS = [
  "page.style",
  "page.dom",
  "page.semantic",
  "page.screenshot",
  "network.trace",
  "network.mock_scenario",
  "task.request",
  "task.state",
  "task.result",
  "code.finding",
  "implementation.note",
  "note",
] as const;

export type CollaborationItemKind =
  (typeof COLLABORATION_ITEM_KINDS)[number];

export const COLLABORATION_ACTORS = [
  "extension_agent",
  "mcp_agent",
  "user",
  "system",
] as const;

export type CollaborationActor = (typeof COLLABORATION_ACTORS)[number];
export type CollaborationVisibility = "shared" | "private";
export type CollaborationSensitivity = "safe" | "page_content" | "sensitive";
export type CollaborationItemStatus =
  | "active"
  | "resolved"
  | "superseded";

export type CollaborationJsonValue =
  | null
  | boolean
  | number
  | string
  | CollaborationJsonValue[]
  | { [key: string]: CollaborationJsonValue };

export interface CollaborationTargetBinding {
  targetId?: string;
  tabId?: number;
  windowId?: number;
  frameId?: number;
  documentId?: string;
  navigationId?: string;
  revision?: number;
  url?: string;
}

export interface CollaborationItemSource {
  actor: CollaborationActor;
  clientId?: string;
}

export interface CollaborationItem {
  id: string;
  kind: CollaborationItemKind;
  title: string;
  summary: string;
  content?: CollaborationJsonValue;
  tags: string[];
  visibility: CollaborationVisibility;
  sensitivity: CollaborationSensitivity;
  status: CollaborationItemStatus;
  source: CollaborationItemSource;
  target?: CollaborationTargetBinding;
  parentId?: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}

export interface CollaborationWorkspaceSnapshot {
  version: typeof COLLABORATION_WORKSPACE_VERSION;
  revision: number;
  items: CollaborationItem[];
}

export interface CollaborationItemInput {
  id?: string;
  kind: CollaborationItemKind;
  title: string;
  summary: string;
  content?: unknown;
  tags?: string[];
  visibility?: CollaborationVisibility;
  sensitivity?: CollaborationSensitivity;
  status?: CollaborationItemStatus;
  target?: CollaborationTargetBinding;
  parentId?: string;
  expectedRevision?: number;
  expiresAt?: string;
}

export interface CollaborationWorkspaceMutationResult {
  workspace: CollaborationWorkspaceSnapshot;
  item: CollaborationItem;
}

export const MAX_COLLABORATION_ITEMS = 100;
export const MAX_COLLABORATION_CONTENT_BYTES = 32 * 1024;
export const MAX_COLLABORATION_WORKSPACE_BYTES = 256 * 1024;
// Keep room for one maximum inline payload plus its bounded metadata. The hard
// ceiling protects Profile persistence and replay; compaction should happen
// before a normal publication reaches that ceiling.
const COLLABORATION_WORKSPACE_HEADROOM_BYTES =
  MAX_COLLABORATION_CONTENT_BYTES + 16 * 1024;
const RETAINED_COLLABORATION_WORKSPACE_BYTES =
  MAX_COLLABORATION_WORKSPACE_BYTES -
  COLLABORATION_WORKSPACE_HEADROOM_BYTES;

const ITEM_ID_PATTERN = /^ctx_[A-Za-z0-9_-]{8,200}$/;
const MAX_JSON_DEPTH = 6;
const MAX_ARRAY_ITEMS = 80;
const MAX_OBJECT_KEYS = 80;

export function createEmptyCollaborationWorkspace(): CollaborationWorkspaceSnapshot {
  return {
    version: COLLABORATION_WORKSPACE_VERSION,
    revision: 0,
    items: [],
  };
}

export function upsertCollaborationItem(
  workspace: CollaborationWorkspaceSnapshot,
  input: CollaborationItemInput,
  source: CollaborationItemSource,
  now = new Date().toISOString(),
  options: { allowOwnerLastWriteWithoutRevision?: boolean } = {},
): CollaborationWorkspaceMutationResult {
  assertWorkspaceSnapshot(workspace, now);
  const normalizedSource = sanitizeSource(source);
  const itemId = normalizeItemId(input.id ?? `ctx_${createMessageId()}`);
  const existingIndex = workspace.items.findIndex((item) => item.id === itemId);
  const existing = existingIndex >= 0 ? workspace.items[existingIndex] : undefined;

  if (existing) {
    if (
      input.expectedRevision !== existing.revision &&
      !(
        input.expectedRevision === undefined &&
        options.allowOwnerLastWriteWithoutRevision
      )
    ) {
      throw new Error(
        `COLLABORATION_REVISION_CONFLICT: item ${itemId} is revision ${existing.revision}; refresh the workspace before updating it.`,
      );
    }
    if (existing.source.actor !== normalizedSource.actor) {
      throw new Error(
        "COLLABORATION_OWNER_MISMATCH: publish a linked response instead of overwriting another participant's item.",
      );
    }
  } else if (input.expectedRevision !== undefined) {
    throw new Error(
      `COLLABORATION_REVISION_CONFLICT: item ${itemId} does not exist.`,
    );
  }

  const item = sanitizeCollaborationItem(
    {
      id: itemId,
      kind: input.kind,
      title: input.title,
      summary: input.summary,
      content: input.content,
      tags: input.tags ?? [],
      visibility: input.visibility ?? "shared",
      sensitivity: input.sensitivity ?? "page_content",
      status: input.status ?? existing?.status ?? "active",
      source: normalizedSource,
      target: input.target,
      parentId: input.parentId,
      revision: (existing?.revision ?? 0) + 1,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      expiresAt: input.expiresAt,
    },
  );

  const items = [...workspace.items];
  if (existingIndex >= 0) {
    items.splice(existingIndex, 1, item);
  } else {
    items.push(item);
  }

  const nextWorkspace = {
    version: COLLABORATION_WORKSPACE_VERSION,
    revision: workspace.revision + 1,
    items: retainBoundedItems(items, now, item.id),
  } satisfies CollaborationWorkspaceSnapshot;
  assertWorkspaceByteLimit(nextWorkspace);

  return {
    workspace: nextWorkspace,
    item,
  };
}

export function sanitizeCollaborationItemInput(
  input: CollaborationItemInput,
): CollaborationItemInput {
  if (!isCollaborationItemKind(input.kind)) {
    throw new Error(`Unsupported collaboration item kind: ${String(input.kind)}`);
  }
  if (
    input.visibility !== undefined &&
    !isCollaborationVisibility(input.visibility)
  ) {
    throw new Error("Collaboration item visibility is invalid.");
  }
  if (
    input.sensitivity !== undefined &&
    !isCollaborationSensitivity(input.sensitivity)
  ) {
    throw new Error("Collaboration item sensitivity is invalid.");
  }
  if (input.status !== undefined && !isCollaborationItemStatus(input.status)) {
    throw new Error("Collaboration item status is invalid.");
  }
  if (
    input.expectedRevision !== undefined &&
    (!Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 1)
  ) {
    throw new Error("Collaboration item expectedRevision is invalid.");
  }
  if (
    input.expiresAt !== undefined &&
    (!isIsoTimestamp(input.expiresAt) || input.expiresAt.length > 64)
  ) {
    throw new Error("Collaboration item expiresAt is invalid.");
  }
  const content = input.content === undefined
    ? undefined
    : sanitizeJsonValue(redactSensitiveData(input.content), 0);
  if (
    content !== undefined &&
    new TextEncoder().encode(JSON.stringify(content)).byteLength >
      MAX_COLLABORATION_CONTENT_BYTES
  ) {
    throw new Error(
      `PAYLOAD_TOO_LARGE: collaboration item content exceeds ${MAX_COLLABORATION_CONTENT_BYTES} bytes. Publish a smaller summary or an artifact reference.`,
    );
  }
  return {
    id: input.id === undefined ? undefined : normalizeItemId(input.id),
    kind: input.kind,
    title: sanitizeRequiredText(input.title, 240, "title"),
    summary: sanitizeRequiredText(input.summary, 2000, "summary"),
    content,
    tags: input.tags === undefined ? undefined : sanitizeTags(input.tags),
    visibility: input.visibility,
    sensitivity: input.sensitivity,
    status: input.status,
    target:
      input.target === undefined
        ? undefined
        : toCollaborationTargetBinding(input.target),
    parentId:
      input.parentId === undefined
        ? undefined
        : normalizeItemId(input.parentId),
    expectedRevision: input.expectedRevision,
    expiresAt: input.expiresAt,
  };
}

export function sanitizeCollaborationWorkspace(
  value: unknown,
  now = new Date().toISOString(),
): CollaborationWorkspaceSnapshot {
  if (!isRecord(value)) {
    throw new Error("Collaboration workspace must be an object.");
  }
  if (
    value.version !== COLLABORATION_WORKSPACE_VERSION ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 0 ||
    !Array.isArray(value.items) ||
    value.items.length > MAX_COLLABORATION_ITEMS
  ) {
    throw new Error("Collaboration workspace metadata is invalid.");
  }
  const items = value.items.map(sanitizeCollaborationItem);
  if (new Set(items.map((item) => item.id)).size !== items.length) {
    throw new Error("Collaboration workspace contains duplicate item IDs.");
  }
  const workspace = {
    version: COLLABORATION_WORKSPACE_VERSION,
    revision: value.revision as number,
    items: retainBoundedItems(items, now),
  } satisfies CollaborationWorkspaceSnapshot;
  assertWorkspaceByteLimit(workspace);
  return workspace;
}

export function collaborationWorkspaceForMcp(
  workspace: CollaborationWorkspaceSnapshot,
): CollaborationWorkspaceSnapshot {
  const safe = sanitizeCollaborationWorkspace(workspace);
  return {
    ...safe,
    items: safe.items.flatMap((item) => {
      if (item.visibility !== "shared") {
        return [];
      }
      if (item.sensitivity !== "sensitive") {
        return [item];
      }
      return [
        {
          ...item,
          title: "Sensitive collaboration item",
          summary: "Sensitive collaboration content is not exposed through the direct MCP resource. Publish a redacted item or perform a separate approval-gated browser read.",
          content: undefined,
          tags: [],
          target: undefined,
        },
      ];
    }),
  };
}

export function sanitizeCollaborationItem(value: unknown): CollaborationItem {
  if (!isRecord(value)) {
    throw new Error("Collaboration item must be an object.");
  }
  const id = normalizeItemId(value.id);
  if (!isCollaborationItemKind(value.kind)) {
    throw new Error(`Unsupported collaboration item kind: ${String(value.kind)}`);
  }
  if (!isCollaborationVisibility(value.visibility)) {
    throw new Error("Collaboration item visibility is invalid.");
  }
  if (!isCollaborationSensitivity(value.sensitivity)) {
    throw new Error("Collaboration item sensitivity is invalid.");
  }
  if (!isCollaborationItemStatus(value.status)) {
    throw new Error("Collaboration item status is invalid.");
  }
  if (
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 1 ||
    !isIsoTimestamp(value.createdAt) ||
    !isIsoTimestamp(value.updatedAt) ||
    (value.expiresAt !== undefined && !isIsoTimestamp(value.expiresAt))
  ) {
    throw new Error("Collaboration item revision or timestamps are invalid.");
  }
  if (value.parentId !== undefined) {
    normalizeItemId(value.parentId);
  }
  const content = value.content === undefined
    ? undefined
    : sanitizeJsonValue(redactSensitiveData(value.content), 0);
  if (
    content !== undefined &&
    new TextEncoder().encode(JSON.stringify(content)).byteLength >
      MAX_COLLABORATION_CONTENT_BYTES
  ) {
    throw new Error(
      `PAYLOAD_TOO_LARGE: collaboration item content exceeds ${MAX_COLLABORATION_CONTENT_BYTES} bytes. Publish a smaller summary or an artifact reference.`,
    );
  }
  return {
    id,
    kind: value.kind,
    title: sanitizeRequiredText(value.title, 240, "title"),
    summary: sanitizeRequiredText(value.summary, 2000, "summary"),
    content,
    tags: sanitizeTags(value.tags),
    visibility: value.visibility,
    sensitivity: value.sensitivity,
    status: value.status,
    source: sanitizeSource(value.source),
    target:
      value.target === undefined
        ? undefined
        : toCollaborationTargetBinding(value.target),
    parentId: value.parentId as string | undefined,
    revision: value.revision as number,
    createdAt: value.createdAt as string,
    updatedAt: value.updatedAt as string,
    expiresAt: value.expiresAt as string | undefined,
  };
}

function sanitizeJsonValue(value: unknown, depth: number): CollaborationJsonValue {
  if (depth > MAX_JSON_DEPTH) {
    throw new Error("COLLABORATION_CONTENT_INVALID: JSON nesting is too deep.");
  }
  if (value === null || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("COLLABORATION_CONTENT_INVALID: numbers must be finite.");
    }
    return value;
  }
  if (typeof value === "string") {
    return sanitizeText(value, 4000);
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_ITEMS) {
      throw new Error(
        `COLLABORATION_CONTENT_INVALID: arrays are limited to ${MAX_ARRAY_ITEMS} entries.`,
      );
    }
    return value.map((entry) =>
      entry === undefined ? null : sanitizeJsonValue(entry, depth + 1)
    );
  }
  if (isRecord(value)) {
    const entries = Object.entries(value).filter(
      ([, entry]) => entry !== undefined,
    );
    if (entries.length > MAX_OBJECT_KEYS) {
      throw new Error(
        `COLLABORATION_CONTENT_INVALID: objects are limited to ${MAX_OBJECT_KEYS} keys.`,
      );
    }
    return Object.fromEntries(
      entries.map(([key, entry]) => [
        sanitizeRequiredText(key, 120, "content key"),
        sanitizeJsonValue(entry, depth + 1),
      ]),
    );
  }
  throw new Error("COLLABORATION_CONTENT_INVALID: content must be JSON-serializable.");
}

function sanitizeSource(value: unknown): CollaborationItemSource {
  if (!isRecord(value) || !isCollaborationActor(value.actor)) {
    throw new Error("Collaboration item source is invalid.");
  }
  return {
    actor: value.actor,
    clientId:
      value.clientId === undefined
        ? undefined
        : sanitizeRequiredText(value.clientId, 200, "source clientId"),
  };
}

export function toCollaborationTargetBinding(
  value: unknown,
): CollaborationTargetBinding {
  if (!isRecord(value)) {
    throw new Error("Collaboration target must be an object.");
  }
  const integerFields = ["tabId", "windowId", "frameId", "revision"] as const;
  for (const key of integerFields) {
    if (
      value[key] !== undefined &&
      (!Number.isSafeInteger(value[key]) || Number(value[key]) < 0)
    ) {
      throw new Error(`Collaboration target ${key} must be a non-negative integer.`);
    }
  }
  return {
    targetId: optionalOpaqueIdentifier(value.targetId, 200, "targetId"),
    tabId: value.tabId as number | undefined,
    windowId: value.windowId as number | undefined,
    frameId: value.frameId as number | undefined,
    documentId: optionalOpaqueIdentifier(value.documentId, 300, "documentId"),
    navigationId: optionalOpaqueIdentifier(
      value.navigationId,
      300,
      "navigationId",
    ),
    revision: value.revision as number | undefined,
    url: typeof value.url === "string" ? sanitizeUrl(value.url) : undefined,
  };
}

function sanitizeTags(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 20) {
    throw new Error("Collaboration item tags must be an array with at most 20 entries.");
  }
  return Array.from(
    new Set(value.map((tag) => sanitizeRequiredText(tag, 80, "tag"))),
  );
}

function retainBoundedItems(
  items: CollaborationItem[],
  now: string,
  preferredItemId?: string,
): CollaborationItem[] {
  const nowMs = Date.parse(now);
  const unexpired = items.filter(
    (item) => !item.expiresAt || Date.parse(item.expiresAt) > nowMs,
  );
  const itemById = new Map(unexpired.map((item) => [item.id, item]));
  const groups = new Map<string, CollaborationItem[]>();
  for (const item of unexpired) {
    const rootId = collaborationGroupRootId(item, itemById);
    if (!rootId) {
      continue;
    }
    groups.set(rootId, [...(groups.get(rootId) ?? []), item]);
  }

  let preferredRootId: string | undefined;
  if (preferredItemId) {
    const preferredItem = itemById.get(preferredItemId);
    if (!preferredItem) {
      throw new Error(
        `COLLABORATION_ITEM_MISSING: item ${preferredItemId} was not available for persistence.`,
      );
    }
    preferredRootId = collaborationGroupRootId(preferredItem, itemById);
    if (!preferredRootId) {
      throw new Error(
        `COLLABORATION_PARENT_MISSING: item ${preferredItemId} must reference a retained parent chain.`,
      );
    }
  }
  const prioritizedGroups = [...groups.entries()].sort((left, right) => {
    if (left[0] === preferredRootId) {
      return -1;
    }
    if (right[0] === preferredRootId) {
      return 1;
    }
    const priorityDifference =
      collaborationGroupPriority(right[1]) -
      collaborationGroupPriority(left[1]);
    if (priorityDifference !== 0) {
      return priorityDifference;
    }
    return collaborationGroupUpdatedAt(right[1]).localeCompare(
      collaborationGroupUpdatedAt(left[1]),
    );
  });
  const retained: CollaborationItem[] = [];
  for (const [rootId, group] of prioritizedGroups) {
    const candidate = [...retained, ...group];
    const byteBudget =
      rootId === preferredRootId
        ? MAX_COLLABORATION_WORKSPACE_BYTES
        : RETAINED_COLLABORATION_WORKSPACE_BYTES;
    if (
      candidate.length > MAX_COLLABORATION_ITEMS ||
      collaborationItemsByteLength(candidate) > byteBudget
    ) {
      if (rootId === preferredRootId) {
        throw new Error(
          `PAYLOAD_TOO_LARGE: collaboration task group containing ${preferredItemId} cannot fit within ${MAX_COLLABORATION_WORKSPACE_BYTES} bytes. Publish large outputs as artifact references instead of inline task events.`,
        );
      }
      continue;
    }
    retained.push(...group);
  }

  return retained.sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
}

function collaborationGroupRootId(
  item: CollaborationItem,
  itemById: ReadonlyMap<string, CollaborationItem>,
): string | undefined {
  let current = item;
  const visited = new Set<string>();
  while (true) {
    if (visited.has(current.id)) {
      return undefined;
    }
    visited.add(current.id);
    if (!current.parentId) {
      return current.id;
    }
    const parent = itemById.get(current.parentId);
    if (!parent) {
      return undefined;
    }
    current = parent;
  }
}

function collaborationGroupPriority(items: CollaborationItem[]): number {
  const delegatedRequest = items.some((item) => item.kind === "task.request");
  const delegatedResult = items.some((item) => item.kind === "task.result");
  if (delegatedRequest && !delegatedResult) {
    return 3;
  }
  if (delegatedRequest && delegatedResult) {
    return 2;
  }
  if (
    items.some((item) => item.status === "active")
  ) {
    return 1;
  }
  return 0;
}

function collaborationGroupUpdatedAt(items: CollaborationItem[]): string {
  return items.reduce(
    (latest, item) => (item.updatedAt > latest ? item.updatedAt : latest),
    "",
  );
}

function collaborationItemsByteLength(items: CollaborationItem[]): number {
  return new TextEncoder().encode(
    JSON.stringify({
      version: COLLABORATION_WORKSPACE_VERSION,
      revision: 0,
      items,
    }),
  ).byteLength;
}

function normalizeItemId(value: unknown): string {
  if (typeof value !== "string" || !ITEM_ID_PATTERN.test(value)) {
    throw new Error("Collaboration item ID is invalid.");
  }
  return value;
}

function sanitizeRequiredText(
  value: unknown,
  maxLength: number,
  field: string,
): string {
  if (typeof value !== "string") {
    throw new Error(`Collaboration ${field} must be a string.`);
  }
  const sanitized = sanitizeText(value, maxLength);
  if (!sanitized) {
    throw new Error(`Collaboration ${field} cannot be empty.`);
  }
  return sanitized;
}

function optionalText(value: unknown, maxLength: number): string | undefined {
  return typeof value === "string" && value.trim()
    ? sanitizeText(value, maxLength)
    : undefined;
}

function optionalOpaqueIdentifier(
  value: unknown,
  maxLength: number,
  field: string,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`Collaboration target ${field} must be a string.`);
  }
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > maxLength ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new Error(`Collaboration target ${field} is invalid.`);
  }
  return normalized;
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isCollaborationItemKind(value: unknown): value is CollaborationItemKind {
  return COLLABORATION_ITEM_KINDS.includes(value as CollaborationItemKind);
}

function isCollaborationActor(value: unknown): value is CollaborationActor {
  return COLLABORATION_ACTORS.includes(value as CollaborationActor);
}

function isCollaborationVisibility(
  value: unknown,
): value is CollaborationVisibility {
  return value === "shared" || value === "private";
}

function isCollaborationSensitivity(
  value: unknown,
): value is CollaborationSensitivity {
  return value === "safe" || value === "page_content" || value === "sensitive";
}

function isCollaborationItemStatus(value: unknown): value is CollaborationItemStatus {
  return value === "active" || value === "resolved" || value === "superseded";
}

function assertWorkspaceSnapshot(
  value: CollaborationWorkspaceSnapshot,
  now: string,
): void {
  sanitizeCollaborationWorkspace(value, now);
}

function assertWorkspaceByteLimit(
  workspace: CollaborationWorkspaceSnapshot,
): void {
  const byteLength = new TextEncoder().encode(JSON.stringify(workspace)).byteLength;
  if (byteLength > MAX_COLLABORATION_WORKSPACE_BYTES) {
    throw new Error(
      `PAYLOAD_TOO_LARGE: collaboration workspace exceeds ${MAX_COLLABORATION_WORKSPACE_BYTES} bytes. Resolve or replace older items, or publish artifact references instead of inline content.`,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
