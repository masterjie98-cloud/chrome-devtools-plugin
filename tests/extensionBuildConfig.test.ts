import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("extension build disables modulepreload hints rejected by Chrome extension pages", async () => {
  const source = await readFile(
    new URL("../vite.config.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /build:\s*\{[\s\S]*modulePreload:\s*false/);
});
