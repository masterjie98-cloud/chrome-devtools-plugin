import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const prefixFlag = process.argv.indexOf("--tab-url-prefix");
const phaseFlag = process.argv.indexOf("--phase");
const tabUrlPrefix =
  prefixFlag >= 0 ? process.argv[prefixFlag + 1]?.trim() : undefined;
const phase = phaseFlag >= 0 ? process.argv[phaseFlag + 1]?.trim() : "ordinary";
const phases = new Set([
  "ordinary",
  "risk",
  "revoke",
  "audit",
  "audit-grants",
  "audit-created",
]);
const LONG_APPROVAL_TIMEOUT_MS = 24 * 60 * 60 * 1000;

if (
  !tabUrlPrefix ||
  !/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\//.test(tabUrlPrefix)
) {
  throw new Error(
    "Pass --tab-url-prefix with an already-open loopback regression page.",
  );
}
if (!phase || !phases.has(phase)) {
  throw new Error(
    "--phase must be ordinary, risk, revoke, audit, audit-grants, or audit-created.",
  );
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/mcp/server.js"],
  env: {
    ...process.env,
    AI_DEVTOOLS_MCP_TOOL_PROFILE: "full",
  },
});
const client = new Client({
  name: "execution-core-regression",
  version: "1.0.0",
});

try {
  await client.connect(transport);
  const target = await selectTarget();
  const result =
    phase === "ordinary"
      ? await runOrdinaryRegression()
      : phase === "risk"
        ? await runRiskRegression()
        : phase === "revoke"
          ? await runRevocationProbe()
          : phase === "audit"
            ? await runAuditRegression()
            : phase === "audit-grants"
              ? await runGrantAuditRegression()
              : await runGrantCreatedAuditRegression();
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        phase,
        target: {
          origin: new URL(target.url).origin,
          title: target.title,
        },
        ...result,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await client.close();
}

async function selectTarget() {
  const sessionsResult = await call("browser_list_sessions", {});
  const sessions = sessionsResult.structuredContent?.sessions;
  const connectedSession = Array.isArray(sessions)
    ? sessions.find(
        (session) =>
          session &&
          typeof session === "object" &&
          session.browserConnected === true &&
          String(session.activeTarget?.url ?? "").startsWith(tabUrlPrefix),
      ) ??
      sessions.find(
        (session) =>
          session &&
          typeof session === "object" &&
          session.browserConnected === true,
      )
    : undefined;
  if (
    connectedSession &&
    typeof connectedSession === "object" &&
    typeof connectedSession.sessionId === "string"
  ) {
    // Resource subscriptions require an explicit adapter-owned binding even
    // when the daemon exposes the same Profile as its active fallback.
    await call("browser_set_session", {
      sessionId: connectedSession.sessionId,
    });
  }
  if (
    phase.startsWith("audit") &&
    connectedSession &&
    typeof connectedSession === "object" &&
    connectedSession.activeTarget &&
    typeof connectedSession.activeTarget === "object" &&
    typeof connectedSession.activeTarget.url === "string"
  ) {
    return {
      id: connectedSession.activeTarget.tabId,
      url: connectedSession.activeTarget.url,
      title: connectedSession.activeTarget.title,
    };
  }

  const tabsResult = await call("browser_list_tabs", {});
  const tabs = tabsResult.structuredContent?.tabs;
  const target = Array.isArray(tabs)
    ? tabs.find((tab) => String(tab?.url ?? "").startsWith(tabUrlPrefix))
    : undefined;
  if (!target || !Number.isSafeInteger(target.id)) {
    const visibleTargets = Array.isArray(tabs)
      ? tabs.slice(0, 20).map((tab) => ({
          id: tab?.id,
          title: tab?.title,
          origin: safeOrigin(tab?.url),
        }))
      : [];
    throw new Error(
      `The loopback regression tab is not open in the connected Profile. Connected sessions: ${JSON.stringify(
        Array.isArray(sessions)
          ? sessions.map((session) =>
              session && typeof session === "object"
                ? {
                    browserConnected: session.browserConnected,
                    uiConnected: session.uiConnected,
                    selected: session.selected,
                    origin: safeOrigin(session.activeTarget?.url),
                  }
                : session,
            )
          : [],
      )}. Session result keys: ${JSON.stringify(
        Object.keys(sessionsResult),
      )}. Session content: ${JSON.stringify(
        Array.isArray(sessionsResult.content)
          ? sessionsResult.content.slice(0, 2)
          : sessionsResult.content,
      ).slice(0, 1200)}. Visible targets: ${JSON.stringify(visibleTargets)}`,
    );
  }
  await call("browser_set_target_tab", { tabId: target.id });
  return target;
}

