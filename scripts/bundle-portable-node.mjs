#!/usr/bin/env node

import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputFlag = process.argv.indexOf("--output");
const outputRoot = resolve(
  outputFlag >= 0 ? process.argv[outputFlag + 1] ?? "" : join(projectRoot, "release", ".portable-node"),
);
const versionFlag = process.argv.indexOf("--version");
const nodeVersion = normalizeNodeVersion(
  versionFlag >= 0 ? process.argv[versionFlag + 1] : process.version,
);
const cacheRoot = join(projectRoot, ".cache", "portable-node", nodeVersion);
const targets = [
  {
    id: "darwin-arm64",
    archive: `node-${nodeVersion}-darwin-arm64.tar.gz`,
    executable: join("bin", "node"),
  },
  {
    id: "darwin-x64",
    archive: `node-${nodeVersion}-darwin-x64.tar.gz`,
    executable: join("bin", "node"),
  },
  {
    id: "win32-x64",
    archive: `node-${nodeVersion}-win-x64.zip`,
    executable: "node.exe",
  },
];

await mkdir(outputRoot, { recursive: true });
await mkdir(cacheRoot, { recursive: true });
const checksumText = await downloadText(
  `https://nodejs.org/dist/${nodeVersion}/SHASUMS256.txt`,
  join(cacheRoot, "SHASUMS256.txt"),
);
const expectedChecksums = parseChecksums(checksumText);

for (const target of targets) {
  const expected = expectedChecksums.get(target.archive);
  if (!expected) {
    throw new Error(`Portable Node checksum is missing for ${target.archive}.`);
  }
  const archivePath = join(cacheRoot, target.archive);
  await downloadFile(
    `https://nodejs.org/dist/${nodeVersion}/${target.archive}`,
    archivePath,
    expected,
  );
  await extractTarget(target, archivePath, outputRoot);
}

await writeFile(
  join(outputRoot, "portable-node.json"),
  `${JSON.stringify(
    {
      version: 1,
      nodeVersion,
      source: `https://nodejs.org/dist/${nodeVersion}/`,
      targets: targets.map((target) => target.id),
    },
    null,
    2,
  )}\n`,
  "utf8",
);

process.stdout.write(
  `${JSON.stringify({ ok: true, nodeVersion, outputRoot, targets: targets.map((target) => target.id) })}\n`,
);

async function extractTarget(target, archivePath, destinationRoot) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "ai-devtools-node-"));
  try {
    const result = spawnSync("tar", ["-xf", archivePath, "-C", temporaryRoot], {
      encoding: "utf8",
    });
    if (result.status !== 0) {
      throw new Error(
        `Cannot extract ${target.archive}: ${result.error?.message || result.stderr || `exit ${result.status}`}`,
      );
    }
    const extractedRoot = join(
      temporaryRoot,
      target.archive.replace(/\.(?:tar\.gz|zip)$/i, ""),
    );
    const executablePath = join(extractedRoot, target.executable);
    await assertFile(executablePath);
    const targetRoot = join(destinationRoot, target.id);
    await rm(targetRoot, { recursive: true, force: true });
    await mkdir(targetRoot, { recursive: true });
    const executableName = target.id.startsWith("win32-") ? "node.exe" : "node";
    await cp(executablePath, join(targetRoot, executableName));
    await cp(join(extractedRoot, "LICENSE"), join(targetRoot, "LICENSE"));
    if (!target.id.startsWith("win32-")) {
      const { chmod } = await import("node:fs/promises");
      await chmod(join(targetRoot, executableName), 0o755);
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function downloadText(url, cachePath) {
  const cached = await readFile(cachePath, "utf8").catch(() => undefined);
  if (cached?.trim()) {
    return cached;
  }
  const response = await fetchWithTimeout(url);
  const value = await response.text();
  await writeFile(cachePath, value, "utf8");
  return value;
}

async function downloadFile(url, cachePath, expectedSha256) {
  const cached = await readFile(cachePath).catch(() => undefined);
  if (cached && sha256(cached) === expectedSha256) {
    return;
  }
  const response = await fetchWithTimeout(url);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = sha256(bytes);
  if (actual !== expectedSha256) {
    throw new Error(
      `Portable Node checksum mismatch for ${basename(cachePath)}: expected ${expectedSha256}, got ${actual}.`,
    );
  }
  await writeFile(cachePath, bytes, { mode: 0o600 });
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "ai-devtools-assistant-release-builder" },
      redirect: "error",
    });
    if (!response.ok) {
      throw new Error(`Download failed (${response.status}) for ${url}.`);
    }
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

function parseChecksums(value) {
  const checksums = new Map();
  for (const line of value.split(/\r?\n/)) {
    const match = /^([a-f0-9]{64})\s+(.+)$/.exec(line.trim());
    if (match) {
      checksums.set(match[2], match[1]);
    }
  }
  return checksums;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function normalizeNodeVersion(value) {
  const normalized = String(value ?? "").trim();
  if (!/^v(?:20|2[1-9]|[3-9][0-9])\.\d+\.\d+$/.test(normalized)) {
    throw new Error(`Unsupported portable Node version: ${normalized}`);
  }
  return normalized;
}

async function assertFile(path) {
  const metadata = await stat(path).catch(() => undefined);
  if (!metadata?.isFile()) {
    throw new Error(`Portable Node archive is missing ${path}.`);
  }
}
