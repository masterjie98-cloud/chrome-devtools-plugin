import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Markdown block elements keep visible vertical rhythm", async () => {
  const styles = await readFile(
    new URL("../src/sidepanel/styles.css", import.meta.url),
    "utf8",
  );

  assert.match(
    styles,
    /\.chat-markdown\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*gap:\s*8px;/s,
  );
  assert.match(styles, /\.chat-content\s*\{[^}]*margin:\s*0\s*!important;/s);
});