function safeOrigin(value) {
  try {
    return new URL(String(value ?? "")).origin;
  } catch {
    return "<invalid>";
  }
}

async function runOrdinaryRegression() {
  const baseline = await call("browser_observe", {
    limit: 60,
    mode: "interactive",
    sourceLimit: 2000,
  });
  assertToolSuccess(baseline, "baseline observation");
  const baselineRevision = Number(
    baseline.structuredContent?.observation?.domRevision ?? 0,
  );
  const baselineNodes = baseline.structuredContent?.snapshot?.nodes;
  const targetRef = (name, selector) => {
    const ref = Array.isArray(baselineNodes)
      ? baselineNodes.find(
          (node) => node?.name === name || node?.selector === selector,
        )?.targetRef
      : undefined;
    if (typeof ref !== "string") {
      throw new Error(`Missing targetRef for ${name} (${selector}).`);
    }
    return ref;
  };

  process.stdout.write(
    "WAITING_FOR_TASK_APPROVAL: choose current conversation/domain, then allow.\n",
  );
  const stage = await call("browser_act", {
    actions: [
      {
        id: "name",
        type: "fill",
        ref: targetRef("姓名", "#benchmark-name"),
        value: "Ada",
      },
      {
        id: "team",
        type: "fill",
        ref: targetRef("团队", "#benchmark-team"),
        value: "Execution Core",
      },
      {
        id: "role",
        type: "select",
        ref: targetRef("角色", "#benchmark-role"),
        values: ["developer"],
      },
      {
        id: "note",
        type: "fill",
        ref: targetRef("备注", "#benchmark-note"),
        value: "v5 regression",
      },
      {
        id: "drawer",
        type: "click",
        ref: targetRef("打开抽屉", "#open-drawer"),
        dependsOn: ["name", "team", "role", "note"],
        expectedOutcome: "#drawer becomes visible",
      },
    ],
  });
  assertToolSuccess(stage, "ordinary action stage");

  const networkStart = await call("browser_network_start_recording", {
    preserveLog: false,
    maxEntries: 100,
  });
  assertToolSuccess(networkStart, "Network start");
  const afterDrawer = await call("browser_observe", {
    limit: 60,
    mode: "interactive",
    sourceLimit: 2000,
    ...(baselineRevision > 0 ? { sinceRevision: baselineRevision } : {}),
  });
  assertToolSuccess(afterDrawer, "post-action observation");
  const afterDrawerNodes = afterDrawer.structuredContent?.snapshot?.nodes;
  const networkRef = Array.isArray(afterDrawerNodes)
    ? afterDrawerNodes.find((node) => node?.name === "请求状态")?.targetRef
    : undefined;
  if (typeof networkRef !== "string") {
    throw new Error("Missing fresh targetRef for 请求状态.");
  }
  const networkClick = await call("browser_act", {
    actions: [
      {
        id: "network",
        type: "click",
        ref: networkRef,
        expectedOutcome: "status becomes network-complete",
      },
    ],
  });
  assertToolSuccess(networkClick, "Network action");
  await call("browser_wait_for", { time: 0.25 });
  const debugActivity = await call("browser_debug_activity", {
    includeNetwork: true,
    includeConsole: true,
    networkLimit: 50,
    consoleLimit: 20,
  });
  assertToolSuccess(debugActivity, "debug activity");
  const networkStop = await call("browser_network_stop_recording", {});
  assertToolSuccess(networkStop, "Network stop");

  const verification = await call("browser_verify", {
    ...(baselineRevision > 0 ? { sinceRevision: baselineRevision } : {}),
    checks: [
      { id: "drawer", type: "text_contains", value: "抽屉操作 1" },
      { id: "network", type: "text_contains", value: "network-complete" },
    ],
  });
  assertToolSuccess(verification, "outcome verification");
  if (verification.structuredContent?.passed !== true) {
    throw new Error(
      `Outcome verification failed: ${JSON.stringify(verification.structuredContent)}`,
    );
  }

  const stageData = stage.structuredContent ?? {};
  const activity = debugActivity.structuredContent ?? {};
  const digest = activity.network ?? {};
  const verified = verification.structuredContent ?? {};
  return {
    actionStage: {
      completed: stageData.completed,
      failed: stageData.failed,
      stoppedAt: stageData.stoppedAt ?? null,
    },
    network: {
      rawReturned: Array.isArray(digest.requests) ? digest.requests.length : null,
      observedRequests: digest.activityDigest?.observedRequests ?? null,
      groups: digest.activityDigest?.groups ?? [],
    },
    domDelta: {
      baselineRevision,
      currentRevision: verified.domRevision ?? null,
      delta: verified.delta ?? null,
    },
    verification: {
      passed: verified.passed,
      checks: verified.checks,
    },
  };
}

