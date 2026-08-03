import assert from "node:assert/strict";
import { createInterface } from "node:readline/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const profileUrlPrefix =
  readFlag("--profile-url-prefix") ?? "http://127.0.0.1:8765/?profile=A";
const approvalTimeout = 24 * 60 * 60 * 1_000;
const readline = createInterface({
  input: process.stdin,
  output: process.stderr,
});

let client;

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
  process.stderr.write(
    `DIALOG_TARGET: profile=${redactSessionId(profile.sessionId)} tab=${target.id} url=${target.url}\n`,
  );

  await waitForManualStep(
    "OPEN_CONFIRM",
    "click the fixture's Open confirm button and leave the native dialog open",
  );
  const dismissedConfirm = await handleDialog("dismiss", undefined, "DISMISS_CONFIRM");
  assertSuccess(dismissedConfirm, "dismiss current confirm");
  assert.equal(resultData(dismissedConfirm).handled, true);
  await assertDialogStatus("confirm dismissed");

  await waitForManualStep(
    "OPEN_PROMPT",
    "click the fixture's Open prompt button and leave the native dialog open",
  );
  const acceptedPrompt = await handleDialog(
    "accept",
    "approved value",
    "ACCEPT_PROMPT",
  );
  assertSuccess(acceptedPrompt, "accept current prompt");
  assert.equal(resultData(acceptedPrompt).handled, true);
  await assertDialogStatus("prompt accepted: approved value");

  await waitForManualStep(
    "NO_DIALOG_CALL",
    "leave the page with no dialog open; the next approved call must fail closed",
  );
  const noDialog = await handleDialog("dismiss", undefined, "NO_DIALOG");
  assert.equal(noDialog.isError, true, "No-dialog call unexpectedly succeeded.");
  assert.match(
    resultText(noDialog),
    /NO_JAVASCRIPT_DIALOG/,
    `No-dialog call failed for an unexpected reason: ${resultText(noDialog)}`,
  );

  await waitForManualStep(
    "OPEN_FUTURE_CONFIRM",
    "click Open confirm again and confirm it remains visibly open before continuing",
  );
  const futureConfirm = await handleDialog(
    "dismiss",
    undefined,
    "DISMISS_FUTURE_CONFIRM",
  );
  assertSuccess(futureConfirm, "dismiss future confirm");
  await assertDialogStatus("confirm dismissed");

  await waitForManualStep(
    "VERIFY_NATIVE_CONFIRM",
    "leave the page idle; approve one read-only V8 side-effect-checked expression",
  );
  process.stderr.write(
    "WAITING_FOR_NATIVE_CONFIRM_READ_APPROVAL: approve browser_evaluate.\n",
  );
  const nativeConfirm = await call(
    client,
    "browser_evaluate",
    {
      expression: "window.confirm.toString()",
      throwOnSideEffect: true,
    },
    approvalTimeout,
  );
  assertSuccess(nativeConfirm, "read native confirm source");
  const functionSource = String(
    resultData(nativeConfirm).result?.value ??
      resultData(nativeConfirm).result?.description ??
      "",
  );
  assert.match(
    functionSource,
    /\[native code\]/,
    `window.confirm no longer appears native: ${functionSource}`,
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        profile: {
          id: redactSessionId(profile.sessionId),
          activeOrigin: safeOrigin(target.url),
        },
        confirmDismissed: true,
        promptAcceptedWithText: true,
        noDialogRejected: true,
        futureDialogNotPreconfigured: true,
        nativeConfirmPreserved: true,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  readline.close();
  await client?.close().catch(() => undefined);
}

async function handleDialog(action, promptText, phase) {
  process.stderr.write(
    `WAITING_FOR_DIALOG_APPROVAL_${phase}: approve browser_handle_dialog.\n`,
  );
  return call(
    client,
    "browser_handle_dialog",
    {
      action,
      ...(promptText === undefined ? {} : { promptText }),
    },
    approvalTimeout,
  );
}

async function assertDialogStatus(expectedText) {
  const result = await call(
    client,
    "browser_query_dom",
    {
      query: "#dialog-result",
      limit: 1,
      includeOuterHTML: true,
    },
    approvalTimeout,
  );
  assertSuccess(result, "read fixture dialog status");
  const element = resultData(result).elements?.[0];
  const evidence = [
    element?.text,
    element?.textContent,
    element?.innerText,
    element?.outerHTML,
  ]
    .filter((value) => typeof value === "string")
    .join("\n");
  assert.match(
    evidence,
    new RegExp(escapeRegExp(expectedText)),
    `Fixture dialog status did not contain "${expectedText}": ${evidence}`,
  );
}

async function waitForManualStep(phase, instruction) {
  await readline.question(
    `READY_FOR_${phase}: ${instruction}; press Enter when ready.\n`,
  );
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
    name: "dialog-live",
    version: "1.0.0",
  });
  await nextClient.connect(transport);
  return nextClient;
}

async function selectProfileTarget(activeClient, sessions, urlPrefix) {
  const candidates = [];
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
    const targets = (resultData(tabsResult).tabs ?? []).filter(
      (tab) =>
        Number.isSafeInteger(tab?.id) &&
        String(tab?.url ?? "").startsWith(urlPrefix),
    );
    for (const target of targets) {
      candidates.push({ profile, target });
    }
  }
  assert.equal(
    candidates.length,
    1,
    candidates.length === 0
      ? `No connected Profile contains the verification Tab ${urlPrefix}.`
      : `Expected exactly one verification Tab ${urlPrefix}, found ${candidates.length}. Close duplicate fixture Tabs or use a more specific --profile-url-prefix.`,
  );
  const selected = candidates[0];
  assertSuccess(
    await call(activeClient, "browser_set_session", {
      sessionId: selected.profile.sessionId,
    }),
    "browser_set_session",
  );
  assertSuccess(
    await call(activeClient, "browser_set_target_tab", {
      tabId: selected.target.id,
    }),
    "browser_set_target_tab",
  );
  return selected;
}

async function call(activeClient, name, args, timeout = 30_000) {
  return activeClient.callTool(
    { name, arguments: args },
    undefined,
    { timeout },
  );
}

function sessionRows(result) {
  assertSuccess(result, "browser_list_sessions");
  const sessions = resultData(result).sessions;
  assert.ok(Array.isArray(sessions), "Session result has no sessions array.");
  return sessions;
}

function assertSuccess(result, label) {
  assert.equal(result.isError, false, `${label} failed: ${resultText(result)}`);
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

function readFlag(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function redactSessionId(sessionId) {
  return `redacted-${String(sessionId).slice(-8)}`;
}

function safeOrigin(url) {
  try {
    return new URL(String(url)).origin;
  } catch {
    return "";
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
