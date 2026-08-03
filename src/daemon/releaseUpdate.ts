import { createHash } from "node:crypto";
import { open, cp, lstat, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

export const DEFAULT_UPDATE_REPOSITORY =
  "masterjie98-cloud/chrome-devtools-plugin";
export const RELEASE_PRODUCT = "ai-devtools-assistant";
export const RELEASE_MANIFEST_VERSION = 1;
export const MAX_RELEASE_ARCHIVE_BYTES = 256 * 1024 * 1024;
export const MAX_RELEASE_CHECKSUM_BYTES = 128 * 1024;
export const MAX_RELEASE_ARCHIVE_ENTRIES = 20_000;

const UPDATE_METADATA_FILE = "安装版本.json";
const RELEASE_MANIFEST_FILE = "release-manifest.json";

export interface InstalledReleaseMetadata {
  version: string;
  installedAt: string;
  extensionPath: string;
  runtimePath: string;
  platform?: string;
  installMode?: "release-zip";
  updateRepository?: string;
  releaseTag?: string;
  releaseUrl?: string;
  archiveSha256?: string;
  previousVersion?: string;
}

export interface ReleasePackageManifest {
  schemaVersion: typeof RELEASE_MANIFEST_VERSION;
  product: typeof RELEASE_PRODUCT;
  version: string;
  buildId: string;
  updateRepository: string;
  archiveName: string;
  checksumName: string;
}

export interface GithubReleaseAsset {
  name: string;
  browserDownloadUrl: string;
  size: number;
  digest: string | null;
  state: string | null;
}

export interface GithubRelease {
  tag: string;
  version: string;
  htmlUrl: string | null;
  publishedAt: string | null;
  assets: GithubReleaseAsset[];
}

export interface SelectedReleaseAssets {
  archive: GithubReleaseAsset;
  checksum: GithubReleaseAsset;
  archiveName: string;
  checksumName: string;
}

export interface ReleaseZipInstallResult {
  version: string;
  buildId: string;
  releaseTag: string;
  releaseUrl: string | null;
  archiveName: string;
  archiveSha256: string;
  projectRoot: string;
}

export interface ReleaseUpdateOptions {
  fetchImpl?: typeof fetch;
  repository?: string;
  release?: GithubRelease;
}

export function normalizeUpdateRepository(value: string | undefined): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return DEFAULT_UPDATE_REPOSITORY;
  }
  if (
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalized) ||
    normalized.split("/").some((part) => part === "." || part === "..")
  ) {
    throw new Error(`无效的 GitHub 更新仓库：${normalized}`);
  }
  return normalized;
}

export async function readInstalledReleaseMetadata(
  installRoot: string,
): Promise<InstalledReleaseMetadata | null> {
  try {
    const parsed = JSON.parse(
      await readFile(join(installRoot, UPDATE_METADATA_FILE), "utf8"),
    ) as Partial<InstalledReleaseMetadata>;
    if (
      typeof parsed.version !== "string" ||
      !parsed.version.trim() ||
      typeof parsed.extensionPath !== "string" ||
      typeof parsed.runtimePath !== "string"
    ) {
      return null;
    }
    return {
      version: parsed.version.trim(),
      installedAt:
        typeof parsed.installedAt === "string" ? parsed.installedAt : "",
      extensionPath: parsed.extensionPath,
      runtimePath: parsed.runtimePath,
      platform:
        typeof parsed.platform === "string" ? parsed.platform : undefined,
      installMode:
        parsed.installMode === "release-zip" ? "release-zip" : undefined,
      updateRepository:
        typeof parsed.updateRepository === "string"
          ? parsed.updateRepository
          : undefined,
      releaseTag:
        typeof parsed.releaseTag === "string" ? parsed.releaseTag : undefined,
      releaseUrl:
        typeof parsed.releaseUrl === "string" ? parsed.releaseUrl : undefined,
      archiveSha256:
        typeof parsed.archiveSha256 === "string"
          ? parsed.archiveSha256
          : undefined,
      previousVersion:
        typeof parsed.previousVersion === "string"
          ? parsed.previousVersion
          : undefined,
    };
  } catch {
    return null;
  }
}

