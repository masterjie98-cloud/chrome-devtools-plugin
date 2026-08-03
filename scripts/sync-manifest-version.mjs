#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(
  await readFile(join(projectRoot, "package.json"), "utf8"),
);
const version = String(packageJson.version ?? "").trim();
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`Invalid package.json version: ${version}`);
}

const manifestPath = join(projectRoot, "public", "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (manifest.version === version) {
  process.stdout.write(`manifest.json already at ${version}\n`);
  process.exit(0);
}

manifest.version = version;
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
process.stdout.write(`Synced public/manifest.json version → ${version}\n`);
