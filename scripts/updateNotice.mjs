#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @param {string} projectRoot
 * @param {{
 *   source?: string,
 *   commit?: string,
 *   previousCommit?: string,
 *   previousVersion?: string,
 *   needsExtensionReload?: boolean,
 * }} [options]
 */
export async function writeUpdateNoticeFile(projectRoot, options = {}) {
  const packageJson = JSON.parse(
    await readFile(join(projectRoot, "package.json"), "utf8"),
  );
  const version = String(packageJson.version ?? "").trim() || "0.0.0";
  const wsSource = await readFile(
    join(projectRoot, "src/shared/wsProtocol.ts"),
    "utf8",
  );
  const protocolMatch = wsSource.match(
    /export const WS_PROTOCOL_VERSION = (\d+)/,
  );
  const protocolVersion = protocolMatch?.[1] ?? "?";
  const buildId = `${version}+ws${protocolVersion}`;

  const notice = {
    version,
    buildId,
    updatedAt: new Date().toISOString(),
    source: options.source ?? "build",
    commit: options.commit ?? "",
    previousCommit: options.previousCommit ?? "",
    previousVersion: options.previousVersion ?? version,
    needsExtensionReload: Boolean(options.needsExtensionReload),
    projectRoot,
  };

  const distDir = join(projectRoot, "dist");
  const localScriptsDir = join(projectRoot, "local-scripts");
  await mkdir(distDir, { recursive: true });
  await mkdir(localScriptsDir, { recursive: true });
  const payload = `${JSON.stringify(notice, null, 2)}\n`;
  await writeFile(join(distDir, "update-notice.json"), payload, "utf8");
  await writeFile(join(localScriptsDir, "update-notice.json"), payload, "utf8");
  return notice;
}

const invokedDirectly = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (invokedDirectly) {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const notice = await writeUpdateNoticeFile(projectRoot, {
    source: "build",
    needsExtensionReload: false,
  });
  process.stdout.write(
    `Wrote update-notice.json version=${notice.version} buildId=${notice.buildId}\n`,
  );
}
