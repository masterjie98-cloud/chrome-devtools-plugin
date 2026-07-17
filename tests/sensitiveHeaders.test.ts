import assert from "node:assert/strict";
import test from "node:test";
import {
  redactApprovalArguments,
} from "../src/shared/sensitiveData";
import { normalizeBrowserToolResultData } from "../src/shared/wsProtocol";

test("network header records and entry arrays redact credential headers", () => {
  const result = normalizeBrowserToolResultData({
    requestHeaders: {
      Authorization: "Bearer secret-token",
      Cookie: "sid=secret-cookie",
      Accept: "application/json",
    },
    responseHeaders: [
      { name: "Set-Cookie", value: "sid=response-secret" },
      { name: "Content-Type", value: "application/json" },
    ],
  });

  assert.deepEqual(result, {
    requestHeaders: {
      Authorization: "[redacted]",
      Cookie: "[redacted]",
      Accept: "application/json",
    },
    responseHeaders: [
      { name: "Set-Cookie", value: "[redacted]" },
      { name: "Content-Type", value: "application/json" },
    ],
  });
});

test("approval arguments redact secrets while preserving operation shape", () => {
  assert.deepEqual(
    redactApprovalArguments({
      requestHeaders: [
        { name: "Authorization", operation: "set", value: "Bearer secret" },
        { name: "Accept", operation: "set", value: "application/json" },
      ],
      responseBodyBase64: "c2VjcmV0",
      urlFilter: "example.test",
    }),
    {
      requestHeaders: [
        { name: "Authorization", operation: "set", value: "[redacted]" },
        { name: "Accept", operation: "set", value: "application/json" },
      ],
      responseBodyBase64: "[redacted]",
      urlFilter: "example.test",
    },
  );
});
