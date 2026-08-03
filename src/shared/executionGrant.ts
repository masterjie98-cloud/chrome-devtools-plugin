import type { ActiveTabSnapshot } from "./wsProtocol";
import type { ToolPolicyClass } from "./toolPolicy";

export const EXECUTION_GRANT_VERSION = 2 as const;
export const UNAUTHENTICATED_DEVELOPMENT_GRANT_KEY =
  "ai-devtools-unauthenticated-local-development-only";

export interface ExecutionGrantClaims {
  version: typeof EXECUTION_GRANT_VERSION;
  grantId: string;
  browserRequestId: string;
  requesterRequestId: string;
  requesterConnectionId: string;
  sessionId: string;
  sourceMcpToolName: string;
  policyClass: ToolPolicyClass;
  mutatesBrowser: boolean;
  toolName: string;
  argumentsSha256: string;
  approvalRequired: boolean;
  approvalId?: string;
  target: Pick<
    ActiveTabSnapshot,
    | "targetId"
    | "tabId"
    | "windowId"
    | "frameId"
    | "documentId"
    | "navigationId"
    | "revision"
  >;
  issuedAt: string;
  expiresAt: string;
}

export interface SignedExecutionGrant {
  claims: ExecutionGrantClaims;
  signature: string;
}

export interface ExecutionGrantExpectation {
  browserRequestId: string;
  sessionId: string;
  toolName: string;
  args: unknown;
  target: ActiveTabSnapshot;
  targetBinding?: "exact" | "none";
  now?: Date;
}

export class ExecutionGrantReplayCache {
  private readonly consumed = new Map<string, number>();

  consume(grantId: string, expiresAt: string, now = Date.now()): boolean {
    for (const [existingGrantId, expiry] of this.consumed) {
      if (expiry <= now) {
        this.consumed.delete(existingGrantId);
      }
    }
    if (this.consumed.has(grantId)) {
      return false;
    }
    const expiry = Date.parse(expiresAt);
    if (!Number.isFinite(expiry) || expiry <= now) {
      return false;
    }
    this.consumed.set(grantId, expiry);
    return true;
  }

  clear(): void {
    this.consumed.clear();
  }
}

export async function createExecutionGrant(
  key: string,
  claims: ExecutionGrantClaims,
): Promise<SignedExecutionGrant> {
  return {
    claims,
    signature: await signClaims(normalizeGrantKey(key), claims),
  };
}

export async function verifyExecutionGrant(
  key: string,
  grant: SignedExecutionGrant,
  expected: ExecutionGrantExpectation,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (grant.claims.version !== EXECUTION_GRANT_VERSION) {
    return { ok: false, reason: "unsupported execution grant version" };
  }
  const signatureValid = await verifyClaimsSignature(
    normalizeGrantKey(key),
    grant.claims,
    grant.signature,
  );
  if (!signatureValid) {
    return { ok: false, reason: "invalid execution grant signature" };
  }
  const now = expected.now ?? new Date();
  const issuedAt = Date.parse(grant.claims.issuedAt);
  const expiresAt = Date.parse(grant.claims.expiresAt);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) {
    return { ok: false, reason: "invalid execution grant timestamps" };
  }
  if (issuedAt > now.getTime() + 5_000 || expiresAt <= now.getTime()) {
    return { ok: false, reason: "execution grant is expired or not yet valid" };
  }
  if (expiresAt - issuedAt > 120_000) {
    return { ok: false, reason: "execution grant lifetime exceeds protocol limit" };
  }
  if (grant.claims.browserRequestId !== expected.browserRequestId) {
    return { ok: false, reason: "execution grant request does not match" };
  }
  if (grant.claims.sessionId !== expected.sessionId) {
    return { ok: false, reason: "execution grant session does not match" };
  }
  if (grant.claims.toolName !== expected.toolName) {
    return { ok: false, reason: "execution grant tool does not match" };
  }
  if (
    grant.claims.argumentsSha256 !==
    (await hashExecutionArguments(expected.args))
  ) {
    return { ok: false, reason: "execution grant arguments do not match" };
  }
  if (expected.targetBinding !== "none") {
    const targetMismatchFields = executionTargetMismatchFields(
      grant.claims.target,
      expected.target,
    );
    if (targetMismatchFields.length > 0) {
      return {
        ok: false,
        reason: `execution grant target is stale or does not match (fields=${targetMismatchFields.join(",")})`,
      };
    }
  }
  if (grant.claims.approvalRequired && !grant.claims.approvalId) {
    return { ok: false, reason: "approval-bound grant is missing approvalId" };
  }
  return { ok: true };
}