export async function isReleaseZipInstallation(
  installRoot: string,
): Promise<boolean> {
  const metadata = await readInstalledReleaseMetadata(installRoot);
  if (!metadata) {
    return false;
  }
  return (
    (await isFile(join(installRoot, "runtime", "daemon", "server.js"))) &&
    (await isFile(join(installRoot, "extension", "manifest.json")))
  );
}

export async function fetchLatestGithubRelease(
  repository: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GithubRelease> {
  const normalizedRepository = normalizeUpdateRepository(repository);
  const response = await fetchImpl(
    `https://api.github.com/repos/${normalizedRepository}/releases/latest`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "ai-devtools-assistant-daemon",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    throw new Error(
      `GitHub Release 检查失败：HTTP ${response.status} ${response.statusText}`,
    );
  }
  const data = (await response.json()) as {
    tag_name?: unknown;
    html_url?: unknown;
    published_at?: unknown;
    draft?: unknown;
    prerelease?: unknown;
    assets?: unknown;
  };
  if (data.draft === true || data.prerelease === true) {
    throw new Error("GitHub latest Release 不是正式版本，已拒绝自动更新。");
  }
  const tag = typeof data.tag_name === "string" ? data.tag_name.trim() : "";
  const version = stripVersionPrefix(tag);
  if (!tag || !parseSemver(version)) {
    throw new Error(`GitHub Release tag 不是有效语义版本：${tag || "<empty>"}`);
  }
  const rawAssets = Array.isArray(data.assets) ? data.assets : [];
  const assets = rawAssets.flatMap((raw): GithubReleaseAsset[] => {
    if (!raw || typeof raw !== "object") {
      return [];
    }
    const asset = raw as Record<string, unknown>;
    if (
      typeof asset.name !== "string" ||
      typeof asset.browser_download_url !== "string"
    ) {
      return [];
    }
    return [
      {
        name: asset.name,
        browserDownloadUrl: asset.browser_download_url,
        size:
          typeof asset.size === "number" && Number.isSafeInteger(asset.size)
            ? asset.size
            : 0,
        digest: typeof asset.digest === "string" ? asset.digest : null,
        state: typeof asset.state === "string" ? asset.state : null,
      },
    ];
  });
  return {
    tag,
    version,
    htmlUrl: typeof data.html_url === "string" ? data.html_url : null,
    publishedAt:
      typeof data.published_at === "string" ? data.published_at : null,
    assets,
  };
}

export function selectReleaseAssets(
  release: GithubRelease,
  repository: string,
): SelectedReleaseAssets {
  const archiveName = `ai-devtools-assistant-local-${release.version}.zip`;
  const checksumName = `${archiveName}.sha256`;
  const archive = release.assets.find(
    (asset) => asset.name === archiveName && asset.state !== "new",
  );
  const checksum = release.assets.find(
    (asset) => asset.name === checksumName && asset.state !== "new",
  );
  if (!archive || !checksum) {
    throw new Error(
      `Release ${release.tag} 缺少 ${archiveName} 或 ${checksumName}，无法安全自动更新。`,
    );
  }
  if (archive.size < 1 || archive.size > MAX_RELEASE_ARCHIVE_BYTES) {
    throw new Error(
      `Release ZIP 大小异常：${archive.size} bytes（允许 1-${MAX_RELEASE_ARCHIVE_BYTES}）。`,
    );
  }
  if (checksum.size < 1 || checksum.size > MAX_RELEASE_CHECKSUM_BYTES) {
    throw new Error(
      `Release SHA-256 文件大小异常：${checksum.size} bytes。`,
    );
  }
  assertGithubReleaseAssetUrl(archive.browserDownloadUrl, repository, release.tag);
  assertGithubReleaseAssetUrl(
    checksum.browserDownloadUrl,
    repository,
    release.tag,
  );
  return { archive, checksum, archiveName, checksumName };
}

export function assertGithubReleaseAssetUrl(
  rawUrl: string,
  repository: string,
  releaseTag: string,
): void {
  const parsed = new URL(rawUrl);
  const expectedPathPrefix = `/${normalizeUpdateRepository(repository)}/releases/download/${encodeURIComponent(releaseTag)}/`;
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "github.com" ||
    !parsed.pathname.startsWith(expectedPathPrefix)
  ) {
    throw new Error(`Release 资产地址不属于预期 GitHub 仓库：${rawUrl}`);
  }
}

