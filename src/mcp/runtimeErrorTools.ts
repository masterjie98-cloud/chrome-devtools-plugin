import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  BrowserRuntimeError,
  BrowserRuntimeErrorsResult,
  RuntimeErrorStackFrame,
} from "../shared/sourceLocation";
import { MCP_TOOL_NAMES } from "../shared/mcpTools";
import type { DaemonClient } from "./daemonClient";
import { formatMcpToolResult } from "./toolRuntime";
import { findWorkspaceSource } from "./workspaceTools";

export const RUNTIME_ERROR_DIAGNOSTICS_TOOL_NAME =
  MCP_TOOL_NAMES.BROWSER_DIAGNOSE_RUNTIME_ERRORS;

const inputSchema = z
  .object({
    afterStreamId: z.string().min(1).max(200).optional(),
    afterSequence: z.number().int().nonnegative().optional(),
    limit: z.number().int().min(1).max(20).optional(),
    maxFramesPerError: z.number().int().min(1).max(12).optional(),
    maxWorkspaceFrames: z.number().int().min(1).max(20).optional(),
    includeWarnings: z.boolean().optional(),
    includeRevoked: z.boolean().optional(),
    includeLocalExcerpt: z.boolean().optional(),
  })
  .strict();

const generatedLocationSchema = z
  .object({
    url: z.string(),
    lineNumber: z.number().int().nonnegative(),
    columnNumber: z.number().int().nonnegative(),
    functionName: z.string().optional(),
  })
  .strict();

const originalLocationSchema = z
  .object({
    source: z.string(),
    lineNumber: z.number().int().positive(),
    columnNumber: z.number().int().positive(),
    name: z.string().optional(),
    sourceRoot: z.string().optional(),
    excerpt: z.string().optional(),
  })
  .strict();

const sourceMapSchema = z
  .object({
    status: z.enum(["resolved", "unavailable", "unsupported", "failed"]),
    generated: generatedLocationSchema.optional(),
    original: originalLocationSchema.optional(),
    sourceMapUrl: z.string().optional(),
    scriptIdentity: z
      .object({
        hash: z.string().optional(),
        buildId: z.string().optional(),
        debugId: z.string().optional(),
        debugIdMatch: z.boolean().optional(),
      })
      .strict()
      .optional(),
    reason: z.string().optional(),
  })
  .strict();

const runtimeFrameSchema = z
  .object({
    scriptId: z.string().optional(),
    generated: generatedLocationSchema,
    asyncContext: z.string().optional(),
    sourceMap: sourceMapSchema.optional(),
  })
  .strict();

const runtimeErrorSchema = z
  .object({
    id: z.string(),
    sequence: z.number().int().positive(),
    kind: z.enum(["exception", "console"]),
    level: z.enum(["error", "warning"]),
    text: z.string(),
    timestamp: z.string(),
    exceptionId: z.number().int().optional(),
    revoked: z.boolean().optional(),
    frames: z.array(runtimeFrameSchema),
    framesOmitted: z.number().int().nonnegative(),
  })
  .strict();

const browserResultSchema = z
  .object({
    version: z.literal("browser-runtime-errors-v1"),
    attached: z.boolean(),
    tabId: z.number().int().nonnegative().optional(),
    cursorStatus: z.enum([
      "ok",
      "stream_restarted",
      "events_dropped",
      "cursor_ahead",
    ]),
    cursor: z
      .object({
        streamId: z.string(),
        sequence: z.number().int().nonnegative(),
      })
      .strict(),
    nextCursor: z
      .object({
        streamId: z.string(),
        sequence: z.number().int().nonnegative(),
      })
      .strict(),
    oldestSequence: z.number().int().nonnegative(),
    latestSequence: z.number().int().nonnegative(),
    missedEvents: z.number().int().nonnegative(),
    droppedEvents: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    returned: z.number().int().nonnegative(),
    errors: z.array(runtimeErrorSchema),
  })
  .strict();

const workspaceMatchSchema = z
  .object({
    root: z.string(),
    path: z.string(),
    score: z.number(),
    line: z.number().int().positive().optional(),
    reason: z.array(z.string()),
    excerpt: z.string().optional(),
    contentMatch: z.boolean().optional(),
  })
  .strict();

