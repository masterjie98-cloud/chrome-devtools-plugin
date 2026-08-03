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

test("localUpdate check returns structured fields on this git checkout", async () => {
  const { checkLocalUpdate } = await import("../src/daemon/localUpdate.js");
  const result = await checkLocalUpdate(projectRoot, {
    skipGitFetch: true,
    fetchImpl: async () => new Response("not found", { status: 404 }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.installMode, "git");
  assert.equal(typeof result.currentVersion, "string");
  assert.equal(typeof result.currentCommit, "string");
  assert.equal(typeof result.updateAvailable, "boolean");
  assert.equal(typeof result.message, "string");
});
