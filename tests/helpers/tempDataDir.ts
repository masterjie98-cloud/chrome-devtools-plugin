import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface TestDataDirectory {
  rootDir: string;
  configPath: string;
  statePath: string;
  artifactDir: string;
  cleanup: () => Promise<void>;
}

export async function createTestDataDirectory(
  prefix = "ai-devtools-test-",
): Promise<TestDataDirectory> {
  const rootDir = await mkdtemp(join(tmpdir(), prefix));
  return {
    rootDir,
    configPath: join(rootDir, "config", "daemon.json"),
    statePath: join(rootDir, "state", "state.json"),
    artifactDir: join(rootDir, "artifacts"),
    cleanup: () => rm(rootDir, { recursive: true, force: true }),
  };
}
