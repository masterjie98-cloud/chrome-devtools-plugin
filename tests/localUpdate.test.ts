import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("sync-manifest-version keeps public/manifest.json aligned", () => {
  const result = spawnSync(
    process.execPath,
    [join(projectRoot, "scripts/sync-manifest-version.mjs")],
    { cwd: projectRoot, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("source checkout is development-only and never auto-updates with git", async () => {
  const { checkLocalUpdate, runLocalUpdate } = await import(
    "../src/daemon/localUpdate.js"
  );
  const result = await checkLocalUpdate(projectRoot, {
    fetchImpl: async () => new Response("not found", { status: 404 }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.installMode, "development");
  assert.equal(result.autoUpdateSupported, false);
  assert.equal(typeof result.currentVersion, "string");
  assert.equal(typeof result.currentCommit, "string");
  assert.equal(typeof result.updateAvailable, "boolean");
  assert.equal(typeof result.message, "string");

  const update = await runLocalUpdate(projectRoot, { noRestart: true });
  assert.equal(update.ok, false);
  assert.equal(update.installMode, "development");
  assert.match(update.error ?? "", /Release ZIP/);
  assert.equal(update.restartScheduled, false);
});
