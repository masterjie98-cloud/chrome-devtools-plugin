import { spawn, spawnSync } from "node:child_process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const children = new Set();
let shuttingDown = false;

function runInitialBuild() {
  console.log("[ai-devtools] Building dist once before watch...");
  const result = spawnSync(npmCommand, ["run", "build:extension"], {
    stdio: "inherit",
    env: process.env
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function startWatcher(label, args, env = {}) {
  const child = spawn(npmCommand, args, {
    stdio: "inherit",
    env: {
      ...process.env,
      ...env
    }
  });

  children.add(child);

  child.on("exit", (code, signal) => {
    children.delete(child);
    if (shuttingDown) {
      return;
    }

    console.error(`[ai-devtools] ${label} watcher exited (${signal ?? code ?? "unknown"}).`);
    shutdown(code ?? 1);
  });
}

function shutdown(code = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  for (const child of children) {
    child.kill("SIGINT");
  }

  setTimeout(() => process.exit(code), 120);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

runInitialBuild();
console.log("[ai-devtools] Watching extension build output in dist/...");
startWatcher("vite", ["run", "watch:vite"], { VITE_WATCH_BUILD: "1" });
startWatcher("content", ["run", "watch:content"]);
