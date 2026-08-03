#!/usr/bin/env node

import { access, mkdir, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const action = process.argv[2] ?? "print";
const dryRun = process.argv.includes("--dry-run");
const serverPathFlag = process.argv.indexOf("--server-path");
const serverPathValue =
  serverPathFlag >= 0 ? process.argv[serverPathFlag + 1]?.trim() : undefined;
const label = "com.ai-devtools-assistant.daemon";
const plistPath = resolve(
  homedir(),
  "Library",
  "LaunchAgents",
  `${label}.plist`,
);
const serverPath = resolve(serverPathValue || "dist/daemon/server.js");
const logDir =
  process.platform === "win32"
    ? resolve(
        process.env.LOCALAPPDATA?.trim() || homedir(),
        "AI DevTools Assistant",
        "logs",
      )
    : resolve(
        homedir(),
        "Library",
        "Logs",
        "ai-devtools-assistant",
      );
const stdoutPath = resolve(logDir, "daemon.log");
const stderrPath = resolve(logDir, "daemon.error.log");
const windowsStartupPath = resolveWindowsStartupPath();

if (process.platform !== "darwin" && process.platform !== "win32") {
  process.stderr.write(
    "Local service installation supports macOS launchd and Windows Startup only.\n",
  );
  process.exitCode = 1;
} else if (!["print", "install", "uninstall"].includes(action)) {
  process.stderr.write("Use print, install, or uninstall.\n");
  process.exitCode = 1;
} else {
  await main();
}

async function main() {
  if (process.platform === "win32") {
    await manageWindowsStartup();
    return;
  }
  const plist = renderPlist({
    label,
    nodePath: process.execPath,
    serverPath,
    stdoutPath,
    stderrPath,
  });
  if (action === "print" || dryRun) {
    process.stdout.write(
      `${JSON.stringify(
        {
          action,
          dryRun,
          plistPath,
          serverPath,
          label,
        },
        null,
        2,
      )}\n${plist}`,
    );
    return;
  }
  if (action === "install") {
    await access(serverPath).catch(() => {
      throw new Error(
        `Missing ${serverPath}. Run npm run build before installing the service.`,
      );
    });
    await mkdir(dirname(plistPath), { recursive: true });
    await mkdir(logDir, { recursive: true });
    await writeFile(plistPath, plist, { encoding: "utf8", mode: 0o600 });
    runLaunchctl(["bootout", `gui/${process.getuid()}/${label}`], true);
    await runLaunchctlWithRetry(
      ["bootstrap", `gui/${process.getuid()}`, plistPath],
      {
        attempts: 10,
        delayMs: 200,
      },
    );
    runLaunchctl(["enable", `gui/${process.getuid()}/${label}`]);
    process.stdout.write(
      `Installed ${label} at ${plistPath}. Logs: ${stdoutPath}, ${stderrPath}\n`,
    );
    return;
  }
  runLaunchctl(["bootout", `gui/${process.getuid()}/${label}`], true);
  await unlink(plistPath).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
  process.stdout.write(`Uninstalled ${label} and removed ${plistPath}.\n`);
}

async function manageWindowsStartup() {
  if (!windowsStartupPath) {
    throw new Error("APPDATA is unavailable; cannot resolve the Windows Startup folder.");
  }
  const launcher = renderWindowsLauncher({
    nodePath: process.execPath,
    serverPath,
    stdoutPath,
    stderrPath,
  });
  if (action === "print" || dryRun) {
    process.stdout.write(
      `${JSON.stringify(
        {
          action,
          dryRun,
          startupPath: windowsStartupPath,
          serverPath,
          label,
        },
        null,
        2,
      )}\n${launcher}`,
    );
    return;
  }
  if (action === "install") {
    await access(serverPath).catch(() => {
      throw new Error(`Missing ${serverPath}. Build or reinstall the daemon first.`);
    });
    await mkdir(dirname(windowsStartupPath), { recursive: true });
    await mkdir(logDir, { recursive: true });
    await writeFile(windowsStartupPath, launcher, "utf8");
    process.stdout.write(`Installed Windows Startup launcher at ${windowsStartupPath}.\n`);
    return;
  }
  await unlink(windowsStartupPath).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
  process.stdout.write(`Removed Windows Startup launcher ${windowsStartupPath}.\n`);
}

function resolveWindowsStartupPath() {
  if (process.platform !== "win32") {
    return null;
  }
  const appData = process.env.APPDATA?.trim();
  if (!appData) {
    return null;
  }
  return resolve(
    appData,
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
    "Startup",
    "AI DevTools Assistant Daemon.cmd",
  );
}

function renderWindowsLauncher({ nodePath, serverPath, stdoutPath, stderrPath }) {
  const quote = (value) => `"${String(value).replaceAll('"', '""')}"`;
  return [
    "@echo off",
    `start \"\" /b ${quote(nodePath)} ${quote(serverPath)} 1>>${quote(stdoutPath)} 2>>${quote(stderrPath)}`,
    "exit /b 0",
    "",
  ].join("\r\n");
}

function runLaunchctl(args, ignoreFailure = false) {
  const result = spawnSync("/bin/launchctl", args, { encoding: "utf8" });
  if (result.status !== 0 && !ignoreFailure) {
    throw new Error(
      `launchctl ${args.join(" ")} failed: ${result.stderr || result.stdout}`,
    );
  }
}

async function runLaunchctlWithRetry(
  args,
  { attempts, delayMs },
) {
  let lastResult;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = spawnSync("/bin/launchctl", args, { encoding: "utf8" });
    if (result.status === 0) {
      return;
    }
    lastResult = result;
    if (attempt < attempts) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
    }
  }
  throw new Error(
    `launchctl ${args.join(" ")} failed after ${attempts} attempts: ${
      lastResult?.stderr || lastResult?.stdout
    }`,
  );
}

function renderPlist({
  label,
  nodePath,
  serverPath,
  stdoutPath,
  stderrPath,
}) {
  const escapeXml = (value) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(nodePath)}</string>
    <string>${escapeXml(serverPath)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(dirname(serverPath))}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>StandardOutPath</key>
  <string>${escapeXml(stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(stderrPath)}</string>
</dict>
</plist>
`;
}
