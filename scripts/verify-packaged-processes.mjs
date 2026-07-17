import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, rm, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const daemonEntry = join(rootDir, "dist", "daemon", "server.js");
const statusEntry = join(rootDir, "dist", "daemon", "status.js");
const mcpEntry = join(rootDir, "dist", "mcp", "server.js");
const timeoutMs = 10_000;

await Promise.all([access(daemonEntry), access(statusEntry), access(mcpEntry)]);

const dataDir = await mkdtemp(join(tmpdir(), "ai-devtools-packaged-"));
const port = await findAvailablePort();
const daemonUrl = `ws://127.0.0.1:${port}`;
const environment = stringEnvironment({
  ...process.env,
  AI_DEVTOOLS_DATA_DIR: dataDir,
  AI_DEVTOOLS_DAEMON_PORT: String(port),
  AI_DEVTOOLS_DAEMON_URL: daemonUrl,
});

let daemon;
const adapters = [];

try {
  daemon = await startDaemon(environment);
  const initialStatus = await readStatus(environment);
  assert.equal(initialStatus.ok, true);
  assert.equal(initialStatus.daemonUrl, daemonUrl);
  assert.equal(initialStatus.sessionBound, false);
  assert.equal(typeof initialStatus.exposedToolCount, "number");
  assert.ok(initialStatus.exposedToolCount > 0);

  const [first, second] = await Promise.all([
    startAdapter("packaged-verifier-a", environment),
    startAdapter("packaged-verifier-b", environment),
  ]);
  adapters.push(first, second);

  assert.notEqual(first.pid, second.pid);
  await Promise.all([verifyAdapter(first), verifyAdapter(second)]);

  const firstCloseStartedAt = Date.now();
  await first.client.close();
  first.closed = true;
  assert.ok(
    Date.now() - firstCloseStartedAt < 2_000,
    "The first adapter did not exit promptly after stdio EOF.",
  );
  assert.match(first.stderr(), /shutting down after STDIN_(?:EOF|CLOSED)/);

  await verifyAdapter(second);
  const statusAfterFirstExit = await readStatus(environment);
  assert.equal(statusAfterFirstExit.ok, true);

  await second.client.close();
  second.closed = true;
  assert.match(second.stderr(), /shutting down after STDIN_(?:EOF|CLOSED)/);

  const statusAfterBothExit = await readStatus(environment);
  assert.equal(statusAfterBothExit.ok, true);

  await stopChild(daemon.child, "packaged daemon");
  assert.equal(daemon.child.exitCode, 0);
  assert.match(daemon.output(), /shutting down after SIGTERM/);
  daemon = undefined;

  const directoryMode = (await stat(dataDir)).mode & 0o777;
  const configMode = (await stat(join(dataDir, "daemon.json"))).mode & 0o777;
  assert.equal(directoryMode, 0o700);
  assert.equal(configMode, 0o600);

  daemon = await startDaemon(environment);
  const restartedStatus = await readStatus(environment);
  assert.equal(restartedStatus.ok, true);
  await stopChild(daemon.child, "restarted packaged daemon");
  assert.equal(daemon.child.exitCode, 0);
  daemon = undefined;

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        daemon: {
          packagedEntry: "dist/daemon/server.js",
          cleanShutdown: true,
          restartedWithPersistentConfig: true,
          privateDataDirectoryMode: "0700",
          privateConfigMode: "0600",
        },
        adapters: {
          packagedEntry: "dist/mcp/server.js",
          concurrentProcesses: 2,
          distinctProcessIds: true,
          independentShutdown: true,
          daemonSurvivedAdapterExit: true,
        },
        exposedToolCount: initialStatus.exposedToolCount,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  for (const adapter of adapters) {
    if (!adapter.closed) {
      await adapter.client.close().catch(() => undefined);
    }
  }
  if (daemon?.child.exitCode === null) {
    await stopChild(daemon.child, "packaged daemon").catch(() => undefined);
  }
  await rm(dataDir, { recursive: true, force: true });
}

async function startDaemon(env) {
  const child = spawn(process.execPath, [daemonEntry], {
    cwd: rootDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const observer = observeChild(child);
  await observer.waitFor(`WebSocket listening on ws://127.0.0.1:${port}`);
  return { child, output: observer.output };
}

async function startAdapter(name, env) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [mcpEntry],
    cwd: rootDir,
    env,
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => {
    stderr = appendBounded(stderr, chunk.toString());
  });
  const client = new Client({ name, version: "1.0.0" });
  await client.connect(transport);
  const pid = transport.pid;
  assert.ok(pid, `${name} did not expose a child process ID.`);
  return { client, transport, pid, stderr: () => stderr, closed: false };
}

async function verifyAdapter(adapter) {
  assert.ok(adapter.transport.pid, "Expected the adapter process to remain alive.");
  const tools = await adapter.client.listTools();
  assert.ok(tools.tools.some((tool) => tool.name === "browser_list_sessions"));
  const result = await adapter.client.callTool({
    name: "browser_list_sessions",
    arguments: {},
  });
  assert.notEqual(result.isError, true);
  assert.equal(typeof result.structuredContent, "object");
}

async function readStatus(env) {
  const result = await runChild(process.execPath, [statusEntry], env);
  assert.equal(result.code, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

async function runChild(command, args, env) {
  const child = spawn(command, args, {
    cwd: rootDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout = appendBounded(stdout, chunk.toString());
  });
  child.stderr.on("data", (chunk) => {
    stderr = appendBounded(stderr, chunk.toString());
  });
  const { code } = await waitForExit(child, timeoutMs, "status command");
  return { code, stdout, stderr };
}

function observeChild(child) {
  let output = "";
  const listeners = new Set();
  const append = (chunk) => {
    output = appendBounded(output, chunk.toString());
    for (const listener of listeners) {
      listener();
    }
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  child.once("exit", () => {
    for (const listener of listeners) {
      listener();
    }
  });

  return {
    output: () => output,
    waitFor(text) {
      if (output.includes(text)) {
        return Promise.resolve();
      }
      return new Promise((resolvePromise, rejectPromise) => {
        const check = () => {
          if (output.includes(text)) {
            cleanup();
            resolvePromise();
          } else if (child.exitCode !== null) {
            cleanup();
            rejectPromise(
              new Error(`Process exited before emitting ${text}:\n${output}`),
            );
          }
        };
        const timeout = setTimeout(() => {
          cleanup();
          rejectPromise(new Error(`Timed out waiting for ${text}:\n${output}`));
        }, timeoutMs);
        const cleanup = () => {
          clearTimeout(timeout);
          listeners.delete(check);
        };
        listeners.add(check);
      });
    },
  };
}

async function stopChild(child, label) {
  if (child.exitCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  try {
    await waitForExit(child, timeoutMs, label);
  } catch (error) {
    child.kill("SIGKILL");
    throw error;
  }
}

function waitForExit(child, timeout, label) {
  if (child.exitCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      rejectPromise(new Error(`${label} did not exit within ${timeout}ms.`));
    }, timeout);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolvePromise({ code, signal });
    });
  });
}

async function findAvailablePort() {
  const server = createServer();
  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  await new Promise((resolvePromise, rejectPromise) => {
    server.close((error) => (error ? rejectPromise(error) : resolvePromise()));
  });
  return address.port;
}

function stringEnvironment(environment) {
  return Object.fromEntries(
    Object.entries(environment).filter((entry) => typeof entry[1] === "string"),
  );
}

function appendBounded(existing, next) {
  return `${existing}${next}`.slice(-64 * 1024);
}
