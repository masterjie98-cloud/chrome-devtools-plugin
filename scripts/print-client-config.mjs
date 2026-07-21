#!/usr/bin/env node

import { resolve } from "node:path";

const supportedProfiles = new Set(["smart", "inspect", "read", "full"]);
const requestedProfile =
  process.argv.find((argument) => argument.startsWith("--profile="))?.slice(10) ??
  "smart";

if (!supportedProfiles.has(requestedProfile)) {
  process.stderr.write(
    `Unsupported profile "${requestedProfile}". Use smart, inspect, read, or full.\n`,
  );
  process.exitCode = 1;
} else {
  const nodePath = process.execPath;
  const serverPath = resolve("dist/mcp/server.js");
  const env = { AI_DEVTOOLS_MCP_TOOL_PROFILE: requestedProfile };
  const serverConfig = {
    command: nodePath,
    args: [serverPath],
    env,
  };
  const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
  const codexCommand = [
    "codex mcp add",
    `--env AI_DEVTOOLS_MCP_TOOL_PROFILE=${requestedProfile}`,
    "ai-devtools --",
    shellQuote(nodePath),
    shellQuote(serverPath),
  ].join(" ");

  process.stdout.write(
    `${JSON.stringify(
      {
        profile: requestedProfile,
        prerequisites: {
          builtServerExists: "Run npm run build before registering a client.",
          daemon: "Run npm run daemon:start or install the local service.",
        },
        codex: {
          command: codexCommand,
          verify: [
            "codex mcp get ai-devtools",
            "codex mcp list",
          ],
        },
        claudeDesktop: {
          mcpServers: { "ai-devtools": serverConfig },
        },
        cursor: {
          mcpServers: { "ai-devtools": serverConfig },
        },
        note:
          "Bridge Token stays in the daemon private config and must not be copied into MCP client configuration.",
      },
      null,
      2,
    )}\n`,
  );
}
