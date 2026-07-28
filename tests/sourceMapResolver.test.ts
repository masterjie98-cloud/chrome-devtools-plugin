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
