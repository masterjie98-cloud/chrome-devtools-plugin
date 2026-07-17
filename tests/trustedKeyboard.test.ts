import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  isSupportedTrustedKey,
  trustedKeyEvents,
  trustedReplaceSelectionEvents,
} from "../src/shared/trustedKeyboard";

test("trusted key events map printable and navigation keys to CDP pairs", () => {
  assert.deepEqual(trustedKeyEvents("a"), [
    {
      type: "keyDown",
      key: "a",
      code: "KeyA",
      windowsVirtualKeyCode: 65,
      nativeVirtualKeyCode: 65,
      text: "a",
      unmodifiedText: "a",
    },
    {
      type: "keyUp",
      key: "a",
      code: "KeyA",
      windowsVirtualKeyCode: 65,
      nativeVirtualKeyCode: 65,
    },
  ]);
  assert.deepEqual(trustedKeyEvents("Enter"), [
    {
      type: "keyDown",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
      text: "\r",
      unmodifiedText: "\r",
    },
    {
      type: "keyUp",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    },
  ]);
});

test("replace uses a CDP selectAll command before Backspace", () => {
  const events = trustedReplaceSelectionEvents();
  assert.deepEqual(events[0]?.commands, ["selectAll"]);
  assert.equal(events[0]?.text, undefined);
  assert.deepEqual(
    events.slice(-2).map((event) => [event.type, event.key]),
    [
      ["rawKeyDown", "Backspace"],
      ["keyUp", "Backspace"],
    ],
  );
});

test("trusted key validation rejects combinations and multi-key strings", () => {
  assert.equal(isSupportedTrustedKey("ArrowLeft"), true);
  assert.equal(isSupportedTrustedKey("你"), true);
  assert.equal(isSupportedTrustedKey("Control+A"), false);
  assert.equal(isSupportedTrustedKey("hello"), false);
  assert.throws(() => trustedKeyEvents("Control+A"), /TRUSTED_KEY_UNSUPPORTED/);
});

test("canonical content protocol no longer exposes synthetic type or key handlers", async () => {
  const [automation, messages] = await Promise.all([
    readFile(
      new URL("../src/content/browserAutomation.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../src/shared/messages.ts", import.meta.url), "utf8"),
  ]);
  assert.equal(automation.includes("new KeyboardEvent"), false);
  assert.equal(messages.includes("CONTENT_TYPE_TEXT"), false);
  assert.equal(messages.includes("CONTENT_PRESS_KEY"), false);
});
