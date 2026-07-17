import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { PersistedBrowserState } from "../../mcp/browserStateHub";
import {
  isSensitiveEgressClass,
  type EgressDestination,
  type SensitiveEgressClass,
} from "../../shared/egressMetrics";
import { resolveDaemonDataPaths } from "../config";

const STATE_VERSION = 1;
const MAX_STATE_BYTES = 8 * 1024 * 1024;
const MAX_AUDIT_EVENTS = 500;
const FLUSH_DELAY_MS = 100;

export type AuditEventType =
  | "approval.requested"
  | "approval.approved"
  | "approval.denied"
  | "grant.created"
  | "grant.revoked"
  | "tool.completed"
  | "tool.failed";

export interface RedactedAuditEvent {
  id: string;
  eventType: AuditEventType;
  timestamp: string;
  requestId: string;
  sessionId: string;
  toolName: string;
  policyClass: string;
  argumentsSha256: string;
  revision: number;
  outcome?: "approved" | "denied" | "completed" | "failed";
  errorCode?: string;
  egressClass?: SensitiveEgressClass;
  egressBytes?: number;
  egressDestination?: EgressDestination;
  approvalWaitMs?: number;
  queueWaitMs?: number;
  executorMs?: number;
  transportMs?: number;
  totalMs?: number;
  resultChars?: number;
  payloadBytes?: number;
}

interface StoredDaemonState {
  version: typeof STATE_VERSION;
  savedAt: string;
  browserState?: PersistedBrowserState;
  auditEvents: RedactedAuditEvent[];
}

export interface DaemonStateStoreOptions {
  statePath?: string;
}

export class DaemonStateStore {
  readonly statePath: string;
  private browserState: PersistedBrowserState | undefined;
  private auditEvents: RedactedAuditEvent[] = [];
  private loaded = false;
  private dirty = false;
  private changeVersion = 0;
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private operationTail: Promise<void> = Promise.resolve();

  constructor(options: DaemonStateStoreOptions = {}) {
    this.statePath = options.statePath ?? defaultDaemonStatePath();
  }

  async load(): Promise<unknown | undefined> {
    if (this.loaded) {
      return this.browserState;
    }
    let raw: string;
    try {
      raw = await readFile(this.statePath, "utf8");
    } catch (error) {
      if (isNodeErrorWithCode(error, "ENOENT")) {
        this.loaded = true;
        return undefined;
      }
      throw error;
    }
    if (Buffer.byteLength(raw, "utf8") > MAX_STATE_BYTES) {
      throw new Error(`Daemon state exceeds ${MAX_STATE_BYTES} bytes: ${this.statePath}`);
    }
    const stored = parseStoredState(raw, this.statePath);
    this.browserState = stored.browserState;
    this.auditEvents = stored.auditEvents.slice(-MAX_AUDIT_EVENTS);
    this.loaded = true;
    await chmod(this.statePath, 0o600);
    return this.browserState;
  }

  scheduleBrowserState(state: PersistedBrowserState): void {
    if (!this.loaded) {
      throw new Error("DaemonStateStore.load() must complete before scheduling state.");
    }
    this.browserState = structuredClone(state);
    this.dirty = true;
    this.changeVersion += 1;
    this.scheduleFlush();
  }

  async appendAudit(event: RedactedAuditEvent): Promise<void> {
    await this.load();
    assertAuditEvent(event);
    this.auditEvents.push(structuredClone(event));
    this.auditEvents = this.auditEvents.slice(-MAX_AUDIT_EVENTS);
    this.dirty = true;
    this.changeVersion += 1;
    this.scheduleFlush();
  }

