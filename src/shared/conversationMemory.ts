import { sanitizeMultilineText, sanitizeText } from "./sanitize";
import { redactSensitiveData } from "./sensitiveData";

export const CONVERSATION_MEMORY_VERSION = "conversation-memory-v1" as const;

export type ConversationTaskAffinity =
  | "general"
  | "browser"
  | "external_mcp"
  | "mixed";
export type ConversationTaskStatus =
  | "active"
  | "waiting"
  | "suspended"
  | "completed"
  | "blocked";
export type ConversationMemoryLifecycle =
  | "active"
  | "resolved"
  | "superseded";

export interface ConversationMemoryProvenance {
  messageIds: string[];
  toolCallIds: string[];
}

export interface ConversationActiveTask {
  id: string;
  objective: string;
  status: ConversationTaskStatus;
  affinity: ConversationTaskAffinity;
  successCriteria: string[];
  entities: string[];
  nextActions: string[];
  blockers: string[];
  provenance: ConversationMemoryProvenance;
  updatedAt: string;
}

export interface ConversationPendingDecision {
  id: string;
  question: string;
  options: Array<{
    id: string;
    label: string;
    recommended: boolean;
  }>;
  status: "pending" | "resolved";
  provenance: ConversationMemoryProvenance;
  updatedAt: string;
}

export interface ConversationConstraint {
  id: string;
  statement: string;
  lifecycle: ConversationMemoryLifecycle;
  importance: number;
  provenance: ConversationMemoryProvenance;
  updatedAt: string;
}

export interface ConversationFact {
  id: string;
  key: string;
  statement: string;
  kind: "verified" | "inference";
  lifecycle: ConversationMemoryLifecycle;
  importance: number;
  tags: string[];
  provenance: ConversationMemoryProvenance;
  updatedAt: string;
}

export interface ConversationTurnSummary {
  id: string;
  summary: string;
  outcome: "progress" | "completed" | "blocked" | "failed";
  unresolved: string[];
  provenance: ConversationMemoryProvenance;
  createdAt: string;
}

export interface ConversationMemoryV1 {
  version: typeof CONVERSATION_MEMORY_VERSION;
  revision: number;
  activeTask?: ConversationActiveTask;
  pendingDecisions: ConversationPendingDecision[];
  constraints: ConversationConstraint[];
  facts: ConversationFact[];
  turnSummaries: ConversationTurnSummary[];
  updatedAt: string;
}

export interface ConversationMemoryPatch {
  activeTask?: ConversationActiveTask | null;
  pendingDecisions?: ConversationPendingDecision[];
  constraints?: ConversationConstraint[];
  facts?: ConversationFact[];
  turnSummary?: ConversationTurnSummary;
}

export interface ConversationMemoryEvidence {
  messageIds: ReadonlySet<string>;
  userMessageIds?: ReadonlySet<string>;
  toolCallIds: ReadonlySet<string>;
}

export interface ConversationMemorySummary {
  activeObjective?: string;
  activeStatus?: ConversationTaskStatus;
  pendingDecisionCount: number;
  factCount: number;
}

const LIMITS = {
  decisions: 12,
  constraints: 32,
  facts: 96,
  summaries: 24,
  list: 20,
  text: 1_200,
} as const;

export function createEmptyConversationMemory(
  now = new Date().toISOString(),
): ConversationMemoryV1 {
  return {
    version: CONVERSATION_MEMORY_VERSION,
    revision: 1,
    pendingDecisions: [],
    constraints: [],
    facts: [],
    turnSummaries: [],
    updatedAt: validTimestamp(now),
  };
}

export function sanitizeConversationMemory(
  value: unknown,
): ConversationMemoryV1 | undefined {
  if (!isRecord(value) || value.version !== CONVERSATION_MEMORY_VERSION) {
    return undefined;
  }
  try {
    const now = validTimestamp(value.updatedAt);
    return {
      version: CONVERSATION_MEMORY_VERSION,
      revision: positiveInteger(value.revision),
      activeTask: value.activeTask
        ? sanitizeActiveTask(value.activeTask, now)
        : undefined,
      pendingDecisions: sanitizeList(
        value.pendingDecisions,
        LIMITS.decisions,
        (entry) => sanitizeDecision(entry, now),
      ),
      constraints: sanitizeList(
        value.constraints,
        LIMITS.constraints,
        (entry) => sanitizeConstraint(entry, now),
      ),
      facts: sanitizeList(value.facts, LIMITS.facts, (entry) =>
        sanitizeFact(entry, now),
      ),
      turnSummaries: sanitizeList(
        value.turnSummaries,
        LIMITS.summaries,
        (entry) => sanitizeTurnSummary(entry, now),
      ),
      updatedAt: now,
    };
  } catch {
    return undefined;
  }
}

