import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const profileBUrlPrefix =
  readFlag("--profile-b-url-prefix") ??
  "http://127.0.0.1:8765/?profile=B";
const runApprovalProbe = process.argv.includes("--approval-profile-b");
const clients = [];

try {
  const adapterA = await startAdapter("profile-isolation-a");
  const adapterB = await startAdapter("profile-isolation-b");
  const firstSessions = await call(adapterA.client, "browser_list_sessions", {});
  const connected = sessionRows(firstSessions).filter(
    (session) => session.browserConnected === true,
  );
  assert.ok(
    connected.length >= 2,
    `Expected two browser-connected Profiles, received ${connected.length}.`,
  );

  const profileB = connected.find((session) =>
    String(session.activeTarget?.url ?? "").startsWith(profileBUrlPrefix),
  );
  assert.ok(
    profileB?.sessionId,
    "Profile B fixture is not the active target of any connected Profile.",
  );
  const profileA = connected.find(
    (session) => session.sessionId !== profileB.sessionId,
  );
  assert.ok(profileA?.sessionId, "A distinct Profile A session was not found.");

  await bind(adapterA.client, profileA.sessionId);
  await bind(adapterB.client, profileB.sessionId);

  const tabsA = tabRows(await call(adapterA.client, "browser_list_tabs", {}));
  const tabsB = tabRows(await call(adapterB.client, "browser_list_tabs", {}));
  assert.ok(
    tabsB.some((tab) => String(tab.url ?? "").startsWith(profileBUrlPrefix)),
    "Profile B adapter cannot see its fixture tab.",
  );
  assert.equal(
    tabsA.some((tab) => String(tab.url ?? "").startsWith(profileBUrlPrefix)),
    false,
    "Profile A adapter leaked Profile B's fixture tab.",
  );

  assert.equal(
    selectedSessionId(
      await call(adapterA.client, "browser_list_sessions", {}),
    ),
    profileA.sessionId,
  );
  assert.equal(
    selectedSessionId(
      await call(adapterB.client, "browser_list_sessions", {}),
    ),
    profileB.sessionId,
  );

  await bind(adapterB.client, profileA.sessionId);
  assert.equal(
    selectedSessionId(
      await call(adapterA.client, "browser_list_sessions", {}),
    ),
    profileA.sessionId,
    "Switching adapter B changed adapter A's binding.",
  );
  await bind(adapterB.client, profileB.sessionId);

  const unknown = await call(adapterB.client, "browser_set_session", {
    sessionId: "chrome-unknown-profile-isolation-probe",
  });
  assert.equal(unknown.isError, true, "Unknown session binding unexpectedly passed.");
  assert.match(resultText(unknown), /browser_list_sessions/i);

  const resourcesA = await adapterA.client.listResources();
  const profileAResource = resourcesA.resources.find((resource) =>
    String(resource.uri).includes(
      `/session/${encodeURIComponent(profileA.sessionId)}/`,
    ),
  );
  assert.ok(profileAResource?.uri, "Profile A advertised no session-bound resource.");
  await adapterA.client.readResource({ uri: profileAResource.uri });

  let crossProfileResourceOutcome = {
    denied: false,
    errorCode: null,
  };
  try {
    const response = await adapterB.client.readResource({
      uri: profileAResource.uri,
    });
    crossProfileResourceOutcome = resourceErrorOutcome(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    crossProfileResourceOutcome = {
      denied: true,
      errorCode: message.match(/\b[A-Z][A-Z_]{2,}\b/)?.[0] ?? "UNKNOWN",
    };
  }
  assert.deepEqual(
    crossProfileResourceOutcome,
    { denied: true, errorCode: "ROLE_FORBIDDEN" },
    `Cross-Profile resource result was not ROLE_FORBIDDEN: ${JSON.stringify(
      crossProfileResourceOutcome,
    )}`,
  );

  let profileBApprovalProbe = false;
  if (runApprovalProbe) {
    process.stderr.write(
      "WAITING_FOR_PROFILE_B_APPROVAL: approve only in Profile B; confirm Profile A has no approval card.\n",
    );
    const patch = await call(
      adapterB.client,
      "browser_apply_css_patch",
      {
        patchId: "profile-isolation-live-probe",
        css: ":root { --ai-devtools-profile-isolation-live-probe: 1; }",
      },
      24 * 60 * 60 * 1_000,
    );
    assertToolSuccess(patch, "Profile B approval probe");
    process.stderr.write(
      "WAITING_FOR_PROFILE_B_CLEANUP_APPROVAL: approve cleanup in Profile B.\n",
    );
    const cleanup = await call(
      adapterB.client,
      "browser_remove_css_patch",
      { patchId: "profile-isolation-live-probe" },
      24 * 60 * 60 * 1_000,
    );
    assertToolSuccess(cleanup, "Profile B approval probe cleanup");
    profileBApprovalProbe = true;
  }

  await adapterB.client.close();
  clients.splice(clients.indexOf(adapterB), 1);
  const survivingTabs = tabRows(
    await call(adapterA.client, "browser_list_tabs", {}),
  );
  assert.ok(survivingTabs.length > 0, "Adapter A stopped after adapter B closed.");
  const sessionsAfterClose = sessionRows(
    await call(adapterA.client, "browser_list_sessions", {}),
  );
  assert.equal(
    sessionsAfterClose.find(
      (session) => session.sessionId === profileB.sessionId,
    )?.browserConnected,
    true,
    "Closing adapter B disconnected Profile B from the daemon.",
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        connectedProfiles: connected.length,
        profileA: {
          id: redactSessionId(profileA.sessionId),
          tabCount: tabsA.length,
          activeOrigin: safeOrigin(profileA.activeTarget?.url),
        },
        profileB: {
          id: redactSessionId(profileB.sessionId),
          tabCount: tabsB.length,
          activeOrigin: safeOrigin(profileB.activeTarget?.url),
        },
        adapterBindingsIndependent: true,
        unknownSessionDenied: true,
        crossProfileResourceDenied: true,
        profileBApprovalProbe,
        adapterCloseIsolated: true,
        profileBStayedConnected: true,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await Promise.allSettled(clients.map(({ client }) => client.close()));
}

async function startAdapter(name) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/mcp/server.js"],
    env: {
      ...process.env,
      AI_DEVTOOLS_MCP_TOOL_PROFILE: "full",
    },
  });
  const client = new Client({ name, version: "1.0.0" });
  await client.connect(transport);
  const entry = { client, transport };
  clients.push(entry);
  return entry;
}

