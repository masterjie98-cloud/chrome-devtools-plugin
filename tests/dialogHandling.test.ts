import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { currentJavaScriptDialogCommand } from "../src/background/dialogHandling";

test("dialog commands affect only the current CDP dialog", () => {
  assert.deepEqual(currentJavaScriptDialogCommand({ action: "dismiss" }), {
    accept: false,
  });
  assert.deepEqual(
    currentJavaScriptDialogCommand({
      action: "accept",
      promptText: "approved value",
    }),
    { accept: true, promptText: "approved value" },
  );
  assert.deepEqual(
    currentJavaScriptDialogCommand({
      action: "dismiss",
      promptText: "must not reach CDP",
    }),
    { accept: false },
  );
});

test("content automation no longer contains persistent dialog overrides", async () => {
  const source = await readFile(
    new URL("../src/content/browserAutomation.ts", import.meta.url),
    "utf8",
  );
  assert.equal(source.includes("__AI_DEVTOOLS_DIALOG_HANDLER__"), false);
  assert.equal(source.includes("window.alert ="), false);
  assert.equal(source.includes("window.confirm ="), false);
  assert.equal(source.includes("window.prompt ="), false);
});