/**
 * Re-check durable memory against the evidence that survived persistence.
 * Structural validation alone is insufficient because message compaction may
 * remove the message or tool call that originally supported an item.
 */
export function revalidateConversationMemory(
  value: unknown,
  evidence: ConversationMemoryEvidence,
): ConversationMemoryV1 | undefined {
  const memory = sanitizeConversationMemory(value);
  if (!memory) {
    return undefined;
  }
  const activeTask = acceptOptionalWithEvidence(
    memory.activeTask,
    evidence,
    "user_or_tool",
  );
  const pendingDecisions = memory.pendingDecisions.flatMap((entry) =>
    acceptArrayEntry(entry, evidence, "any"),
  );
  const constraints = memory.constraints.flatMap((entry) =>
    acceptArrayEntry(entry, evidence, "user"),
  );
  const facts = memory.facts.flatMap((entry) =>
    acceptArrayEntry(
      entry,
      evidence,
      entry.kind === "verified" ? "user_or_tool" : "any",
    ),
  );
  const turnSummaries = memory.turnSummaries.flatMap((entry) =>
    acceptArrayEntry(entry, evidence, "any"),
  );
  return {
    ...memory,
    ...(activeTask ? { activeTask } : { activeTask: undefined }),
    pendingDecisions,
    constraints,
    facts,
    turnSummaries,
  };
}

export function summarizeConversationMemory(
  value: ConversationMemoryV1 | undefined,
): ConversationMemorySummary | undefined {
  const memory = sanitizeConversationMemory(value);
  if (!memory) {
    return undefined;
  }
  return {
    ...(memory.activeTask?.objective
      ? { activeObjective: memory.activeTask.objective }
      : {}),
    ...(memory.activeTask?.status
      ? { activeStatus: memory.activeTask.status }
      : {}),
    pendingDecisionCount: memory.pendingDecisions.filter(
      (decision) => decision.status === "pending",
    ).length,
    factCount: memory.facts.filter((fact) => fact.lifecycle === "active").length,
  };
}

/**
 * End the currently remembered workflow without discarding durable evidence.
 * A user-initiated stop or interrupt must not leave an active task or pending
 * decision that can silently steer the next model turn back into the old tool
 * plan. Verified facts, constraints, and summaries remain available as history.
 */
export function supersedeConversationTask(
  value: ConversationMemoryV1 | undefined,
  now = new Date().toISOString(),
): ConversationMemoryV1 | undefined {
  const memory = sanitizeConversationMemory(value);
  if (!memory) {
    return undefined;
  }
  const timestamp = validTimestamp(now);
  return {
    ...memory,
    revision: memory.revision + 1,
    activeTask: undefined,
    pendingDecisions: memory.pendingDecisions.map((decision) =>
      decision.status === "pending"
        ? { ...decision, status: "resolved", updatedAt: timestamp }
        : decision,
    ),
    updatedAt: timestamp,
  };
}

