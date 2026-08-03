#!/usr/bin/env node

/**
 * Interactive CMD scaffold for local background services (daemon + MCP config).
 * Chrome extension (dist/) is separate — this script only prints its path.
 */

import { spawnSync } from "node:child_process";
import {
  access,
  chmod,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { createInterface } from "node:readline";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scriptsDir = join(projectRoot, "local-scripts");
const configPath = join(scriptsDir, "scaffold-config.json");
const isWin = process.platform === "win32";
const isMac = process.platform === "darwin";
const ext = isWin ? "cmd" : "command";
const useDefaults =
  process.argv.includes("--defaults") || process.argv.includes("--yes");

assertNodeVersion();

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

try {
  await main();
} finally {
  rl.close();
}

async function main() {
  process.stdout.write(
    [
      "",
      "========================================",
      " AI DevTools — 后台服务配置脚手架",
      "========================================",
      "本脚手架只处理 daemon / MCP 后台。",
      "Chrome 扩展请单独加载项目里的 dist/（不是这里的 install）。",
      ...(useDefaults
        ? ["模式: --defaults（非交互，使用默认/上次配置）"]
        : []),
      "",
    ].join("\n"),
  );

  const previous = await loadPreviousConfig();
  let answers;
  if (useDefaults) {
    answers = await buildDefaultAnswers(previous);
    process.stdout.write(
      `使用配置: ${JSON.stringify(answers, null, 2)}\n`,
    );
  } else if (previous) {
    const reuse = await askYesNo(
      "检测到上次配置，是否直接沿用并执行？",
      true,
    );
    answers = reuse ? previous : await askQuestions(previous);
  } else {
    answers = await askQuestions(null);
  }

  await mkdir(scriptsDir, { recursive: true });
  await writeFile(configPath, `${JSON.stringify(answers, null, 2)}\n`, "utf8");

  if (answers.npmInstall) {
    runNpm(["install"], "安装 npm 依赖");
  }
  if (answers.buildNode) {
    runNpm(["run", "build:node"], "构建 daemon / MCP（build:node）");
  }

  await writeLauncherScripts(answers);

  if (answers.installLaunchAgent) {
    if (!isMac) {
      process.stdout.write("当前系统不是 macOS，已跳过 LaunchAgent。\n");
    } else {
      runNode(
        [
          join(projectRoot, "scripts", "manage-local-service.mjs"),
          "install",
          "--server-path",
          join(projectRoot, "dist", "daemon", "server.js"),
        ],
        "安装 macOS LaunchAgent",
      );
    }
  }

  if (answers.startDaemonNow) {
    process.stdout.write(
      "\n正在启动 daemon（新窗口/本窗口取决于平台）…\n",
    );
    startDaemonDetachedOrHint();
  }

  if (answers.printMcpConfig) {
    process.stdout.write("\n--- MCP 客户端配置 (npm run client:config) ---\n");
    runNpm(["run", "client:config"], "生成 MCP 客户端配置", {
      allowFailure: true,
    });
  }

  await printFinalSummary(answers);
}

async function buildDefaultAnswers(previous) {
  const base = previous ?? {
    npmInstall: !(await pathExists(join(projectRoot, "node_modules"))),
    buildNode: true,
    installLaunchAgent: false,
    startDaemonNow: false,
    printMcpConfig: true,
    mcpDebugScript: false,
  };
  return {
    ...base,
    installLaunchAgent: isMac ? Boolean(base.installLaunchAgent) : false,
    // Non-interactive runs should not pop GUI windows by default.
    startDaemonNow: useDefaults ? false : Boolean(base.startDaemonNow),
    savedAt: new Date().toISOString(),
  };
}

async function askQuestions(defaults) {
  const d = await buildDefaultAnswers(defaults);
  // Interactive default: offer to start daemon after setup.
  d.startDaemonNow = defaults?.startDaemonNow ?? true;

  process.stdout.write("\n逐步确认（直接回车 = 默认值）\n\n");

  const npmInstall = await askYesNo(
    "是否执行 npm install？",
    d.npmInstall,
  );
  const buildNode = await askYesNo(
    "是否构建后台（npm run build:node，不含扩展）？",
    d.buildNode,
  );
  const installLaunchAgent = isMac
    ? await askYesNo(
        "是否安装 macOS LaunchAgent 开机自启？（可选，默认可双击启动脚本）",
        d.installLaunchAgent,
      )
    : false;
  const startDaemonNow = await askYesNo(
    "配置完成后是否立刻启动 daemon？",
    d.startDaemonNow,
  );
  const printMcpConfig = await askYesNo(
    "是否打印 Cursor/Codex MCP 配置？（MCP 由客户端按需拉起，一般不手动常开）",
    d.printMcpConfig,
  );
  const mcpDebugScript = await askYesNo(
    "是否额外生成「启动 MCP 调试」脚本（npm run mcp:dev）？",
    d.mcpDebugScript,
  );

  return {
    npmInstall,
    buildNode,
    installLaunchAgent,
    startDaemonNow,
    printMcpConfig,
    mcpDebugScript,
    savedAt: new Date().toISOString(),
  };
}

async function writeLauncherScripts(answers) {
  const ctl = join(projectRoot, "scripts", "local-daemon-ctl.mjs");
  const files = [];

  files.push([
    `启动 Daemon.${ext}`,
    wrapperScript({
      title: "启动 Daemon",
      nodeArgs: [ctl, "run"],
      pauseOnWin: true,
    }),
  ]);
  files.push([
    `停止 Daemon.${ext}`,
    wrapperScript({
      title: "停止 Daemon",
      nodeArgs: [ctl, "stop"],
      pauseOnWin: true,
    }),
  ]);
  files.push([
    `查看 Daemon 状态.${ext}`,
    wrapperScript({
      title: "查看 Daemon 状态",
      nodeArgs: [ctl, "status"],
      pauseOnWin: true,
    }),
  ]);
  files.push([
    `显示连接信息.${ext}`,
    wrapperScript({
      title: "显示连接信息",
      nodeArgs: [ctl, "info"],
      pauseOnWin: true,
    }),
  ]);
  files.push([
    `显示 MCP 客户端配置.${ext}`,
    wrapperScript({
      title: "显示 MCP 客户端配置",
      npmArgs: ["run", "client:config"],
      pauseOnWin: true,
    }),
  ]);
  files.push([
    `拉取更新.${ext}`,
    wrapperScript({
      title: "拉取更新 (git pull + build)",
      npmArgs: ["run", "update:local"],
      pauseOnWin: true,
    }),
  ]);

  if (answers.mcpDebugScript) {
    files.push([
      `启动 MCP 调试.${ext}`,
      wrapperScript({
        title: "启动 MCP 调试 (mcp:dev)",
        npmArgs: ["run", "mcp:dev"],
        pauseOnWin: true,
      }),
    ]);
  }

  for (const [name, body] of files) {
    const path = join(scriptsDir, name);
    await writeFile(path, body, "utf8");
    if (!isWin) {
      await chmod(path, 0o755);
    }
  }

  process.stdout.write(`\n已写入启动脚本目录: ${scriptsDir}\n`);
  for (const [name] of files) {
    process.stdout.write(`  - ${name}\n`);
  }
}

function wrapperScript({ title, nodeArgs, npmArgs, pauseOnWin }) {
  if (isWin) {
    const lines = [
      "@echo off",
      "setlocal",
      `title AI DevTools - ${title}`,
      `cd /d "${projectRoot}"`,
    ];
    if (nodeArgs) {
      lines.push(`node ${nodeArgs.map(winQuote).join(" ")}`);
    } else if (npmArgs) {
      lines.push(`call npm ${npmArgs.map(winQuote).join(" ")}`);
    }
    if (pauseOnWin) {
      lines.push("echo.");
      lines.push("pause");
    }
    lines.push("endlocal");
    return `${lines.join("\r\n")}\r\n`;
  }

  const lines = [
    "#!/bin/zsh",
    "set -euo pipefail",
    `cd ${shellQuote(projectRoot)}`,
    `echo "=== ${title} ==="`,
  ];
  if (nodeArgs) {
    lines.push(`exec node ${nodeArgs.map(shellQuote).join(" ")}`);
  } else if (npmArgs) {
    lines.push(`exec npm ${npmArgs.map(shellQuote).join(" ")}`);
  }
  return `${lines.join("\n")}\n`;
}

function startDaemonDetachedOrHint() {
  const startScript = join(scriptsDir, `启动 Daemon.${ext}`);
  if (isWin) {
    spawnSync("cmd.exe", ["/c", "start", "AI DevTools Daemon", startScript], {
      cwd: projectRoot,
      stdio: "inherit",
      shell: false,
    });
    process.stdout.write(`已尝试新开窗口运行: ${startScript}\n`);
    return;
  }
  if (isMac) {
    spawnSync("open", [startScript], { stdio: "inherit" });
    process.stdout.write(`已尝试打开: ${startScript}\n`);
    return;
  }
  process.stdout.write(
    `请手动运行: ${startScript}\n或: node scripts/local-daemon-ctl.mjs run\n`,
  );
}

async function printFinalSummary(answers) {
  const extensionDist = join(projectRoot, "dist");
  process.stdout.write(
    [
      "",
      "========================================",
      " 完成后台配置",
      "========================================",
      "",
      "【后台】",
      `- 启动脚本目录: ${scriptsDir}`,
      "- 日常只需保持 daemon 运行（双击「启动 Daemon」）",
      "- MCP 由 Cursor/Codex 按配置按需拉起；不要默认常开 mcp:dev",
      answers.mcpDebugScript
        ? "- 已生成「启动 MCP 调试」供排错"
        : "- 未生成 MCP 调试脚本（需要时可再跑脚手架勾选）",
      "",
      "【Chrome 扩展 — 独立步骤，非后台 install】",
      `- 目录: ${extensionDist}`,
      "  （若还没有扩展产物，在项目根另执行: npm run build:extension）",
      "1. chrome://extensions → 开发者模式 → 加载已解压的扩展程序",
      `2. 选择: ${extensionDist}`,
      "3. 双击「显示连接信息」复制 Bridge Token，填入扩展 AI 设置",
      "",
      "常用命令:",
      "  npm run setup:local          # 再次打开本脚手架",
      "  npm run daemon:start         # 等价前台启动 daemon",
      "  npm run client:config        # 打印 MCP 客户端配置",
      "",
    ].join("\n"),
  );
}

async function loadPreviousConfig() {
  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return {
      npmInstall: Boolean(parsed.npmInstall),
      buildNode: Boolean(parsed.buildNode),
      installLaunchAgent: Boolean(parsed.installLaunchAgent),
      startDaemonNow: Boolean(parsed.startDaemonNow),
      printMcpConfig: Boolean(parsed.printMcpConfig),
      mcpDebugScript: Boolean(parsed.mcpDebugScript),
    };
  } catch {
    return null;
  }
}

