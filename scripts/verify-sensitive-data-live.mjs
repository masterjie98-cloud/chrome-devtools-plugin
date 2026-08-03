import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const profileUrlPrefix =
  readFlag("--profile-url-prefix") ?? "http://127.0.0.1:8765/?profile=A";
const skipValueGates = process.argv.includes("--skip-value-gates");
const approvalTimeoutMs = 24 * 60 * 60 * 1_000;
const marker = {
  localKey: "manual-sensitive-local",
  localValue: "manual-local-value",
  sessionKey: "manual-sensitive-session",
  sessionValue: "manual-session-value",
  cookieName: "manual_sensitive_cookie",
  cookieValue: "manual-cookie-value",
  mutationCookieName: "manual_mutation_cookie",
  mutationCookieValue: "manual-mutation-value",
  queryValue: "manual-query-marker",
  headerValue: "manual-header-marker",
  bodyValue: "manual-response-body-marker",
};
const forbiddenPersistedValues = [
  marker.localValue,
  marker.sessionValue,
  marker.cookieValue,
  marker.mutationCookieValue,
  marker.queryValue,
  marker.headerValue,
  marker.bodyValue,
];

let client;
let recordingActive = false;
let markersSeeded = false;
let markersCleared = false;

try {
  client = await startAdapter();
  const { profile, target } = await selectProfileTarget(client);
  process.stderr.write(
    `SENSITIVE_TARGET: profile=${redactSessionId(profile.sessionId)} tab=${target.id} origin=${new URL(target.url).origin}\n`,
  );

  process.stderr.write(
    "ALLOW_NETWORK_START: allow bounded Network recording in Profile A.\n",
  );
  assertSuccess(
    await call("browser_network_start_recording", {
      preserveLog: false,
      maxEntries: 200,
    }),
    "Network recording start",
  );
  recordingActive = true;

  process.stderr.write(
    "ALLOW_SEED_MARKERS: allow one click on the disposable fixture seed button.\n",
  );
  assertSuccess(
    await call("browser_click", { selector: "#seed-sensitive-markers" }),
    "seed disposable markers",
  );
  markersSeeded = true;
  await waitForVisibleText("disposable markers seeded");

  if (!skipValueGates) {
    process.stderr.write(
      "ALLOW_STORAGE_KEYS_ONLY: allow Storage metadata without values.\n",
    );
    const storageKeysOnly = await call("browser_storage_state", {
      includeValues: false,
    });
    assertSuccess(storageKeysOnly, "Storage keys-only read");
    const storageKeysText = json(storageKeysOnly.structuredContent);
    assert.equal(storageKeysOnly.structuredContent?.valuesIncluded, false);
    assert.match(storageKeysText, new RegExp(marker.localKey));
    assert.match(storageKeysText, new RegExp(marker.sessionKey));
    assertDoesNotContainValues(storageKeysText, [
      marker.localValue,
      marker.sessionValue,
      marker.cookieValue,
    ]);

    process.stderr.write(
      "DENY_STORAGE_VALUES: deny the first Storage includeValues request.\n",
    );
    assertDenied(
      await call("browser_storage_state", { includeValues: true }),
      "denied Storage values read",
    );

    process.stderr.write(
      "ALLOW_STORAGE_VALUES: allow the second Storage includeValues request.\n",
    );
    const storageValues = await call("browser_storage_state", {
      includeValues: true,
    });
    assertSuccess(storageValues, "approved Storage values read");
    const storageValuesText = json(storageValues.structuredContent);
    assert.equal(storageValues.structuredContent?.valuesIncluded, true);
    assertContainsValues(storageValuesText, [
      marker.localValue,
      marker.sessionValue,
      marker.cookieValue,
    ]);

    process.stderr.write(
      "ALLOW_COOKIE_NAMES_ONLY: allow Cookie metadata without values.\n",
    );
    const cookieNamesOnly = await call("browser_cookie_list", {
      includeValues: false,
    });
    assertSuccess(cookieNamesOnly, "Cookie names-only read");
    const cookieNamesText = json(cookieNamesOnly.structuredContent);
    assert.match(cookieNamesText, new RegExp(marker.cookieName));
    assertDoesNotContainValues(cookieNamesText, [marker.cookieValue]);

    process.stderr.write(
      "DENY_COOKIE_VALUES: deny the first Cookie includeValues request.\n",
    );
    assertDenied(
      await call("browser_cookie_list", { includeValues: true }),
      "denied Cookie values read",
    );

    process.stderr.write(
      "ALLOW_COOKIE_VALUES: allow the second Cookie includeValues request.\n",
    );
    const cookieValues = await call("browser_cookie_list", {
      includeValues: true,
    });
    assertSuccess(cookieValues, "approved Cookie values read");
    assertContainsValues(json(cookieValues.structuredContent), [
      marker.cookieValue,
    ]);
  }

  const cookieUrl = `${new URL(target.url).origin}/`;
  process.stderr.write(
    "ALLOW_COOKIE_SET: allow the disposable mutation Cookie write.\n",
  );
  assertSuccess(
    await call("browser_cookie_set", {
      url: cookieUrl,
      name: marker.mutationCookieName,
      value: marker.mutationCookieValue,
    }),
    "Cookie set",
  );

  process.stderr.write(
    "ALLOW_COOKIE_DELETE: allow deletion of the same disposable mutation Cookie.\n",
  );
  assertSuccess(
    await call("browser_cookie_delete", {
      url: cookieUrl,
      name: marker.mutationCookieName,
    }),
    "Cookie delete",
  );

  process.stderr.write(
    "ALLOW_NETWORK_METADATA: allow the bounded sensitive fixture Network list.\n",
  );
  const networkPage = await call("browser_network_requests", {
    urlContains: "sensitive-fixture.json",
    limit: 20,
  });
  assertSuccess(networkPage, "Network request list");
  const networkText = json(networkPage.structuredContent);
  assertDoesNotContainNamedValues(networkText, {
    query: marker.queryValue,
    requestHeader: marker.headerValue,
    responseBody: marker.bodyValue,
  });
  assert.match(networkText, /redacted/i);
  const sensitiveRequest = networkPage.structuredContent?.requests?.find(
    (request) =>
      typeof request?.requestId === "string" &&
      String(request?.url ?? "").includes("sensitive-fixture.json"),
  );
  assert.ok(
    sensitiveRequest?.requestId,
    "The recorded sensitive fixture request was not found.",
  );

  process.stderr.write(
    "ALLOW_NETWORK_DETAILS: allow one sanitized request-details read.\n",
  );
  const networkDetails = await call("browser_network_get_request", {
    requestId: sensitiveRequest.requestId,
  });
  assertSuccess(networkDetails, "Network request details");
  const networkDetailsText = json(networkDetails.structuredContent);
  assertDoesNotContainValues(networkDetailsText, [
    marker.queryValue,
    marker.headerValue,
    marker.bodyValue,
  ]);
  assert.match(networkDetailsText, /redacted/i);

  process.stderr.write(
    "DENY_RESPONSE_BODY: deny the first response-body request.\n",
  );
  assertDenied(
    await call("browser_network_get_response_body", {
      requestId: sensitiveRequest.requestId,
    }),
    "denied response-body read",
  );

  process.stderr.write(
    "ALLOW_RESPONSE_BODY: allow the second response-body request.\n",
  );
  const responseBody = await call("browser_network_get_response_body", {
    requestId: sensitiveRequest.requestId,
  });
  assertSuccess(responseBody, "approved response-body read");
  assertContainsValues(json(responseBody.structuredContent), [
    marker.bodyValue,
  ]);

  assertSuccess(
    await call("browser_network_stop_recording", {}),
    "Network recording stop",
  );
  recordingActive = false;

  process.stderr.write(
    "ALLOW_AUDIT_METADATA: allow a bounded audit read to verify persisted redaction.\n",
  );
  const audit = await call("browser_get_audit_events", { limit: 100 });
  assertSuccess(audit, "audit redaction read");
  const auditText = json(audit.structuredContent);
  assertDoesNotContainValues(auditText, forbiddenPersistedValues);

  await clearMarkers();
  process.stderr.write(
    "ALLOW_POST_CLEANUP_METADATA: allow one final keys-only Storage verification.\n",
  );
  const clearedState = await call("browser_storage_state", {
    includeValues: false,
  });
  assertSuccess(clearedState, "post-cleanup Storage metadata read");
  const clearedStateText = json(clearedState.structuredContent);
  assert.doesNotMatch(clearedStateText, new RegExp(marker.localKey));
  assert.doesNotMatch(clearedStateText, new RegExp(marker.sessionKey));
  assert.doesNotMatch(clearedStateText, new RegExp(marker.cookieName));
  assert.doesNotMatch(clearedStateText, new RegExp(marker.mutationCookieName));

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        profile: redactSessionId(profile.sessionId),
        targetOrigin: new URL(target.url).origin,
        storageValuesGated: skipValueGates ? "prior-phase" : true,
        cookieValuesGated: skipValueGates ? "prior-phase" : true,
        cookieMutationsSeparatelyApproved: true,
        networkMetadataRedacted: true,
        responseBodyDeniedThenApproved: true,
        persistedAuditRedacted: true,
        disposableMarkersCleared: true,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  if (client) {
    if (recordingActive) {
      await call("browser_network_stop_recording", {}).catch(() => undefined);
      recordingActive = false;
    }
    if (markersSeeded && !markersCleared) {
      await clearMarkers().catch(() => undefined);
    }
    await client.close();
  }
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
    name: "sensitive-data-live-verifier",
    version: "1.0.0",
  });
  await nextClient.connect(transport);
  return nextClient;
}

