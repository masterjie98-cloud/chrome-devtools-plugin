import { createHash } from "node:crypto";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import {
  basename,
  delimiter,
  extname,
  relative,
  resolve,
  sep,
} from "node:path";
import { pathToFileURL } from "node:url";
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
const PROJECT_MARKERS = [
  "package.json",
  "pnpm-workspace.yaml",
  "yarn.lock",
  "package-lock.json",
  "tsconfig.json",
  "vite.config.ts",
  "next.config.js",
  "Cargo.toml",
  "go.mod",
  "pyproject.toml",
] as const;

export const workspaceSourceInputSchema = z
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
    lineNumber: z.number().int().positive().max(10_000_000).optional(),
    expectedExcerpt: z.string().min(1).max(500).optional(),
    columnNumber: z.number().int().positive().max(10_000_000).optional(),
    workspaceRoot: z
      .string()
      .min(1)
      .max(2_000)
      .optional()
      .describe(
        "Optional configured root id, exact path, or unique project name returned by a previous call.",
      ),
  })
  .strict()
  .refine((value) => Boolean(value.sourceHint || value.symbol), {
    message: "sourceHint or symbol is required",
  });

export const workspaceSourceOutputSchema = z
  .object({
    version: z.literal("browser-workspace-source-v1"),
    roots: z.array(z.string()),
    rootCandidates: z.array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          path: z.string(),
          markers: z.array(z.string()),
          selected: z.boolean(),
          matchScore: z.number(),
        })
        .strict(),
    ),
    selectedRootId: z.string().optional(),
    scannedFiles: z.number().int().nonnegative(),
    truncated: z.boolean(),
    matches: z.array(
      z
        .object({
          root: z.string(),
          rootId: z.string(),
          projectName: z.string(),
          path: z.string(),
          absolutePath: z.string(),
          fileUri: z.string(),
          location: z.string(),
          editorTargets: z.array(
            z
              .object({
                editor: z.enum(["vscode", "cursor"]),
                uri: z.string(),
                command: z.string(),
                arguments: z.array(z.string()),
              })
              .strict(),
          ),
          score: z.number(),
          line: z.number().int().positive().optional(),
          column: z.number().int().positive().optional(),
          reason: z.array(z.string()),
          excerpt: z.string().optional(),
          contentMatch: z.boolean().optional(),
        })
        .strict(),
    ),
    warnings: z.array(z.string()),
  })
  .strict();

interface WorkspaceMatch {
  root: string;
  rootId: string;
  projectName: string;
  path: string;
  absolutePath: string;
  fileUri: string;
  location: string;
  editorTargets: Array<{
    editor: "vscode" | "cursor";
    uri: string;
    command: string;
    arguments: string[];
  }>;
  score: number;
  line?: number;
  column?: number;
  reason: string[];
  excerpt?: string;
  contentMatch?: boolean;
}

