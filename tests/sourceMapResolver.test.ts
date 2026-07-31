import assert from "node:assert/strict";
import test from "node:test";
import { resolveSourceMapLocation } from "../src/background/sourceMapResolver";

test("source-map resolver maps a generated initiator to original source", async () => {
  const sourceMap = {
    version: 3,
    file: "app.js",
    sourceRoot: "https://example.test/src/",
    sources: ["Button.tsx"],
    sourcesContent: ["export function Button() { return null; }"],
    names: ["Button"],
    mappings: "AAAAA",
  };
  const sourceMapURL = `data:application/json;base64,${Buffer.from(
    JSON.stringify(sourceMap),
  ).toString("base64")}`;
  const result = await resolveSourceMapLocation(
    {
      scriptId: "1",
      url: "https://example.test/assets/app.js",
      sourceMapURL,
    },
    {
      url: "https://example.test/assets/app.js",
      lineNumber: 0,
      columnNumber: 0,
      functionName: "onClick",
    },
    true,
  );

  assert.equal(result.status, "resolved");
  assert.equal(
    result.original?.source,
    "https://example.test/src/Button.tsx",
  );
  assert.equal(result.original?.lineNumber, 1);
  assert.equal(result.original?.columnNumber, 1);
  assert.equal(result.original?.name, "Button");
  assert.match(result.original?.excerpt ?? "", /function Button/);
});

test("source-map resolver fails closed for index-shifting invalid sources", async () => {
  const sourceMapURL = `data:application/json,${encodeURIComponent(
    JSON.stringify({
      version: 3,
      sources: [null, "Button.tsx"],
      names: [],
      mappings: "AAAA",
    }),
  )}`;
  const result = await resolveSourceMapLocation(
    {
      scriptId: "2",
      url: "https://example.test/assets/app.js",
      sourceMapURL,
    },
    {
      url: "https://example.test/assets/app.js",
      lineNumber: 0,
      columnNumber: 0,
    },
  );

  assert.equal(result.status, "failed");
  assert.match(result.reason ?? "", /invalid Source Map/i);
});

test("source-map resolver supports embedded indexed sections and verifies debug identity", async () => {
  const debugId = "8d5f5f2a-0ec7-4f48-b58e-6e163aefab48";
  const sourceMapURL = `data:application/json,${encodeURIComponent(
    JSON.stringify({
      version: 3,
      debugId,
      sections: [
        {
          offset: { line: 2, column: 5 },
          map: {
            version: 3,
            sources: ["webpack:///src/runtime/boom.ts"],
            sourcesContent: [
              'export function boom() { throw new Error("mapped boom"); }',
            ],
            names: ["boom"],
            mappings: "AAAAA",
          },
        },
      ],
    }),
  )}`;
  const result = await resolveSourceMapLocation(
    {
      scriptId: "indexed",
      url: "https://example.test/assets/app.js",
      sourceMapURL,
      hash: "script-hash",
      buildId: debugId.replace(/-/g, ""),
    },
    {
      url: "https://example.test/assets/app.js",
      lineNumber: 2,
      columnNumber: 5,
      functionName: "boom",
    },
    true,
  );

  assert.equal(result.status, "resolved");
  assert.equal(result.original?.source, "webpack:///src/runtime/boom.ts");
  assert.equal(result.original?.lineNumber, 1);
  assert.equal(result.original?.columnNumber, 1);
  assert.equal(result.original?.name, "boom");
  assert.equal(result.scriptIdentity?.hash, "script-hash");
  assert.equal(result.scriptIdentity?.debugId, debugId);
  assert.equal(result.scriptIdentity?.debugIdMatch, true);
  assert.equal(result.sourceMapUrl, "data:source-map");
});

test("source-map resolver rejects indexed sections that fetch another map", async () => {
  const sourceMapURL = `data:application/json,${encodeURIComponent(
    JSON.stringify({
      version: 3,
      sections: [
        {
          offset: { line: 0, column: 0 },
          url: "chunk.js.map",
        },
      ],
    }),
  )}`;
  const result = await resolveSourceMapLocation(
    {
      scriptId: "external-section",
      url: "https://example.test/assets/app.js",
      sourceMapURL,
    },
    {
      url: "https://example.test/assets/app.js",
      lineNumber: 0,
      columnNumber: 0,
    },
  );

  assert.equal(result.status, "failed");
  assert.match(result.reason ?? "", /external URLs are not supported/i);
});

test("source-map resolver fetches signed URLs but redacts their query from output", async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];
  globalThis.fetch = async (input) => {
    requestedUrls.push(String(input));
    return new Response(
      JSON.stringify({
        version: 3,
        sources: ["../src/app.ts"],
        names: [],
        mappings: "AAAA",
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  };
  try {
    const result = await resolveSourceMapLocation(
      {
        scriptId: "signed-map",
        url: "https://example.test/assets/app.js",
        sourceMapURL: "app.js.map?signature=private-marker#fragment",
      },
      {
        url: "https://example.test/assets/app.js",
        lineNumber: 0,
        columnNumber: 0,
      },
    );

    assert.equal(result.status, "resolved");
    assert.equal(
      requestedUrls[0],
      "https://example.test/assets/app.js.map?signature=private-marker#fragment",
    );
    assert.equal(
      result.sourceMapUrl,
      "https://example.test/assets/app.js.map",
    );
    assert.equal(result.sourceMapUrl?.includes("private-marker"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("source-map resolver accepts a debugger-backed text loader", async () => {
  const requestedUrls: string[] = [];
  const result = await resolveSourceMapLocation(
    {
      scriptId: "debugger-loader",
      url: "https://example.test/assets/runtime.js",
      sourceMapURL: "runtime.js.map",
    },
    {
      url: "https://example.test/assets/runtime.js",
      lineNumber: 0,
      columnNumber: 0,
    },
    true,
    {
      cachePartition: "debugger-target-a",
      loadText: async (mapUrl) => {
        requestedUrls.push(mapUrl);
        return JSON.stringify({
          version: 3,
          sources: ["../src/runtime.ts"],
          sourcesContent: ['throw new Error("runtime failure");'],
          names: [],
          mappings: "AAAA",
        });
      },
    },
  );

  assert.deepEqual(requestedUrls, [
    "https://example.test/assets/runtime.js.map",
  ]);
  assert.equal(result.status, "resolved");
  assert.equal(
    result.original?.source,
    "https://example.test/src/runtime.ts",
  );
  assert.match(result.original?.excerpt ?? "", /runtime failure/);
});

test("source-map cache partitions do not reuse target-specific map content", async () => {
  const script = {
    scriptId: "partitioned-map",
    url: "https://example.test/assets/partitioned.js",
    sourceMapURL: "partitioned.js.map",
  };
  const generated = {
    url: script.url,
    lineNumber: 0,
    columnNumber: 0,
  };
  const load = (source: string) => async () =>
    JSON.stringify({
      version: 3,
      sources: [source],
      names: [],
      mappings: "AAAA",
    });

  const first = await resolveSourceMapLocation(
    script,
    generated,
    false,
    {
      cachePartition: "profile-a",
      loadText: load("../src/a.ts"),
    },
  );
  const second = await resolveSourceMapLocation(
    script,
    generated,
    false,
    {
      cachePartition: "profile-b",
      loadText: load("../src/b.ts"),
    },
  );

  assert.equal(first.original?.source, "https://example.test/src/a.ts");
  assert.equal(second.original?.source, "https://example.test/src/b.ts");
});
