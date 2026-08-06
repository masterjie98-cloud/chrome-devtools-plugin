#!/usr/bin/env node

/**
 * Cross-platform local installer for the packaged zip (Windows + macOS).
 * Copies runtime + extension into a stable user directory, starts daemon,
 * prints Bridge Token and Chrome load path.
 */

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
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  process.stdout.write(`AI DevTools Assistant Release ZIP 安装器

用法：
  node runtime/install-local.mjs [选项]

选项：
  --dry-run          仅显示安装目标，不写入文件或启动 daemon
  --autostart        安装并启用登录自启动（默认行为）
  --no-autostart     安装但不注册登录自启动
  --help, -h         显示本帮助并退出
`);
  process.exit(0);
}

const dryRun = process.argv.includes("--dry-run");
const forceAutostart =
  process.argv.includes("--autostart") ||
  process.argv.includes("--launch-agent");
const forceNoAutostart =
  process.argv.includes("--no-autostart") ||
  process.argv.includes("--no-launch-agent");
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
const installRoot = resolveInstallRoot();
const installedRuntimeRoot = join(installRoot, "runtime");
const installedExtensionRoot = join(installRoot, "extension");
const installedGuidePath = join(installRoot, "安装说明.md");
const installedAiMcpGuidePath = join(installRoot, "让 AI 自动接入 MCP.md");
const pidPath = join(installRoot, "daemon.pid");
const manageServicePath = join(installedRuntimeRoot, "manage-local-service.mjs");
const daemonServerPath = join(installedRuntimeRoot, "daemon", "server.js");
let runtimeNodePath = process.execPath;

assertNodeVersion();
await assertFile(join(sourceExtensionRoot, "manifest.json"));
await assertFile(join(sourceRuntimeRoot, "daemon", "server.js"));
await assertFile(join(sourceRuntimeRoot, "daemon", "printToken.js"));
await assertFile(join(bundleRoot, "让 AI 自动接入 MCP.md"));