const outputSchema = z
  .object({
    version: z.literal("browser-runtime-error-diagnostics-v1"),
    attached: z.boolean(),
    tabId: z.number().int().nonnegative().optional(),
    cursorStatus: browserResultSchema.shape.cursorStatus,
    cursor: browserResultSchema.shape.cursor,
    nextCursor: browserResultSchema.shape.nextCursor,
    oldestSequence: z.number().int().nonnegative(),
    latestSequence: z.number().int().nonnegative(),
    missedEvents: z.number().int().nonnegative(),
    droppedEvents: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    returned: z.number().int().nonnegative(),
    errors: z.array(
      runtimeErrorSchema.extend({
        frames: z.array(
          runtimeFrameSchema.extend({
            workspace: z
              .object({
                status: z.enum(["matched", "unmapped", "not_attempted"]),
                confidence: z.enum([
                  "source-map-content-verified",
                  "source-map-path-match",
                  "heuristic",
                  "identity-mismatch",
                  "unmapped",
                ]),
                scannedFiles: z.number().int().nonnegative().optional(),
                truncated: z.boolean().optional(),
                matches: z.array(workspaceMatchSchema),
                warnings: z.array(z.string()),
              })
              .strict(),
          }),
        ),
      }),
    ),
    mappingSummary: z
      .object({
        totalFrames: z.number().int().nonnegative(),
        sourceMappedFrames: z.number().int().nonnegative(),
        localMatchedFrames: z.number().int().nonnegative(),
        contentVerifiedFrames: z.number().int().nonnegative(),
      })
      .strict(),
    warnings: z.array(z.string()),
  })
  .strict();

type WorkspaceDiagnostics = z.infer<
  typeof outputSchema
>["errors"][number]["frames"][number]["workspace"];

