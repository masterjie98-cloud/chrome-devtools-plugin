import assert from "node:assert/strict";
import test from "node:test";
import {
  approvalModeNeedsDecision,
  matchesTaskCapabilityGrant,
  type TaskCapabilityGrant,
} from "../src/shared/taskCapabilityGrant";
import { getToolPolicy } from "../src/shared/toolPolicy";

const grant: TaskCapabilityGrant = {
  version: 1,
  grantId: "grant-1",
  revision: 1,
  taskId: "conversation-1",
  sessionId: "profile-1",
  origin: "https://example.test",
  targetId: "target-1",
  tabId: 7,
  principals: ["ui"],
  requesterClientNames: ["chrome-devtools-sidepanel"],
  egressDestinations: ["AI Provider: https://provider.test"],
  capabilities: ["page.interact.low_risk", "page.observe.visual"],
  issuedAt: "2026-07-17T00:00:00.000Z",
  expiresAt: "2026-07-17T02:00:00.000Z",
};

const context = {
  now: Date.parse("2026-07-17T01:00:00.000Z"),
  taskId: "conversation-1",
  sessionId: "profile-1",
  requesterRole: "ui" as const,
  requesterClientName: "chrome-devtools-sidepanel",
  target: {
    url: "https://example.test/next",
    title: "Page",
    targetId: "target-1",
    tabId: 7,
  },
  egressDestinations: ["AI Provider: https://provider.test"],
  policy: getToolPolicy("browser_click", { selector: "#next" }),
};

test("task grant matches only the exact task, Profile, tab, origin, principal, destination and capability", () => {
  assert.equal(matchesTaskCapabilityGrant(grant, context), true);
  assert.equal(
    matchesTaskCapabilityGrant(grant, { ...context, taskId: "conversation-2" }),
    false,
  );
  assert.equal(
    matchesTaskCapabilityGrant(grant, {
      ...context,
      target: { ...context.target, url: "https://other.test/" },
    }),
    false,
  );
  assert.equal(
    matchesTaskCapabilityGrant(grant, {
      ...context,
      egressDestinations: ["AI Provider: https://other-provider.test"],
    }),
    false,
  );
  assert.equal(
    matchesTaskCapabilityGrant(grant, { ...context, requesterRole: "mcp" }),
    false,
  );
});

test("a task grant can cover low-risk actions but never a decision barrier", () => {
  assert.equal(approvalModeNeedsDecision(context.policy.approvalMode, true), false);
  const submit = getToolPolicy("browser_click", { selector: "#submit" });
  assert.equal(submit.approvalMode, "decision_barrier");
  assert.equal(approvalModeNeedsDecision(submit.approvalMode, true), true);
});

test("expired and revoked grants fail closed", () => {
  assert.equal(
    matchesTaskCapabilityGrant(grant, {
      ...context,
      now: Date.parse("2026-07-17T03:00:00.000Z"),
    }),
    false,
  );
  assert.equal(
    matchesTaskCapabilityGrant(
      { ...grant, revokedAt: "2026-07-17T01:00:00.000Z" },
      context,
    ),
    false,
  );
});
