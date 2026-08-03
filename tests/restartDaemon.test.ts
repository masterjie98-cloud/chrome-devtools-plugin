import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const helperPath = resolve("scripts/restart-daemon.mjs");

test("restart helper waits for the old PID and starts a daemon inside its install root", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "ai-daemon-restart-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const markerPath = join(root, "started.txt");
  const pidPath = join(root, "daemon.pid");
  const serverPath = join(root, "server.mjs");
  await writeFile(
    serverPath,
    "import { writeFile } from 'node:fs/promises'; await writeFile(process.env.RESTART_TEST_MARKER, 'started');\n",
  );

  const result = spawnSync(
    process.execPath,
    [
      helperPath,
      "--wait-pid",
      "2147483647",
      "--server-path",
      serverPath,
      "--cwd",
      root,
      "--pid-path",
      pidPath,
    ],
    {
      encoding: "utf8",
      env: { ...process.env, RESTART_TEST_MARKER: markerPath },
    },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  await waitForFile(markerPath);
  assert.equal(await readFile(markerPath, "utf8"), "started");
  assert.match(await readFile(pidPath, "utf8"), /^\d+\n$/);
});

test("restart helper rejects a server outside the configured install root", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "ai-daemon-restart-root-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const result = spawnSync(
    process.execPath,
    [
      helperPath,
      "--wait-pid",
      "2147483647",
      "--server-path",
      helperPath,
      "--cwd",
      root,
    ],
    { encoding: "utf8" },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must be inside/);
});

async function waitForFile(path: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      await readFile(path);
      return;
    } catch {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
    }
  }
  throw new Error(`Timed out waiting for ${path}`);
}
