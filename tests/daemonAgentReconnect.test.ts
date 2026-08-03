import assert from "node:assert/strict";
import test from "node:test";
import {
  createAgentSessionSnapshot,
  finalizeAgentSession,
} from "../src/shared/agentSession";
import { daemonAgentResultFromSession } from "../src/shared/daemonAgent";

test("running daemon session remains pending after reconnect", () => {
  const session = createAgentSessionSnapshot("run-a", "inspect the page");
  assert.equal(daemonAgentResultFromSession(session), undefined);
});

test("terminal daemon session reconstructs a lost completion event", () => {
  const session = finalizeAgentSession(
    createAgentSessionSnapshot("run-a", "inspect the page"),
    "completed",
    "finished after reconnect",
  );
  assert.deepEqual(daemonAgentResultFromSession(session), {
    finalContent: "finished after reconnect",
    session,
    status: "completed",
  });
});

test("failed daemon session restores a visible error detail", () => {
  const session = finalizeAgentSession(
    createAgentSessionSnapshot("run-a", "inspect the page"),
    "failed",
    "provider connection failed",
  );
  assert.deepEqual(daemonAgentResultFromSession(session), {
    finalContent: "provider connection failed",
    session,
    status: "failed",
    errorDetail: "provider connection failed",
  });
});