async function runRiskRegression() {
  const first = await call("browser_execute_action_stage", {
    actions: [
      {
        id: "opaque-submit",
        type: "click",
        selector: ".primary-action",
      },
    ],
  });
  const firstText = JSON.stringify(first.structuredContent ?? first.content ?? {});
  if (!firstText.includes("DECISION_BARRIER_REQUIRED")) {
    throw new Error(
      "Opaque submit target did not fail closed with DECISION_BARRIER_REQUIRED.",
    );
  }

  process.stdout.write(
    "WAITING_FOR_DECISION_BARRIER: reject the separate high-risk approval card.\n",
  );
  const retry = await call("browser_execute_action_stage", {
    actions: [
      {
        id: "opaque-submit",
        type: "click",
        selector: ".primary-action",
      },
    ],
    decisionBarrier: true,
  });
  if (!retry.isError) {
    throw new Error("The high-risk retry was not denied by the user.");
  }
  return {
    executorPreflight: "DECISION_BARRIER_REQUIRED",
    approvedMutationBeforeBarrier: false,
    retryDenied: true,
  };
}

async function runRevocationProbe() {
  process.stdout.write(
    "WAITING_FOR_REVOKED_GRANT_PROBE: after revoking the active task grant, reject this ordinary approval card.\n",
  );
  const result = await call("browser_click", { selector: "#network-action" });
  if (!result.isError) {
    throw new Error("The ordinary action executed without a fresh approval after revoke.");
  }
  return { freshApprovalAfterRevokeDenied: true };
}

