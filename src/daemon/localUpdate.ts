import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_UPDATE_REPOSITORY,
  fetchLatestGithubRelease,
  installLatestReleaseZip,
  isReleaseZipInstallation,
  isVersionNewer,
  normalizeUpdateRepository,
  readInstalledReleaseMetadata,
  selectReleaseAssets,
  type GithubRelease,
} from "./releaseUpdate";

export type LocalUpdateInstallMode = "development" | "release-zip";

export interface LocalUpdateCheckResult {
  ok: true;
  updateAvailable: boolean;
  currentVersion: string;
  currentCommit: string;
  remoteCommit: string | null;
  latestReleaseTag: string | null;
  latestReleaseVersion: string | null;
  releaseUrl: string | null;
  releaseAssetName: string | null;
  projectRoot: string;
  branch: string | null;
  installMode: LocalUpdateInstallMode;
  autoUpdateSupported: boolean;
  message: string;
}

export interface LocalUpdateRunResult {
  ok: boolean;
  currentVersion?: string;
  newVersion?: string;
  commit?: string;
  buildId?: string;
  logTail?: string;
  error?: string;
  projectRoot: string;
  installMode?: LocalUpdateInstallMode;
  releaseTag?: string;
  releaseUrl?: string | null;
  archiveName?: string;
  archiveSha256?: string;
  restartScheduled: boolean;
}

interface LocalUpdateOptions {
  fetchImpl?: typeof fetch;
}

export function resolveProjectRootFromDaemon(): string {
  // src/daemon/*.ts, dist/daemon/*.js and <install>/runtime/daemon/*.js all
  // resolve two levels above the daemon module to their owning project/install.
  return resolve(dirname(fileURLToPath(import.meta.url)), "../..");
}

export async function checkLocalUpdate(
  projectRoot = resolveProjectRootFromDaemon(),
  options: LocalUpdateOptions = {},
): Promise<LocalUpdateCheckResult> {
  if (await isReleaseZipInstallation(projectRoot)) {
    return checkReleaseZipUpdate(projectRoot, options.fetchImpl);
  }
  return checkDevelopmentUpdate(projectRoot, options.fetchImpl);
}

export async function runLocalUpdate(
  projectRoot = resolveProjectRootFromDaemon(),
  options: { noRestart?: boolean; fetchImpl?: typeof fetch } = {},
): Promise<LocalUpdateRunResult> {
  if (await isReleaseZipInstallation(projectRoot)) {
    return runReleaseZipUpdate(projectRoot, options);
  }
  return {
    ok: false,
    error:
      "自动更新仅支持 Release ZIP 安装。当前是源码开发目录，请由维护者自行切换代码版本并构建；daemon 不会执行 git、依赖安装或构建命令。",
    projectRoot,
    installMode: "development",
    restartScheduled: false,
  };
}

async function checkReleaseZipUpdate(
  projectRoot: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LocalUpdateCheckResult> {
  const metadata = await readInstalledReleaseMetadata(projectRoot);
  if (!metadata) {
    throw new Error("ZIP 安装目录缺少有效的安装版本元数据。");
  }
  const repository = normalizeUpdateRepository(
    metadata.updateRepository || process.env.AI_DEVTOOLS_UPDATE_REPOSITORY,
  );
  const release = await fetchLatestGithubRelease(repository, fetchImpl);
  let assetName: string | null = null;
  let assetReady = false;
  try {
    const assets = selectReleaseAssets(release, repository);
    assetName = assets.archiveName;
    assetReady = true;
  } catch {
    // The check still reports the newer release, but makes the missing safe
    // update artifact explicit instead of attempting a source-code archive.
  }
  const versionUpdate = isVersionNewer(release.version, metadata.version);
  const updateAvailable = versionUpdate;
  const message = !versionUpdate
    ? `已是最新 Release（当前 ${metadata.version}）。`
    : assetReady
      ? `发现 GitHub Release ${release.tag}；确认后将下载 ${assetName}，校验并自动重启 daemon。`
      : `GitHub Release ${release.tag} 新于当前 ${metadata.version}，但缺少匹配的 ZIP 与 SHA-256 资产，请联系发布者。`;
  return {
    ok: true,
    updateAvailable,
    currentVersion: metadata.version,
    currentCommit: "",
    remoteCommit: null,
    latestReleaseTag: release.tag,
    latestReleaseVersion: release.version,
    releaseUrl: release.htmlUrl,
    releaseAssetName: assetName,
    projectRoot,
    branch: null,
    installMode: "release-zip",
    autoUpdateSupported: assetReady,
    message,
  };
}

async function runReleaseZipUpdate(
  projectRoot: string,
  options: { noRestart?: boolean; fetchImpl?: typeof fetch },
): Promise<LocalUpdateRunResult> {
  const metadata = await readInstalledReleaseMetadata(projectRoot);
  if (!metadata) {
    return {
      ok: false,
      error: "ZIP 安装目录缺少有效的安装版本元数据。",
      projectRoot,
      installMode: "release-zip",
      restartScheduled: false,
    };
  }
  try {
    const result = await installLatestReleaseZip(projectRoot, metadata, {
      fetchImpl: options.fetchImpl,
      repository:
        metadata.updateRepository || process.env.AI_DEVTOOLS_UPDATE_REPOSITORY,
    });
    return {
      ok: true,
      currentVersion: metadata.version,
      newVersion: result.version,
      buildId: result.buildId,
      projectRoot,
      installMode: "release-zip",
      releaseTag: result.releaseTag,
      releaseUrl: result.releaseUrl,
      archiveName: result.archiveName,
      archiveSha256: result.archiveSha256,
      restartScheduled: !options.noRestart,
    };
  } catch (error) {
    return {
      ok: false,
      currentVersion: metadata.version,
      error: error instanceof Error ? error.message : "Release ZIP 更新失败。",
      projectRoot,
      installMode: "release-zip",
      restartScheduled: false,
    };
  }
}

async function checkDevelopmentUpdate(
  projectRoot: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LocalUpdateCheckResult> {
  const packageJson = JSON.parse(
    await readFile(join(projectRoot, "package.json"), "utf8"),
  );
  const currentVersion = String(packageJson.version ?? "").trim() || "0.0.0";
  const repository = normalizeUpdateRepository(
    process.env.AI_DEVTOOLS_UPDATE_REPOSITORY || DEFAULT_UPDATE_REPOSITORY,
  );
  const release = await fetchReleaseBestEffort(repository, fetchImpl);
  const releaseUpdate = Boolean(
    release?.version && isVersionNewer(release.version, currentVersion),
  );
  return {
    ok: true,
    updateAvailable: releaseUpdate,
    currentVersion,
    currentCommit: "",
    remoteCommit: null,
    latestReleaseTag: release?.tag ?? null,
    latestReleaseVersion: release?.version ?? null,
    releaseUrl: release?.htmlUrl ?? null,
    releaseAssetName: null,
    projectRoot,
    branch: null,
    installMode: "development",
    autoUpdateSupported: false,
    message:
      releaseUpdate
        ? `GitHub Release ${release?.tag} 新于当前 ${currentVersion}；源码开发目录不会自动更新，请手动下载 Release ZIP 或由维护者更新源码。`
        : "源码开发目录不参与自动更新；未发现更高的正式 Release。",
  };
}

async function fetchReleaseBestEffort(
  repository: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GithubRelease | null> {
  try {
    return await fetchLatestGithubRelease(repository, fetchImpl);
  } catch {
    return null;
  }
}