export function requestNeedsBrowserContext(
  input: string,
  rememberedAffinity?: ConversationTaskAffinity,
): boolean {
  const normalized = input.toLocaleLowerCase().trim();
  // An explicitly named MCP must win over generic page/save vocabulary: many
  // external systems expose their own pages and write operations.
  if (normalized.includes("mcp")) {
    return false;
  }

  const externalSignals = [
    "prometheus",
    "promql",
    "kubernetes",
    "k8s",
    "pod 日志",
    "pod日志",
    "集群指标",
  ];
  const explicitCurrentBrowserSignals = [
    "browser_",
    "current browser",
    "current tab",
    "浏览器",
    "当前 tab",
    "当前tab",
    "tab 页",
    "tab页",
  ];
  const explicitlyTargetsCurrentBrowser =
    explicitCurrentBrowserSignals.some((signal) =>
      normalized.includes(signal),
    ) ||
    /\bcurrent\b.{0,48}\bpage\b/i.test(normalized) ||
    (normalized.includes("当前") && normalized.includes("页面"));
  if (explicitlyTargetsCurrentBrowser) {
    return true;
  }
  if (externalSignals.some((signal) => normalized.includes(signal))) {
    return false;
  }

  const browserSignals = [
    "this page",
    "the page",
    "form",
    "fill",
    "click",
    "这个页面",
    "网页",
    "页面",
    "dom",
    "url",
    "截图",
    "页面元素",
    "按钮",
    "表单",
    "填写",
    "点击",
  ];
  if (browserSignals.some((signal) => normalized.includes(signal))) {
    return true;
  }

  if (rememberedAffinity === "external_mcp") {
    return false;
  }

  const ambiguousBrowserSignals = ["page", "inspect", "save", "保存"];
  if (ambiguousBrowserSignals.some((signal) => normalized.includes(signal))) {
    return true;
  }
  const continuationSignals = [
    "继续",
    "刚才",
    "上面",
    "之前",
    "下一步",
    "再查",
    "接着",
    "你决定",
    "按原计划",
    "然后呢",
  ];
  const continuesRememberedTask =
    normalized.length === 0 ||
    continuationSignals.some((signal) => normalized.includes(signal));
  return (
    continuesRememberedTask &&
    (rememberedAffinity === "browser" || rememberedAffinity === "mixed")
  );
}

export function applyConversationMemoryPatch(
  currentValue: ConversationMemoryV1 | undefined,
  patchValue: unknown,
  evidence: ConversationMemoryEvidence,
  now = new Date().toISOString(),
): ConversationMemoryV1 {
  const current =
    sanitizeConversationMemory(currentValue) ?? createEmptyConversationMemory(now);
  if (!isRecord(patchValue)) {
    return current;
  }
  const timestamp = validTimestamp(now);
  const patch = sanitizeConversationMemoryPatch(
    patchValue,
    evidence,
    timestamp,
  );
  let activeTask =
    patch.activeTask === null
      ? undefined
      : patch.activeTask ?? current.activeTask;
  const taskSwitched = Boolean(
    patch.activeTask &&
      current.activeTask &&
      patch.activeTask.id !== current.activeTask.id,
  );
  const currentDecisions = taskSwitched
    ? current.pendingDecisions.map((decision) =>
        decision.status === "pending"
          ? { ...decision, status: "resolved" as const, updatedAt: timestamp }
          : decision,
      )
    : current.pendingDecisions;
  const pendingDecisions = mergeById(
    currentDecisions,
    patch.pendingDecisions ?? [],
    LIMITS.decisions,
  );
  if (
    activeTask?.status === "completed" &&
    pendingDecisions.some((decision) => decision.status === "pending")
  ) {
    activeTask = { ...activeTask, status: "waiting" };
  }
  return {
    version: CONVERSATION_MEMORY_VERSION,
    revision: current.revision + 1,
    activeTask,
    pendingDecisions,
    constraints: mergeById(
      current.constraints,
      patch.constraints ?? [],
      LIMITS.constraints,
    ),
    facts: mergeFacts(current.facts, patch.facts ?? []),
    turnSummaries: patch.turnSummary
      ? mergeById(
          current.turnSummaries,
          [patch.turnSummary],
          LIMITS.summaries,
        )
      : current.turnSummaries,
    updatedAt: timestamp,
  };
}

/**
 * Apply a delayed patch only when the durable memory still matches the exact
 * revision the producer observed. This prevents an older turn from merging
 * into state that a newer turn has already advanced.
 */
export function applyConversationMemoryPatchAtRevision(
  currentValue: ConversationMemoryV1 | undefined,
  patchValue: unknown,
  evidence: ConversationMemoryEvidence,
  expectedRevision: number,
  now = new Date().toISOString(),
): ConversationMemoryV1 | undefined {
  const current = sanitizeConversationMemory(currentValue);
  if (
    !current ||
    !Number.isSafeInteger(expectedRevision) ||
    expectedRevision < 1 ||
    current.revision !== expectedRevision
  ) {
    return undefined;
  }
  return applyConversationMemoryPatch(current, patchValue, evidence, now);
}

