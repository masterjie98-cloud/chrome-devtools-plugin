import assert from "node:assert/strict";
import { createInterface } from "node:readline/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const profileUrlPrefix =
  readFlag("--profile-url-prefix") ?? "http://127.0.0.1:8765/?profile=B";
const approvalTimeout = 24 * 60 * 60 * 1_000;
const ruleInput = {
  priority: 1,
  target: "request",
  urlFilter: "||127.0.0.1:8765/",
  resourceTypes: ["xmlhttprequest", "main_frame", "sub_frame"],
  headers: [
    {
      header: "X-AI-DevTools-Manual",
      operation: "set",
      value: "manual-rule-marker",
    },
  ],
};

let client;
let disposableRuleId;
const readline = createInterface({
  input: process.stdin,
  output: process.stderr,
});

try {
  client = await startAdapter();
  const sessions = sessionRows(
    await call(client, "browser_list_sessions", {}),
  ).filter((session) => session.browserConnected === true);
  const { profile, target } = await selectProfileTarget(
    client,
    sessions,
    profileUrlPrefix,
  );

  const initialRules = await listRules(client, "INITIAL");
  const initialIds = new Set(initialRules.map((rule) => rule.id));

  await waitForStep(
    "STEP_1_DENY_UPSERT",
    "deny the first browser_upsert_header_rule approval",
  );
  assertDenied(
    await call(
      client,
      "browser_upsert_header_rule",
      ruleInput,
      approvalTimeout,
    ),
    "first DNR upsert",
  );
  assert.deepEqual(
    ruleIds(await listRules(client, "AFTER_DENIED_UPSERT")),
    ruleIds(initialRules),
    "A denied DNR upsert changed the rule set.",
  );

  await waitForStep(
    "STEP_2_APPROVE_UPSERT",
    "approve the second browser_upsert_header_rule request once",
  );
  const created = await call(
    client,
    "browser_upsert_header_rule",
    ruleInput,
    approvalTimeout,
  );
  assertSuccess(created, "approved DNR upsert");
  disposableRuleId = resultData(created).ruleId;
  assert.equal(
    Number.isSafeInteger(disposableRuleId),
    true,
    "Approved DNR upsert returned no numeric ruleId.",
  );
  assert.equal(
    initialIds.has(disposableRuleId),
    false,
    "The disposable DNR upsert reused a pre-existing rule ID.",
  );
  assert.equal(
    (await listRules(client, "AFTER_APPROVED_UPSERT")).some(
      (rule) => rule.id === disposableRuleId,
    ),
    true,
    "Approved DNR rule is absent from the current rule list.",
  );

  await waitForStep(
    "STEP_3_DENY_RETRY",
    "deny the same rule replacement; it must request a fresh approval",
  );
  assertDenied(
    await call(
      client,
      "browser_upsert_header_rule",
      { ...ruleInput, ruleId: disposableRuleId },
      approvalTimeout,
    ),
    "DNR replacement retry",
  );
  assert.equal(
    (await listRules(client, "AFTER_DENIED_REPLACEMENT")).some(
      (rule) => rule.id === disposableRuleId,
    ),
    true,
    "Denied DNR replacement removed the existing disposable rule.",
  );

  await waitForStep(
    "STEP_4_DENY_REMOVE",
    "deny the first browser_remove_network_rule request",
  );
  assertDenied(
    await call(
      client,
      "browser_remove_network_rule",
      { ruleId: disposableRuleId },
      approvalTimeout,
    ),
    "first DNR removal",
  );
  assert.equal(
    (await listRules(client, "AFTER_DENIED_REMOVE")).some(
      (rule) => rule.id === disposableRuleId,
    ),
    true,
    "Denied DNR removal removed the disposable rule.",
  );

  await waitForStep(
    "STEP_5_APPROVE_REMOVE",
    "approve removal of the exact disposable rule ID",
  );
  const removed = await call(
    client,
    "browser_remove_network_rule",
    { ruleId: disposableRuleId },
    approvalTimeout,
  );
  assertSuccess(removed, "approved DNR removal");
  const rulesAfterApprovedRemove = await listRules(
    client,
    "AFTER_APPROVED_REMOVE",
  );
  assert.equal(
    rulesAfterApprovedRemove.some((rule) => rule.id === disposableRuleId),
    false,
    "Approved DNR removal left the disposable rule behind.",
  );
  disposableRuleId = undefined;

  assert.deepEqual(
    ruleIds(rulesAfterApprovedRemove),
    ruleIds(initialRules),
    "DNR verification changed an unrelated pre-existing rule.",
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        profile: {
          id: redactSessionId(profile.sessionId),
          activeOrigin: safeOrigin(target.url),
        },
        initialRuleCount: initialRules.length,
        deniedUpsertPreservedRules: true,
        approvedRuleCreated: true,
        retryRequiredFreshApproval: true,
        deniedRemovalPreservedRule: true,
        exactCleanupCompleted: true,
        unrelatedRulesPreserved: true,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  readline.close();
  if (client && Number.isSafeInteger(disposableRuleId)) {
    process.stderr.write(
      `CLEANUP_REQUIRED: approve removal of disposable rule ${disposableRuleId}; no other rule will be changed.\n`,
    );
    const cleanup = await call(
      client,
      "browser_remove_network_rule",
      { ruleId: disposableRuleId },
      approvalTimeout,
    ).catch(() => undefined);
    if (!cleanup || cleanup.isError) {
      process.stderr.write(
        `WARNING: disposable DNR rule ${disposableRuleId} still requires manual cleanup.\n`,
      );
    }
  }
  await client?.close().catch(() => undefined);
}

async function startAdapter() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/mcp/server.js"],
    env: {
      ...process.env,
      AI_DEVTOOLS_MCP_TOOL_PROFILE: "full",
    },
  });
  const nextClient = new Client({
    name: "dnr-approval-live",
    version: "1.0.0",
  });
  await nextClient.connect(transport);
  return nextClient;
}

