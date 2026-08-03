#!/usr/bin/env node

/**
 * Cross-platform daemon process helper for local-scripts/*.cmd|.command.
 * Usage: node scripts/local-daemon-ctl.mjs <run|stop|status|info>
 */

import { spawn, spawnSync } from "node:child_process";
import {
  access,
  mkdir,
  readFile,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const action = process.argv[2] ?? "status";
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scriptsDir = join(projectRoot, "local-scripts");
const pidPath = join(scriptsDir, "daemon.pid");
const serverPath = join(projectRoot, "dist", "daemon", "server.js");
const statusPath = join(projectRoot, "dist", "daemon", "status.js");
const printTokenPath = join(projectRoot, "dist", "daemon", "printToken.js");
const extensionDist = join(projectRoot, "dist");

if (!["run", "stop", "status", "info"].includes(action)) {
  process.stderr.write("Usage: node scripts/local-daemon-ctl.mjs <run|stop|status|info>\n");
  process.exitCode = 1;
} else {
  await main();
}

async function main() {
  switch (action) {
    case "run":
      await runDaemon();
      return;
    case "stop":
      await stopDaemon();
      return;
    case "status":
      await printStatus();
      return;
    case "info":
      await printInfo();
      return;
  }
}

async function runDaemon() {
  await access(serverPath).catch(() => {
    throw new Error(
      `缺少 ${serverPath}。请先在项目根目录执行 npm run build:node（或 npm run setup:local）。`,
    );
  });
  await mkdir(scriptsDir, { recursive: true });

  const existingPid = await readPid();
  if (existingPid && isPidAlive(existingPid)) {
    process.stderr.write(
      `Daemon 已在运行 (pid ${existingPid})。如需重启，先执行停止脚本。\n`,
    );
    process.exitCode = 1;
    return;
  }

  const child = spawn(process.execPath, [serverPath], {
    cwd: projectRoot,
    stdio: "inherit",
    env: process.env,
  });
  await writeFile(pidPath, `${child.pid}\n`, "utf8");
  process.stdout.write(`Daemon 已启动 (pid ${child.pid})，日志见本窗口。Ctrl+C 结束。\n`);

  const clearPid = async () => {
    const current = await readPid();
    if (current === child.pid) {
      await unlink(pidPath).catch(() => undefined);
    }
  };

  const onSignal = () => {
    child.kill("SIGTERM");
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  const exitCode = await new Promise((resolveExit) => {
    child.on("exit", (code, signal) => {
      resolveExit(signal ? 1 : (code ?? 1));
    });
  });
  await clearPid();
  process.exitCode = exitCode;
}

async function stopDaemon() {
  const pid = await readPid();
  if (!pid) {
    process.stdout.write("未找到 daemon.pid，可能未通过本地启动脚本启动。\n");
    process.exitCode = 1;
    return;
  }
  if (!isPidAlive(pid)) {
    await unlink(pidPath).catch(() => undefined);
    process.stdout.write(`进程 ${pid} 已不存在，已清理 pid 文件。\n`);
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "inherit",
      });
    } else {
      throw error;
    }
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!isPidAlive(pid)) {
      break;
    }
    await delay(100);
  }
  if (isPidAlive(pid) && process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "inherit",
    });
  } else if (isPidAlive(pid)) {
    process.kill(pid, "SIGKILL");
  }
  await unlink(pidPath).catch(() => undefined);
  process.stdout.write(`已停止 daemon (pid ${pid}).\n`);
}

async function printStatus() {
  const pid = await readPid();
  process.stdout.write(
    `pid 文件: ${pid ? `${pid}${isPidAlive(pid) ? " (alive)" : " (stale)"}` : "(none)"}\n`,
  );
  try {
    await access(statusPath);
  } catch {
    process.stdout.write(
      "尚未构建 dist/daemon/status.js。请先 npm run build:node。\n",
    );
    process.exitCode = 1;
    return;
  }
  const result = spawnSync(process.execPath, [statusPath], {
    cwd: projectRoot,
    encoding: "utf8",
    env: process.env,
  });
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  process.exitCode = result.status === 0 ? 0 : 1;
}

async function printInfo() {
  process.stdout.write(
    [
      "",
      "=== 后台服务 ===",
      `项目目录: ${projectRoot}`,
      `Daemon 入口: ${serverPath}`,
      "监听: ws://127.0.0.1:17321",
      "启动: local-scripts 里的「启动 Daemon」脚本（或 npm run daemon:start）",
      "",
      "=== MCP（由 Cursor/Codex 按需拉起，一般不要手动常开）===",
      "生成配置: npm run client:config",
      "调试窗口: npm run mcp:dev（需 daemon 已运行）",
      "",
      "=== Chrome 扩展（独立，不是后台 install）===",
      `加载已解压扩展目录: ${extensionDist}`,
      "1. 打开 chrome://extensions",
      "2. 开启开发者模式 → 加载已解压的扩展程序",
      `3. 选择: ${extensionDist}`,
      "4. 侧栏 AI 设置填入 Bridge Token（下面）",
      "",
    ].join("\n"),
  );

  const tokenResult = await readBridgeToken();
  if (tokenResult.ok) {
    process.stdout.write(`Bridge Token:\n${tokenResult.token}\n\n`);
    process.stdout.write("请勿把 Token 发到聊天、日志或截图。\n");
  } else {
    process.stdout.write(
      `未能读取 Token：${tokenResult.error}\n先启动一次 daemon，或执行 npm run build:node 后再试。\n`,
    );
  }
}

async function readBridgeToken() {
  try {
    await access(printTokenPath);
    const result = spawnSync(process.execPath, [printTokenPath], {
      cwd: projectRoot,
      encoding: "utf8",
      env: process.env,
    });
    if (result.status === 0 && result.stdout.trim()) {
      return { ok: true, token: result.stdout.trim() };
    }
    return {
      ok: false,
      error: (result.stderr || result.stdout || `exit ${result.status}`).trim(),
    };
  } catch {
    // fall through to npm script
  }

  const result = spawnSync("npm", ["run", "daemon:token", "--silent"], {
    cwd: projectRoot,
    encoding: "utf8",
    env: process.env,
    shell: process.platform === "win32",
  });
  if (result.status === 0 && result.stdout.trim()) {
    return { ok: true, token: result.stdout.trim() };
  }
  return {
    ok: false,
    error: (result.stderr || result.stdout || "printToken unavailable").trim(),
  };
}

async function readPid() {
  try {
    const raw = (await readFile(pidPath, "utf8")).trim();
    const pid = Number(raw);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
