import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import type {
  ArtifactKind,
  ArtifactReadResult,
  ArtifactReference,
  StoredArtifactMetadata,
} from "../../shared/artifacts";
import { resolveDaemonDataPaths } from "../config";

const INDEX_VERSION = 1;
const INDEX_FILENAME = "index.json";
const DEFAULT_TTL_MS = 24 * 60 * 60_000;
const DEFAULT_MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_SESSION_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const DEFAULT_MAX_SESSION_COUNT = 50;
const DEFAULT_MAX_TOTAL_COUNT = 500;

export interface ArtifactStoreLimits {
  ttlMs: number;
  maxArtifactBytes: number;
  maxSessionBytes: number;
  maxTotalBytes: number;
  maxSessionCount: number;
  maxTotalCount: number;
}

export interface ArtifactStoreOptions {
  rootDir?: string;
  limits?: Partial<ArtifactStoreLimits>;
  clock?: () => number;
}

interface StoredArtifactIndex {
  version: typeof INDEX_VERSION;
  artifacts: StoredArtifactMetadata[];
}

export class ArtifactStore {
  readonly rootDir: string;
  readonly limits: ArtifactStoreLimits;
  private readonly clock: () => number;
  private readonly artifacts = new Map<string, StoredArtifactMetadata>();
  private loaded = false;
  private operationTail: Promise<void> = Promise.resolve();

  constructor(options: ArtifactStoreOptions = {}) {
    this.rootDir = options.rootDir ?? defaultArtifactRoot();
    this.limits = {
      ttlMs: options.limits?.ttlMs ?? DEFAULT_TTL_MS,
      maxArtifactBytes:
        options.limits?.maxArtifactBytes ?? DEFAULT_MAX_ARTIFACT_BYTES,
      maxSessionBytes:
        options.limits?.maxSessionBytes ?? DEFAULT_MAX_SESSION_BYTES,
      maxTotalBytes: options.limits?.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES,
      maxSessionCount:
        options.limits?.maxSessionCount ?? DEFAULT_MAX_SESSION_COUNT,
      maxTotalCount:
        options.limits?.maxTotalCount ?? DEFAULT_MAX_TOTAL_COUNT,
    };
    validateLimits(this.limits);
    this.clock = options.clock ?? Date.now;
  }

  putDataUrl(
    sessionId: string,
    kind: ArtifactKind,
    dataUrl: string,
  ): Promise<ArtifactReference> {
    return this.serialize(async () => {
      await this.ensureLoaded();
      const { mimeType, bytes } = decodeDataUrl(dataUrl);
      return this.putBytesInternal(sessionId, kind, mimeType, bytes);
    });
  }

  putBytes(
    sessionId: string,
    kind: ArtifactKind,
    mimeType: string,
    bytes: Uint8Array,
  ): Promise<ArtifactReference> {
    return this.serialize(async () => {
      await this.ensureLoaded();
      return this.putBytesInternal(sessionId, kind, mimeType, bytes);
    });
  }

  getMetadata(id: string): Promise<ArtifactReference | undefined> {
    return this.serialize(async () => {
      await this.ensureLoaded();
      await this.cleanupInternal(this.clock());
      const metadata = this.artifacts.get(id);
      return metadata ? toReference(metadata) : undefined;
    });
  }

  read(id: string, sessionId?: string): Promise<ArtifactReadResult | undefined> {
    return this.serialize(async () => {
      await this.ensureLoaded();
      await this.cleanupInternal(this.clock());
      const metadata = this.artifacts.get(id);
      if (!metadata || (sessionId && metadata.sessionId !== sessionId)) {
        return undefined;
      }
      const bytes = await readFile(join(this.rootDir, metadata.relativePath));
      return { metadata: toReference(metadata), bytes };
    });
  }

