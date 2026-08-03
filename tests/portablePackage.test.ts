import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Release ZIP installers use the bundled Node runtime on macOS and Windows", async () => {
  const [macInstaller, windowsInstaller] = await Promise.all([
    read("packaging/setup.command"),
    read("packaging/setup.cmd"),
  ]);

  assert.match(macInstaller, /runtime\/node\/\$NODE_TARGET\/node/);
  assert.match(macInstaller, /install-local\.mjs" "\$@"/);
  assert.match(windowsInstaller, /runtime\\node\\win32-x64\\node\.exe/i);
  assert.match(windowsInstaller, /install-local\.mjs" %\*/i);
  assert.doesNotMatch(macInstaller, /command -v node/);
  assert.doesNotMatch(windowsInstaller, /where node/i);
});

test("Release ZIP installer help exits before installation side effects", () => {
  const projectRoot = fileURLToPath(new URL("..", import.meta.url));
  const result = spawnSync(
    process.execPath,
    ["scripts/install-local.mjs", "--help"],
    { cwd: projectRoot, encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Release ZIP 安装器/);
  assert.match(result.stdout, /--dry-run/);
  assert.match(result.stdout, /--no-autostart/);
  assert.equal(result.stderr, "");
});

test("local package generation bundles and validates every supported Node target", async () => {
  const packager = await read("scripts/package-local.mjs");
  const bundler = await read("scripts/bundle-portable-node.mjs");

  assert.match(packager, /bundlePortableNode/);
  for (const target of ["darwin-arm64", "darwin-x64", "win32-x64"]) {
    assert.match(packager, new RegExp(`runtime/node/${target}`));
    assert.match(bundler, new RegExp(target));
  }
  assert.match(bundler, /SHASUMS256\.txt/);
  assert.match(bundler, /Portable Node checksum mismatch/);
  assert.match(packager, /runtime\/node\/portable-node\.json/);
});