function askYesNo(question, defaultYes) {
  const hint = defaultYes ? "Y/n" : "y/N";
  return new Promise((resolveAnswer) => {
    if (!process.stdin.isTTY) {
      process.stdout.write(`${question} [${hint}] (非 TTY，使用默认)\n`);
      resolveAnswer(defaultYes);
      return;
    }
    rl.question(`${question} [${hint}] `, (answer) => {
      const normalized = String(answer ?? "")
        .trim()
        .toLowerCase();
      if (!normalized) {
        resolveAnswer(defaultYes);
        return;
      }
      resolveAnswer(normalized === "y" || normalized === "yes");
    });
  });
}

function runNpm(args, label, { allowFailure = false } = {}) {
  process.stdout.write(`\n>> ${label}\n`);
  const result = spawnSync("npm", args, {
    cwd: projectRoot,
    stdio: "inherit",
    env: process.env,
    shell: isWin,
  });
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`${label}失败 (exit ${result.status})`);
  }
  return result;
}

function runNode(args, label) {
  process.stdout.write(`\n>> ${label}\n`);
  const result = spawnSync(process.execPath, args, {
    cwd: projectRoot,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`${label}失败 (exit ${result.status})`);
  }
}

function assertNodeVersion() {
  const major = Number(process.versions.node.split(".")[0]);
  if (!Number.isInteger(major) || major < 20) {
    process.stderr.write(
      `需要 Node.js 20+，当前为 ${process.versions.node}。\n`,
    );
    process.exit(1);
  }
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

function winQuote(value) {
  const text = String(value);
  if (!/[ \t"]/u.test(text)) {
    return text;
  }
  return `"${text.replaceAll('"', '\\"')}"`;
}