async function selectProfileTarget(activeClient) {
  const sessionsResult = await call("browser_list_sessions", {});
  assertSuccess(sessionsResult, "browser_list_sessions");
  const sessions = Array.isArray(sessionsResult.structuredContent?.sessions)
    ? sessionsResult.structuredContent.sessions
    : [];
  for (const profile of sessions) {
    if (profile?.browserConnected !== true || !profile.sessionId) {
      continue;
    }
    assertSuccess(
      await call("browser_set_session", { sessionId: profile.sessionId }),
      "browser_set_session",
    );
    const tabsResult = await call("browser_list_tabs", {});
    assertSuccess(tabsResult, "browser_list_tabs");
    const target = tabsResult.structuredContent?.tabs?.find((tab) =>
      String(tab?.url ?? "").startsWith(profileUrlPrefix),
    );
    if (!target || !Number.isSafeInteger(target.id)) {
      continue;
    }
    assertSuccess(
      await call("browser_set_target_tab", { tabId: target.id }),
      "browser_set_target_tab",
    );
    return { profile, target };
  }
  throw new Error(
    `No connected Profile contains the verification tab ${profileUrlPrefix}.`,
  );
}

async function clearMarkers() {
  process.stderr.write(
    "ALLOW_CLEAR_MARKERS: allow one click to clear all disposable fixture markers.\n",
  );
  assertSuccess(
    await call("browser_click", { selector: "#clear-sensitive-markers" }),
    "clear disposable markers",
  );
  await waitForVisibleText("disposable markers cleared");
  markersCleared = true;
}