export function sanitizeConversationMemoryPatch(
  patchValue: unknown,
  evidence: ConversationMemoryEvidence,
  now = new Date().toISOString(),
): ConversationMemoryPatch {
  if (!isRecord(patchValue)) {
    return {};
  }
  return sanitizePatch(patchValue, validTimestamp(now), evidence);
}

export function buildConversationMemoryContext(
  memoryValue: ConversationMemoryV1 | undefined,
): string | null {
  const memory = sanitizeConversationMemory(memoryValue);
  if (!memory) {
    return null;
  }
  const payload = {
    version: memory.version,
    revision: memory.revision,
    activeTask: memory.activeTask,
    pendingDecisions: memory.pendingDecisions.filter(
      (decision) => decision.status === "pending",
    ),
    constraints: rankByImportance(memory.constraints)
      .filter((entry) => entry.lifecycle === "active")
      .slice(0, 12),
    facts: rankByImportance(memory.facts)
      .filter((entry) => entry.lifecycle === "active")
      .slice(0, 24),
    turnSummaries: memory.turnSummaries.slice(-6),
  };
  return `CONVERSATION_MEMORY\n${JSON.stringify(payload)}`;
}

function sanitizePatch(
  value: Record<string, unknown>,
  now: string,
  evidence: ConversationMemoryEvidence,
): ConversationMemoryPatch {
  const hasActiveTask = Object.hasOwn(value, "activeTask");
  const activeTask: ConversationMemoryPatch["activeTask"] =
    value.activeTask === null
      ? null
      : sanitizeOptionalCandidate(
          value.activeTask,
          (entry) => sanitizeActiveTask(entry, now),
          evidence,
          "user_or_tool",
        );
  const turnSummary = sanitizeOptionalCandidate(
    value.turnSummary,
    (entry) => sanitizeTurnSummary(entry, now),
    evidence,
  );
  return {
    ...(hasActiveTask && activeTask !== undefined ? { activeTask } : {}),
    pendingDecisions: sanitizeCandidates(
      value.pendingDecisions,
      LIMITS.decisions,
      (entry) => sanitizeDecision(entry, now),
      evidence,
    ),
    constraints: sanitizeCandidates(
      value.constraints,
      LIMITS.constraints,
      (entry) => sanitizeConstraint(entry, now),
      evidence,
      true,
    ),
    facts: sanitizeCandidates(
      value.facts,
      LIMITS.facts,
      (entry) => sanitizeFact(entry, now),
      evidence,
      false,
      (entry) => (entry.kind === "verified" ? "user_or_tool" : "any"),
    ),
    ...(turnSummary ? { turnSummary } : {}),
  };
}

function sanitizeActiveTask(
  value: unknown,
  now: string,
): ConversationActiveTask {
  if (!isRecord(value)) {
    throw new Error("Conversation active task is invalid.");
  }
  return {
    id: identifier(value.id),
    objective: requiredText(value.objective, 2_000),
    status: enumValue(
      value.status,
      ["active", "waiting", "suspended", "completed", "blocked"] as const,
    ),
    affinity: enumValue(
      value.affinity,
      ["general", "browser", "external_mcp", "mixed"] as const,
    ),
    successCriteria: textArray(value.successCriteria, 800),
    entities: textArray(value.entities, 240),
    nextActions: textArray(value.nextActions, 800),
    blockers: textArray(value.blockers, 800),
    provenance: sanitizeProvenance(value.provenance),
    updatedAt: optionalTimestamp(value.updatedAt, now),
  };
}

function sanitizeDecision(
  value: unknown,
  now: string,
): ConversationPendingDecision {
  if (!isRecord(value)) {
    throw new Error("Conversation pending decision is invalid.");
  }
  return {
    id: identifier(value.id),
    question: requiredText(value.question, 1_200),
    options: sanitizeList(value.options, 12, (option) => {
      if (!isRecord(option)) {
        throw new Error("Conversation decision option is invalid.");
      }
      return {
        id: identifier(option.id),
        label: requiredText(option.label, 600),
        recommended: option.recommended === true,
      };
    }),
    status: enumValue(value.status, ["pending", "resolved"] as const),
    provenance: sanitizeProvenance(value.provenance),
    updatedAt: optionalTimestamp(value.updatedAt, now),
  };
}