export async function hashExecutionArguments(
  args: unknown,
): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(stableJsonStringify(args)),
  );
  return bytesToHex(new Uint8Array(bytes));
}

export function isSignedExecutionGrant(
  value: unknown,
): value is SignedExecutionGrant {
  if (!isRecord(value) || !isRecord(value.claims)) {
    return false;
  }
  const claims = value.claims;
  return (
    claims.version === EXECUTION_GRANT_VERSION &&
    typeof claims.grantId === "string" &&
    typeof claims.browserRequestId === "string" &&
    typeof claims.requesterRequestId === "string" &&
    typeof claims.requesterConnectionId === "string" &&
    typeof claims.sessionId === "string" &&
    typeof claims.sourceMcpToolName === "string" &&
    isToolPolicyClass(claims.policyClass) &&
    typeof claims.mutatesBrowser === "boolean" &&
    typeof claims.toolName === "string" &&
    typeof claims.argumentsSha256 === "string" &&
    typeof claims.approvalRequired === "boolean" &&
    isRecord(claims.target) &&
    typeof claims.issuedAt === "string" &&
    typeof claims.expiresAt === "string" &&
    typeof value.signature === "string"
  );
}

function isToolPolicyClass(value: unknown): value is ToolPolicyClass {
  return (
    value === "safe_read" ||
    value === "sensitive_read" ||
    value === "reversible_write" ||
    value === "page_action" ||
    value === "destructive_write" ||
    value === "arbitrary_execution" ||
    value === "open_world"
  );
}

export function stableJsonStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJsonStringify(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(
        ([key, entry]) =>
          `${JSON.stringify(key)}:${stableJsonStringify(entry)}`,
      )
      .join(",")}}`;
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    return "null";
  }
  const serialized = JSON.stringify(value);
  return serialized === undefined ? "null" : serialized;
}

export function normalizeGrantKey(key: string): string {
  return key.trim() || UNAUTHENTICATED_DEVELOPMENT_GRANT_KEY;
}

export function executionTargetMismatchFields(
  granted: ExecutionGrantClaims["target"],
  current: ActiveTabSnapshot,
): string[] {
  const fields = [
    "targetId",
    "tabId",
    "windowId",
    "frameId",
    "documentId",
    "navigationId",
  ] as const;
  // revision is still signed into the grant as the daemon's monotonic approval
  // revision. The extension independently proves freshness with Chrome's
  // documentId/navigationId because its local navigation counter can differ
  // after frame-only selection changes.
  return fields.filter(
    (field) => granted[field] !== undefined && granted[field] !== current[field],
  );
}

async function signClaims(
  key: string,
  claims: ExecutionGrantClaims,
): Promise<string> {
  const cryptoKey = await importHmacKey(key, ["sign"]);
  const signature = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(stableJsonStringify(claims)),
  );
  return bytesToBase64Url(new Uint8Array(signature));
}

async function verifyClaimsSignature(
  key: string,
  claims: ExecutionGrantClaims,
  signature: string,
): Promise<boolean> {
  try {
    const cryptoKey = await importHmacKey(key, ["verify"]);
    return await crypto.subtle.verify(
      "HMAC",
      cryptoKey,
      base64UrlToBytes(signature),
      new TextEncoder().encode(stableJsonStringify(claims)),
    );
  } catch {
    return false;
  }
}

function importHmacKey(
  key: string,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages,
  );
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