async function waitForVisibleText(value) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = await call("browser_verify", {
      checks: [{ id: "fixture-status", type: "text_contains", value }],
    });
    assertSuccess(result, "fixture status verification");
    if (result.structuredContent?.passed === true) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Fixture did not reach its expected bounded status.`);
}

async function call(name, args) {
  return client.callTool(
    { name, arguments: args },
    undefined,
    { timeout: approvalTimeoutMs },
  );
}

function assertSuccess(result, label) {
  assert.equal(
    result.isError,
    false,
    `${label} failed: ${resultText(result) || json(result.structuredContent)}`,
  );
}

function assertDenied(result, label) {
  assert.equal(result.isError, true, `${label} unexpectedly succeeded.`);
  assert.match(resultText(result), /APPROVAL_DENIED|user denied/i);
}

function assertContainsValues(text, values) {
  for (const value of values) {
    assert.ok(text.includes(value), "An approved disposable value was omitted.");
  }
}

function assertDoesNotContainValues(text, values) {
  for (const value of values) {
    assert.equal(
      text.includes(value),
      false,
      "A disposable value escaped a redaction boundary.",
    );
  }
}

function assertDoesNotContainNamedValues(text, values) {
  const leakedFields = Object.entries(values)
    .filter(([, value]) => text.includes(value))
    .map(([name]) => name);
  assert.deepEqual(
    leakedFields,
    [],
    `Disposable values escaped the redaction boundary: ${leakedFields.join(", ")}`,
  );
}

function resultText(result) {
  return Array.isArray(result.content)
    ? result.content
        .filter((item) => item?.type === "text")
        .map((item) => item.text)
        .join("\n")
    : "";
}

function json(value) {
  return JSON.stringify(value ?? null);
}

function readFlag(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1]?.trim() : undefined;
}

function redactSessionId(sessionId) {
  return `redacted-${String(sessionId).slice(-8)}`;
}