async function selectProfileTarget(activeClient, sessions, urlPrefix) {
  for (const profile of sessions) {
    if (!profile?.sessionId) {
      continue;
    }
    assertSuccess(
      await call(activeClient, "browser_set_session", {
        sessionId: profile.sessionId,
      }),
      "browser_set_session",
    );
    const tabsResult = await call(activeClient, "browser_list_tabs", {});
    assertSuccess(tabsResult, "browser_list_tabs");
    const target = resultData(tabsResult).tabs?.find((tab) =>
      String(tab?.url ?? "").startsWith(urlPrefix),
    );
    if (!target || !Number.isSafeInteger(target.id)) {
      continue;
    }
    assertSuccess(
      await call(activeClient, "browser_set_target_tab", {
        tabId: target.id,
      }),
      "browser_set_target_tab",
    );
    return { profile, target };
  }
  throw new Error(
    `No connected Profile contains the verification Tab ${urlPrefix}.`,
  );
}

async function listRules(activeClient, phase) {
  process.stderr.write(
    `WAITING_FOR_DNR_LIST_APPROVAL_${phase}: approve the read-only network-rule list.\n`,
  );
  const result = await call(
    activeClient,
    "browser_list_network_rules",
    {},
    approvalTimeout,
  );
  assertSuccess(result, "browser_list_network_rules");
  const rules = resultData(result).value;
  assert.ok(Array.isArray(rules), "Network-rule result has no value array.");
  return rules;
}

async function waitForStep(phase, instruction) {
  await readline.question(
    `READY_FOR_${phase}: ${instruction}; press Enter to issue exactly this approval request.\n`,
  );
}

async function call(activeClient, name, args, timeout = 30_000) {
  return activeClient.callTool(
    { name, arguments: args },
    undefined,
    { timeout },
  );
}

function assertSuccess(result, label) {
  assert.equal(result.isError, false, `${label} failed: ${resultText(result)}`);
}

function assertDenied(result, label) {
  assert.equal(result.isError, true, `${label} unexpectedly succeeded.`);
  assert.match(
    resultText(result),
    /APPROVAL_DENIED/,
    `${label} failed for an unexpected reason: ${resultText(result)}`,
  );
}

function sessionRows(result) {
  assertSuccess(result, "browser_list_sessions");
  const sessions = resultData(result).sessions;
  assert.ok(Array.isArray(sessions), "Session result has no sessions array.");
  return sessions;
}

function resultData(result) {
  return result.structuredContent ?? {};
}

function resultText(result) {
  return Array.isArray(result.content)
    ? result.content
        .filter((item) => item?.type === "text")
        .map((item) => item.text)
        .join("\n")
    : "";
}

function ruleIds(rules) {
  return rules.map((rule) => rule.id).sort((left, right) => left - right);
}

function redactSessionId(sessionId) {
  return `redacted-${String(sessionId).slice(-8)}`;
}

function safeOrigin(value) {
  try {
    return new URL(String(value ?? "")).origin;
  } catch {
    return "unavailable";
  }
}

function readFlag(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
