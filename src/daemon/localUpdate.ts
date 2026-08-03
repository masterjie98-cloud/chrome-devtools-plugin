import { spawnSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
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

export type LocalUpdateInstallMode = "git" | "release-zip";

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
  skipGitFetch?: boolean;
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
  return checkGitUpdate(projectRoot, options);
}

export async function runLocalUpdate(
  projectRoot = resolveProjectRootFromDaemon(),
  options: { noRestart?: boolean; fetchImpl?: typeof fetch } = {},
): Promise<LocalUpdateRunResult> {
  if (await isReleaseZipInstallation(projectRoot)) {
    return runReleaseZipUpdate(projectRoot, options);
  }
  return runGitUpdate(projectRoot, options);
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

async function checkGitUpdate(
  projectRoot: string,
  options: LocalUpdateOptions,
): Promise<LocalUpdateCheckResult> {
  await assertGitRepo(projectRoot);
  const packageJson = JSON.parse(
    await readFile(join(projectRoot, "package.json"), "utf8"),
  );
  const currentVersion = String(packageJson.version ?? "").trim() || "0.0.0";
  const currentCommit = git(projectRoot, ["rev-parse", "HEAD"]) ?? "";
  const branch = git(projectRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);

  if (!options.skipGitFetch) {
    git(projectRoot, ["fetch", "--quiet", "--tags", "origin"], true);
  }
  const upstream =
    git(projectRoot, ["rev-parse", "--abbrev-ref", "@{upstream}"]) ??
    (branch ? `origin/${branch}` : "origin/main");
  const remoteCommit = git(projectRoot, ["rev-parse", upstream]);
  const repository =
    parseGithubRepo(git(projectRoot, ["remote", "get-url", "origin"])) ??
    DEFAULT_UPDATE_REPOSITORY;
  const release = await fetchReleaseBestEffort(repository, options.fetchImpl);
  const commitUpdate =
    Boolean(remoteCommit) &&
    Boolean(currentCommit) &&
    remoteCommit !== currentCommit;
  const releaseUpdate = Boolean(
    release?.version && isVersionNewer(release.version, currentVersion),
  );
  const updateAvailable = commitUpdate || releaseUpdate;

  const parts: string[] = [];
  if (commitUpdate) parts.push(`git 远端 ${upstream} 有新提交`);
  if (releaseUpdate) parts.push(`GitHub Release ${release?.tag} 新于当前 ${currentVersion}`);
  return {
    ok: true,
    updateAvailable,
    currentVersion,
    currentCommit,
    remoteCommit,
    latestReleaseTag: release?.tag ?? null,
    latestReleaseVersion: release?.version ?? null,
    releaseUrl: release?.htmlUrl ?? null,
    releaseAssetName: null,
    projectRoot,
    branch,
    installMode: "git",
    autoUpdateSupported: true,
    message:
      parts.length > 0
        ? parts.join("；")
        : "已是最新（未发现更新的 git 提交或更高 Release 版本）。",
  };
}

async function runGitUpdate(
  projectRoot: string,
  options: { noRestart?: boolean },
): Promise<LocalUpdateRunResult> {
  await assertGitRepo(projectRoot);
  const updateScript = join(projectRoot, "scripts", "update-local.mjs");
  await access(updateScript);
  const beforeVersion = JSON.parse(
    await readFile(join(projectRoot, "package.json"), "utf8"),
  ).version as string;
  const result = spawnSync(process.execPath, [updateScript, "--no-restart"], {
    cwd: projectRoot,
    encoding: "utf8",
    env: process.env,
    timeout: 15 * 60_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  const logTail = combined.slice(-4_000);
  if (result.status !== 0) {
    return {
      ok: false,
      currentVersion: beforeVersion,
      error: `update:local failed (exit ${result.status}): ${logTail || "no output"}`,
      projectRoot,
      installMode: "git",
      restartScheduled: false,
    };
  }
  const packageJson = JSON.parse(
    await readFile(join(projectRoot, "package.json"), "utf8"),
  );
  let notice: { version?: string; buildId?: string; commit?: string } = {};
  try {
    notice = JSON.parse(
      await readFile(join(projectRoot, "dist", "update-notice.json"), "utf8"),
    ) as typeof notice;
  } catch {
    // The build succeeded but an older branch may not emit a notice.
  }
  return {
    ok: true,
    currentVersion: beforeVersion,
    newVersion: String(packageJson.version ?? notice.version ?? ""),
    commit: notice.commit,
    buildId: notice.buildId,
    logTail,
    projectRoot,
    installMode: "git",
    restartScheduled: !options.noRestart,
  };
}

async function assertGitRepo(projectRoot: string): Promise<void> {
  const inside = git(projectRoot, ["rev-parse", "--is-inside-work-tree"]);
  if (inside !== "true") {
    throw new Error(
      "当前目录既不是有效 Release ZIP 安装，也不是 git clone 开发目录。",
    );
  }
}

function git(
  projectRoot: string,
  args: string[],
  allowFailure = false,
): string | null {
  const result = spawnSync("git", args, {
    cwd: projectRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    if (allowFailure) return null;
    return null;
  }
  return result.stdout.trim();
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

function parseGithubRepo(remote: string | null): string | null {
  if (!remote) return null;
  const match = remote.match(/github\.com[:/](.+?)(?:\.git)?$/i);
  return match?.[1] ? normalizeUpdateRepository(match[1].replace(/\.git$/i, "")) : null;
}
