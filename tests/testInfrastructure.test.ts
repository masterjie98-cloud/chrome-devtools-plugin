import assert from "node:assert/strict";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import test from "node:test";
import { WS_COMMANDS, WS_PROTOCOL_VERSION } from "../src/shared/wsProtocol";
import {
  clientHelloMessage,
  createDeterministicIdFactory,
  TEST_BRIDGE_TOKEN,
  TEST_PROTOCOL_TIME,
} from "./helpers/protocolFixtures";
import { createTestDataDirectory } from "./helpers/tempDataDir";

test("protocol fixtures centralize token, version, timestamp, and deterministic IDs", () => {
  assert.equal(WS_PROTOCOL_VERSION, 6);
  const createId = createDeterministicIdFactory("message");
  assert.equal(createId(), "message-1");
  assert.equal(createId(), "message-2");

  const hello = clientHelloMessage("mcp", "profile-fixture", {
    requestId: createId(),
  });
  assert.equal(hello.command, WS_COMMANDS.CLIENT_HELLO);
  assert.equal(hello.sentAt, TEST_PROTOCOL_TIME);
  assert.deepEqual(hello.payload, {
    protocolVersion: WS_PROTOCOL_VERSION,
    clientRole: "mcp",
    clientName: "codex-stdio-adapter",
    sessionId: "profile-fixture",
    bridgeToken: TEST_BRIDGE_TOKEN,
  });
});

test("temporary daemon data directory exposes isolated paths and cleans up", async () => {
  const dataDir = await createTestDataDirectory("ai-devtools-helper-");
  try {
    await mkdir(dataDir.artifactDir, { recursive: true });
    await mkdir(dirname(dataDir.statePath), { recursive: true });
    await writeFile(dataDir.statePath, "fixture", "utf8");

    assert.equal(dataDir.configPath.startsWith(dataDir.rootDir), true);
    assert.equal(dataDir.statePath.startsWith(dataDir.rootDir), true);
    assert.equal(dataDir.artifactDir.startsWith(dataDir.rootDir), true);
    assert.equal((await stat(dataDir.statePath)).isFile(), true);
  } finally {
    await dataDir.cleanup();
  }
  await assert.rejects(stat(dataDir.rootDir), (error: unknown) =>
    Boolean(
      error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT",
    ),
  );
});