  list(sessionId?: string): Promise<ArtifactReference[]> {
    return this.serialize(async () => {
      await this.ensureLoaded();
      await this.cleanupInternal(this.clock());
      return Array.from(this.artifacts.values())
        .filter((artifact) => !sessionId || artifact.sessionId === sessionId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map(toReference);
    });
  }

  cleanup(): Promise<void> {
    return this.serialize(async () => {
      await this.ensureLoaded();
      await this.cleanupInternal(this.clock());
    });
  }

  private async putBytesInternal(
    sessionId: string,
    kind: ArtifactKind,
    mimeType: string,
    bytes: Uint8Array,
  ): Promise<ArtifactReference> {
    const normalizedSessionId = normalizeSessionId(sessionId);
    const normalizedMimeType = normalizeMimeType(mimeType);
    if (bytes.byteLength === 0) {
      throw new Error("PAYLOAD_TOO_LARGE: artifact bytes cannot be empty.");
    }
    if (bytes.byteLength > this.limits.maxArtifactBytes) {
      throw new Error(
        `PAYLOAD_TOO_LARGE: artifact is ${bytes.byteLength} bytes; maximum is ${this.limits.maxArtifactBytes}.`,
      );
    }

    const now = this.clock();
    await this.cleanupInternal(now);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const duplicate = Array.from(this.artifacts.values()).find(
      (artifact) =>
        artifact.sessionId === normalizedSessionId &&
        artifact.kind === kind &&
        artifact.mimeType === normalizedMimeType &&
        artifact.sha256 === sha256 &&
        Date.parse(artifact.expiresAt) > now,
    );
    if (duplicate) {
      return toReference(duplicate);
    }

    const id = `art_${randomUUID().replaceAll("-", "")}`;
    const relativePath = join(
      "objects",
      `${id}${extensionForMimeType(normalizedMimeType)}`,
    );
    const absolutePath = join(this.rootDir, relativePath);
    const metadata: StoredArtifactMetadata = {
      id,
      uri: `ai-devtools://artifact/${id}`,
      kind,
      mimeType: normalizedMimeType,
      byteLength: bytes.byteLength,
      sha256,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + this.limits.ttlMs).toISOString(),
      sessionId: normalizedSessionId,
      relativePath,
    };

    await mkdir(dirname(absolutePath), { recursive: true, mode: 0o700 });
    await writeFile(absolutePath, bytes, { flag: "wx", mode: 0o600 });
    await chmod(absolutePath, 0o600);
    this.artifacts.set(id, metadata);
    const evicted = this.selectBudgetEvictions();
    for (const artifact of evicted) {
      this.artifacts.delete(artifact.id);
    }
    try {
      await this.persistIndex();
    } catch (error) {
      this.artifacts.delete(id);
      for (const artifact of evicted) {
        if (artifact.id !== id) {
          this.artifacts.set(artifact.id, artifact);
        }
      }
      await unlink(absolutePath).catch(() => undefined);
      throw error;
    }
    await this.deleteArtifactFiles(evicted);

    const retained = this.artifacts.get(id);
    if (!retained) {
      throw new Error(
        "PAYLOAD_TOO_LARGE: artifact could not fit within the configured retention budget.",
      );
    }
    return toReference(retained);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }
    const objectsDir = join(this.rootDir, "objects");
    await mkdir(objectsDir, {
      recursive: true,
      mode: 0o700,
    });
    await chmod(this.rootDir, 0o700);
    await chmod(objectsDir, 0o700);
    const indexPath = join(this.rootDir, INDEX_FILENAME);
    let raw: string;
    try {
      raw = await readFile(indexPath, "utf8");
    } catch (error) {
      if (isNodeErrorWithCode(error, "ENOENT")) {
        this.loaded = true;
        await this.persistIndex();
        return;
      }
      throw error;
    }