export function parseSha256File(content: string, archiveName: string): string {
  for (const line of content.split(/\r?\n/)) {
    const match = line.trim().match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/);
    if (match?.[1] && match[2] && basename(match[2].trim()) === archiveName) {
      return match[1].toLowerCase();
    }
  }
  throw new Error(`SHA-256 文件未包含 ${archiveName} 的有效摘要。`);
}

export function parseGithubAssetSha256(digest: string | null): string | null {
  if (!digest) {
    return null;
  }
  const match = digest.trim().match(/^sha256:([a-fA-F0-9]{64})$/);
  return match?.[1]?.toLowerCase() ?? null;
}

export function validateArchiveEntries(
  entries: string[],
  expectedRootName: string,
): void {
  if (entries.length < 1 || entries.length > MAX_RELEASE_ARCHIVE_ENTRIES) {
    throw new Error(
      `Release ZIP 条目数量异常：${entries.length}（上限 ${MAX_RELEASE_ARCHIVE_ENTRIES}）。`,
    );
  }
  for (const rawEntry of entries) {
    const entry = rawEntry.replaceAll("\\", "/").trim();
    if (!entry || entry.includes("\0") || entry.length > 1_024) {
      throw new Error("Release ZIP 包含空条目或超长条目。");
    }
    const parts = entry.split("/").filter(Boolean);
    if (
      entry.startsWith("/") ||
      /^[A-Za-z]:\//.test(entry) ||
      parts.some((part) => part === "." || part === "..") ||
      parts[0] !== expectedRootName
    ) {
      throw new Error(`Release ZIP 包含不安全或非预期路径：${rawEntry}`);
    }
  }
}