async function runAuditRegression() {
  process.stdout.write(
    "WAITING_FOR_AUDIT_APPROVAL: allow the bounded redacted audit metadata read.\n",
  );
  const page = await call("browser_get_audit_events", { limit: 100 });
  assertToolSuccess(page, "audit metadata");
  const lifecyclePageEvents = Array.isArray(page.structuredContent?.events)
    ? page.structuredContent.events
    : [];
  const lifecycleEvents = lifecyclePageEvents.filter(
    (event) =>
      event?.eventType === "tool.completed" &&
      [
        "approvalWaitMs",
        "queueWaitMs",
        "executorMs",
        "transportMs",
        "totalMs",
        "resultChars",
        "payloadBytes",
      ].every(
        (field) =>
          Number.isSafeInteger(event?.[field]) && Number(event[field]) >= 0,
      ),
  );
  let grantEvents = lifecyclePageEvents.filter(
    (event) => event?.toolName === "task_capability_grant",
  );
  if (grantEvents.length === 0) {
    process.stdout.write(
      "WAITING_FOR_GRANT_AUDIT_APPROVAL: allow the filtered task-grant lifecycle read.\n",
    );
    const grantPage = await call("browser_get_audit_events", {
      limit: 100,
      toolName: "task_capability_grant",
    });
    assertToolSuccess(grantPage, "task-grant audit metadata");
    grantEvents = Array.isArray(grantPage.structuredContent?.events)
      ? grantPage.structuredContent.events
      : [];
  }
  const grantCreated = grantEvents.filter(
    (event) => event?.eventType === "grant.created",
  ).length;
  const grantRevoked = grantEvents.filter(
    (event) => event?.eventType === "grant.revoked",
  ).length;
  if (grantCreated < 1 || grantRevoked < 1) {
    throw new Error(
      `Expected grant lifecycle events, got created=${grantCreated} revoked=${grantRevoked}.`,
    );
  }
  if (lifecycleEvents.length < 1) {
    throw new Error("No completed tool event contained all lifecycle metrics.");
  }
  return {
    audit: {
      lifecyclePageEvents: lifecyclePageEvents.length,
      grantPageEvents: grantEvents.length,
      grantCreated,
      grantRevoked,
      lifecycleMetricEvents: lifecycleEvents.length,
      latestLifecycleMetrics: lifecycleEvents.slice(-5).map((event) => ({
        toolName: event.toolName,
        approvalWaitMs: event.approvalWaitMs,
        queueWaitMs: event.queueWaitMs,
        executorMs: event.executorMs,
        transportMs: event.transportMs,
        totalMs: event.totalMs,
        resultChars: event.resultChars,
        payloadBytes: event.payloadBytes,
      })),
    },
  };
}

async function runGrantAuditRegression() {
  process.stdout.write(
    "WAITING_FOR_GRANT_AUDIT_APPROVAL: allow the filtered task-grant lifecycle read.\n",
  );
  const page = await call("browser_get_audit_events", {
    limit: 100,
    toolName: "task_capability_grant",
  });
  assertToolSuccess(page, "task-grant audit metadata");
  const events = Array.isArray(page.structuredContent?.events)
    ? page.structuredContent.events
    : [];
  const grantCreated = events.filter(
    (event) => event?.eventType === "grant.created",
  ).length;
  const grantRevoked = events.filter(
    (event) => event?.eventType === "grant.revoked",
  ).length;
  if (grantRevoked < 1) {
    throw new Error(
      `Expected a grant revoke event, got created=${grantCreated} revoked=${grantRevoked}.`,
    );
  }
  return {
    audit: {
      filteredToolName: "task_capability_grant",
      returnedEvents: events.length,
      grantCreated,
      grantRevoked,
    },
  };
}

async function runGrantCreatedAuditRegression() {
  process.stdout.write(
    "WAITING_FOR_GRANT_CREATED_AUDIT_APPROVAL: allow the filtered grant.created metadata read.\n",
  );
  const page = await call("browser_get_audit_events", {
    limit: 100,
    eventType: "grant.created",
  });
  assertToolSuccess(page, "grant-created audit metadata");
  const events = Array.isArray(page.structuredContent?.events)
    ? page.structuredContent.events
    : [];
  if (events.length < 1) {
    throw new Error("Expected at least one grant.created audit event.");
  }
  return {
    audit: {
      filteredEventType: "grant.created",
      returnedEvents: events.length,
    },
  };
}

async function call(name, args) {
  return client.callTool(
    { name, arguments: args },
    undefined,
    { timeout: LONG_APPROVAL_TIMEOUT_MS },
  );
}

function assertToolSuccess(result, label) {
  if (result.isError) {
    throw new Error(`${label} failed: ${JSON.stringify(result.content ?? [])}`);
  }
}
