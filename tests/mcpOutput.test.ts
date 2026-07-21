import assert from "node:assert/strict";
import test from "node:test";
import { formatMcpToolResult } from "../src/mcp/toolRuntime";
import { MCP_TOOL_OUTPUT_SCHEMAS } from "../src/mcp/toolOutputSchemas";
import { MCP_TOOL_NAMES } from "../src/shared/mcpTools";

test("screenshot MCP results use image content without base64 JSON text", () => {
  const imageBytes = Buffer.from("image-bytes", "utf8");
  const base64 = imageBytes.toString("base64");
  const result = formatMcpToolResult({
    capturedAt: "2026-07-10T00:00:00.000Z",
    mimeType: "image/png",
    dataUrl: `data:image/png;base64,${base64}`,
    artifact: {
      id: "art_0123456789abcdef0123456789abcdef",
      uri: "ai-devtools://artifact/art_0123456789abcdef0123456789abcdef",
      kind: "screenshot",
      mimeType: "image/png",
      byteLength: imageBytes.byteLength,
      sha256: "a".repeat(64),
      createdAt: "2026-07-10T00:00:00.000Z",
      expiresAt: "2026-07-11T00:00:00.000Z",
    },
  });

  const text = result.content.find((entry) => entry.type === "text");
  const image = result.content.find((entry) => entry.type === "image");
  assert.ok(text && text.type === "text");
  assert.equal(text.text.includes(base64), false);
  assert.match(text.text, /ai-devtools:\/\/artifact\//);
  assert.ok(image && image.type === "image");
  assert.equal(image.data, base64);
  assert.equal(image.mimeType, "image/png");
  assert.equal("dataUrl" in result.structuredContent, false);
  assert.equal(
    (result.structuredContent.artifact as { uri?: unknown }).uri,
    "ai-devtools://artifact/art_0123456789abcdef0123456789abcdef",
  );
  assert.equal(
    MCP_TOOL_OUTPUT_SCHEMAS[
      MCP_TOOL_NAMES.BROWSER_TAKE_SCREENSHOT
    ].safeParse(result.structuredContent).success,
    true,
  );
});

test("ordinary MCP result summaries and collections are bounded", () => {
  const result = formatMcpToolResult({
    query: "button",
    queryType: "selector",
    count: 250,
    elements: Array.from({ length: 250 }, (_, index) => ({
      index,
      value: "x".repeat(100),
    })),
  });
  const text = result.content.find((entry) => entry.type === "text");
  const elements = result.structuredContent.elements;

  assert.ok(text && text.type === "text");
  assert.equal(text.text.length <= 6_100, true);
  assert.ok(Array.isArray(elements));
  assert.equal(elements.length, 201);
  assert.equal(elements[200], "[50 additional entries omitted]");
  assert.equal(
    MCP_TOOL_OUTPUT_SCHEMAS[MCP_TOOL_NAMES.BROWSER_QUERY_DOM].safeParse(
      result.structuredContent,
    ).success,
    true,
  );
});

test("MCP errors omit success-only structuredContent", () => {
  const result = formatMcpToolResult(
    { error: "IDEMPOTENCY_CONFLICT: taskId already exists" },
    true,
  );

  assert.equal(result.isError, true);
  assert.equal("structuredContent" in result, false);
  assert.match(result.content[0]?.type === "text" ? result.content[0].text : "", /IDEMPOTENCY_CONFLICT/);
});
