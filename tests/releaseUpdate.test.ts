import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import {
  DEFAULT_UPDATE_REPOSITORY,
  assertGithubReleaseAssetUrl,
  fetchLatestGithubRelease,
  installLatestReleaseZip,
  isReleaseZipInstallation,
  parseGithubAssetSha256,
  parseSha256File,
  replaceInstalledRelease,
  selectReleaseAssets,
  validateArchiveEntries,
  type GithubRelease,
} from "../src/daemon/releaseUpdate";
import { checkLocalUpdate, runLocalUpdate } from "../src/daemon/localUpdate";

test("latest GitHub Release parsing selects exact ZIP and checksum assets", async () => {
  const release = await fetchLatestGithubRelease(
    DEFAULT_UPDATE_REPOSITORY,
    mockReleaseFetch("0.2.0"),
  );
  assert.equal(release.tag, "v0.2.0");
  assert.equal(release.version, "0.2.0");
  const assets = selectReleaseAssets(release, DEFAULT_UPDATE_REPOSITORY);
  assert.equal(assets.archiveName, "ai-devtools-assistant-local-0.2.0.zip");
  assert.equal(
    parseGithubAssetSha256(assets.archive.digest),
    "a".repeat(64),
  );
});

test("release asset selection rejects another repository or incomplete release", () => {
  assert.throws(
    () =>
      assertGithubReleaseAssetUrl(
        "https://github.com/attacker/repo/releases/download/v0.2.0/ai-devtools-assistant-local-0.2.0.zip",
        DEFAULT_UPDATE_REPOSITORY,
        "v0.2.0",
      ),
    /不属于预期 GitHub 仓库/,
  );
  const incomplete = releaseFixture("0.2.0");
  incomplete.assets = incomplete.assets.slice(0, 1);
  assert.throws(
    () => selectReleaseAssets(incomplete, DEFAULT_UPDATE_REPOSITORY),
    /缺少.*\.zip.*\.sha256/,
  );
});

test("checksum and archive entry validation fail closed", () => {
  const archiveName = "ai-devtools-assistant-local-0.2.0.zip";
  assert.equal(
    parseSha256File(`${"b".repeat(64)}  ${archiveName}\n`, archiveName),
    "b".repeat(64),
  );
  assert.throws(
    () => parseSha256File(`${"b".repeat(64)}  another.zip\n`, archiveName),
    /未包含/,
  );
  assert.throws(
    () =>
      validateArchiveEntries(
        ["ai-devtools-assistant-local-0.2.0/../escape"],
        "ai-devtools-assistant-local-0.2.0",
      ),
    /不安全/,
  );
  assert.throws(
    () =>
      validateArchiveEntries(
        ["different-root/runtime/daemon/server.js"],
        "ai-devtools-assistant-local-0.2.0",
      ),
    /非预期路径/,
  );
});

test("ZIP installation check reports an exact Release asset", async (context) => {
  const installRoot = await mkdtemp(join(tmpdir(), "ai-release-check-"));
  context.after(() => rm(installRoot, { recursive: true, force: true }));
  await createInstalledRoot(installRoot, "0.1.0");
  assert.equal(await isReleaseZipInstallation(installRoot), true);

  const result = await checkLocalUpdate(installRoot, {
    fetchImpl: mockReleaseFetch("0.2.0"),
  });
  assert.equal(result.ok, true);
  assert.equal(result.installMode, "release-zip");
  assert.equal(result.updateAvailable, true);
  assert.equal(result.autoUpdateSupported, true);
  assert.equal(
    result.releaseAssetName,
    "ai-devtools-assistant-local-0.2.0.zip",
  );
});

