import assert from "node:assert/strict";
import { chmod, mkdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  addAllowedExtensionId,
  loadDaemonConfig,
  resolveDaemonDataPaths,
  saveExternalMcpServers,
} from "../src/daemon/config";
import { createTestDataDirectory } from "./helpers/tempDataDir";

test("AI_DEVTOOLS_DATA_DIR places config, state, and artifacts under one root", async () => {
  const dataDir = await createTestDataDirectory("ai-devtools-config-");
  try {
    const paths = resolveDaemonDataPaths(
      { AI_DEVTOOLS_DATA_DIR: dataDir.rootDir },
      "/unused-home",
    );
    assert.deepEqual(paths, {
      dataDir: resolve(dataDir.rootDir),
      configPath: join(resolve(dataDir.rootDir), "daemon.json"),
      statePath: join(resolve(dataDir.rootDir), "state.json"),
      artifactDir: join(resolve(dataDir.rootDir), "artifacts"),
    });

    const config = await loadDaemonConfig({ environment: {}, paths });
    assert.equal(config.configPath, paths.configPath);
    assert.equal(config.bridgeToken.length >= 32, true);
    assert.deepEqual(config.allowedExtensionIds, []);
    assert.equal((await stat(dataDir.rootDir)).mode & 0o777, 0o700);
    assert.equal((await stat(paths.configPath)).mode & 0o777, 0o600);
  } finally {
    await dataDir.cleanup();
  }
});

test("extension ID allowlist is strict, deduplicated, persisted, and private", async () => {
  const dataDir = await createTestDataDirectory("ai-devtools-extension-pairing-");
  const extensionA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const extensionB = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  try {
    const paths = resolveDaemonDataPaths({ AI_DEVTOOLS_DATA_DIR: dataDir.rootDir });
    await addAllowedExtensionId(extensionB, { environment: {}, paths });
    const config = await addAllowedExtensionId(extensionA.toUpperCase(), {
      environment: {},
      paths,
    });
    await addAllowedExtensionId(extensionA, { environment: {}, paths });

    assert.deepEqual(config.allowedExtensionIds, [extensionA, extensionB]);
    assert.deepEqual(
      (await loadDaemonConfig({ environment: {}, paths })).allowedExtensionIds,
      [extensionA, extensionB],
    );
    assert.equal((await stat(paths.configPath)).mode & 0o777, 0o600);
    const stored = JSON.parse(await readFile(paths.configPath, "utf8")) as {
      bridgeToken?: string;
      allowedExtensionIds?: string[];
    };
    assert.equal(typeof stored.bridgeToken, "string");
    assert.deepEqual(stored.allowedExtensionIds, [extensionA, extensionB]);
    await assert.rejects(
      addAllowedExtensionId("not-an-extension-id", { environment: {}, paths }),
      /32 lowercase letters/,
    );
  } finally {
    await dataDir.cleanup();
  }
});

test("external MCP secrets stay only in the private daemon config", async () => {
  const dataDir = await createTestDataDirectory("ai-devtools-external-mcp-");
  try {
    const paths = resolveDaemonDataPaths({ AI_DEVTOOLS_DATA_DIR: dataDir.rootDir });
    const initial = await loadDaemonConfig({ environment: {}, paths });
    const saved = await saveExternalMcpServers(
      [
        {
          id: "mcp_private_fixture",
          name: "Private fixture",
          enabled: false,
          autoApproveTools: true,
          transport: {
            type: "streamable-http",
            url: "https://mcp.example.test/mcp",
            headers: { Authorization: "Bearer not-a-real-secret" },
          },
        },
      ],
      { environment: {}, paths },
    );
    assert.equal(saved.bridgeToken, initial.bridgeToken);
    assert.equal(saved.externalMcpServers.length, 1);
    assert.equal(saved.externalMcpServers[0]?.autoApproveTools, true);
    assert.equal((await stat(paths.configPath)).mode & 0o777, 0o600);
    const raw = await readFile(paths.configPath, "utf8");
    assert.match(raw, /not-a-real-secret/);
    const loaded = await loadDaemonConfig({ environment: {}, paths });
    assert.deepEqual(loaded.externalMcpServers, saved.externalMcpServers);
  } finally {
    await dataDir.cleanup();
  }
});

test("environment extension allowlist overrides stored pairing for one run", async () => {
  const dataDir = await createTestDataDirectory("ai-devtools-extension-env-");
  const storedId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const environmentId = "cccccccccccccccccccccccccccccccc";
  try {
    const paths = resolveDaemonDataPaths({ AI_DEVTOOLS_DATA_DIR: dataDir.rootDir });
    await addAllowedExtensionId(storedId, { environment: {}, paths });
    const config = await loadDaemonConfig({
      environment: {
        AI_DEVTOOLS_ALLOWED_EXTENSION_IDS: `${environmentId},${environmentId}`,
      },
      paths,
    });
    assert.deepEqual(config.allowedExtensionIds, [environmentId]);
    await assert.rejects(
      loadDaemonConfig({
        environment: { AI_DEVTOOLS_ALLOWED_EXTENSION_IDS: "invalid" },
        paths,
      }),
      /32 lowercase letters/,
    );
  } finally {
    await dataDir.cleanup();
  }
});

test("explicit per-path overrides win without changing the umbrella root", () => {
  const paths = resolveDaemonDataPaths(
    {
      AI_DEVTOOLS_DATA_DIR: "/tmp/ai-devtools-root",
      AI_DEVTOOLS_CONFIG_PATH: "/tmp/explicit/daemon.json",
      AI_DEVTOOLS_STATE_PATH: "/tmp/explicit/state.json",
      AI_DEVTOOLS_ARTIFACT_DIR: "/tmp/explicit/artifacts",
    },
    "/unused-home",
  );

  assert.equal(paths.dataDir, "/tmp/ai-devtools-root");
  assert.equal(paths.configPath, "/tmp/explicit/daemon.json");
  assert.equal(paths.statePath, "/tmp/explicit/state.json");
  assert.equal(paths.artifactDir, "/tmp/explicit/artifacts");
});

test("unset umbrella preserves legacy default locations", () => {
  const paths = resolveDaemonDataPaths({}, "/home/tester");
  assert.equal(paths.dataDir, undefined);
  assert.equal(
    paths.configPath,
    "/home/tester/.config/ai-devtools-assistant/daemon.json",
  );
  assert.equal(
    paths.statePath,
    "/home/tester/.local/share/ai-devtools-assistant/state.json",
  );
  assert.equal(
    paths.artifactDir,
    "/home/tester/.local/share/ai-devtools-assistant/artifacts",
  );
});

test("an explicit config path does not chmod an existing parent directory", async () => {
  const dataDir = await createTestDataDirectory("ai-devtools-explicit-config-");
  const sharedParent = join(dataDir.rootDir, "shared-parent");
  try {
    await mkdir(sharedParent, { mode: 0o755 });
    await chmod(sharedParent, 0o755);
    const paths = resolveDaemonDataPaths({
      AI_DEVTOOLS_CONFIG_PATH: join(sharedParent, "daemon.json"),
    });
    await loadDaemonConfig({ environment: {}, paths });

    assert.equal((await stat(sharedParent)).mode & 0o777, 0o755);
    assert.equal((await stat(paths.configPath)).mode & 0o777, 0o600);
  } finally {
    await dataDir.cleanup();
  }
});