    const index = parseIndex(raw, indexPath);
    for (const artifact of index.artifacts) {
      this.artifacts.set(artifact.id, artifact);
    }
    this.loaded = true;
    await this.cleanupInternal(this.clock());
  }

  private async cleanupInternal(now: number): Promise<void> {
    const expired = Array.from(this.artifacts.values()).filter(
      (artifact) => Date.parse(artifact.expiresAt) <= now,
    );
    for (const artifact of expired) {
      this.artifacts.delete(artifact.id);
    }
    const evicted = this.selectBudgetEvictions();
    for (const artifact of evicted) {
      this.artifacts.delete(artifact.id);
    }
    const removed = deduplicateArtifacts([...expired, ...evicted]);
    if (removed.length === 0) {
      return;
    }
    try {
      await this.persistIndex();
    } catch (error) {
      for (const artifact of removed) {
        this.artifacts.set(artifact.id, artifact);
      }
      throw error;
    }
    await this.deleteArtifactFiles(removed);
  }

  private selectBudgetEvictions(): StoredArtifactMetadata[] {
    const toRemove = new Map<string, StoredArtifactMetadata>();
    const byAge = (left: StoredArtifactMetadata, right: StoredArtifactMetadata) =>
      left.createdAt.localeCompare(right.createdAt);

    const sessions = new Set(
      Array.from(this.artifacts.values()).map((artifact) => artifact.sessionId),
    );
    for (const sessionId of sessions) {
      const artifacts = Array.from(this.artifacts.values())
        .filter((artifact) => artifact.sessionId === sessionId)
        .sort(byAge);
      let bytes = sumBytes(artifacts);
      while (
        artifacts.length > this.limits.maxSessionCount ||
        bytes > this.limits.maxSessionBytes
      ) {
        const oldest = artifacts.shift();
        if (!oldest) {
          break;
        }
        bytes -= oldest.byteLength;
        toRemove.set(oldest.id, oldest);
      }
    }

    const retained = Array.from(this.artifacts.values())
      .filter((artifact) => !toRemove.has(artifact.id))
      .sort(byAge);
    let totalBytes = sumBytes(retained);
    while (
      retained.length > this.limits.maxTotalCount ||
      totalBytes > this.limits.maxTotalBytes
    ) {
      const oldest = retained.shift();
      if (!oldest) {
        break;
      }
      totalBytes -= oldest.byteLength;
      toRemove.set(oldest.id, oldest);
    }

    return Array.from(toRemove.values());
  }

  private async deleteArtifactFiles(
    artifacts: StoredArtifactMetadata[],
  ): Promise<void> {
    for (const artifact of artifacts) {
      await unlink(join(this.rootDir, artifact.relativePath)).catch((error) => {
        // The index is authoritative. A failed unlink leaves only a bounded
        // orphan for later manual cleanup and must not roll metadata back.
        void error;
      });
    }
  }

  private async persistIndex(): Promise<void> {
    const indexPath = join(this.rootDir, INDEX_FILENAME);
    const temporaryPath = join(
      this.rootDir,
      `.index-${process.pid}-${randomUUID()}.tmp`,
    );
    const index: StoredArtifactIndex = {
      version: INDEX_VERSION,
      artifacts: Array.from(this.artifacts.values()).sort((left, right) =>
        left.createdAt.localeCompare(right.createdAt),
      ),
    };
    try {
      await writeFile(temporaryPath, `${JSON.stringify(index, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      await chmod(temporaryPath, 0o600);
      await rename(temporaryPath, indexPath);
      await chmod(indexPath, 0o600);
    } finally {
      await unlink(temporaryPath).catch(() => undefined);
    }
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation, operation);
    this.operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export function defaultArtifactRoot(): string {
  return resolveDaemonDataPaths().artifactDir;
}

function decodeDataUrl(dataUrl: string): {
  mimeType: string;
  bytes: Uint8Array;
} {
  const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]*={0,2})$/.exec(
    dataUrl,
  );
  if (!match) {
    throw new Error(
      "PAYLOAD_TOO_LARGE: artifact must be a base64 PNG or JPEG data URL.",
    );
  }
  const bytes = Buffer.from(match[2]!, "base64");
  if (bytes.byteLength === 0) {
    throw new Error("PAYLOAD_TOO_LARGE: artifact data URL is empty.");
  }
  return { mimeType: match[1]!, bytes };
}

function normalizeSessionId(sessionId: string): string {
  const normalized = sessionId.trim();
  if (!normalized || normalized.length > 200) {
    throw new Error("Invalid artifact sessionId.");
  }
  return normalized;
}

function normalizeMimeType(mimeType: string): string {
  const normalized = mimeType.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/.test(normalized)) {
    throw new Error(`Invalid artifact MIME type: ${mimeType}`);
  }
  return normalized;
}

function extensionForMimeType(mimeType: string): string {
  switch (normalizeMimeType(mimeType)) {
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    default:
      return ".bin";
  }
}

function toReference(metadata: StoredArtifactMetadata): ArtifactReference {
  return {
    id: metadata.id,
    uri: metadata.uri,
    kind: metadata.kind,
    mimeType: metadata.mimeType,
    byteLength: metadata.byteLength,
    sha256: metadata.sha256,
    createdAt: metadata.createdAt,
    expiresAt: metadata.expiresAt,
  };
}

function parseIndex(raw: string, indexPath: string): StoredArtifactIndex {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`Artifact index is not valid JSON: ${indexPath}`);
  }
  if (!value || typeof value !== "object") {
    throw new Error(`Artifact index is invalid: ${indexPath}`);
  }
  const candidate = value as { version?: unknown; artifacts?: unknown };
  if (candidate.version !== INDEX_VERSION || !Array.isArray(candidate.artifacts)) {
    throw new Error(`Artifact index version is unsupported: ${indexPath}`);
  }
  const artifacts = candidate.artifacts.filter(isStoredArtifactMetadata);
  if (artifacts.length !== candidate.artifacts.length) {
    throw new Error(`Artifact index contains invalid metadata: ${indexPath}`);
  }
  return { version: INDEX_VERSION, artifacts };
}

function isStoredArtifactMetadata(
  value: unknown,
): value is StoredArtifactMetadata {
  if (!value || typeof value !== "object") {
    return false;
  }
  const artifact = value as Partial<StoredArtifactMetadata>;
  let expectedRelativePath: string | undefined;
  if (typeof artifact.id === "string" && typeof artifact.mimeType === "string") {
    try {
      expectedRelativePath = join(
        "objects",
        `${artifact.id}${extensionForMimeType(artifact.mimeType)}`,
      );
    } catch {
      return false;
    }
  }
  return (
    typeof artifact.id === "string" &&
    /^art_[a-f0-9]{32}$/.test(artifact.id) &&
    typeof artifact.uri === "string" &&
    artifact.uri === `ai-devtools://artifact/${artifact.id}` &&
    (artifact.kind === "screenshot" || artifact.kind === "payload") &&
    typeof artifact.mimeType === "string" &&
    typeof artifact.byteLength === "number" &&
    Number.isSafeInteger(artifact.byteLength) &&
    artifact.byteLength > 0 &&
    typeof artifact.sha256 === "string" &&
    /^[a-f0-9]{64}$/.test(artifact.sha256) &&
    typeof artifact.createdAt === "string" &&
    Number.isFinite(Date.parse(artifact.createdAt)) &&
    typeof artifact.expiresAt === "string" &&
    Number.isFinite(Date.parse(artifact.expiresAt)) &&
    typeof artifact.sessionId === "string" &&
    typeof artifact.relativePath === "string" &&
    artifact.relativePath === expectedRelativePath &&
    dirname(artifact.relativePath) === "objects" &&
    extname(artifact.relativePath).length > 0 &&
    Date.parse(artifact.expiresAt) > Date.parse(artifact.createdAt)
  );
}

function deduplicateArtifacts(
  artifacts: StoredArtifactMetadata[],
): StoredArtifactMetadata[] {
  return Array.from(
    new Map(artifacts.map((artifact) => [artifact.id, artifact])).values(),
  );
}

function sumBytes(artifacts: StoredArtifactMetadata[]): number {
  return artifacts.reduce((total, artifact) => total + artifact.byteLength, 0);
}

function validateLimits(limits: ArtifactStoreLimits): void {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`Artifact limit ${name} must be a positive safe integer.`);
    }
  }
  if (limits.maxArtifactBytes > limits.maxSessionBytes) {
    throw new Error("maxArtifactBytes cannot exceed maxSessionBytes.");
  }
  if (limits.maxSessionBytes > limits.maxTotalBytes) {
    throw new Error("maxSessionBytes cannot exceed maxTotalBytes.");
  }
  if (limits.maxSessionCount > limits.maxTotalCount) {
    throw new Error("maxSessionCount cannot exceed maxTotalCount.");
  }
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === code,
  );
}