export function registerWorkspaceSourceTool(server: McpServer): void {
  server.registerTool(
    WORKSPACE_TOOL_NAME,
    {
      title: "Find browser source in local workspace",
      description:
        "Resolve a browser/source-map file hint or component symbol to bounded files under configured local workspace roots. Roots come only from AI_DEVTOOLS_WORKSPACE_ROOTS or the adapter working directory; arbitrary paths are rejected.",
      inputSchema: workspaceSourceInputSchema,
      outputSchema: workspaceSourceOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (rawArgs: Record<string, unknown>) => {
      try {
        const args = workspaceSourceInputSchema.parse(rawArgs);
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
  args: z.infer<typeof workspaceSourceInputSchema>,
): Promise<z.infer<typeof workspaceSourceOutputSchema>> {
  const configuredRoots = await configuredWorkspaceRoots();
  const selectedRoot = selectConfiguredWorkspaceRoot(
    configuredRoots,
    args.workspaceRoot,
  );
  const roots = selectedRoot ? [selectedRoot] : configuredRoots;
  const extensions = new Set(args.extensions ?? DEFAULT_EXTENSIONS);
  const limit = args.limit ?? 20;
  const normalizedHint = normalizeSourceHint(args.sourceHint);
  const symbol = args.symbol?.trim();
  const matches: WorkspaceMatch[] = [];
  const warnings: string[] = [];
  let scannedFiles = 0;
  let truncated = false;
  const perRootScanLimit = Math.max(
    500,
    Math.floor(MAX_SCANNED_FILES / Math.max(1, roots.length)),
  );

  const projectScores = new Map<string, number>();

  for (const rootInfo of roots) {
    const root = rootInfo.path;
    const pending = [root];
    let rootScannedFiles = 0;
    let rootTruncated = false;
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
        rootScannedFiles += 1;
        if (rootScannedFiles > perRootScanLimit) {
          truncated = true;
          rootTruncated = true;
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
        let line: number | undefined = args.lineNumber;
        let excerpt: string | undefined;
        let contentMatch: boolean | undefined;
        const shouldInspectContent =
          Boolean(symbol) || (args.lineNumber !== undefined && score > 0);
        if (shouldInspectContent) {
          const metadata = await stat(absolutePath);
          if (metadata.size <= MAX_FILE_BYTES) {
            const content = await readFile(absolutePath, "utf8");
            const lines = content.split(/\r?\n/);
            if (symbol) {
              const index = content
                .toLowerCase()
                .indexOf(symbol.toLowerCase());
              if (index >= 0) {
                line ??= content.slice(0, index).split(/\r?\n/).length;
                score += 60;
                reasons.push("symbol content match");
              }
            }
            if (line !== undefined && line <= lines.length) {
              const mappedLine = lines[line - 1] ?? "";
              if (args.expectedExcerpt) {
                contentMatch =
                  normalizeComparableSource(mappedLine) ===
                  normalizeComparableSource(args.expectedExcerpt);
                if (contentMatch) {
                  score += 80;
                  reasons.push("mapped source content match");
                } else {
                  reasons.push("mapped source content differs");
                }
              }
              if (args.includeExcerpt) {
                excerpt = lines
                  .slice(
                    Math.max(0, line - 2),
                    Math.min(lines.length, line + 1),
                  )
                  .join("\n")
                  .slice(0, 1_500);
              }
            }
          }
          if (
            symbol &&
            entry.name.toLowerCase().includes(symbol.toLowerCase())
          ) {
            score += 20;
            reasons.push("symbol filename match");
          }
        }
        if (score > 0) {
          matches.push({
            root,
            rootId: rootInfo.id,
            projectName: rootInfo.name,
            path: relativePath,
            absolutePath,
            fileUri: pathToFileURL(absolutePath).href,
            location: sourceLocation(absolutePath, line, args.columnNumber),
            editorTargets: editorTargets(
              absolutePath,
              line,
              args.columnNumber,
            ),
            score,
            line,
            column: args.columnNumber,
            reason: reasons,
            excerpt,
            contentMatch,
          });
          projectScores.set(
            rootInfo.id,
            Math.max(projectScores.get(rootInfo.id) ?? 0, score),
          );
        }
      }
      if (rootTruncated) {
        break;
      }
    }
  }

  return {
    version: "browser-workspace-source-v1",
    roots: configuredRoots.map((root) => root.path),
    rootCandidates: configuredRoots
      .map((root) => ({
        id: root.id,
        name: root.name,
        path: root.path,
        markers: root.markers,
        selected: root.id === selectedRoot?.id,
        matchScore: projectScores.get(root.id) ?? 0,
      }))
      .sort(
        (left, right) =>
          right.matchScore - left.matchScore ||
          left.name.localeCompare(right.name),
      ),
    ...(selectedRoot ? { selectedRootId: selectedRoot.id } : {}),
    scannedFiles: Math.min(scannedFiles, perRootScanLimit * roots.length),
    truncated,
    matches: matches
      .sort(
        (left, right) =>
          right.score - left.score || left.path.localeCompare(right.path),
      )
      .slice(0, limit)
      .map((match) => ({
        root: match.root,
        rootId: match.rootId,
        projectName: match.projectName,
        path: match.path,
        absolutePath: match.absolutePath,
        fileUri: match.fileUri,
        location: match.location,
        editorTargets: match.editorTargets,
        score: match.score,
        ...(match.line ? { line: match.line } : {}),
        ...(match.column ? { column: match.column } : {}),
        reason: match.reason,
        ...(match.excerpt ? { excerpt: match.excerpt } : {}),
        ...(match.contentMatch === undefined
          ? {}
          : { contentMatch: match.contentMatch }),
      })),
    warnings,
  };
}

interface ConfiguredWorkspaceRoot {
  id: string;
  name: string;
  path: string;
  markers: string[];
}

async function configuredWorkspaceRoots(): Promise<ConfiguredWorkspaceRoot[]> {
  const configured = process.env.AI_DEVTOOLS_WORKSPACE_ROOTS
    ?.split(delimiter)
    .map((value) => value.trim())
    .filter(Boolean);
  const candidates = configured?.length ? configured : [process.cwd()];
  const roots: ConfiguredWorkspaceRoot[] = [];
  for (const candidate of candidates.slice(0, 20)) {
    const resolved = await realpath(resolve(candidate));
    const metadata = await stat(resolved);
    if (!metadata.isDirectory()) {
      throw new Error(`WORKSPACE_ROOT_INVALID: not a directory: ${candidate}`);
    }
    if (roots.some((root) => root.path === resolved)) {
      continue;
    }
    roots.push({
      id: workspaceRootId(resolved),
      name: basename(resolved) || resolved,
      path: resolved,
      markers: await detectProjectMarkers(resolved),
    });
  }
  return roots;
}

function selectConfiguredWorkspaceRoot(
  roots: ConfiguredWorkspaceRoot[],
  selector: string | undefined,
): ConfiguredWorkspaceRoot | undefined {
  const normalized = selector?.trim();
  if (!normalized) {
    return undefined;
  }
  const exact = roots.find(
    (root) => root.id === normalized || root.path === resolve(normalized),
  );
  if (exact) {
    return exact;
  }
  const byName = roots.filter((root) => root.name === normalized);
  if (byName.length === 1) {
    return byName[0];
  }
  if (byName.length > 1) {
    throw new Error(
      `WORKSPACE_ROOT_AMBIGUOUS: project name matches ${byName.length} configured roots; use rootCandidates[].id.`,
    );
  }
  throw new Error(
    "WORKSPACE_ROOT_NOT_CONFIGURED: select a rootCandidates[].id or configure AI_DEVTOOLS_WORKSPACE_ROOTS; arbitrary paths are rejected.",
  );
}

function workspaceRootId(root: string): string {
  return `workspace-${createHash("sha256").update(root).digest("hex").slice(0, 12)}`;
}

async function detectProjectMarkers(root: string): Promise<string[]> {
  const markers: string[] = [];
  for (const marker of PROJECT_MARKERS) {
    try {
      const metadata = await stat(resolve(root, marker));
      if (metadata.isFile()) {
        markers.push(marker);
      }
    } catch {
      // Marker absence is expected and does not make the root invalid.
    }
  }
  return markers;
}

function normalizeSourceHint(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  let pathValue: string;
  try {
    const url = new URL(value);
    if (
      url.protocol === "data:" ||
      url.protocol === "javascript:" ||
      url.protocol === "blob:"
    ) {
      throw new Error("unsupported source URL scheme");
    }
    pathValue = decodeURIComponent(url.pathname || url.hostname);
  } catch (error) {
    if (
      error instanceof URIError ||
      /^[a-z][a-z0-9+.-]*:/i.test(value)
    ) {
      throw new Error("WORKSPACE_SOURCE_HINT_INVALID: unsupported source URL.");
    }
    pathValue = value.split(/[?#]/, 1)[0] ?? "";
  }
  const normalized = normalizePath(pathValue)
    .replace(/^\/+/, "")
    .replace(/^(?:\.\/)+/, "");
  if (!normalized || normalized.split("/").includes("..")) {
    throw new Error("WORKSPACE_SOURCE_HINT_INVALID: path traversal is not allowed.");
  }
  return normalized;
}

function normalizePath(value: string): string {
  return value.split(sep).join("/").replace(/\\/g, "/");
}

function normalizeComparableSource(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function sourceLocation(
  absolutePath: string,
  line?: number,
  column?: number,
): string {
  if (line === undefined) {
    return absolutePath;
  }
  return `${absolutePath}:${line}:${column ?? 1}`;
}

function editorTargets(
  absolutePath: string,
  line?: number,
  column?: number,
): WorkspaceMatch["editorTargets"] {
  const location = sourceLocation(absolutePath, line, column);
  const encodedPath = pathToFileURL(absolutePath).pathname;
  const suffix = line === undefined ? "" : `:${line}:${column ?? 1}`;
  return [
    {
      editor: "vscode",
      uri: `vscode://file${encodedPath}${suffix}`,
      command: "code",
      arguments: ["--goto", location],
    },
    {
      editor: "cursor",
      uri: `cursor://file${encodedPath}${suffix}`,
      command: "cursor",
      arguments: ["--goto", location],
    },
  ];
}
