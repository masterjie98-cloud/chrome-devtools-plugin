import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const prefixFlag = process.argv.indexOf("--tab-url-prefix");
const tabUrlPrefix =
  prefixFlag >= 0 ? process.argv[prefixFlag + 1]?.trim() : undefined;
const artifactFlag = process.argv.indexOf("--artifact-uri");
const artifactUri =
  artifactFlag >= 0
    ? process.argv[artifactFlag + 1]?.trim()
    : "ai-devtools://artifact/live-verification";
const LONG_APPROVAL_TIMEOUT_MS = 24 * 60 * 60 * 1000;

if (
  !tabUrlPrefix ||
  !/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\//.test(tabUrlPrefix)
) {
  throw new Error(
    "Pass --tab-url-prefix with an already-open loopback verification fixture.",
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
  name: "p0-p2-live-verifier",
  version: "1.0.0",
});

try {
  await client.connect(transport);
  const target = await selectTarget();
  const css = await call("browser_explain_css", {
    selector: "#trusted-button",
    properties: ["width"],
    maxRules: 20,
    includeVariables: false,
  });
  assertSuccess(css, "CSS source-map verification");
  const sourceHint = Array.isArray(css.structuredContent?.sourceHints)
    ? css.structuredContent.sourceHints.find(
        (hint) =>
          String(hint?.url ?? "").endsWith("/mapped.css") &&
          Array.isArray(hint?.originalSources) &&
          hint.originalSources.includes("src/fixtures/trusted-button.scss"),
      )
    : undefined;
  if (!sourceHint) {
    throw new Error(
      `CSS source map was not resolved: ${JSON.stringify(
        css.structuredContent?.sourceHints ?? [],
      )}`,
    );
  }

  const taskId = `task_live_${Date.now().toString(36)}`;
  const delegated = await call("browser_delegate_collaboration_task", {
    taskId,
    requestType: "task",
    title: "P0-P2 live collaboration verification",
    instruction:
      "This task is created only to verify durable progress, evidence, cancellation, and waiter recovery.",
    acceptanceCriteria: ["The task is cancelled by Codex without browser work."],
    scope: "target",
    sensitivity: "page_content",
  });
  assertSuccess(delegated, "task delegation");

  const progressArgs = {
    taskId,
    eventId: "evt_progress_live1",
    eventType: "progress",
    message: "Live verification reached the collaboration event phase.",
    progress: 50,
  };
  const progress = await call("browser_update_collaboration_task", progressArgs);
  assertSuccess(progress, "progress event");
  const progressRetry = await call(
    "browser_update_collaboration_task",
    progressArgs,
  );
  assertSuccess(progressRetry, "progress event idempotent retry");
  if (progressRetry.structuredContent?.deduplicated !== true) {
    throw new Error("Repeated collaboration event was not deduplicated.");
  }

  const requirement = await call("browser_update_collaboration_task", {
    taskId,
    eventId: "evt_require_live1",
    eventType: "requirement",
    message: "Do not accept or execute this verification-only task.",
    requirements: ["Cancellation must be durable."],
  });
  assertSuccess(requirement, "requirement event");

  const evidence = await call("browser_update_collaboration_task", {
    taskId,
    eventId: "evt_evidence_live1",
    eventType: "evidence",
    message: "Attach the preceding bounded issue-evidence artifact.",
    artifactUris: [artifactUri],
  });
  assertSuccess(evidence, "evidence event");

  const cancelled = await call("browser_cancel_collaboration_task", {
    taskId,
    reason: "Live verification completed without handing work to the plugin Agent.",
  });
  assertSuccess(cancelled, "task cancellation");
  const waited = await call("browser_wait_for_collaboration_result", { taskId });
  assertSuccess(waited, "cancelled task waiter");
  if (waited.structuredContent?.status !== "cancelled") {
    throw new Error(
      `Cancelled task waiter returned ${waited.structuredContent?.status}.`,
    );
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        target: { origin: new URL(target.url).origin, title: target.title },
        cssSourceMap: {
          url: sourceHint.url,
          sourceMapUrl: sourceHint.sourceMapUrl,
          originalSources: sourceHint.originalSources,
        },
        collaborationV2: {
          taskId,
          progressDeduplicated:
            progressRetry.structuredContent?.deduplicated === true,
          requirementEventId: requirement.structuredContent?.eventId,
          evidenceEventId: evidence.structuredContent?.eventId,
          finalStatus: waited.structuredContent?.status,
        },
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
  const connected = Array.isArray(sessions)
    ? sessions.find(
        (session) =>
          session?.browserConnected === true &&
          String(session.activeTarget?.url ?? "").startsWith(tabUrlPrefix),
      ) ?? sessions.find((session) => session?.browserConnected === true)
    : undefined;
  if (connected && typeof connected.sessionId === "string") {
    // Always turn an active fallback into this adapter's explicit binding.
    await call("browser_set_session", { sessionId: connected.sessionId });
  }

  const tabsResult = await call("browser_list_tabs", {});
  assertSuccess(tabsResult, "tab listing");
  const target = Array.isArray(tabsResult.structuredContent?.tabs)
    ? tabsResult.structuredContent.tabs.find((tab) =>
        String(tab?.url ?? "").startsWith(tabUrlPrefix),
      )
    : undefined;
  if (!target || !Number.isSafeInteger(target.id)) {
    throw new Error("The loopback verification fixture is not open.");
  }
  await call("browser_set_target_tab", { tabId: target.id });
  return target;
}

async function call(name, args) {
  return client.callTool(
    { name, arguments: args },
    undefined,
    { timeout: LONG_APPROVAL_TIMEOUT_MS },
  );
}

function assertSuccess(result, label) {
  if (result.isError) {
    throw new Error(`${label} failed: ${JSON.stringify(result.content ?? [])}`);
  }
}
