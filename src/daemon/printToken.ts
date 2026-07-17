import { loadDaemonConfig } from "./config";

const config = await loadDaemonConfig();
process.stdout.write(`${config.bridgeToken}\n`);
