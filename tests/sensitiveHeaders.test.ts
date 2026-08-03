import assert from "node:assert/strict";
import test from "node:test";
import {
  redactApprovalArguments,
} from "../src/shared/sensitiveData";
import { MCP_TOOL_OUTPUT_SCHEMAS } from "../src/mcp/toolOutputSchemas";
import { MCP_TOOL_NAMES } from "../src/shared/mcpTools";
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

test("value-omitted cookie mutation results retain their output-schema shape", () => {
  const result = normalizeBrowserToolResultData({
    cookie: {
      name: "manual_mutation_cookie",
      valueIncluded: false,
      domain: "127.0.0.1",
      path: "/",
      secure: false,
      httpOnly: false,
      sameSite: "lax",
      session: true,
    },
  });

  assert.deepEqual(result, {
    cookie: {
      name: "manual_mutation_cookie",
      valueIncluded: false,
      domain: "127.0.0.1",
      path: "/",
      secure: false,
      httpOnly: false,
      sameSite: "lax",
      session: true,
    },
  });
  assert.equal(
    MCP_TOOL_OUTPUT_SCHEMAS[MCP_TOOL_NAMES.BROWSER_COOKIE_SET].safeParse(result)
      .success,
    true,
  );
});

test("cookie fields containing raw values remain fully redacted", () => {
  assert.deepEqual(
    normalizeBrowserToolResultData({
      cookie: "sid=raw-secret",
      nested: {
        cookie: {
          name: "sid",
          value: "raw-secret",
          valueIncluded: true,
          domain: "example.test",
          path: "/",
          secure: true,
          httpOnly: true,
        },
      },
    }),
    {
      cookie: "[redacted]",
      nested: {
        cookie: "[redacted]",
      },
    },
  );
});

test("Network request bodies are redacted by default", () => {
  assert.deepEqual(
    normalizeBrowserToolResultData({
      requestPostData: "ordinaryField=private-value",
      postData: "another-private-value",
    }),
    {
      requestPostData: "[redacted]",
      postData: "[redacted]",
    },
  );
});
