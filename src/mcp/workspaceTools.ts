import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, delimiter, extname, relative, resolve, sep } from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { formatMcpToolResult } from "./toolRuntime";

export const WORKSPACE_TOOL_NAME = "browser_find_workspace_source";

const DEFAULT_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".js",
  ".jsx",
  ".less",
  ".mjs",
  ".scss",
  ".ts",
  ".tsx",
  ".vue",
]);
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".codegraph",
  ".next",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
]);
const MAX_SCANNED_FILES = 5_000;
const MAX_FILE_BYTES = 512 * 1024;

const inputSchema = z
  .object({
    sourceHint: z.string().min(1).max(2_000).optional(),
    symbol: z.string().min(1).max(300).optional(),
    extensions: z
      .array(z.string().regex(/^\.[a-z0-9]+$/i))
      .min(1)
      .max(20)
      .optional(),
    limit: z.number().int().min(1).max(50).optional(),
    includeExcerpt: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Boolean(value.sourceHint || value.symbol), {
    message: "sourceHint or symbol is required",
  });

const outputSchema = z
  .object({
    version: z.literal("browser-workspace-source-v1"),
    roots: z.array(z.string()),
    scannedFiles: z.number().int().nonnegative(),
    truncated: z.boolean(),
    matches: z.array(
      z
        .object({
          root: z.string(),
          path: z.string(),
          score: z.number(),
          line: z.number().int().positive().optional(),
          reason: z.array(z.string()),
          excerpt: z.string().optional(),
        })
        .strict(),
    ),
    warnings: z.array(z.string()),
  })
  .strict();

interface WorkspaceMatch {
  root: string;
  path: string;
  score: number;
  line?: number;
  reason: string[];
  excerpt?: string;
}

export function registerWorkspaceSourceTool(server: McpServer): void {
  server.registerTool(
    WORKSPACE_TOOL_NAME,
    {
      title: "Find browser source in local workspace",
      description:
        "Resolve a browser/source-map file hint or component symbol to bounded files under configured local workspace roots. Roots come only from AI_DEVTOOLS_WORKSPACE_ROOTS or the adapter working directory; arbitrary paths are rejected.",
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
        return formatMcpToolResult(await findWorkspaceSource(args));
      } catch (error) {
        return formatMcpToolResult(
          {
            error:
              error instanceof Error
                ? error.message
                : "Workspace source lookup failed.",
          },
          true,
        );
      }
    },
  );
}

export async function findWorkspaceSource(
  args: z.infer<typeof inputSchema>,
): Promise<z.infer<typeof outputSchema>> {
  const roots = await configuredWorkspaceRoots();
  const extensions = new Set(args.extensions ?? DEFAULT_EXTENSIONS);
  const limit = args.limit ?? 20;
  const normalizedHint = normalizeSourceHint(args.sourceHint);
  const symbol = args.symbol?.trim();
  const matches: WorkspaceMatch[] = [];
  const warnings: string[] = [];
  let scannedFiles = 0;
  let truncated = false;

  for (const root of roots) {
    const pending = [root];
    while (pending.length > 0) {
      const directory = pending.pop()!;
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch (error) {
        warnings.push(
          `Cannot read ${relative(root, directory) || "."}: ${
            error instanceof Error ? error.message : String(error)
          }`.slice(0, 500),
        );
        continue;
      }
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (!IGNORED_DIRECTORIES.has(entry.name)) {
            pending.push(resolve(directory, entry.name));
          }
          continue;
        }
        if (!entry.isFile() || !extensions.has(extname(entry.name))) {
          continue;
        }
        scannedFiles += 1;
        if (scannedFiles > MAX_SCANNED_FILES) {
          truncated = true;
          break;
        }
        const absolutePath = resolve(directory, entry.name);
        const relativePath = relative(root, absolutePath);
        const normalizedRelativePath = normalizePath(relativePath);
        const normalizedAbsolutePath = normalizePath(absolutePath);
        const reasons: string[] = [];
        let score = 0;
        if (
          normalizedHint &&
          (normalizedRelativePath.endsWith(normalizedHint) ||
            normalizedAbsolutePath.endsWith(normalizedHint) ||
            normalizedHint.endsWith(normalizedRelativePath))
        ) {
          score += 100;
          reasons.push("source path suffix match");
        } else if (
          normalizedHint &&
          normalizedRelativePath.includes(basename(normalizedHint))
        ) {
          score += 40;
          reasons.push("source filename match");
        }
        let line: number | undefined;
        let excerpt: string | undefined;
        if (symbol) {
          const metadata = await stat(absolutePath);
          if (metadata.size <= MAX_FILE_BYTES) {
            const content = await readFile(absolutePath, "utf8");
            const index = content.toLowerCase().indexOf(symbol.toLowerCase());
            if (index >= 0) {
              line = content.slice(0, index).split(/\r?\n/).length;
              score += 60;
              reasons.push("symbol content match");
              if (args.includeExcerpt) {
                const lines = content.split(/\r?\n/);
                excerpt = lines
                  .slice(Math.max(0, line - 2), Math.min(lines.length, line + 1))
                  .join("\n")
                  .slice(0, 1_500);
              }
            }
          }
          if (entry.name.toLowerCase().includes(symbol.toLowerCase())) {
            score += 20;
            reasons.push("symbol filename match");
          }
        }
        if (score > 0) {
          matches.push({
            root,
            path: relativePath,
            score,
            line,
            reason: reasons,
            excerpt,
          });
        }
      }
      if (truncated) {
        break;
      }
    }
    if (truncated) {
      break;
    }
  }

  return {
    version: "browser-workspace-source-v1",
    roots,
    scannedFiles: Math.min(scannedFiles, MAX_SCANNED_FILES),
    truncated,
    matches: matches
      .sort(
        (left, right) =>
          right.score - left.score || left.path.localeCompare(right.path),
      )
      .slice(0, limit)
      .map((match) => ({
        root: match.root,
        path: match.path,
        score: match.score,
        ...(match.line ? { line: match.line } : {}),
        reason: match.reason,
        ...(match.excerpt ? { excerpt: match.excerpt } : {}),
      })),
    warnings,
  };
}

async function configuredWorkspaceRoots(): Promise<string[]> {
  const configured = process.env.AI_DEVTOOLS_WORKSPACE_ROOTS
    ?.split(delimiter)
    .map((value) => value.trim())
    .filter(Boolean);
  const candidates = configured?.length ? configured : [process.cwd()];
  const roots: string[] = [];
  for (const candidate of candidates.slice(0, 10)) {
    const resolved = await realpath(resolve(candidate));
    const metadata = await stat(resolved);
    if (!metadata.isDirectory()) {
      throw new Error(`WORKSPACE_ROOT_INVALID: not a directory: ${candidate}`);
    }
    roots.push(resolved);
  }
  return [...new Set(roots)];
}

function normalizeSourceHint(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const withoutScheme =
    value.replace(/^(?:webpack|vite|file):\/+/, "").split(/[?#]/, 1)[0] ?? "";
  const normalized = normalizePath(withoutScheme).replace(/^\/+/, "");
  if (!normalized || normalized.split("/").includes("..")) {
    throw new Error("WORKSPACE_SOURCE_HINT_INVALID: path traversal is not allowed.");
  }
  return normalized;
}

function normalizePath(value: string): string {
  return value.split(sep).join("/").replace(/\\/g, "/");
}
