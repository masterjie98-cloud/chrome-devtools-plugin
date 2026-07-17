import { DaemonClient } from "../mcp/daemonClient";
import { MCP_WS_URL } from "../shared/wsProtocol";

const daemonUrl = process.env.AI_DEVTOOLS_DAEMON_URL ?? MCP_WS_URL;
const client = new DaemonClient();

try {
  const tools = await client.listTools();
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        daemonUrl,
        sessionBound: Boolean(process.env.AI_DEVTOOLS_SESSION_ID),
        exposedToolCount: tools.length,
      },
      null,
      2,
    )}\n`,
  );
} catch (error) {
  process.stderr.write(
    `${JSON.stringify(
      {
        ok: false,
        daemonUrl,
        error:
          error instanceof Error ? error.message : "Daemon status check failed.",
      },
      null,
      2,
    )}\n`,
  );
  process.exitCode = 1;
} finally {
  client.close();
}
