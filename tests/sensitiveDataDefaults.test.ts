import assert from "node:assert/strict";
import test from "node:test";
import { toBrowserCookieSnapshot } from "../src/background/chromeApi";
import { storageToRecordSnapshot } from "../src/content/browserAutomation";

const cookie = {
  name: "session",
  value: "secret-cookie-value",
  domain: "example.test",
  path: "/",
  secure: true,
  httpOnly: true,
  sameSite: "lax",
  session: true,
} as chrome.cookies.Cookie;

test("cookie snapshots omit values unless explicitly requested", () => {
  const safe = toBrowserCookieSnapshot(cookie);
  assert.equal(safe.value, undefined);
  assert.equal(safe.valueIncluded, false);

  const approved = toBrowserCookieSnapshot(cookie, true);
  assert.equal(approved.value, "secret-cookie-value");
  assert.equal(approved.valueIncluded, true);
});

test("storage snapshots preserve keys but omit values by default", () => {
  const values = new Map([
    ["token", "secret-storage-value"],
    ["theme", "dark"],
  ]);
  const storage = {
    length: values.size,
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
  } as Storage;

  assert.deepEqual(storageToRecordSnapshot(storage, false), {
    token: "[value omitted]",
    theme: "[value omitted]",
  });
  assert.deepEqual(storageToRecordSnapshot(storage, true), {
    token: "secret-storage-value",
    theme: "dark",
  });
});