test("Release ZIP installer downloads, verifies, extracts, and replaces the installed bundle", async (context) => {
  const installRoot = await mkdtemp(join(tmpdir(), "ai-release-e2e-install-"));
  const sourceRoot = await mkdtemp(join(tmpdir(), "ai-release-e2e-source-"));
  context.after(() =>
    Promise.all([
      rm(installRoot, { recursive: true, force: true }),
      rm(sourceRoot, { recursive: true, force: true }),
    ]),
  );
  await createInstalledRoot(installRoot, "0.1.0");
  const version = "0.2.0";
  const archiveName = `ai-devtools-assistant-local-${version}.zip`;
  const bundleRoot = join(sourceRoot, `ai-devtools-assistant-local-${version}`);
  await createReleaseBundle(bundleRoot, version);
  const archivePath = join(sourceRoot, archiveName);
  createZipArchive(bundleRoot, archivePath);
  const archiveBytes = await readFile(archivePath);
  const archiveSha256 = sha256(archiveBytes);
  const release = releaseFixture(version);
  const archiveAsset = release.assets[0];
  const checksumAsset = release.assets[1];
  assert.ok(archiveAsset);
  assert.ok(checksumAsset);
  archiveAsset.size = archiveBytes.byteLength;
  archiveAsset.digest = `sha256:${archiveSha256}`;
  const checksumText = `${archiveSha256}  ${archiveName}\n`;
  checksumAsset.size = Buffer.byteLength(checksumText);
  const metadata = JSON.parse(
    await readFile(join(installRoot, "安装版本.json"), "utf8"),
  );

  const result = await installLatestReleaseZip(installRoot, metadata, {
    release,
    fetchImpl: mockReleaseAssetFetch(archiveBytes, checksumText),
  });

  assert.equal(result.version, version);
  assert.equal(result.archiveSha256, archiveSha256);
  assert.equal(
    await readFile(join(installRoot, "runtime", "version.txt"), "utf8"),
    version,
  );
  assert.equal(
    JSON.parse(
      await readFile(join(installRoot, "extension", "manifest.json"), "utf8"),
    ).version,
    version,
  );
  const installedMetadata = JSON.parse(
    await readFile(join(installRoot, "安装版本.json"), "utf8"),
  );
  assert.equal(installedMetadata.version, version);
  assert.equal(installedMetadata.previousVersion, "0.1.0");
  assert.equal(installedMetadata.archiveSha256, archiveSha256);
});

test("daemon local-update entry routes a ZIP installation through the verified Release installer", async (context) => {
  const installRoot = await mkdtemp(join(tmpdir(), "ai-release-run-entry-"));
  const sourceRoot = await mkdtemp(join(tmpdir(), "ai-release-run-entry-source-"));
  context.after(() =>
    Promise.all([
      rm(installRoot, { recursive: true, force: true }),
      rm(sourceRoot, { recursive: true, force: true }),
    ]),
  );
  await createInstalledRoot(installRoot, "0.1.0");
  const version = "0.2.0";
  const archiveName = `ai-devtools-assistant-local-${version}.zip`;
  const bundleRoot = join(sourceRoot, `ai-devtools-assistant-local-${version}`);
  await createReleaseBundle(bundleRoot, version);
  const archivePath = join(sourceRoot, archiveName);
  createZipArchive(bundleRoot, archivePath);
  const archiveBytes = await readFile(archivePath);
  const archiveSha256 = sha256(archiveBytes);
  const checksumText = `${archiveSha256}  ${archiveName}\n`;
  const api = releaseApiFixture(version);
  const archiveAsset = api.assets[0];
  const checksumAsset = api.assets[1];
  assert.ok(archiveAsset);
  assert.ok(checksumAsset);
  archiveAsset.size = archiveBytes.byteLength;
  archiveAsset.digest = `sha256:${archiveSha256}`;
  checksumAsset.size = Buffer.byteLength(checksumText);

  const result = await runLocalUpdate(installRoot, {
    noRestart: true,
    fetchImpl: mockCompleteReleaseFetch(api, archiveBytes, checksumText),
  });

  assert.equal(result.ok, true);
  assert.equal(result.installMode, "release-zip");
  assert.equal(result.currentVersion, "0.1.0");
  assert.equal(result.newVersion, version);
  assert.equal(result.archiveSha256, archiveSha256);
  assert.equal(result.restartScheduled, false);
  assert.equal(
    await readFile(join(installRoot, "runtime", "version.txt"), "utf8"),
    version,
  );
});

