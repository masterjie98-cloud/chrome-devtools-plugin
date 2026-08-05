import { randomBytes } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  normalizeExternalMcpServers,
  type ExternalMcpServerConfig,
} from "../shared/externalMcp";

export interface DaemonConfig {
  bridgeToken: string;
  configPath: string;
  allowedExtensionIds: string[];
  externalMcpServers: ExternalMcpServerConfig[];
}

export interface DaemonDataPaths {
  dataDir?: string;
  configPath: string;
  statePath: string;
  artifactDir: string;
}

export interface LoadDaemonConfigOptions {
  environment?: NodeJS.ProcessEnv;
  paths?: DaemonDataPaths;
}

interface StoredDaemonConfig {
  bridgeToken: string;
  allowedExtensionIds?: string[];
  externalMcpServers?: ExternalMcpServerConfig[];
}

const MAX_ALLOWED_EXTENSION_IDS = 32;
const CHROME_EXTENSION_ID_PATTERN = /^[a-p]{32}$/;

export function resolveDaemonDataPaths(
  environment: NodeJS.ProcessEnv = process.env,
  homeDirectory = homedir(),
): DaemonDataPaths {
  const dataDirValue = environment.AI_DEVTOOLS_DATA_DIR?.trim();
  const dataDir = dataDirValue ? resolve(dataDirValue) : undefined;
  const explicitConfigPath = environment.AI_DEVTOOLS_CONFIG_PATH?.trim();
  const explicitStatePath = environment.AI_DEVTOOLS_STATE_PATH?.trim();
  const explicitArtifactDir = environment.AI_DEVTOOLS_ARTIFACT_DIR?.trim();

  return {
    dataDir,
    configPath: resolve(
      explicitConfigPath ||
        (dataDir
          ? join(dataDir, "daemon.json")
          : join(homeDirectory, ".config", "ai-devtools-assistant", "daemon.json")),
    ),
    statePath: resolve(
      explicitStatePath ||
        (dataDir
          ? join(dataDir, "state.json")
          : join(homeDirectory, ".local", "share", "ai-devtools-assistant", "state.json")),
    ),
    artifactDir: resolve(
      explicitArtifactDir ||
        (dataDir
          ? join(dataDir, "artifacts")
          : join(homeDirectory, ".local", "share", "ai-devtools-assistant", "artifacts")),
    ),
  };
}