function sanitizeConstraint(
  value: unknown,
  now: string,
): ConversationConstraint {
  if (!isRecord(value)) {
    throw new Error("Conversation constraint is invalid.");
  }
  return {
    id: identifier(value.id),
    statement: requiredText(value.statement, LIMITS.text),
    lifecycle: enumValue(
      value.lifecycle,
      ["active", "resolved", "superseded"] as const,
    ),
    importance: importance(value.importance),
    provenance: sanitizeProvenance(value.provenance),
    updatedAt: optionalTimestamp(value.updatedAt, now),
  };
}

function sanitizeFact(value: unknown, now: string): ConversationFact {
  if (!isRecord(value)) {
    throw new Error("Conversation fact is invalid.");
  }
  return {
    id: identifier(value.id),
    key: requiredText(value.key, 320).toLocaleLowerCase(),
    statement: requiredText(value.statement, LIMITS.text),
    kind: enumValue(value.kind, ["verified", "inference"] as const),
    lifecycle: enumValue(
      value.lifecycle,
      ["active", "resolved", "superseded"] as const,
    ),
    importance: importance(value.importance),
    tags: textArray(value.tags, 160),
    provenance: sanitizeProvenance(value.provenance),
    updatedAt: optionalTimestamp(value.updatedAt, now),
  };
}

function sanitizeTurnSummary(
  value: unknown,
  now: string,
): ConversationTurnSummary {
  if (!isRecord(value)) {
    throw new Error("Conversation turn summary is invalid.");
  }
  return {
    id: identifier(value.id),
    summary: requiredText(value.summary, 2_400),
    outcome: enumValue(
      value.outcome,
      ["progress", "completed", "blocked", "failed"] as const,
    ),
    unresolved: textArray(value.unresolved, 800),
    provenance: sanitizeProvenance(value.provenance),
    createdAt: optionalTimestamp(value.createdAt, now),
  };
}

type EvidenceRequirement = "any" | "user" | "user_or_tool";

function acceptWithEvidence<T extends { provenance: ConversationMemoryProvenance }>(
  value: T,
  evidence: ConversationMemoryEvidence,
  requirement: EvidenceRequirement = "any",
): T {
  const validMessages = value.provenance.messageIds.filter((id) =>
    evidence.messageIds.has(id),
  );
  const validTools = value.provenance.toolCallIds.filter((id) =>
    evidence.toolCallIds.has(id),
  );
  const validUserMessages = validMessages.filter((id) =>
    evidence.userMessageIds?.has(id),
  );
  if (
    validMessages.length + validTools.length === 0 ||
    (requirement === "user" && validUserMessages.length === 0) ||
    (requirement === "user_or_tool" &&
      validUserMessages.length + validTools.length === 0)
  ) {
    throw new Error("Conversation memory candidate has no valid provenance.");
  }
  return {
    ...value,
    provenance: { messageIds: validMessages, toolCallIds: validTools },
  };
}

function sanitizeCandidates<T extends { provenance: ConversationMemoryProvenance }>(
  value: unknown,
  limit: number,
  mapper: (entry: unknown) => T,
  evidence: ConversationMemoryEvidence,
  requireUserMessage = false,
  requirementForEntry?: (entry: T) => EvidenceRequirement,
): T[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.slice(-limit).flatMap((entry) => {
    try {
      const mapped = mapper(entry);
      return [
        acceptWithEvidence(
          mapped,
          evidence,
          requirementForEntry?.(mapped) ??
            (requireUserMessage ? "user" : "any"),
        ),
      ];
    } catch {
      return [];
    }
  });
}

function sanitizeOptionalCandidate<
  T extends { provenance: ConversationMemoryProvenance },
>(
  value: unknown,
  mapper: (entry: unknown) => T,
  evidence: ConversationMemoryEvidence,
  requirement: EvidenceRequirement = "any",
): T | undefined {
  if (value === undefined) {
    return undefined;
  }
  try {
    return acceptWithEvidence(mapper(value), evidence, requirement);
  } catch {
    return undefined;
  }
}