test("Release ZIP installer rejects a bad checksum before replacing installed files", async (context) => {
  const installRoot = await mkdtemp(join(tmpdir(), "ai-release-e2e-reject-"));
  const sourceRoot = await mkdtemp(join(tmpdir(), "ai-release-e2e-reject-source-"));
  context.after(() =>
    Promise.all([
      rm(installRoot, { recursive: true, force: true }),
      rm(sourceRoot, { recursive: true, force: true }),
    ]),
  );
  await createInstalledRoot(installRoot, "0.1.0");
  const version = "0.2.0";
  const archiveName = `ai-devtools-assistant-local-${version}.zip`;
  const bundleRoot = join(sourceRoot, `ai-devtools-assistant-local-${version}`);
  await createReleaseBundle(bundleRoot, version);
  const archivePath = join(sourceRoot, archiveName);
  createZipArchive(bundleRoot, archivePath);
  const archiveBytes = await readFile(archivePath);
  const release = releaseFixture(version);
  const archiveAsset = release.assets[0];
  const checksumAsset = release.assets[1];
  assert.ok(archiveAsset);
  assert.ok(checksumAsset);
  archiveAsset.size = archiveBytes.byteLength;
  archiveAsset.digest = `sha256:${sha256(archiveBytes)}`;
  const checksumText = `${"0".repeat(64)}  ${archiveName}\n`;
  checksumAsset.size = Buffer.byteLength(checksumText);
  const metadata = JSON.parse(
    await readFile(join(installRoot, "安装版本.json"), "utf8"),
  );

  await assert.rejects(
    installLatestReleaseZip(installRoot, metadata, {
      release,
      fetchImpl: mockReleaseAssetFetch(archiveBytes, checksumText),
    }),
    /SHA-256 不匹配/,
  );
  assert.equal(
    await readFile(join(installRoot, "runtime", "version.txt"), "utf8"),
    "0.1.0",
  );
  assert.equal(
    JSON.parse(
      await readFile(join(installRoot, "extension", "manifest.json"), "utf8"),
    ).version,
    "0.1.0",
  );
});

test("transactional release replacement keeps one previous version", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "ai-release-install-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await createInstalledRoot(root, "0.1.0");
  const bundleRoot = join(root, ".updates", "bundle");
  await createReleaseBundle(bundleRoot, "0.2.0");

  await replaceInstalledRelease(bundleRoot, root, {
    version: "0.2.0",
    buildId: "0.2.0+ws10",
    repository: DEFAULT_UPDATE_REPOSITORY,
    releaseTag: "v0.2.0",
    releaseUrl: "https://github.com/masterjie98-cloud/chrome-devtools-plugin/releases/tag/v0.2.0",
    archiveSha256: "c".repeat(64),
    previousVersion: "0.1.0",
  });

  assert.equal(
    await readFile(join(root, "runtime", "version.txt"), "utf8"),
    "0.2.0",
  );
  assert.equal(
    await readFile(join(root, ".runtime.previous", "version.txt"), "utf8"),
    "0.1.0",
  );
  const metadata = JSON.parse(
    await readFile(join(root, "安装版本.json"), "utf8"),
  );
  assert.equal(metadata.version, "0.2.0");
  assert.equal(metadata.installMode, "release-zip");
  assert.equal(metadata.previousVersion, "0.1.0");
});

test("transactional release replacement restores runtime when extension swap fails", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "ai-release-rollback-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await createInstalledRoot(root, "0.1.0");
  await rm(join(root, "extension"), { recursive: true, force: true });
  const bundleRoot = join(root, ".updates", "bundle");
  await createReleaseBundle(bundleRoot, "0.2.0");

  await assert.rejects(
    replaceInstalledRelease(bundleRoot, root, {
      version: "0.2.0",
      buildId: "0.2.0+ws10",
      repository: DEFAULT_UPDATE_REPOSITORY,
      releaseTag: "v0.2.0",
      releaseUrl: null,
      archiveSha256: "d".repeat(64),
      previousVersion: "0.1.0",
    }),
  );
  assert.equal(
    await readFile(join(root, "runtime", "version.txt"), "utf8"),
    "0.1.0",
  );
});