export async function loadDaemonConfig(
  options: LoadDaemonConfigOptions = {},
): Promise<DaemonConfig> {
  const environment = options.environment ?? process.env;
  const paths = options.paths ?? resolveDaemonDataPaths(environment);
  const configPath = paths.configPath;
  const environmentToken = environment.AI_DEVTOOLS_BRIDGE_TOKEN?.trim();
  const environmentExtensionIds = parseAllowedExtensionIds(
    environment.AI_DEVTOOLS_ALLOWED_EXTENSION_IDS,
    "AI_DEVTOOLS_ALLOWED_EXTENSION_IDS",
  );
  if (environmentToken) {
    assertValidBridgeToken(environmentToken);
    const existing = await readStoredConfig(configPath);
    return {
      bridgeToken: environmentToken,
      configPath,
      allowedExtensionIds:
        environmentExtensionIds ?? existing?.allowedExtensionIds ?? [],
      externalMcpServers: existing?.externalMcpServers ?? [],
    };
  }

  if (paths.dataDir) {
    await ensurePrivateDirectory(paths.dataDir);
  }
  await ensureConfigDirectory(
    dirname(configPath),
    paths.dataDir === dirname(configPath),
  );
  const existing = await readStoredConfig(configPath);
  if (existing) {
    return {
      bridgeToken: existing.bridgeToken,
      configPath,
      allowedExtensionIds:
        environmentExtensionIds ?? existing.allowedExtensionIds ?? [],
      externalMcpServers: existing.externalMcpServers ?? [],
    };
  }

  const bridgeToken = randomBytes(32).toString("base64url");
  try {
    await writeFile(
      configPath,
      `${JSON.stringify(
        {
          bridgeToken,
          allowedExtensionIds: environmentExtensionIds ?? [],
          externalMcpServers: [],
        } satisfies StoredDaemonConfig,
        null,
        2,
      )}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
  } catch (error) {
    if (!isAlreadyExistsError(error)) {
      throw error;
    }
    const raced = await readStoredConfig(configPath);
    if (!raced) {
      throw new Error(`Daemon config was created concurrently but is unreadable: ${configPath}`);
    }
    return {
      bridgeToken: raced.bridgeToken,
      configPath,
      allowedExtensionIds:
        environmentExtensionIds ?? raced.allowedExtensionIds ?? [],
      externalMcpServers: raced.externalMcpServers ?? [],
    };
  }
  await chmod(configPath, 0o600);
  return {
    bridgeToken,
    configPath,
    allowedExtensionIds: environmentExtensionIds ?? [],
    externalMcpServers: [],
  };
}

export async function addAllowedExtensionId(
  extensionId: string,
  options: LoadDaemonConfigOptions = {},
): Promise<DaemonConfig> {
  const environment = options.environment ?? process.env;
  const paths = options.paths ?? resolveDaemonDataPaths(environment);
  const normalizedExtensionId = normalizeExtensionId(extensionId);
  const loaded = await loadDaemonConfig({ environment, paths });
  const stored = await readStoredConfig(paths.configPath);
  if (!stored && environment.AI_DEVTOOLS_BRIDGE_TOKEN?.trim()) {
    throw new Error(
      "Cannot persist an extension allowlist while the bridge token exists only in AI_DEVTOOLS_BRIDGE_TOKEN; configure AI_DEVTOOLS_ALLOWED_EXTENSION_IDS instead.",
    );
  }
  const allowedExtensionIds = normalizeExtensionIds([
    ...(stored?.allowedExtensionIds ?? loaded.allowedExtensionIds),
    normalizedExtensionId,
  ], "daemon config allowedExtensionIds");
  const next: StoredDaemonConfig = {
    bridgeToken: stored?.bridgeToken ?? loaded.bridgeToken,
    allowedExtensionIds,
    externalMcpServers: stored?.externalMcpServers ?? loaded.externalMcpServers,
  };
  await ensureConfigDirectory(
    dirname(paths.configPath),
    paths.dataDir === dirname(paths.configPath),
  );
  await writeStoredConfigAtomic(paths.configPath, next);
  return {
    bridgeToken: next.bridgeToken,
    configPath: paths.configPath,
    allowedExtensionIds,
    externalMcpServers: next.externalMcpServers ?? [],
  };
}

export async function saveExternalMcpServers(
  servers: ExternalMcpServerConfig[],
  options: LoadDaemonConfigOptions = {},
): Promise<DaemonConfig> {
  const environment = options.environment ?? process.env;
  const paths = options.paths ?? resolveDaemonDataPaths(environment);
  const normalizedServers = normalizeExternalMcpServers(servers);
  const loaded = await loadDaemonConfig({ environment, paths });
  const stored = await readStoredConfig(paths.configPath);
  if (!stored && environment.AI_DEVTOOLS_BRIDGE_TOKEN?.trim()) {
    throw new Error(
      "Cannot persist external MCP servers while the bridge token exists only in AI_DEVTOOLS_BRIDGE_TOKEN.",
    );
  }
  const next: StoredDaemonConfig = {
    bridgeToken: stored?.bridgeToken ?? loaded.bridgeToken,
    allowedExtensionIds: stored?.allowedExtensionIds ?? loaded.allowedExtensionIds,
    externalMcpServers: normalizedServers,
  };
  await ensureConfigDirectory(
    dirname(paths.configPath),
    paths.dataDir === dirname(paths.configPath),
  );
  await writeStoredConfigAtomic(paths.configPath, next);
  return {
    bridgeToken: next.bridgeToken,
    configPath: paths.configPath,
    allowedExtensionIds: next.allowedExtensionIds ?? [],
    externalMcpServers: normalizedServers,
  };
}

async function ensurePrivateDirectory(directoryPath: string): Promise<void> {
  await mkdir(directoryPath, { recursive: true, mode: 0o700 });
  await chmod(directoryPath, 0o700);
}

async function ensureConfigDirectory(
  directoryPath: string,
  managedDataRoot: boolean,
): Promise<void> {
  const createdPath = await mkdir(directoryPath, {
    recursive: true,
    mode: 0o700,
  });
  if (createdPath || managedDataRoot) {
    await chmod(directoryPath, 0o700);
  }
}

async function readStoredConfig(
  configPath: string,
): Promise<StoredDaemonConfig | undefined> {
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (error) {
    if (isNotFoundError(error)) {
      return undefined;
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`Daemon config is not valid JSON: ${configPath}`);
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as Record<string, unknown>).bridgeToken !== "string"
  ) {
    throw new Error(`Daemon config is missing bridgeToken: ${configPath}`);
  }
  const bridgeToken = (parsed as StoredDaemonConfig).bridgeToken.trim();
  assertValidBridgeToken(bridgeToken);
  const allowedExtensionIds = normalizeExtensionIds(
    (parsed as StoredDaemonConfig).allowedExtensionIds ?? [],
    "daemon config allowedExtensionIds",
  );
  const externalMcpServers = normalizeExternalMcpServers(
    (parsed as StoredDaemonConfig).externalMcpServers ?? [],
  );
  await chmod(configPath, 0o600);
  return { bridgeToken, allowedExtensionIds, externalMcpServers };
}

function parseAllowedExtensionIds(
  value: string | undefined,
  source: string,
): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  return normalizeExtensionIds(
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    source,
  );
}

function normalizeExtensionIds(value: unknown, source: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${source} must be an array or comma-separated list.`);
  }
  if (value.length > MAX_ALLOWED_EXTENSION_IDS) {
    throw new Error(
      `${source} supports at most ${MAX_ALLOWED_EXTENSION_IDS} Chrome extension IDs.`,
    );
  }
  const normalized = value.map((item) => {
    if (typeof item !== "string") {
      throw new Error(`${source} must contain only Chrome extension IDs.`);
    }
    return normalizeExtensionId(item);
  });
  return [...new Set(normalized)].sort();
}

function normalizeExtensionId(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!CHROME_EXTENSION_ID_PATTERN.test(normalized)) {
    throw new Error(
      "Chrome extension ID must contain exactly 32 lowercase letters in the a-p range.",
    );
  }
  return normalized;
}

async function writeStoredConfigAtomic(
  configPath: string,
  config: StoredDaemonConfig,
): Promise<void> {
  const temporaryPath = `${configPath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, configPath);
    await chmod(configPath, 0o600);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

function assertValidBridgeToken(token: string): void {
  if (token.length < 32 || token.length > 512) {
    throw new Error("AI DevTools bridge token must be between 32 and 512 characters.");
  }
}

function isNotFoundError(error: unknown): boolean {
  return isNodeErrorWithCode(error, "ENOENT");
}

function isAlreadyExistsError(error: unknown): boolean {
  return isNodeErrorWithCode(error, "EEXIST");
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === code,
  );
}
