import assert from "node:assert/strict";
import { createInterface } from "node:readline/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const profileUrlPrefix =
  readFlag("--profile-url-prefix") ?? "http://127.0.0.1:8765/?profile=B";
const networkRequestsToolName = "browser_network_requests";
const approvalTimeoutMs = 24 * 60 * 60 * 1_000;
const readline = createInterface({
  input: process.stdin,
  output: process.stderr,
});

let client;
let recordingActive = false;

try {
  client = await startAdapter();
  await assertNetworkPaginationToolAdvertised(client);
  const sessions = sessionRows(
    await call(client, "browser_list_sessions", {}),
  ).filter((session) => session.browserConnected === true);
  const { profile, target } = await selectProfileTarget(
    client,
    sessions,
    profileUrlPrefix,
  );

  await startRecording(client);
  await waitForManualReload("FIRST");
  await stopRecording(client);

  const firstPage = await readNetworkPage(
    client,
    { limit: 2 },
    "FIRST_PAGE",
  );
  assertSuccess(firstPage, "first Network page");
  const firstData = resultData(firstPage);
  const firstCursor = firstData.pagination?.nextCursor;
  assert.equal(
    typeof firstCursor,
    "string",
    `Expected more than one Network page, received ${String(
      firstData.pagination?.totalCount ?? "unknown",
    )} requests.`,
  );

  const requestIds = new Set();
  let page = firstData;
  let pageCount = 0;
  while (true) {
    pageCount += 1;
    assert.ok(pageCount <= 100, "Network pagination exceeded 100 pages.");
    for (const request of page.requests ?? []) {
      assert.equal(
        requestIds.has(request.requestId),
        false,
        `Network request repeated across pages: ${request.requestId}`,
      );
      requestIds.add(request.requestId);
    }
    const nextCursor = page.pagination?.nextCursor;
    if (typeof nextCursor !== "string") {
      break;
    }
    const next = await readNetworkPage(
      client,
      {
        cursor: nextCursor,
        limit: 2,
      },
      `PAGE_${pageCount + 1}`,
    );
    assertSuccess(next, `Network page ${pageCount + 1}`);
    page = resultData(next);
  }

  assert.ok(
    requestIds.size >= 3,
    `Expected at least three recorded requests, received ${requestIds.size}.`,
  );

  await startRecording(client);
  await waitForManualReload("SECOND");
  const stale = await readNetworkPage(
    client,
    {
      cursor: firstCursor,
      limit: 2,
    },
    "STALE_CURSOR",
  );
  assert.equal(stale.isError, true, "Old Network cursor unexpectedly succeeded.");
  assert.match(
    resultText(stale),
    /STALE_PAGINATION_CURSOR/,
    `Old cursor failed for an unexpected reason: ${resultText(stale)}`,
  );
  await stopRecording(client);

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        profile: {
          id: redactSessionId(profile.sessionId),
          activeOrigin: safeOrigin(target.url),
        },
        pageSize: 2,
        pageCount,
        uniqueRequests: requestIds.size,
        noRequestRepeats: true,
        staleCursorRejected: true,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  readline.close();
  if (recordingActive && client) {
    try {
      await stopRecording(client, "CLEANUP");
    } catch (error) {
      process.stderr.write(
        `WARNING: Network recording cleanup failed: ${String(error)}\n`,
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
    name: "network-pagination-live",
    version: "1.0.0",
  });
  await nextClient.connect(transport);
  return nextClient;
}

async function assertNetworkPaginationToolAdvertised(activeClient) {
  const listed = await activeClient.listTools();
  const networkTools = listed.tools
    .map((tool) => tool.name)
    .filter((name) => name.startsWith("browser_network_"));
  assert.ok(
    networkTools.includes(networkRequestsToolName),
    `${networkRequestsToolName} is not advertised by the full MCP profile. ` +
      `Advertised Network tools: ${networkTools.join(", ") || "none"}.`,
  );
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

async function startRecording(activeClient) {
  process.stderr.write(
    "WAITING_FOR_NETWORK_START_APPROVAL: approve in the target Profile.\n",
  );
  const result = await call(
    activeClient,
    "browser_network_start_recording",
    { preserveLog: false, maxEntries: 200 },
    approvalTimeoutMs,
  );
  assertSuccess(result, "browser_network_start_recording");
  recordingActive = true;
}

async function stopRecording(activeClient, phase = "NORMAL") {
  process.stderr.write(
    `STOPPING_NETWORK_RECORDING_${phase}: no approval is required.\n`,
  );
  const result = await call(
    activeClient,
    "browser_network_stop_recording",
    {},
    approvalTimeoutMs,
  );
  assertSuccess(result, "browser_network_stop_recording");
  recordingActive = false;
}

async function readNetworkPage(activeClient, args, phase) {
  process.stderr.write(
    `WAITING_FOR_NETWORK_READ_APPROVAL_${phase}: approve the raw Network read in the target Profile.\n`,
  );
  return call(
    activeClient,
    networkRequestsToolName,
    args,
    approvalTimeoutMs,
  );
}

async function waitForManualReload(phase) {
  await readline.question(
    `READY_FOR_${phase}_RELOAD: reload the fixture tab, wait for it to finish, then press Enter here.\n`,
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
