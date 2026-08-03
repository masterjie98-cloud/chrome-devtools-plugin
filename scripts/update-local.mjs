#!/usr/bin/env node

/**
 * Local git pull + rebuild for unpacked Chrome extension + daemon.
 * Writes dist/update-notice.json so the running extension can detect a newer
 * on-disk build and prompt the user to reload.
 */

import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeUpdateNoticeFile } from "./updateNotice.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skipPull = process.argv.includes("--skip-pull");
const skipInstall = process.argv.includes("--skip-install");
const dryRun = process.argv.includes("--dry-run");
const noRestart = process.argv.includes("--no-restart");

assertGitRepo();
assertNodeVersion();

const before = await readPackageVersion();
const commitBefore = gitOutput(["rev-parse", "HEAD"]) ?? "unknown";

if (!skipPull) {
  run("git", ["pull", "--ff-only"], "git pull --ff-only");
} else {
  process.stdout.write("跳过 git pull（--skip-pull）\n");
}

const afterPullCommit = gitOutput(["rev-parse", "HEAD"]) ?? commitBefore;

if (!skipInstall) {
  run("npm", ["install"], "npm install");
}

if (!dryRun) {
  run("npm", ["run", "build"], "npm run build");
} else {
  process.stdout.write("(dry-run) 跳过 npm run build\n");
}

const notice = await writeUpdateNoticeFile(projectRoot, {
  source: skipPull ? "build" : "git-pull",
  commit: afterPullCommit,
  previousCommit: commitBefore,
  previousVersion: before.version,
  needsExtensionReload: true,
});

process.stdout.write(
  [
    "",
    "本地更新完成。",
    `版本: ${before.version} → ${notice.version}`,
    `commit: ${commitBefore.slice(0, 7)} → ${String(notice.commit).slice(0, 7)}`,
    `buildId: ${notice.buildId}`,
    `通知文件: ${join(projectRoot, "dist", "update-notice.json")}`,
    "",
    "下一步：",
    "1. 打开扩展侧栏设置：若提示「代码已更新」，点击「重载扩展」",
    "   或到 chrome://extensions 点击「重新加载」",
    "2. 若未使用 LaunchAgent，请手动重启 daemon：npm run daemon:start",
    "",
  ].join("\n"),
);

if (!dryRun && !noRestart) {
  maybeRestartLaunchAgent();
} else if (noRestart) {
  process.stdout.write("已跳过 daemon 重启（--no-restart），由调用方决定何时重启。\n");
}

async function readPackageVersion() {
  const packageJson = JSON.parse(
    await readFile(join(projectRoot, "package.json"), "utf8"),
  );
  return { version: String(packageJson.version ?? "").trim() || "0.0.0" };
}

function maybeRestartLaunchAgent() {
  if (process.platform !== "darwin") {
    return;
  }
  const label = "com.ai-devtools-assistant.daemon";
  const print = spawnSync(
    "/bin/launchctl",
    ["print", `gui/${process.getuid()}/${label}`],
    { encoding: "utf8" },
  );
  if (print.status !== 0) {
    process.stdout.write(
      "未检测到 LaunchAgent，请手动重启 daemon（npm run daemon:start）。\n",
    );
    return;
  }
  const kick = spawnSync(
    "/bin/launchctl",
    ["kickstart", "-k", `gui/${process.getuid()}/${label}`],
    { encoding: "utf8" },
  );
  if (kick.status === 0) {
    process.stdout.write("已请求 LaunchAgent 重启 daemon。\n");
  } else {
    process.stdout.write(
      `LaunchAgent 重启失败，请手动重启 daemon：${kick.stderr || kick.stdout}\n`,
    );
  }
}

function assertGitRepo() {
  const result = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  if (result.status !== 0 || result.stdout.trim() !== "true") {
    throw new Error(
      "当前目录不是 git 仓库。本地自动更新需要 git clone 的开发目录。",
    );
  }
}

function assertNodeVersion() {
  const major = Number(process.versions.node.split(".")[0]);
  if (!Number.isInteger(major) || major < 20) {
    throw new Error(`需要 Node.js 20+，当前为 ${process.versions.node}`);
  }
}

function gitOutput(args) {
  const result = spawnSync("git", args, {
    cwd: projectRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return undefined;
  }
  return result.stdout.trim();
}

function run(command, args, label) {
  process.stdout.write(`\n>> ${label}\n`);
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32" && command === "npm",
  });
  if (result.status !== 0) {
    throw new Error(`${label} 失败 (exit ${result.status})`);
  }
}
