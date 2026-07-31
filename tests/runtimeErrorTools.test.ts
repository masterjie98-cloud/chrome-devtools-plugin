import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DaemonClient } from "../src/mcp/daemonClient";
import {
  registerRuntimeErrorDiagnosticsTool,
  RUNTIME_ERROR_DIAGNOSTICS_TOOL_NAME,
} from "../src/mcp/runtimeErrorTools";
import { MCP_TOOL_NAMES } from "../src/shared/mcpTools";

test("runtime-error MCP tool maps a captured browser stack to verified local source", async () => {
  const previous = process.env.AI_DEVTOOLS_WORKSPACE_ROOTS;
  process.env.AI_DEVTOOLS_WORKSPACE_ROOTS = process.cwd();
  const localPath = `${process.cwd()}/src/mcp/workspaceTools.ts`;
  const lines = (await readFile(localPath, "utf8")).split(/\r?\n/);
  const lineNumber =
    lines.findIndex((line) =>
      line.includes("export function registerWorkspaceSourceTool"),
    ) + 1;
  assert.ok(lineNumber > 0);

  const daemon = {
    callTool: async (toolName: string, args: Record<string, unknown>) => {
      assert.equal(
        toolName,
        MCP_TOOL_NAMES.BROWSER_DIAGNOSE_RUNTIME_ERRORS,
      );
      assert.equal(args.afterStreamId, "runtime-stream");
      assert.equal(args.afterSequence, 7);
      return {
        version: "browser-runtime-errors-v1",
        attached: true,
        tabId: 42,
        cursorStatus: "ok",
        cursor: { streamId: "runtime-stream", sequence: 7 },
        nextCursor: { streamId: "runtime-stream", sequence: 8 },
        oldestSequence: 1,
        latestSequence: 8,
        missedEvents: 0,
        droppedEvents: 0,
        total: 1,
        returned: 1,
        errors: [
          {
            id: "runtime-error-8",
            sequence: 8,
            kind: "exception",
            level: "error",
            text: "Mapped fixture failure",
            timestamp: "2026-07-30T00:00:00.000Z",
            frames: [
              {
                scriptId: "script-1",
                generated: {
                  url: "https://example.test/assets/app.js",
                  lineNumber: 0,
                  columnNumber: 0,
                  functionName: "registerWorkspaceSourceTool",
                },
                sourceMap: {
                  status: "resolved",
                  generated: {
                    url: "https://example.test/assets/app.js",
                    lineNumber: 0,
                    columnNumber: 0,
                    functionName: "registerWorkspaceSourceTool",
                  },
                  original: {
                    source: "webpack:///src/mcp/workspaceTools.ts",
                    lineNumber,
                    columnNumber: 1,
                    name: "registerWorkspaceSourceTool",
                    excerpt: lines[lineNumber - 1],
                  },
                  sourceMapUrl: "https://example.test/assets/app.js.map",
                  scriptIdentity: {
                    buildId: "fixture-id",
                    debugId: "fixture-id",
                    debugIdMatch: true,
                  },
                },
              },
            ],
            framesOmitted: 0,
          },
        ],
      };
    },
  } as unknown as DaemonClient;
  const server = new McpServer({
    name: "runtime-error-tool-test",
    version: "1.0.0",
  });
  registerRuntimeErrorDiagnosticsTool(server, daemon);
  const client = new Client({
    name: "runtime-error-tool-client",
    version: "1.0.0",
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  try {
    const listed = await client.listTools();
    const definition = listed.tools.find(
      (tool) => tool.name === RUNTIME_ERROR_DIAGNOSTICS_TOOL_NAME,
    );
    assert.ok(definition);
    assert.equal(definition.annotations?.readOnlyHint, true);
    assert.equal(definition.annotations?.openWorldHint, false);

    const result = await client.callTool({
      name: RUNTIME_ERROR_DIAGNOSTICS_TOOL_NAME,
      arguments: {
        afterStreamId: "runtime-stream",
        afterSequence: 7,
        limit: 5,
      },
    });
    assert.equal(result.isError, false);
    const structured = result.structuredContent as {
      errors: Array<{
        frames: Array<{
          workspace: {
            status: string;
            confidence: string;
            matches: Array<{
              path: string;
              line?: number;
              contentMatch?: boolean;
            }>;
          };
        }>;
      }>;
      mappingSummary: {
        sourceMappedFrames: number;
        localMatchedFrames: number;
        contentVerifiedFrames: number;
      };
    };
    const workspace = structured.errors[0]?.frames[0]?.workspace;
    assert.equal(workspace?.status, "matched");
    assert.equal(workspace?.confidence, "source-map-content-verified");
    assert.equal(workspace?.matches[0]?.path, "src/mcp/workspaceTools.ts");
    assert.equal(workspace?.matches[0]?.line, lineNumber);
    assert.equal(workspace?.matches[0]?.contentMatch, true);
    assert.deepEqual(structured.mappingSummary, {
      totalFrames: 1,
      sourceMappedFrames: 1,
      localMatchedFrames: 1,
      contentVerifiedFrames: 1,
    });
  } finally {
    await Promise.all([client.close(), server.close()]);
    if (previous === undefined) {
      delete process.env.AI_DEVTOOLS_WORKSPACE_ROOTS;
    } else {
      process.env.AI_DEVTOOLS_WORKSPACE_ROOTS = previous;
    }
  }
});
