import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";

const fixtureMode = process.env.MCP_FIXTURE_MODE ?? "echo";
const server = new McpServer(
  { name: "external-echo-fixture", version: "1.0.0" },
  process.env.MCP_FIXTURE_INSTRUCTIONS
    ? { instructions: process.env.MCP_FIXTURE_INSTRUCTIONS }
    : undefined,
);

server.registerTool(
  "echo",
  {
    description: "Echo one bounded string",
    inputSchema: { text: z.string().max(200) },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ text }) => ({
    content: [{ type: "text", text }],
  }),
);

if (fixtureMode === "structured") {
  server.registerTool(
    "structured_echo",
    {
      description: "Return the same payload as text JSON and structured content",
      inputSchema: { text: z.string().max(200) },
      outputSchema: {
        text: z.string(),
        length: z.number().int().nonnegative(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ text }) => {
      const payload = { text, length: text.length };
      return {
        content: [{ type: "text", text: JSON.stringify(payload) }],
        structuredContent: payload,
      };
    },
  );
}

if (fixtureMode === "large") {
  server.registerTool(
    "large_result",
    {
      description: "Return a result larger than the former local 1 MiB limit",
      inputSchema: { size: z.number().int().min(1).max(2_000_000) },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ size }) => {
      const marker = "CRITICAL_TAIL_EVIDENCE";
      return {
        content: [
          {
            type: "text",
            text: `${"x".repeat(Math.max(0, size - marker.length))}${marker}`,
          },
        ],
      };
    },
  );
}

if (fixtureMode === "retry") {
  server.registerTool(
    "flaky_read",
    {
      description: "Close the first transport, then succeed after reconnect",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: process.env.MCP_FIXTURE_IDEMPOTENT_HINT !== "false",
        openWorldHint: false,
      },
    },
    async () => {
      const marker = process.env.MCP_FIXTURE_RETRY_MARKER;
      const failuresBeforeSuccess = Math.max(
        1,
        Number.parseInt(process.env.MCP_FIXTURE_RETRY_FAILURES ?? "1", 10) || 1,
      );
      const failureCount =
        marker && existsSync(marker)
          ? Number.parseInt(readFileSync(marker, "utf8"), 10) || 0
          : 0;
      if (marker && failureCount < failuresBeforeSuccess) {
        writeFileSync(marker, String(failureCount + 1), "utf8");
        process.exit(19);
      }
      return {
        content: [{ type: "text", text: "recovered after reconnect" }],
      };
    },
  );
}

await server.connect(new StdioServerTransport());