async function bind(client, sessionId) {
  const result = await call(client, "browser_set_session", { sessionId });
  assertToolSuccess(result, "browser_set_session");
}

async function call(client, name, args, timeout = 30_000) {
  return client.callTool(
    { name, arguments: args },
    undefined,
    { timeout },
  );
}

function assertToolSuccess(result, label) {
  assert.equal(
    result.isError,
    false,
    `${label} failed: ${resultText(result)}`,
  );
}

function sessionRows(result) {
  assertToolSuccess(result, "browser_list_sessions");
  const sessions = result.structuredContent?.sessions;
  assert.ok(Array.isArray(sessions), "Session result has no sessions array.");
  return sessions;
}

function tabRows(result) {
  assertToolSuccess(result, "browser_list_tabs");
  const tabs = result.structuredContent?.tabs;
  assert.ok(Array.isArray(tabs), "Tab result has no tabs array.");
  return tabs;
}

function selectedSessionId(result) {
  return sessionRows(result).find((session) => session.selected === true)?.sessionId;
}

function resultText(result) {
  return Array.isArray(result.content)
    ? result.content
        .filter((item) => item?.type === "text")
        .map((item) => item.text)
        .join("\n")
    : "";
}

function resourceErrorOutcome(response) {
  const text = Array.isArray(response?.contents)
    ? response.contents.find(
        (content) =>
          content?.mimeType === "application/json" &&
          typeof content.text === "string",
      )?.text
    : undefined;
  if (!text) {
    return { denied: false, errorCode: null };
  }
  try {
    const error = JSON.parse(text)?.error;
    const errorCode =
      typeof error === "string"
        ? error.match(/\b[A-Z][A-Z_]{2,}\b/)?.[0] ?? null
        : null;
    return {
      denied: errorCode !== null,
      errorCode,
    };
  } catch {
    return { denied: false, errorCode: null };
  }
}

function redactSessionId(sessionId) {
  return `redacted-${String(sessionId).slice(-8)}`;
}

function safeOrigin(value) {
  try {
    return new URL(String(value ?? "")).origin;
  } catch {
    return null;
  }
}

function readFlag(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1]?.trim() : undefined;
}
