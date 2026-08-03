import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolveProjectRootFromDaemon } from "./localUpdate";

export const LOCAL_SERVICE_LABEL = "com.ai-devtools-assistant.daemon";

export interface LocalServiceStatus {
  ok: true;
  platform: NodeJS.Platform;
  /** LaunchAgent / Windows Startup autostart is implemented for this OS. */
  supported: boolean;
  /** Plist or Startup launcher is installed for login autostart. */
  registered: boolean;
  /** launchctl currently has the job loaded (macOS only). */
  loaded: boolean;
  label: string;
  plistPath: string | null;
  serverPath: string;
  manageScriptPath: string | null;
  message: string;
}

export interface LocalServiceSetResult {
  ok: boolean;
  registered: boolean;
  supported: boolean;
  platform: NodeJS.Platform;
  message?: string;
  error?: string;
}

export function resolveDaemonServerPath(): string {
  const argvPath = process.argv[1]?.trim();
  if (argvPath) {
    return resolve(argvPath);
  }
  return resolve(dirname(fileURLToPath(import.meta.url)), "server.js");
}

async function findManageScript(
  projectRoot = resolveProjectRootFromDaemon(),
): Promise<string | null> {
  const candidates = [
    join(projectRoot, "scripts", "manage-local-service.mjs"),
    join(projectRoot, "runtime", "manage-local-service.mjs"),
    join(projectRoot, "manage-local-service.mjs"),
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // try next
    }
  }
  return null;
}

function plistPathForLabel(label = LOCAL_SERVICE_LABEL): string {
  return join(homedir(), "Library", "LaunchAgents", `${label}.plist`);
}

function windowsStartupPath(): string | null {
  const appData = process.env.APPDATA?.trim();
  return appData
    ? join(
        appData,
        "Microsoft",
        "Windows",
        "Start Menu",
        "Programs",
        "Startup",
        "AI DevTools Assistant Daemon.cmd",
      )
    : null;
}

function isLaunchAgentLoaded(label = LOCAL_SERVICE_LABEL): boolean {
  if (process.platform !== "darwin" || typeof process.getuid !== "function") {
    return false;
  }
  const result = spawnSync(
    "/bin/launchctl",
    ["print", `gui/${process.getuid()}/${label}`],
    { encoding: "utf8" },
  );
  return result.status === 0;
}

async function isPlistInstalled(label = LOCAL_SERVICE_LABEL): Promise<boolean> {
  try {
    await access(plistPathForLabel(label));
    return true;
  } catch {
    return false;
  }
}

async function isWindowsStartupInstalled(): Promise<boolean> {
  const path = windowsStartupPath();
  if (!path) {
    return false;
  }
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function getLocalServiceStatus(
  projectRoot = resolveProjectRootFromDaemon(),
): Promise<LocalServiceStatus> {
  const serverPath = resolveDaemonServerPath();
  const manageScriptPath = await findManageScript(projectRoot);
  const platform = process.platform;

  if (platform !== "darwin" && platform !== "win32") {
    return {
      ok: true,
      platform,
      supported: false,
      registered: false,
      loaded: false,
      label: LOCAL_SERVICE_LABEL,
      plistPath: null,
      serverPath,
      manageScriptPath,
      message:
        "当前系统不支持内置登录自启动；请使用系统服务管理器启动 daemon。",
    };
  }

  if (platform === "win32") {
    const startupPath = windowsStartupPath();
    const registered = await isWindowsStartupInstalled();
    return {
      ok: true,
      platform,
      supported: Boolean(startupPath),
      registered,
      loaded: registered,
      label: LOCAL_SERVICE_LABEL,
      plistPath: startupPath,
      serverPath,
      manageScriptPath,
      message: registered
        ? "已注册 Windows 登录自启动。"
        : startupPath
          ? "未注册 Windows 登录自启动。开启后登录时可自动启动 daemon。"
          : "APPDATA 不可用，无法定位 Windows Startup 目录。",
    };
  }

  const plistPath = plistPathForLabel();
  const registered = await isPlistInstalled();
  const loaded = isLaunchAgentLoaded();

  return {
    ok: true,
    platform,
    supported: true,
    registered,
    loaded,
    label: LOCAL_SERVICE_LABEL,
    plistPath,
    serverPath,
    manageScriptPath,
    message: registered
      ? loaded
        ? "已注册 LaunchAgent，且当前已由 launchd 加载。"
        : "已注册 LaunchAgent（plist 存在）；当前可能尚未加载。"
      : "未注册开机自启。开启后登录时可自动启动 daemon。",
  };
}

export async function setLocalServiceAutostart(
  enabled: boolean,
  projectRoot = resolveProjectRootFromDaemon(),
): Promise<LocalServiceSetResult> {
  const status = await getLocalServiceStatus(projectRoot);
  if (!status.supported) {
    return {
      ok: false,
      registered: false,
      supported: false,
      platform: status.platform,
      error: status.message,
    };
  }

  if (!status.manageScriptPath) {
    return {
      ok: false,
      registered: status.registered,
      supported: true,
      platform: status.platform,
      error: "找不到 manage-local-service.mjs，无法修改登录自启动。",
    };
  }

  const action = enabled ? "install" : "uninstall";
  const result = spawnSync(
    process.execPath,
    [
      status.manageScriptPath,
      action,
      "--server-path",
      status.serverPath,
    ],
    { encoding: "utf8" },
  );

  if (result.status !== 0) {
    return {
      ok: false,
      registered:
        status.platform === "win32"
          ? await isWindowsStartupInstalled()
          : await isPlistInstalled(),
      supported: true,
      platform: status.platform,
      error: (
        result.stderr ||
        result.stdout ||
        `${action} failed (exit ${result.status})`
      ).trim(),
    };
  }

  const registered =
    status.platform === "win32"
      ? await isWindowsStartupInstalled()
      : await isPlistInstalled();
  return {
    ok: true,
    registered,
    supported: true,
    platform: status.platform,
    message: enabled
      ? status.platform === "win32"
        ? "已注册 Windows 登录自启动。"
        : "已注册 macOS LaunchAgent 开机自启。"
      : status.platform === "win32"
        ? "已取消 Windows 登录自启动。"
        : "已取消 LaunchAgent 开机自启。",
  };
}
