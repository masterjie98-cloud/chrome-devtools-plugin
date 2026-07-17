import { startPluginWebSocketServer } from "../mcp/wsServer";
import { browserStateHub } from "../mcp/browserStateHub";
import { loadDaemonConfig, resolveDaemonDataPaths } from "./config";
import { ArtifactStore } from "./artifacts/store";
import { DaemonStateStore } from "./store/stateStore";

const port = parsePort(process.env.AI_DEVTOOLS_DAEMON_PORT);
const dataPaths = resolveDaemonDataPaths();
const config = await loadDaemonConfig({ paths: dataPaths });
const stateStore = new DaemonStateStore({ statePath: dataPaths.statePath });
const restoredState = await stateStore.load();
if (restoredState) {
  browserStateHub.restorePersistentState(restoredState);
}
const daemon = startPluginWebSocketServer(port, undefined, {
  bridgeToken: config.bridgeToken,
  allowedExtensionIds: config.allowedExtensionIds,
  artifactStore: new ArtifactStore({ rootDir: dataPaths.artifactDir }),
  stateStore,
});
await daemon.ready();
let shuttingDown = false;

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}

async function shutdown(signal: "SIGINT" | "SIGTERM"): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.error(`[ai-devtools-daemon] shutting down after ${signal}.`);
  await daemon.close();
  process.exit(0);
}

function parsePort(value: string | undefined): number {
  if (!value) {
    return 17321;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid AI_DEVTOOLS_DAEMON_PORT: ${value}`);
  }
  return parsed;
}