export function registerRuntimeErrorDiagnosticsTool(
  server: McpServer,
  daemonClient: DaemonClient,
): void {
  server.registerTool(
    RUNTIME_ERROR_DIAGNOSTICS_TOOL_NAME,
    {
      title: "Diagnose browser runtime errors",
      description:
        "Read bounded JavaScript exceptions and console error stacks from the selected Tab, resolve loaded-script source maps inside the extension, then match original paths only under configured local workspace roots. Start browser_activity_start before reproducing an intermittent error, save runtimeErrorCursor, and pass it as afterStreamId/afterSequence to read only later errors. Full source-map payloads are never returned to the model.",
      inputSchema,
      outputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (rawArgs: Record<string, unknown>) => {
      try {
        const args = inputSchema.parse(rawArgs);
        const browserResult = browserResultSchema.parse(
          await daemonClient.callTool(
            MCP_TOOL_NAMES.BROWSER_DIAGNOSE_RUNTIME_ERRORS,
            {
              afterStreamId: args.afterStreamId,
              afterSequence: args.afterSequence,
              limit: args.limit,
              maxFramesPerError: args.maxFramesPerError,
              includeWarnings: args.includeWarnings,
              includeRevoked: args.includeRevoked,
            },
          ),
        ) as BrowserRuntimeErrorsResult;
        const result = await enrichRuntimeErrorsWithWorkspace(
          browserResult,
          args.maxWorkspaceFrames ?? 12,
          args.includeLocalExcerpt !== false,
        );
        return formatMcpToolResult(outputSchema.parse(result));
      } catch (error) {
        return formatMcpToolResult(
          {
            error:
              error instanceof Error
                ? error.message
                : "Runtime error diagnosis failed.",
          },
          true,
        );
      }
    },
  );
}

export async function enrichRuntimeErrorsWithWorkspace(
  browserResult: BrowserRuntimeErrorsResult,
  maxWorkspaceFrames: number,
  includeLocalExcerpt: boolean,
): Promise<z.infer<typeof outputSchema>> {
  let workspaceBudget = maxWorkspaceFrames;
  let totalFrames = 0;
  let sourceMappedFrames = 0;
  let localMatchedFrames = 0;
  let contentVerifiedFrames = 0;
  const warnings: string[] = [];
  if (browserResult.cursorStatus === "stream_restarted") {
    warnings.push(
      "The runtime-error stream restarted; results begin at the oldest retained error in the new stream.",
    );
  } else if (browserResult.cursorStatus === "events_dropped") {
    warnings.push(
      `${browserResult.missedEvents} runtime errors were evicted before this cursor and cannot be reconstructed.`,
    );
  } else if (browserResult.cursorStatus === "cursor_ahead") {
    warnings.push(
      "The supplied runtime-error cursor is ahead of the selected Tab stream.",
    );
  }

  const errors = await mapSeries(browserResult.errors, async (error) => {
    const frames = await mapSeries(error.frames, async (frame) => {
      totalFrames += 1;
      const original = frame.sourceMap?.original;
      if (frame.sourceMap?.status === "resolved" && original) {
        sourceMappedFrames += 1;
      }
      if (!original || workspaceBudget <= 0) {
        return {
          ...frame,
          workspace: {
            status: original ? "not_attempted" : "unmapped",
            confidence: "unmapped",
            matches: [],
            warnings: original
              ? ["Workspace lookup budget exhausted for this result."]
              : [frame.sourceMap?.reason ?? "No original source location."],
          } satisfies WorkspaceDiagnostics,
        };
      }
      workspaceBudget -= 1;
      let workspace = await findWorkspaceSource({
        sourceHint: original.source,
        lineNumber: original.lineNumber,
        expectedExcerpt: original.excerpt,
        includeExcerpt: includeLocalExcerpt,
        limit: 3,
      });
      const symbol = original.name ?? frame.generated.functionName;
      if (workspace.matches.length === 0 && symbol) {
        workspace = await findWorkspaceSource({
          sourceHint: original.source,
          symbol,
          includeExcerpt: includeLocalExcerpt,
          limit: 3,
        });
      }
      const topMatch = workspace.matches[0];
      const confidence = workspaceConfidence(frame, topMatch);
      if (topMatch) {
        localMatchedFrames += 1;
      }
      if (topMatch?.contentMatch === true) {
        contentVerifiedFrames += 1;
      }
      return {
        ...frame,
        workspace: {
          status: topMatch ? "matched" : "unmapped",
          confidence,
          scannedFiles: workspace.scannedFiles,
          truncated: workspace.truncated,
          matches: workspace.matches,
          warnings: workspace.warnings,
        } satisfies WorkspaceDiagnostics,
      };
    });
    return {
      ...error,
      frames,
    };
  });

  return {
    version: "browser-runtime-error-diagnostics-v1",
    attached: browserResult.attached,
    tabId: browserResult.tabId,
    cursorStatus: browserResult.cursorStatus,
    cursor: browserResult.cursor,
    nextCursor: browserResult.nextCursor,
    oldestSequence: browserResult.oldestSequence,
    latestSequence: browserResult.latestSequence,
    missedEvents: browserResult.missedEvents,
    droppedEvents: browserResult.droppedEvents,
    total: browserResult.total,
    returned: browserResult.returned,
    errors,
    mappingSummary: {
      totalFrames,
      sourceMappedFrames,
      localMatchedFrames,
      contentVerifiedFrames,
    },
    warnings,
  };
}

function workspaceConfidence(
  frame: RuntimeErrorStackFrame,
  match:
    | {
        score: number;
        contentMatch?: boolean;
        reason: string[];
      }
    | undefined,
): WorkspaceDiagnostics["confidence"] {
  if (frame.sourceMap?.scriptIdentity?.debugIdMatch === false) {
    return "identity-mismatch";
  }
  if (match?.contentMatch === true) {
    return "source-map-content-verified";
  }
  if (match?.reason.includes("source path suffix match")) {
    return "source-map-path-match";
  }
  return match ? "heuristic" : "unmapped";
}

async function mapSeries<T, U>(
  values: readonly T[],
  mapper: (value: T) => Promise<U>,
): Promise<U[]> {
  const output: U[] = [];
  for (const value of values) {
    output.push(await mapper(value));
  }
  return output;
}
