import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getLocalServiceStatus,
  LOCAL_SERVICE_LABEL,
  resolveDaemonServerPath,
} from "../src/daemon/localService";

describe("localService", () => {
  it("resolves a concrete daemon server path", () => {
    const path = resolveDaemonServerPath();
    assert.ok(path.length > 0);
    assert.ok(path.includes("node") || path.endsWith(".js") || path.includes("/"));
  });

  it("reports macOS LaunchAgent and Windows Startup support", async () => {
    const status = await getLocalServiceStatus();
    assert.equal(status.ok, true);
    assert.equal(status.label, LOCAL_SERVICE_LABEL);
    assert.equal(status.platform, process.platform);
    if (process.platform === "darwin" || process.platform === "win32") {
      assert.equal(status.supported, true);
      assert.equal(typeof status.registered, "boolean");
      assert.equal(typeof status.loaded, "boolean");
      assert.ok(
        process.platform === "darwin"
          ? status.plistPath?.includes("LaunchAgents")
          : status.plistPath?.endsWith("AI DevTools Assistant Daemon.cmd"),
      );
    } else {
      assert.equal(status.supported, false);
      assert.equal(status.registered, false);
      assert.equal(status.plistPath, null);
    }
  });
});
