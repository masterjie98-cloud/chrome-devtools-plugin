import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { ArtifactStore } from "../src/daemon/artifacts/store";
import { externalizeLargeJsonResult } from "../src/daemon/artifacts/externalize";
import { createTestDataDirectory } from "./helpers/tempDataDir";

test("ArtifactStore keeps screenshot bytes outside metadata and survives restart", async () => {
  const dataDir = await createTestDataDirectory("ai-devtools-artifacts-");
  const bytes = Buffer.from("test-png-bytes", "utf8");
  const dataUrl = `data:image/png;base64,${bytes.toString("base64")}`;

  try {
    const store = new ArtifactStore({ rootDir: dataDir.artifactDir });
    const first = await store.putDataUrl("profile-a", "screenshot", dataUrl);
    const duplicate = await store.putDataUrl(
      "profile-a",
      "screenshot",
      dataUrl,
    );

    assert.equal(duplicate.id, first.id);
    assert.equal(first.byteLength, bytes.byteLength);
    assert.match(first.uri, /^ai-devtools:\/\/artifact\/art_[a-f0-9]{32}$/);

    const indexRaw = await readFile(
      join(dataDir.artifactDir, "index.json"),
      "utf8",
    );
    assert.equal(indexRaw.includes(dataUrl), false);
    assert.equal(indexRaw.includes(bytes.toString("base64")), false);
    assert.equal(indexRaw.includes("dataUrl"), false);

    const restarted = new ArtifactStore({ rootDir: dataDir.artifactDir });
    const restored = await restarted.read(first.id, "profile-a");
    assert.ok(restored);
    assert.deepEqual(Buffer.from(restored.bytes), bytes);
    assert.equal(await restarted.read(first.id, "profile-b"), undefined);

    const rootMode = (await stat(dataDir.artifactDir)).mode & 0o777;
    const indexMode =
      (await stat(join(dataDir.artifactDir, "index.json"))).mode & 0o777;
    assert.equal(rootMode, 0o700);
    assert.equal(indexMode, 0o600);
  } finally {
    await dataDir.cleanup();
  }
});

test("ArtifactStore enforces per-session budgets and TTL cleanup", async () => {
  const dataDir = await createTestDataDirectory("ai-devtools-artifacts-");
  let now = Date.parse("2026-07-10T00:00:00.000Z");
  const store = new ArtifactStore({
    rootDir: dataDir.artifactDir,
    clock: () => now,
    limits: {
      ttlMs: 1_000,
      maxArtifactBytes: 8,
      maxSessionBytes: 10,
      maxTotalBytes: 20,
      maxSessionCount: 2,
      maxTotalCount: 3,
    },
  });

  try {
    const first = await store.putBytes(
      "profile-a",
      "payload",
      "application/octet-stream",
      Buffer.from("123456"),
    );
    now += 1;
    const second = await store.putBytes(
      "profile-a",
      "payload",
      "application/octet-stream",
      Buffer.from("abcdef"),
    );

    assert.equal(await store.getMetadata(first.id), undefined);
    assert.equal((await store.list("profile-a")).length, 1);
    assert.equal((await store.list("profile-a"))[0]?.id, second.id);

    await assert.rejects(
      store.putBytes(
        "profile-b",
        "payload",
        "application/octet-stream",
        Buffer.from("123456789"),
      ),
      /PAYLOAD_TOO_LARGE/,
    );

    now += 1_001;
    await store.cleanup();
    assert.deepEqual(await store.list(), []);
  } finally {
    await dataDir.cleanup();
  }
});

test("oversized JSON results become readable payload artifacts", async () => {
  const dataDir = await createTestDataDirectory("ai-devtools-artifacts-");
  const store = new ArtifactStore({ rootDir: dataDir.artifactDir });
  const payload = {
    elements: Array.from({ length: 20 }, (_, index) => ({
      index,
      html: `<div>${"x".repeat(100)}</div>`,
    })),
  };

  try {
    const small = { ok: true };
    assert.equal(
      await externalizeLargeJsonResult(small, "profile-a", store, 1_000),
      small,
    );

    const externalized = await externalizeLargeJsonResult(
      payload,
      "profile-a",
      store,
      100,
    );
    assert.ok(externalized && typeof externalized === "object");
    const result = externalized as {
      artifact: { id: string; kind: string };
      externalized: boolean;
      originalByteLength: number;
    };
    assert.equal(result.externalized, true);
    assert.equal(result.artifact.kind, "payload");
    assert.equal(result.originalByteLength > 100, true);

    const restored = await store.read(result.artifact.id, "profile-a");
    assert.ok(restored);
    assert.deepEqual(
      JSON.parse(Buffer.from(restored.bytes).toString("utf8")),
      payload,
    );
  } finally {
    await dataDir.cleanup();
  }
});