function acceptOptionalWithEvidence<
  T extends { provenance: ConversationMemoryProvenance },
>(
  value: T | undefined,
  evidence: ConversationMemoryEvidence,
  requirement: EvidenceRequirement,
): T | undefined {
  if (!value) {
    return undefined;
  }
  try {
    return acceptWithEvidence(value, evidence, requirement);
  } catch {
    return undefined;
  }
}

function acceptArrayEntry<
  T extends { provenance: ConversationMemoryProvenance },
>(
  value: T,
  evidence: ConversationMemoryEvidence,
  requirement: EvidenceRequirement,
): T[] {
  const accepted = acceptOptionalWithEvidence(value, evidence, requirement);
  return accepted ? [accepted] : [];
}

function sanitizeProvenance(value: unknown): ConversationMemoryProvenance {
  if (!isRecord(value)) {
    return { messageIds: [], toolCallIds: [] };
  }
  return {
    messageIds: identifierArray(value.messageIds),
    toolCallIds: identifierArray(value.toolCallIds),
  };
}

function mergeFacts(
  current: ConversationFact[],
  incoming: ConversationFact[],
): ConversationFact[] {
  const next = [...current];
  for (const fact of incoming) {
    for (let index = 0; index < next.length; index += 1) {
      const existing = next[index]!;
      if (
        existing.key === fact.key &&
        existing.id !== fact.id &&
        existing.lifecycle === "active"
      ) {
        next[index] = { ...existing, lifecycle: "superseded" };
      }
    }
    const existingIndex = next.findIndex((entry) => entry.id === fact.id);
    if (existingIndex >= 0) {
      next[existingIndex] = fact;
    } else {
      next.push(fact);
    }
  }
  return rankByImportance(next).slice(0, LIMITS.facts);
}

function mergeById<T extends { id: string }>(
  current: T[],
  incoming: T[],
  limit: number,
): T[] {
  const merged = new Map(current.map((entry) => [entry.id, entry]));
  for (const entry of incoming) {
    merged.set(entry.id, entry);
  }
  return Array.from(merged.values()).slice(-limit);
}

function rankByImportance<T extends { importance?: number; updatedAt?: string }>(
  values: T[],
): T[] {
  return [...values].sort(
    (left, right) =>
      (right.importance ?? 0) - (left.importance ?? 0) ||
      String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")),
  );
}

function sanitizeList<T>(
  value: unknown,
  limit: number,
  mapper: (entry: unknown) => T,
): T[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.slice(-limit).flatMap((entry) => {
    try {
      return [mapper(entry)];
    } catch {
      return [];
    }
  });
}

function textArray(value: unknown, maxChars: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .slice(-LIMITS.list)
    .map((entry) => sanitizeText(String(entry ?? ""), maxChars))
    .filter(Boolean);
}

function identifierArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .slice(-LIMITS.list)
        .map((entry) => {
          try {
            return identifier(entry);
          } catch {
            return "";
          }
        })
        .filter(Boolean),
    ),
  );
}

function identifier(value: unknown): string {
  const normalized = sanitizeText(String(value ?? ""), 160);
  if (!normalized || !/^[a-zA-Z0-9_.:-]+$/.test(normalized)) {
    throw new Error("Conversation memory identifier is invalid.");
  }
  return normalized;
}

function requiredText(value: unknown, maxChars: number): string {
  const normalized = sanitizeMultilineText(String(value ?? ""), maxChars);
  if (!normalized) {
    throw new Error("Conversation memory text is required.");
  }
  return String(redactSensitiveData(normalized));
}

function importance(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function enumValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error("Conversation memory enum value is invalid.");
  }
  return value as T[number];
}

function positiveInteger(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 1) {
    throw new Error("Conversation memory revision is invalid.");
  }
  return numeric;
}

function validTimestamp(value: unknown): string {
  const text = String(value ?? "");
  if (!Number.isFinite(Date.parse(text))) {
    throw new Error("Conversation memory timestamp is invalid.");
  }
  return new Date(text).toISOString();
}

function optionalTimestamp(value: unknown, fallback: string): string {
  try {
    return validTimestamp(value);
  } catch {
    return fallback;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