function mockReleaseFetch(version: string): typeof fetch {
  return async () =>
    new Response(JSON.stringify(releaseApiFixture(version)), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
}

function mockReleaseAssetFetch(
  archiveBytes: Buffer,
  checksumText: string,
): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url =
      input instanceof Request
        ? input.url
        : input instanceof URL
          ? input.toString()
          : input;
    if (url.endsWith(".zip")) {
      return new Response(new Uint8Array(archiveBytes), {
        status: 200,
        headers: { "content-length": String(archiveBytes.byteLength) },
      });
    }
    if (url.endsWith(".zip.sha256")) {
      return new Response(checksumText, {
        status: 200,
        headers: { "content-length": String(Buffer.byteLength(checksumText)) },
      });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

function mockCompleteReleaseFetch(
  releaseApi: ReturnType<typeof releaseApiFixture>,
  archiveBytes: Buffer,
  checksumText: string,
): typeof fetch {
  const assetFetch = mockReleaseAssetFetch(archiveBytes, checksumText);
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url =
      input instanceof Request
        ? input.url
        : input instanceof URL
          ? input.toString()
          : input;
    if (url.endsWith("/releases/latest")) {
      return new Response(JSON.stringify(releaseApi), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return assetFetch(input, init);
  }) as typeof fetch;
}

function releaseFixture(version: string): GithubRelease {
  const api = releaseApiFixture(version);
  return {
    tag: api.tag_name,
    version,
    htmlUrl: api.html_url,
    publishedAt: api.published_at,
    assets: api.assets.map((asset) => ({
      name: asset.name,
      browserDownloadUrl: asset.browser_download_url,
      size: asset.size,
      digest: asset.digest,
      state: asset.state,
    })),
  };
}

function releaseApiFixture(version: string) {
  const tag = `v${version}`;
  const archiveName = `ai-devtools-assistant-local-${version}.zip`;
  const base = `https://github.com/${DEFAULT_UPDATE_REPOSITORY}/releases/download/${tag}`;
  return {
    tag_name: tag,
    html_url: `https://github.com/${DEFAULT_UPDATE_REPOSITORY}/releases/tag/${tag}`,
    published_at: "2026-08-03T00:00:00.000Z",
    draft: false,
    prerelease: false,
    assets: [
      {
        name: archiveName,
        browser_download_url: `${base}/${archiveName}`,
        size: 1_024,
        digest: `sha256:${"a".repeat(64)}`,
        state: "uploaded",
      },
      {
        name: `${archiveName}.sha256`,
        browser_download_url: `${base}/${archiveName}.sha256`,
        size: 100,
        digest: null,
        state: "uploaded",
      },
    ],
  };
}

async function createInstalledRoot(root: string, version: string) {
  await mkdir(join(root, "runtime", "daemon"), { recursive: true });
  await mkdir(join(root, "extension"), { recursive: true });
  await writeFile(join(root, "runtime", "daemon", "server.js"), "server");
  await writeFile(join(root, "runtime", "version.txt"), version);
  await writeFile(join(root, "extension", "manifest.json"), JSON.stringify({ version }));
  await writeFile(
    join(root, "安装版本.json"),
    JSON.stringify({
      version,
      installedAt: "2026-08-03T00:00:00.000Z",
      extensionPath: join(root, "extension"),
      runtimePath: join(root, "runtime"),
      installMode: "release-zip",
      updateRepository: DEFAULT_UPDATE_REPOSITORY,
    }),
  );
}

async function createReleaseBundle(root: string, version: string) {
  await mkdir(join(root, "runtime", "daemon"), { recursive: true });
  await mkdir(join(root, "runtime", "mcp"), { recursive: true });
  await mkdir(join(root, "extension"), { recursive: true });
  await writeFile(join(root, "runtime", "daemon", "server.js"), "server");
  await writeFile(join(root, "runtime", "daemon", "status.js"), "status");
  await writeFile(join(root, "runtime", "mcp", "server.js"), "mcp");
  await writeFile(join(root, "runtime", "restart-daemon.mjs"), "restart");
  await writeFile(join(root, "runtime", "version.txt"), version);
  await writeFile(
    join(root, "extension", "manifest.json"),
    JSON.stringify({ version }),
  );
  await writeFile(join(root, "extension", "update-notice.json"), "{}");
  await writeFile(join(root, "安装说明.md"), `version ${version}`);
  await writeFile(join(root, "package.json"), JSON.stringify({ version }));
  await writeFile(
    join(root, "release-manifest.json"),
    JSON.stringify({
      schemaVersion: 1,
      product: "ai-devtools-assistant",
      version,
      buildId: `${version}+ws10`,
      updateRepository: DEFAULT_UPDATE_REPOSITORY,
      archiveName: `ai-devtools-assistant-local-${version}.zip`,
      checksumName: `ai-devtools-assistant-local-${version}.zip.sha256`,
    }),
  );
}

function createZipArchive(bundleRoot: string, archivePath: string): void {
  const parent = dirname(bundleRoot);
  const rootName = basename(bundleRoot);
  const command =
    process.platform === "win32"
      ? {
          executable: "tar.exe",
          args: ["-a", "-cf", archivePath, "-C", parent, rootName],
        }
      : {
          executable: "/usr/bin/zip",
          args: ["-q", "-r", archivePath, rootName],
          cwd: parent,
        };
  const result = spawnSync(command.executable, command.args, {
    cwd: command.cwd,
    encoding: "utf8",
  });
  assert.equal(
    result.status,
    0,
    `Could not create test ZIP: ${result.error?.message || result.stderr || `exit ${result.status}`}`,
  );
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
