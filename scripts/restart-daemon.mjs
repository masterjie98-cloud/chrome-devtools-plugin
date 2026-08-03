#!/usr/bin/env node

import { spawn } from "node:child_process";
import { access, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

if (process.argv.includes("--help")) {
  process.stdout.write(
    "Usage: node restart-daemon.mjs --wait-pid <pid> --server-path <path> --cwd <path> [--pid-path <path>]\n",
  );
  process.exit(0);
}

const waitPid = parsePositiveInteger(readFlag("--wait-pid"), "--wait-pid");
const serverPath = resolveRequiredPath(readFlag("--server-path"), "--server-path");
const workingDirectory = resolveRequiredPath(readFlag("--cwd"), "--cwd");
const pidPath = readFlag("--pid-path")
  ? resolveRequiredPath(readFlag("--pid-path"), "--pid-path")
  : undefined;

assertPathInside(serverPath, workingDirectory, "daemon server");
await waitForProcessExit(waitPid, 30_000);
await access(serverPath);

const child = spawn(process.execPath, [serverPath], {
  cwd: workingDirectory,
  detached: true,
  stdio: "ignore",
  env: process.env,
});
child.unref();
if (pidPath && child.pid) {
  await writeFile(pidPath, `${child.pid}\n`, { encoding: "utf8", mode: 0o600 });
}

function readFlag(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1]?.trim() : undefined;
}

function parsePositiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function resolveRequiredPath(value, name) {
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return resolve(value);
}

function assertPathInside(path, parent, label) {
  if (!isAbsolute(path) || !isAbsolute(parent)) {
    throw new Error(`${label} path must be absolute.`);
  }
  const child = relative(parent, path);
  if (!child || child === ".." || child.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
    throw new Error(`${label} must be inside the configured working directory.`);
  }
  if (dirname(path) === path) {
    throw new Error(`${label} path is not a file path.`);
  }
}

async function waitForProcessExit(pid, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!isProcessAlive(pid)) {
      return;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`Timed out waiting for daemon process ${pid} to exit.`);
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}
