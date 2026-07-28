import assert from "node:assert/strict";
import test from "node:test";
import {
  createExecutionGrant,
  EXECUTION_GRANT_VERSION,
  ExecutionGrantReplayCache,
  hashExecutionArguments,
  isSignedExecutionGrant,
  verifyExecutionGrant,
} from "../src/shared/executionGrant";

const KEY = "execution-grant-test-key-000000000000000000";
const TARGET = {
  url: "https://example.test/page",
  title: "Page",
  targetId: "tab-9",
  tabId: 9,
  windowId: 3,
  frameId: 4,
  documentId: "document-a",
  navigationId: "navigation-a",
  revision: 7,
};

test("execution grant binds request, session, tool, arguments, and target", async () => {
  const args = { selector: "#confirm", options: { force: false } };
  const grant = await createExecutionGrant(KEY, {
    version: EXECUTION_GRANT_VERSION,
    grantId: "grant-1",
    browserRequestId: "browser-request-1",
    requesterRequestId: "mcp-request-1",
    requesterConnectionId: "connection-1",
    sessionId: "profile-1",
    sourceMcpToolName: "browser_click",
    policyClass: "page_action",
    mutatesBrowser: true,
    toolName: "browser.click",
    argumentsSha256: await hashExecutionArguments(args),
    approvalRequired: true,
    approvalId: "approval-1",
    target: TARGET,
    issuedAt: "2026-07-13T01:00:00.000Z",
    expiresAt: "2026-07-13T01:00:30.000Z",
  });

  assert.deepEqual(
    await verifyExecutionGrant(KEY, grant, {
      browserRequestId: "browser-request-1",
      sessionId: "profile-1",
      toolName: "browser.click",
      args,
      target: TARGET,
      now: new Date("2026-07-13T01:00:10.000Z"),
    }),
    { ok: true },
  );
  assert.match(
    (
      await verifyExecutionGrant(KEY, grant, {
        browserRequestId: "browser-request-1",
        sessionId: "profile-1",
        toolName: "browser.click",
        args: { selector: "#other" },
        target: TARGET,
        now: new Date("2026-07-13T01:00:10.000Z"),
      }) as { ok: false; reason: string }
    ).reason,
    /arguments do not match/,
  );
  assert.match(
    (
      await verifyExecutionGrant(KEY, grant, {
        browserRequestId: "browser-request-1",
        sessionId: "profile-1",
        toolName: "browser.click",
        args,
        target: { ...TARGET, documentId: "document-b" },
        now: new Date("2026-07-13T01:00:10.000Z"),
      }) as { ok: false; reason: string }
    ).reason,
    /target is stale.*fields=documentId/,
  );
  assert.deepEqual(
    await verifyExecutionGrant(KEY, grant, {
      browserRequestId: "browser-request-1",
      sessionId: "profile-1",
      toolName: "browser.click",
      args,
      target: {
        ...TARGET,
        targetId: "tab-10",
        tabId: 10,
        windowId: 4,
        documentId: "document-b",
        navigationId: "navigation-b",
      },
      targetBinding: "none",
      now: new Date("2026-07-13T01:00:10.000Z"),
    }),
    { ok: true },
  );
});

test("execution grants reject signature tampering, expiry, and replay", async () => {
  const args = {};
  const grant = await createExecutionGrant(KEY, {
    version: EXECUTION_GRANT_VERSION,
    grantId: "grant-2",
    browserRequestId: "browser-request-2",
    requesterRequestId: "mcp-request-2",
    requesterConnectionId: "connection-2",
    sessionId: "profile-2",
    sourceMcpToolName: "browser_snapshot",
    policyClass: "safe_read",
    mutatesBrowser: false,
    toolName: "dom.getPageInfo",
    argumentsSha256: await hashExecutionArguments(args),
    approvalRequired: false,
    target: TARGET,
    issuedAt: "2026-07-13T02:00:00.000Z",
    expiresAt: "2026-07-13T02:00:30.000Z",
  });
  const tampered = {
    ...grant,
    claims: { ...grant.claims, sessionId: "profile-attacker" },
  };
  assert.equal(
    isSignedExecutionGrant({
      ...grant,
      claims: { ...grant.claims, policyClass: "read-ish" },
    }),
    false,
  );
  assert.match(
    (
      await verifyExecutionGrant(KEY, tampered, {
        browserRequestId: "browser-request-2",
        sessionId: "profile-attacker",
        toolName: "dom.getPageInfo",
        args,
        target: TARGET,
        now: new Date("2026-07-13T02:00:10.000Z"),
      }) as { ok: false; reason: string }
    ).reason,
    /signature/,
  );
  assert.match(
    (
      await verifyExecutionGrant(KEY, grant, {
        browserRequestId: "browser-request-2",
        sessionId: "profile-2",
        toolName: "dom.getPageInfo",
        args,
        target: TARGET,
        now: new Date("2026-07-13T02:00:31.000Z"),
      }) as { ok: false; reason: string }
    ).reason,
    /expired/,
  );

  const cache = new ExecutionGrantReplayCache();
  assert.equal(
    cache.consume("grant-2", "2026-07-13T02:00:30.000Z", Date.parse("2026-07-13T02:00:10.000Z")),
    true,
  );
  assert.equal(
    cache.consume("grant-2", "2026-07-13T02:00:30.000Z", Date.parse("2026-07-13T02:00:11.000Z")),
    false,
  );
});
