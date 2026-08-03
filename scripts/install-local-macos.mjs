#!/usr/bin/env node

import {
  cp,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const dryRun = process.argv.includes("--dry-run");
const sourceRuntimeRoot = dirname(fileURLToPath(import.meta.url));
const bundleRoot = resolve(sourceRuntimeRoot, "..");
const sourceExtensionRoot = join(bundleRoot, "extension");
const releasePackageJson = JSON.parse(
  await readFile(join(bundleRoot, "package.json"), "utf8"),
);
const version = String(releasePackageJson.version ?? "").trim();
const updateRepository = String(
  releasePackageJson.aiDevtools?.updateRepository ??
    "masterjie98-cloud/chrome-devtools-plugin",
).trim();
const installRoot = join(
  homedir(),
  "Library",
  "Application Support",
  "AI DevTools Assistant",
);
const installedRuntimeRoot = join(installRoot, "runtime");
const installedExtensionRoot = join(installRoot, "extension");
const installedGuidePath = join(installRoot, "安装说明.md");
const serviceLabel = "com.ai-devtools-assistant.daemon";

assertMacOs();
assertNodeVersion();
await assertFile(join(sourceExtensionRoot, "manifest.json"));
await assertFile(join(sourceRuntimeRoot, "daemon", "server.js"));
await assertFile(join(sourceRuntimeRoot, "daemon", "printToken.js"));
await assertFile(join(sourceRuntimeRoot, "manage-local-service.mjs"));

if (dryRun) {
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        dryRun: true,
        version,
        sourceBundle: bundleRoot,
        installRoot,
        extensionPath: installedExtensionRoot,
        daemonEntry: join(installedRuntimeRoot, "daemon", "server.js"),
        launchAgent: join(
          homedir(),
          "Library",
          "LaunchAgents",
          `${serviceLabel}.plist`,
        ),
      },
      null,
      2,
    )}\n`,
  );
  process.exit(0);
}

await mkdir(installRoot, { recursive: true });
stopInstalledService();
await replaceDirectory(sourceRuntimeRoot, installedRuntimeRoot);
await replaceDirectory(sourceExtensionRoot, installedExtensionRoot);
await cp(join(bundleRoot, "安装说明.md"), installedGuidePath);
await writeFile(
  join(installRoot, "安装版本.json"),
  `${JSON.stringify(
    {
      version,
      installedAt: new Date().toISOString(),
      extensionPath: installedExtensionRoot,
      runtimePath: installedRuntimeRoot,
      platform: process.platform,
      installMode: "release-zip",
      updateRepository,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

runNode(
  [
    join(installedRuntimeRoot, "manage-local-service.mjs"),
    "install",
    "--server-path",
    join(installedRuntimeRoot, "daemon", "server.js"),
  ],
  "安装本地 daemon 服务",
);

await waitForDaemon();
const tokenResult = runNode(
  [join(installedRuntimeRoot, "daemon", "printToken.js")],
  "读取本机 Bridge Token",
  { captureOutput: true },
);
const bridgeToken = tokenResult.stdout.trim();

process.stdout.write(
  [
    "",
    "AI DevTools Assistant 本地安装完成。",
    "",
    "1. 打开 Chrome：chrome://extensions",
    "2. 启用“开发者模式”，点击“加载已解压的扩展程序”",
    `3. 选择目录：${installedExtensionRoot}`,
    "4. 打开扩展侧栏的 AI 设置，将下面的本机 Token 填入“本地 Bridge Token”",
    "",
    bridgeToken,
    "",
    `完整说明：${installedGuidePath}`,
    "请勿把 Token 发到聊天、日志、截图或共享文档。",
    "",
  ].join("\n"),
);

function assertMacOs() {
  if (process.platform !== "darwin") {
    throw new Error("此一键安装器仅支持 macOS。");
  }
}

function assertNodeVersion() {
  const majorVersion = Number(process.versions.node.split(".")[0]);
  if (!Number.isInteger(majorVersion) || majorVersion < 20) {
    throw new Error(
      `需要 Node.js 20 或更高版本，当前版本为 ${process.versions.node}。`,
    );
  }
}

function stopInstalledService() {
  spawnSync(
    "/bin/launchctl",
    ["bootout", `gui/${process.getuid()}/${serviceLabel}`],
    { encoding: "utf8" },
  );
}

async function replaceDirectory(source, destination) {
  const staging = `${destination}.installing-${process.pid}`;
  const backup = `${destination}.previous`;
  await rm(staging, { recursive: true, force: true });
  await cp(source, staging, { recursive: true });
  await rm(backup, { recursive: true, force: true });

  const destinationExists = await stat(destination)
    .then((value) => value.isDirectory())
    .catch(() => false);
  if (destinationExists) {
    await rename(destination, backup);
  }
  try {
    await rename(staging, destination);
  } catch (error) {
    if (destinationExists) {
      await rename(backup, destination).catch(() => undefined);
    }
    throw error;
  }
}

async function waitForDaemon() {
  let lastError;
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    const result = runNode(
      [join(installedRuntimeRoot, "daemon", "status.js")],
      "检查 daemon 状态",
      { captureOutput: true, allowFailure: true },
    );
    if (result.status === 0) {
      return;
    }
    lastError = result.stderr || result.stdout;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`daemon 启动后状态检查失败：${lastError || "未知错误"}`);
}

function runNode(
  args,
  label,
  { captureOutput = false, allowFailure = false } = {},
) {
  const result = spawnSync(process.execPath, args, {
    encoding: "utf8",
    stdio: captureOutput ? "pipe" : "inherit",
  });
  if (result.status !== 0 && !allowFailure) {
    throw new Error(
      `${label}失败：${result.error?.message || result.stderr || `exit ${result.status}`}`,
    );
  }
  return result;
}

async function assertFile(path) {
  const fileStat = await stat(path).catch(() => undefined);
  if (!fileStat?.isFile()) {
    throw new Error(`安装包缺少必要文件：${path}`);
  }
}