  async listAuditEvents(): Promise<RedactedAuditEvent[]> {
    await this.load();
    return structuredClone(this.auditEvents);
  }

  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    await this.serialize(async () => {
      if (!this.dirty) {
        return;
      }
      const persistedVersion = this.changeVersion;
      await this.persist();
      if (persistedVersion === this.changeVersion) {
        this.dirty = false;
      } else {
        this.dirty = true;
        this.scheduleFlush();
      }
    });
  }

  private scheduleFlush(): void {
    if (this.flushTimer) {
      return;
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      void this.flush().catch((error) => {
        console.error(
          `[ai-devtools-daemon] state persistence failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    }, FLUSH_DELAY_MS);
    this.flushTimer.unref?.();
  }

  private async persist(): Promise<void> {
    const stored: StoredDaemonState = {
      version: STATE_VERSION,
      savedAt: new Date().toISOString(),
      browserState: this.browserState,
      auditEvents: this.auditEvents,
    };
    const serialized = `${JSON.stringify(stored, null, 2)}\n`;
    if (Buffer.byteLength(serialized, "utf8") > MAX_STATE_BYTES) {
      throw new Error(
        `Daemon state exceeds the ${MAX_STATE_BYTES}-byte persistence budget.`,
      );
    }

    const stateDirectory = dirname(this.statePath);
    const temporaryPath = join(
      stateDirectory,
      `.state-${process.pid}-${randomUUID()}.tmp`,
    );
    await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
    await chmod(stateDirectory, 0o700);
    try {
      await writeFile(temporaryPath, serialized, {
        encoding: "utf8",
        mode: 0o600,
      });
      await chmod(temporaryPath, 0o600);
      await rename(temporaryPath, this.statePath);
      await chmod(this.statePath, 0o600);
    } finally {
      await unlink(temporaryPath).catch(() => undefined);
    }
  }

  private serialize(operation: () => Promise<void>): Promise<void> {
    const result = this.operationTail.then(operation, operation);
    this.operationTail = result.catch(() => undefined);
    return result;
  }
}

export function defaultDaemonStatePath(): string {
  return resolveDaemonDataPaths().statePath;
}

function parseStoredState(raw: string, statePath: string): StoredDaemonState {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`Daemon state is not valid JSON: ${statePath}`);
  }
  if (!value || typeof value !== "object") {
    throw new Error(`Daemon state is invalid: ${statePath}`);
  }
  const candidate = value as {
    version?: unknown;
    savedAt?: unknown;
    browserState?: unknown;
    auditEvents?: unknown;
  };
  if (
    candidate.version !== STATE_VERSION ||
    typeof candidate.savedAt !== "string" ||
    !Array.isArray(candidate.auditEvents) ||
    !candidate.auditEvents.every(isAuditEvent)
  ) {
    throw new Error(`Daemon state schema is unsupported or invalid: ${statePath}`);
  }
  return {
    version: STATE_VERSION,
    savedAt: candidate.savedAt,
    browserState: candidate.browserState as PersistedBrowserState | undefined,
    auditEvents: candidate.auditEvents,
  };
}

function assertAuditEvent(event: RedactedAuditEvent): void {
  if (!isAuditEvent(event)) {
    throw new Error("Refusing to persist an invalid or unredacted audit event.");
  }
}

function isAuditEvent(value: unknown): value is RedactedAuditEvent {
  if (!value || typeof value !== "object") {
    return false;
  }
  const event = value as Partial<RedactedAuditEvent>;
  const allowedKeys = new Set([
    "id",
    "eventType",
    "timestamp",
    "requestId",
    "sessionId",
    "toolName",
    "policyClass",
    "argumentsSha256",
    "revision",
    "outcome",
    "errorCode",
    "egressClass",
    "egressBytes",
    "egressDestination",
    "approvalWaitMs",
    "queueWaitMs",
    "executorMs",
    "transportMs",
    "totalMs",
    "resultChars",
    "payloadBytes",
  ]);
  return (
    Object.keys(value).every((key) => allowedKeys.has(key)) &&
    typeof event.id === "string" &&
    event.id.length > 0 &&
    event.id.length <= 200 &&
    (event.eventType === "approval.requested" ||
      event.eventType === "approval.approved" ||
      event.eventType === "approval.denied" ||
      event.eventType === "grant.created" ||
      event.eventType === "grant.revoked" ||
      event.eventType === "tool.completed" ||
      event.eventType === "tool.failed") &&
    typeof event.timestamp === "string" &&
    Number.isFinite(Date.parse(event.timestamp)) &&
    typeof event.requestId === "string" &&
    event.requestId.length <= 200 &&
    typeof event.sessionId === "string" &&
    event.sessionId.length <= 200 &&
    typeof event.toolName === "string" &&
    event.toolName.length <= 200 &&
    typeof event.policyClass === "string" &&
    event.policyClass.length <= 100 &&
    typeof event.argumentsSha256 === "string" &&
    /^[a-f0-9]{64}$/.test(event.argumentsSha256) &&
    typeof event.revision === "number" &&
    Number.isSafeInteger(event.revision) &&
    event.revision >= 0 &&
    (event.outcome === undefined ||
      event.outcome === "approved" ||
      event.outcome === "denied" ||
      event.outcome === "completed" ||
      event.outcome === "failed") &&
    (event.errorCode === undefined ||
      (typeof event.errorCode === "string" && event.errorCode.length <= 100)) &&
    (event.egressClass === undefined || isSensitiveEgressClass(event.egressClass)) &&
    (event.egressBytes === undefined ||
      (typeof event.egressBytes === "number" &&
        Number.isSafeInteger(event.egressBytes) &&
        event.egressBytes >= 0 &&
        event.egressBytes <= 64 * 1024 * 1024)) &&
    (event.egressDestination === undefined ||
      event.egressDestination === "extension_agent" ||
      event.egressDestination === "mcp_adapter") &&
    [
      event.approvalWaitMs,
      event.queueWaitMs,
      event.executorMs,
      event.transportMs,
      event.totalMs,
      event.resultChars,
      event.payloadBytes,
    ].every(
      (metric) =>
        metric === undefined ||
        (typeof metric === "number" &&
          Number.isSafeInteger(metric) &&
          metric >= 0 &&
          metric <= 64 * 1024 * 1024),
    ) &&
    ((event.egressClass === undefined &&
      event.egressBytes === undefined &&
      event.egressDestination === undefined) ||
      (event.egressClass !== undefined &&
        event.egressBytes !== undefined &&
        event.egressDestination !== undefined &&
        event.eventType === "tool.completed"))
  );
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === code,
  );
}
