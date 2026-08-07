import assert from "node:assert/strict";
import test from "node:test";
import { toBrowserCookieSnapshot } from "../src/background/chromeApi";
import { storageToRecordSnapshot } from "../src/content/browserAutomation";
import { redactSensitiveDataForMcp } from "../src/shared/sensitiveData";
import { sanitizeMultilineText } from "../src/shared/sanitize";

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

test("MCP outbound redaction preserves dates and protocol IDs", () => {
  assert.deepEqual(
    redactSensitiveDataForMcp({
      taskId: "task_mcp_ui_phase1_e2e_1786079805882",
      createdAt: "2026-08-07T13:15:00.000Z",
      instruction:
        "在 2026-08-07 联系 13800138000，邮箱是 owner@example.test",
      password: "local-secret",
    }),
    {
      taskId: "task_mcp_ui_phase1_e2e_1786079805882",
      createdAt: "2026-08-07T13:15:00.000Z",
      instruction:
        "在 2026-08-07 联系 [REDACTED_PHONE]，邮箱是 [REDACTED_EMAIL]",
      password: "[redacted]",
    },
  );
});

test("text sanitization never treats calendar dates as phone numbers", () => {
  assert.equal(
    sanitizeMultilineText("日期 2026-08-07，电话 13800138000", 200),
    "日期 2026-08-07，电话 [REDACTED_PHONE]",
  );
});
