import assert from "node:assert/strict";
import test from "node:test";
import { externalizeLargeJsonResult } from "../src/daemon/artifacts/externalize";
import { ArtifactStore } from "../src/daemon/artifacts/store";
import { executeMcpToolData } from "../src/mcp/toolRuntime";
import { MCP_TOOL_NAMES } from "../src/shared/mcpTools";
import { createTestDataDirectory } from "./helpers/tempDataDir";

test("large result artifacts can be read without gaps and searched at the tail", async () => {
  const dataDir = await createTestDataDirectory("artifact-read-");
  const store = new ArtifactStore({ rootDir: dataDir.artifactDir });
  const payload = {
    items: Array.from({ length: 1_000 }, (_, index) => ({
      index,
      value: `${"x".repeat(40)}-${index}${
        index === 100 || index === 900 ? "-REPEATED_EVIDENCE" : ""
      }`,
    })),
    finalEvidence: "CRITICAL_TAIL_EVIDENCE",
  };
  const bridge = {} as Parameters<typeof executeMcpToolData>[2];

  try {
    const externalized = (await externalizeLargeJsonResult(
      payload,
      "profile-a",
      store,
      100,
    )) as {
      artifact: { id: string };
    };
    const readJsonArtifact = async (artifactId: string): Promise<unknown> => {
      const stored = await store.read(artifactId, "profile-a");
      if (!stored) throw new Error("ARTIFACT_NOT_FOUND");
      return JSON.parse(Buffer.from(stored.bytes).toString("utf8"));
    };
    const readArtifactText = async (artifactId: string): Promise<string> => {
      const stored = await store.read(artifactId, "profile-a");
      if (!stored) throw new Error("ARTIFACT_NOT_FOUND");
      return Buffer.from(stored.bytes).toString("utf8");
    };

    const chunks: string[] = [];
    let offset = 0;
    let hasMore = true;
    while (hasMore) {
      const page = (await executeMcpToolData(
        MCP_TOOL_NAMES.BROWSER_READ_ARTIFACT,
        {
          artifactId: externalized.artifact.id,
          mode: "read",
          offset,
          limit: 10_000,
        },
        bridge,
        { sessionId: "profile-a", readJsonArtifact, readArtifactText },
      )) as {
        chunk: string;
        nextOffset: number;
        hasMore: boolean;
      };
      chunks.push(page.chunk);
      assert.ok(page.nextOffset > offset);
      offset = page.nextOffset;
      hasMore = page.hasMore;
    }
    assert.equal(chunks.join(""), JSON.stringify(payload));

    const search = (await executeMcpToolData(
      MCP_TOOL_NAMES.BROWSER_READ_ARTIFACT,
      {
        artifactId: externalized.artifact.id,
        mode: "search",
        query: "CRITICAL_TAIL_EVIDENCE",
      },
      bridge,
      { sessionId: "profile-a", readJsonArtifact, readArtifactText },
    )) as {
      returnedMatches: number;
      matches: Array<{ excerpt: string }>;
    };
    assert.equal(search.returnedMatches, 1);
    assert.match(search.matches[0]?.excerpt ?? "", /CRITICAL_TAIL_EVIDENCE/);

    const firstMatch = (await executeMcpToolData(
      MCP_TOOL_NAMES.BROWSER_READ_ARTIFACT,
      {
        artifactId: externalized.artifact.id,
        mode: "search",
        query: "REPEATED_EVIDENCE",
        maxMatches: 1,
      },
      bridge,
      { sessionId: "profile-a", readJsonArtifact, readArtifactText },
    )) as {
      returnedMatches: number;
      hasMoreMatches: boolean;
      nextSearchOffset?: number;
    };
    assert.equal(firstMatch.returnedMatches, 1);
    assert.equal(firstMatch.hasMoreMatches, true);
    assert.ok(firstMatch.nextSearchOffset);
    const secondMatch = (await executeMcpToolData(
      MCP_TOOL_NAMES.BROWSER_READ_ARTIFACT,
      {
        artifactId: externalized.artifact.id,
        mode: "search",
        query: "REPEATED_EVIDENCE",
        searchOffset: firstMatch.nextSearchOffset,
        maxMatches: 1,
      },
      bridge,
      { sessionId: "profile-a", readJsonArtifact, readArtifactText },
    )) as { returnedMatches: number; hasMoreMatches: boolean };
    assert.equal(secondMatch.returnedMatches, 1);
    assert.equal(secondMatch.hasMoreMatches, false);

    await assert.rejects(
      executeMcpToolData(
        MCP_TOOL_NAMES.BROWSER_READ_ARTIFACT,
        { artifactId: externalized.artifact.id },
        bridge,
        {
          sessionId: "profile-b",
          readJsonArtifact: async (artifactId) => {
            const stored = await store.read(artifactId, "profile-b");
            if (!stored) throw new Error("ARTIFACT_NOT_FOUND");
            return JSON.parse(Buffer.from(stored.bytes).toString("utf8"));
          },
        },
      ),
      /ARTIFACT_NOT_FOUND/,
    );
  } finally {
    await dataDir.cleanup();
  }
});