export async function installLatestReleaseZip(
  installRoot: string,
  currentMetadata: InstalledReleaseMetadata,
  options: ReleaseUpdateOptions = {},
): Promise<ReleaseZipInstallResult> {
  assertSafeInstallRoot(installRoot);
  const repository = normalizeUpdateRepository(
    options.repository ||
      currentMetadata.updateRepository ||
      process.env.AI_DEVTOOLS_UPDATE_REPOSITORY,
  );
  const release =
    options.release ??
    (await fetchLatestGithubRelease(repository, options.fetchImpl));
  if (!isVersionNewer(release.version, currentMetadata.version)) {
    throw new Error(
      `没有可安装的新版本：当前 ${currentMetadata.version}，Release ${release.version}。`,
    );
  }
  const assets = selectReleaseAssets(release, repository);
  const updatesRoot = join(installRoot, ".updates");
  await mkdir(updatesRoot, { recursive: true, mode: 0o700 });
  const stagingRoot = await mkdtemp(join(updatesRoot, "release-"));
  const archivePath = join(stagingRoot, assets.archiveName);
  const checksumPath = join(stagingRoot, assets.checksumName);

  try {
    const archiveSha256 = await downloadFile(
      assets.archive.browserDownloadUrl,
      archivePath,
      assets.archive.size,
      MAX_RELEASE_ARCHIVE_BYTES,
      options.fetchImpl,
    );
    await downloadFile(
      assets.checksum.browserDownloadUrl,
      checksumPath,
      assets.checksum.size,
      MAX_RELEASE_CHECKSUM_BYTES,
      options.fetchImpl,
    );
    const checksumSha256 = parseSha256File(
      await readFile(checksumPath, "utf8"),
      assets.archiveName,
    );
    const githubDigest = parseGithubAssetSha256(assets.archive.digest);
    if (archiveSha256 !== checksumSha256) {
      throw new Error(
        `Release ZIP SHA-256 不匹配：期望 ${checksumSha256}，实际 ${archiveSha256}。`,
      );
    }
    if (githubDigest && archiveSha256 !== githubDigest) {
      throw new Error(
        `Release ZIP 与 GitHub 资产 digest 不匹配：${githubDigest}。`,
      );
    }

    const expectedRootName = `ai-devtools-assistant-local-${release.version}`;
    const entries = listArchiveEntries(archivePath);
    validateArchiveEntries(entries, expectedRootName);
    const extractedRoot = join(stagingRoot, "extracted");
    await mkdir(extractedRoot, { recursive: true, mode: 0o700 });
    extractArchive(archivePath, extractedRoot);
    const bundleRoot = join(extractedRoot, expectedRootName);
    const manifest = await validateExtractedRelease(
      bundleRoot,
      release.version,
      repository,
      assets,
    );
    await prepareInstalledUpdateNotice(bundleRoot, {
      previousVersion: currentMetadata.version,
      projectRoot: installRoot,
      releaseTag: release.tag,
    });
    await replaceInstalledRelease(bundleRoot, installRoot, {
      version: release.version,
      buildId: manifest.buildId,
      repository,
      releaseTag: release.tag,
      releaseUrl: release.htmlUrl,
      archiveSha256,
      previousVersion: currentMetadata.version,
    });
    return {
      version: release.version,
      buildId: manifest.buildId,
      releaseTag: release.tag,
      releaseUrl: release.htmlUrl,
      archiveName: assets.archiveName,
      archiveSha256,
      projectRoot: installRoot,
    };
  } finally {
    await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function replaceInstalledRelease(
  bundleRoot: string,
  installRoot: string,
  release: {
    version: string;
    buildId: string;
    repository: string;
    releaseTag: string;
    releaseUrl: string | null;
    archiveSha256: string;
    previousVersion: string;
  },
): Promise<void> {
  assertSafeInstallRoot(installRoot);
  const installedRuntime = join(installRoot, "runtime");
  const installedExtension = join(installRoot, "extension");
  const runtimeBackup = join(installRoot, ".runtime.previous");
  const extensionBackup = join(installRoot, ".extension.previous");
  const sourceRuntime = join(bundleRoot, "runtime");
  const sourceExtension = join(bundleRoot, "extension");
  await assertExpectedReleaseFiles(bundleRoot);
  await rm(runtimeBackup, { recursive: true, force: true });
  await rm(extensionBackup, { recursive: true, force: true });

  let runtimeBackedUp = false;
  let runtimeInstalled = false;
  let extensionBackedUp = false;
  let extensionInstalled = false;
  try {
    await rename(installedRuntime, runtimeBackup);
    runtimeBackedUp = true;
    await rename(sourceRuntime, installedRuntime);
    runtimeInstalled = true;
    await rename(installedExtension, extensionBackup);
    extensionBackedUp = true;
    await rename(sourceExtension, installedExtension);
    extensionInstalled = true;

    const guideSource = join(bundleRoot, "安装说明.md");
    if (await isFile(guideSource)) {
      await cp(guideSource, join(installRoot, "安装说明.md"));
    }
    const metadata: InstalledReleaseMetadata = {
      version: release.version,
      installedAt: new Date().toISOString(),
      extensionPath: installedExtension,
      runtimePath: installedRuntime,
      platform: process.platform,
      installMode: "release-zip",
      updateRepository: release.repository,
      releaseTag: release.releaseTag,
      releaseUrl: release.releaseUrl ?? undefined,
      archiveSha256: release.archiveSha256,
      previousVersion: release.previousVersion,
    };
    await writeJsonAtomically(
      join(installRoot, UPDATE_METADATA_FILE),
      metadata,
    );
  } catch (error) {
    if (extensionInstalled) {
      await rm(installedExtension, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
    if (extensionBackedUp) {
      await rename(extensionBackup, installedExtension).catch(() => undefined);
    }
    if (runtimeInstalled) {
      await rm(installedRuntime, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
    if (runtimeBackedUp) {
      await rename(runtimeBackup, installedRuntime).catch(() => undefined);
    }
    throw error;
  }
}

export function isVersionNewer(candidate: string, current: string): boolean {
  const left = parseSemver(candidate);
  const right = parseSemver(current);
  if (!left || !right) {
    return false;
  }
  for (let index = 0; index < 3; index += 1) {
    if (left[index]! > right[index]!) return true;
    if (left[index]! < right[index]!) return false;
  }
  return false;
}

export function parseSemver(value: string): [number, number, number] | null {
  const match = value.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/);
  if (!match) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function stripVersionPrefix(tag: string): string {
  return tag.replace(/^v/i, "");
}

async function downloadFile(
  rawUrl: string,
  destinationPath: string,
  expectedBytes: number,
  maximumBytes: number,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchImpl(rawUrl, {
    headers: {
      Accept: "application/octet-stream",
      "User-Agent": "ai-devtools-assistant-daemon",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(2 * 60_000),
  });
  if (!response.ok || !response.body) {
    throw new Error(
      `Release 资产下载失败：HTTP ${response.status} ${response.statusText}`,
    );
  }
  assertAllowedGithubDownloadResponse(response.url || rawUrl);
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > maximumBytes) {
    throw new Error(`Release 资产超过允许大小：${declaredLength} bytes。`);
  }
  await mkdir(dirname(destinationPath), { recursive: true, mode: 0o700 });
  const file = await open(destinationPath, "wx", 0o600);
  const hash = createHash("sha256");
  let bytes = 0;
  try {
    for await (const rawChunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      const chunk = Buffer.from(rawChunk);
      bytes += chunk.byteLength;
      if (bytes > maximumBytes) {
        throw new Error(`Release 资产超过允许大小：>${maximumBytes} bytes。`);
      }
      hash.update(chunk);
      await file.write(chunk);
    }
  } finally {
    await file.close();
  }
  if (bytes < 1 || (expectedBytes > 0 && bytes !== expectedBytes)) {
    throw new Error(
      `Release 资产大小不匹配：期望 ${expectedBytes} bytes，实际 ${bytes} bytes。`,
    );
  }
  return hash.digest("hex");
}

function assertAllowedGithubDownloadResponse(rawUrl: string): void {
  const parsed = new URL(rawUrl);
  const trustedHost =
    parsed.hostname === "github.com" ||
    parsed.hostname === "githubusercontent.com" ||
    parsed.hostname.endsWith(".githubusercontent.com");
  if (parsed.protocol !== "https:" || !trustedHost) {
    throw new Error(`Release 下载重定向到了非 GitHub HTTPS 地址：${rawUrl}`);
  }
}

function listArchiveEntries(archivePath: string): string[] {
  const result = runTar(["-tf", archivePath]);
  return result.stdout.split(/\r?\n/).filter(Boolean);
}

function extractArchive(archivePath: string, destinationRoot: string): void {
  runTar(["-xf", archivePath, "-C", destinationRoot]);
}

function runTar(args: string[]): { stdout: string } {
  const candidates =
    process.platform === "win32"
      ? ["tar.exe", "tar"]
      : ["/usr/bin/tar", "tar"];
  const failures: string[] = [];
  for (const command of candidates) {
    const result = spawnSync(command, args, {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
    if (result.status === 0) {
      return { stdout: result.stdout || "" };
    }
    failures.push(
      `${command}: ${result.error?.message || result.stderr || `exit ${result.status}`}`,
    );
  }
  throw new Error(`无法读取或解压 Release ZIP：${failures.join(" | ")}`);
}

async function validateExtractedRelease(
  bundleRoot: string,
  expectedVersion: string,
  repository: string,
  assets: SelectedReleaseAssets,
): Promise<ReleasePackageManifest> {
  await assertExpectedReleaseFiles(bundleRoot);
  const manifest = JSON.parse(
    await readFile(join(bundleRoot, RELEASE_MANIFEST_FILE), "utf8"),
  ) as Partial<ReleasePackageManifest>;
  if (
    manifest.schemaVersion !== RELEASE_MANIFEST_VERSION ||
    manifest.product !== RELEASE_PRODUCT ||
    manifest.version !== expectedVersion ||
    typeof manifest.buildId !== "string" ||
    manifest.updateRepository !== repository ||
    manifest.archiveName !== assets.archiveName ||
    manifest.checksumName !== assets.checksumName
  ) {
    throw new Error("Release 包清单与 GitHub Release 或当前产品不匹配。");
  }
  const packageJson = JSON.parse(
    await readFile(join(bundleRoot, "package.json"), "utf8"),
  ) as { version?: unknown };
  const extensionManifest = JSON.parse(
    await readFile(join(bundleRoot, "extension", "manifest.json"), "utf8"),
  ) as { version?: unknown };
  if (
    packageJson.version !== expectedVersion ||
    extensionManifest.version !== expectedVersion
  ) {
    throw new Error("Release 包 package.json、扩展 manifest 与 Release 版本不一致。");
  }
  await assertNoSymlinks(bundleRoot);
  return manifest as ReleasePackageManifest;
}

async function assertExpectedReleaseFiles(bundleRoot: string): Promise<void> {
  const requiredPaths = [
    RELEASE_MANIFEST_FILE,
    "package.json",
    "extension/manifest.json",
    "extension/update-notice.json",
    "runtime/daemon/server.js",
    "runtime/daemon/status.js",
    "runtime/mcp/server.js",
    "runtime/restart-daemon.mjs",
  ];
  for (const path of requiredPaths) {
    if (!(await isFile(join(bundleRoot, path)))) {
      throw new Error(`Release 包缺少必要文件：${path}`);
    }
  }
}

async function assertNoSymlinks(root: string): Promise<void> {
  const queue = [root];
  while (queue.length > 0) {
    const current = queue.pop()!;
    const item = await lstat(current);
    if (item.isSymbolicLink()) {
      throw new Error(`Release 包不允许符号链接：${relative(root, current)}`);
    }
    if (!item.isDirectory()) {
      continue;
    }
    const { readdir } = await import("node:fs/promises");
    const children = await readdir(current);
    for (const child of children) {
      queue.push(join(current, child));
    }
  }
}

async function prepareInstalledUpdateNotice(
  bundleRoot: string,
  options: {
    previousVersion: string;
    projectRoot: string;
    releaseTag: string;
  },
): Promise<void> {
  const noticePath = join(bundleRoot, "extension", "update-notice.json");
  const notice = JSON.parse(await readFile(noticePath, "utf8")) as Record<
    string,
    unknown
  >;
  notice.updatedAt = new Date().toISOString();
  notice.source = "github-release-zip";
  notice.previousVersion = options.previousVersion;
  notice.needsExtensionReload = true;
  notice.projectRoot = options.projectRoot;
  notice.releaseTag = options.releaseTag;
  await writeFile(noticePath, `${JSON.stringify(notice, null, 2)}\n`, "utf8");
}

async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  const temporaryPath = `${path}.writing-${process.pid}`;
  await writeFile(
    temporaryPath,
    `${JSON.stringify(value, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  if (process.platform === "win32") {
    await rm(path, { force: true });
  }
  await rename(temporaryPath, path);
}

function assertSafeInstallRoot(installRoot: string): void {
  const resolved = resolve(installRoot);
  const parsedRoot = resolve(sep);
  if (
    !isAbsolute(resolved) ||
    resolved === parsedRoot ||
    resolved === resolve(dirname(resolved))
  ) {
    throw new Error(`拒绝使用不安全的安装目录：${installRoot}`);
  }
}

async function isFile(path: string): Promise<boolean> {
  return stat(path)
    .then((value) => value.isFile())
    .catch(() => false);
}