if (dryRun) {
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        dryRun: true,
        version,
        platform: process.platform,
        installRoot,
        extensionPath: installedExtensionRoot,
        daemonEntry: join(installedRuntimeRoot, "daemon", "server.js"),
        aiMcpGuide: installedAiMcpGuidePath,
      },
      null,
      2,
    )}\n`,
  );
  process.exit(0);
}

await mkdir(installRoot, { recursive: true });
await stopExistingDaemon();
await replaceDirectory(sourceRuntimeRoot, installedRuntimeRoot);
await replaceDirectory(sourceExtensionRoot, installedExtensionRoot);
runtimeNodePath = resolveBundledNode(installedRuntimeRoot);
await assertFile(runtimeNodePath);
await cp(join(bundleRoot, "安装说明.md"), installedGuidePath).catch(() =>
  writeFile(
    installedGuidePath,
    "# AI DevTools Assistant\n\nLoad the extension folder in Chrome developer mode.\n",
    "utf8",
  ),
);
await cp(
  join(bundleRoot, "让 AI 自动接入 MCP.md"),
  installedAiMcpGuidePath,
);
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

const installedAutostart = await installAutostart();

await startDaemonProcess();
await waitForDaemon();
const tokenResult = runNode(
  [join(installedRuntimeRoot, "daemon", "printToken.js")],
  "读取本机 Bridge Token",
  { captureOutput: true },
);
const bridgeToken = tokenResult.stdout.trim();

const autostartLines = installedAutostart
  ? [
      "",
      process.platform === "darwin"
        ? "已注册 macOS LaunchAgent（登录后自动启动 daemon）。"
        : "已注册 Windows 登录自启动（登录后自动启动 daemon）。",
    ]
  : process.platform === "darwin" || process.platform === "win32"
    ? [
        "",
        "未注册开机自启。以后若需要可再执行：",
        `  "${runtimeNodePath}" "${manageServicePath}" install --server-path "${daemonServerPath}"`,
      ]
    : [];

process.stdout.write(
  [
    "",
    "AI DevTools Assistant 本地安装完成。",
    "",
    "1. 打开 Chrome：chrome://extensions",
    "2. 启用「开发者模式」，点击「加载已解压的扩展程序」",
    `3. 选择目录：${installedExtensionRoot}`,
    "4. 打开扩展侧栏 AI 设置，将下面的 Token 填入「本地 Bridge Token」",
    "",
    bridgeToken,
    "",
    `安装目录：${installRoot}`,
    `完整说明：${installedGuidePath}`,
    `交给宿主 AI 的 MCP 接入文件：${installedAiMcpGuidePath}`,
    "请勿把 Token 发到聊天、日志、截图或共享文档。",
    "",
    installedAutostart
      ? "daemon 已在后台启动，并已配置登录自启动。"
      : "daemon 已在后台启动（无窗口）；关机后需再运行本安装脚本或手动启动。",
    ...autostartLines,
    "",
    "以后更新：侧栏设置 → 检查更新 → 由 Daemon 更新。",
    "Daemon 会下载 GitHub Release ZIP、校验、覆盖并重启；Chrome 扩展仍需按提示重载。",
    "",
  ].join("\n"),
);

async function installAutostart() {
  if (process.platform !== "darwin" && process.platform !== "win32") {
    return false;
  }
  const manageExists = await stat(manageServicePath)
    .then((value) => value.isFile())
    .catch(() => false);
  if (!manageExists) {
    return false;
  }

  if (forceNoAutostart) {
    return false;
  }
  // Release ZIP installation is one-click by default. --no-autostart is the
  // explicit opt-out; --autostart remains accepted for automation clarity.
  void forceAutostart;
  const result = runNode(
    [manageServicePath, "install", "--server-path", daemonServerPath],
    process.platform === "darwin"
      ? "安装 macOS LaunchAgent"
      : "安装 Windows 登录自启动",
    { captureOutput: true, allowFailure: true },
  );
  return result.status === 0;
}

function resolveInstallRoot() {
  if (process.platform === "darwin") {
    return join(
      homedir(),
      "Library",
      "Application Support",
      "AI DevTools Assistant",
    );
  }
  if (process.platform === "win32") {
    const base =
      process.env.LOCALAPPDATA?.trim() || join(homedir(), "AppData", "Local");
    return join(base, "AI DevTools Assistant");
  }
  return join(homedir(), ".local", "share", "AI DevTools Assistant");
}

function assertNodeVersion() {
  const majorVersion = Number(process.versions.node.split(".")[0]);
  if (!Number.isInteger(majorVersion) || majorVersion < 20) {
    throw new Error(
      `需要 Node.js 20 或更高版本，当前版本为 ${process.versions.node}。`,
    );
  }
}

async function stopExistingDaemon() {
  if (process.platform === "darwin") {
    spawnSync(
      "/bin/launchctl",
      ["bootout", `gui/${process.getuid()}/com.ai-devtools-assistant.daemon`],
      { encoding: "utf8" },
    );
  }
  try {
    const raw = (await readFile(pidPath, "utf8")).trim();
    const pid = Number(raw);
    if (Number.isInteger(pid) && pid > 0) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        if (process.platform === "win32") {
          spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
            encoding: "utf8",
          });
        }
      }
    }
  } catch {
    // no pid file
  }
  await rm(pidPath, { force: true });
}

async function startDaemonProcess() {
  const status = runNode(
    [join(installedRuntimeRoot, "daemon", "status.js")],
    "检查 daemon",
    { captureOutput: true, allowFailure: true },
  );
  if (status.status === 0) {
    return;
  }

  const serverPath = join(installedRuntimeRoot, "daemon", "server.js");
  const child = spawn(runtimeNodePath, [serverPath], {
    cwd: installRoot,
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();
  if (child.pid) {
    await writeFile(pidPath, `${child.pid}\n`, "utf8");
  }
}

async function waitForDaemon() {
  let lastError;
  for (let attempt = 1; attempt <= 20; attempt += 1) {
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

function runNode(
  args,
  label,
  { captureOutput = false, allowFailure = false } = {},
) {
  const result = spawnSync(runtimeNodePath, args, {
    encoding: "utf8",
    stdio: captureOutput ? "pipe" : "inherit",
    env: process.env,
  });
  if (result.status !== 0 && !allowFailure) {
    throw new Error(
      `${label}失败：${result.error?.message || result.stderr || `exit ${result.status}`}`,
    );
  }
  return result;
}

function resolveBundledNode(runtimeRoot) {
  if (process.platform === "darwin") {
    const target = process.arch === "arm64" ? "darwin-arm64" : "darwin-x64";
    return join(runtimeRoot, "node", target, "node");
  }
  if (process.platform === "win32" && process.arch === "x64") {
    return join(runtimeRoot, "node", "win32-x64", "node.exe");
  }
  throw new Error(
    `安装包暂不支持 ${process.platform}/${process.arch}；支持 macOS arm64/x64 与 Windows x64。`,
  );
}

async function assertFile(path) {
  const fileStat = await stat(path).catch(() => undefined);
  if (!fileStat?.isFile()) {
    throw new Error(`安装包缺少必要文件：${path}`);
  }
}
