import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
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

test("Windows Release ZIP installer is emitted as cmd-safe ASCII with CRLF", async () => {
  const [windowsInstaller, packager] = await Promise.all([
    read("packaging/setup.cmd"),
    read("scripts/package-local.mjs"),
  ]);

  assert.doesNotMatch(windowsInstaller, /[^\x00-\x7f]/);
  assert.match(packager, /writeWindowsBatch\(/);
  assert.match(packager, /replace\(\/\\r\?\\n\/g, "\\r\\n"\)/);
});

test("Windows installer offers direct Codex registration and the guide has runnable commands", async () => {
  const [windowsInstaller, clientConfig, packager] = await Promise.all([
    read("packaging/setup.cmd"),
    read("scripts/print-client-config.mjs"),
    read("scripts/package-local.mjs"),
  ]);

  assert.match(windowsInstaller, /where codex/i);
  assert.match(windowsInstaller, /codex mcp add/i);
  assert.match(windowsInstaller, /%LOCALAPPDATA%\\AI DevTools Assistant/i);
  assert.match(clientConfig, /process\.platform === "win32"/);
  assert.doesNotMatch(packager, /runtime\/node\/<当前平台>\/node/);
  assert.match(packager, /在 Windows CMD 中运行/);
  assert.match(packager, /runtime\\\\node\\\\win32-x64\\\\node\.exe/);
});

test("Release ZIP gives a host AI everything needed to register generic stdio MCP", async () => {
  const projectRoot = fileURLToPath(new URL("..", import.meta.url));
  const [aiGuide, clientConfig, packager, installer] = await Promise.all([
    read("packaging/让 AI 自动接入 MCP.md").catch(() => ""),
    read("scripts/print-client-config.mjs"),
    read("scripts/package-local.mjs"),
    read("scripts/install-local.mjs"),
  ]);
  const generated = spawnSync(
    process.execPath,
    [
      "scripts/print-client-config.mjs",
      "--server-path",
      "dist/mcp/server.js",
    ],
    { cwd: projectRoot, encoding: "utf8" },
  );

  assert.equal(generated.status, 0, generated.stderr);
  const output = JSON.parse(generated.stdout) as {
    genericMcp?: {
      serverName?: string;
      transport?: string;
      command?: string;
      args?: string[];
      env?: Record<string, string>;
    };
  };
  assert.equal(output.genericMcp?.serverName, "ai-devtools");
  assert.equal(output.genericMcp?.transport, "stdio");
  assert.ok(output.genericMcp?.command);
  assert.ok(output.genericMcp?.args?.[0]);
  assert.equal(output.genericMcp?.env?.AI_DEVTOOLS_MCP_TOOL_PROFILE, "smart");
  assert.equal(isAbsolute(output.genericMcp?.command ?? ""), true);
  assert.equal(isAbsolute(output.genericMcp?.args?.[0] ?? ""), true);

  assert.match(aiGuide, /genericMcp/);
  assert.match(aiGuide, /不得覆盖|merge/i);
  assert.match(aiGuide, /Bridge Token/);
  assert.match(aiGuide, /重启|restart/i);
  assert.match(aiGuide, /验证|verify/i);
  assert.match(clientConfig, /genericMcp/);
  assert.match(clientConfig, /transport:\s*"stdio"/);
  assert.match(packager, /让 AI 自动接入 MCP\.md/);
  assert.match(installer, /让 AI 自动接入 MCP\.md/);
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
