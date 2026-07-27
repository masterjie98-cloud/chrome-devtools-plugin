import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const prefixFlag = process.argv.indexOf("--tab-url-prefix");
const tabUrlPrefix =
  prefixFlag >= 0 ? process.argv[prefixFlag + 1]?.trim() : undefined;
const LONG_APPROVAL_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const OBSERVATION_FIELDS = [
  "role",
  "name",
  "value",
  "selectedValues",
  "checked",
  "disabled",
];

if (
  !tabUrlPrefix ||
  !/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\//.test(tabUrlPrefix)
) {
  throw new Error(
    "Pass --tab-url-prefix with an already-open loopback workflow fixture.",
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
  name: "workflow-evidence-verifier",
  version: "1.0.0",
});

try {
  await client.connect(transport);
  const advertised = await client.listTools();
  requireTool(advertised.tools, "browser_workflow");

  const target = await selectTarget();
  const status = await call("browser_status", {});
  assertSuccess(status, "browser status");
  const compatibility = status.structuredContent?.compatibility;
  if (compatibility?.compatible !== true) {
    throw new Error(
      `Runtime compatibility failed: ${JSON.stringify(compatibility)}`,
    );
  }

  const observed = await call("browser_observe", {
    mode: "interactive",
    limit: 80,
    sourceLimit: 3000,
    frameScope: "auto",
    maxFrames: 4,
    fields: OBSERVATION_FIELDS,
  });
  assertSuccess(observed, "multi-frame observation");
  assertProjectedNodes(observed.structuredContent, OBSERVATION_FIELDS);
  findNode(
    findChildFrame(observed.structuredContent?.frames).snapshot?.nodes,
    "Child input",
  );

  process.stdout.write(
    "WAITING_FOR_TASK_APPROVAL: allow the bounded workflow and child-frame action.\n",
  );
  const workflow = await call("browser_workflow", {
    observation: {
      mode: "interactive",
      limit: 80,
      sourceLimit: 3000,
      frameScope: "auto",
      maxFrames: 4,
      fields: ["role", "name", "value", "selectedValues", "checked"],
    },
    actions: [
      { id: "name", type: "fill", selector: "#form-name", value: "Workflow Ada" },
      { id: "agree", type: "fill", selector: "#form-agree", value: true },
      {
        id: "country",
        type: "select",
        selector: "#form-country",
        values: ["us"],
      },
      {
        id: "tags",
        type: "select",
        selector: "#form-tags",
        values: ["beta", "gamma"],
      },
    ],
    checks: [
      {
        id: "name-value",
        type: "target_state",
        selector: "#form-name",
        value: "Workflow Ada",
      },
      {
        id: "agree-state",
        type: "target_state",
        selector: "#form-agree",
        checked: true,
      },
      {
        id: "country-values",
        type: "target_state",
        selector: "#form-country",
        selectedValues: ["us"],
      },
      {
        id: "tag-values",
        type: "target_state",
        selector: "#form-tags",
        selectedValues: ["beta", "gamma"],
      },
    ],
    evidence: {
      dom: true,
      url: true,
      network: true,
      console: true,
      networkLimit: 20,
      consoleLimit: 20,
    },
  });
  assertSuccess(workflow, "browser workflow");
  if (
    workflow.structuredContent?.status !== "completed" ||
    workflow.structuredContent?.verification?.passed !== true
  ) {
    throw new Error(
      `Workflow verification failed: ${JSON.stringify(
        workflow.structuredContent,
      )}`,
    );
  }

  // browser_workflow performs its own post-action observation. Snapshot refs
  // are intentionally generation-scoped, so refresh the frame/node refs before
  // issuing a separate direct-frame action.
  const refreshedFrames = await call("browser_observe", {
    mode: "interactive",
    limit: 80,
    sourceLimit: 3000,
    frameScope: "auto",
    maxFrames: 4,
    fields: ["role", "name", "value"],
  });
  assertSuccess(refreshedFrames, "post-workflow frame observation");
  const childFrame = findChildFrame(
    refreshedFrames.structuredContent?.frames,
  );
  const childInput = findNode(childFrame.snapshot?.nodes, "Child input");

  const childAction = await call("browser_act", {
    actions: [
      {
        id: "child-input",
        type: "fill",
        frameRef: childFrame.frameRef,
        documentId: childFrame.documentId,
        ref: childInput.targetRef,
        value: "direct-frame-value",
      },
    ],
  });
  assertSuccess(childAction, "direct child-frame action");
  if (childAction.structuredContent?.completed !== 1) {
    throw new Error(
      `Direct child-frame action did not complete: ${JSON.stringify(
        childAction.structuredContent,
      )}`,
    );
  }
  const verifiedFrames = await call("browser_observe", {
    mode: "interactive",
    limit: 80,
    sourceLimit: 3000,
    frameScope: "auto",
    maxFrames: 4,
    fields: ["role", "name", "value"],
  });
  assertSuccess(verifiedFrames, "direct child-frame verification");
  const verifiedChildInput = findNode(
    findChildFrame(verifiedFrames.structuredContent?.frames).snapshot?.nodes,
    "Child input",
  );
  if (verifiedChildInput.value !== "direct-frame-value") {
    throw new Error(
      `Direct child-frame value verification failed: ${JSON.stringify(
        verifiedChildInput,
      )}`,
    );
  }

  process.stdout.write(
    "WAITING_FOR_VISUAL_APPROVAL: allow two bounded element screenshots.\n",
  );
  const firstImage = await call("browser_take_screenshot", {
    selector: "#trusted-form-grid",
    diffAgainst: "previous",
    returnImage: "always",
  });
  assertSuccess(firstImage, "visual baseline");
  const secondImage = await call("browser_take_screenshot", {
    selector: "#trusted-form-grid",
    diffAgainst: "previous",
    returnImage: "changed",
  });
  assertSuccess(secondImage, "unchanged visual diff");
  const comparison = secondImage.structuredContent?.comparison;
  if (
    comparison?.baselineAvailable !== true ||
    comparison?.changed !== false ||
    secondImage.content?.some((entry) => entry.type === "image")
  ) {
    throw new Error(
      `Unchanged screenshot diff was not byte-free: ${JSON.stringify({
        comparison,
        contentTypes: secondImage.content?.map((entry) => entry.type),
      })}`,
    );
  }

  const actionResults = workflow.structuredContent?.actions?.results;
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        target: {
          origin: new URL(target.url).origin,
          title: target.title,
        },
        compatibility,
        observation: {
          childFrames: observed.structuredContent?.frames?.length ?? 0,
          childActionable: childFrame.actionable === true,
          projectedFields: OBSERVATION_FIELDS,
        },
        workflow: {
          status: workflow.structuredContent?.status,
          completedActions: workflow.structuredContent?.actions?.completed,
          postStates: Array.isArray(actionResults)
            ? actionResults.filter((entry) => entry?.postState).length
            : 0,
          verificationPassed:
            workflow.structuredContent?.verification?.passed === true,
          evidenceChannels: Object.keys(
            workflow.structuredContent?.evidence ?? {},
          ).sort(),
        },
        directFrame: {
          frameRef: childFrame.frameRef,
          documentBound: typeof childFrame.documentId === "string",
          completedActions: childAction.structuredContent?.completed,
          verifiedValue: verifiedChildInput.value,
        },
        screenshotDiff: comparison,
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
  if (
    connected &&
    typeof connected.sessionId === "string" &&
    connected.selected !== true
  ) {
    await call("browser_set_session", { sessionId: connected.sessionId });
  }

  const tabsResult = await call("browser_list_tabs", {});
  assertSuccess(tabsResult, "tab listing");
  const tabs = tabsResult.structuredContent?.tabs;
  const target = Array.isArray(tabs)
    ? tabs.find((tab) => String(tab?.url ?? "").startsWith(tabUrlPrefix))
    : undefined;
  if (!target || !Number.isSafeInteger(target.id)) {
    throw new Error("The loopback workflow fixture is not open.");
  }
  await call("browser_set_target_tab", { tabId: target.id });
  return target;
}

function findChildFrame(frames) {
  const frame = Array.isArray(frames)
    ? frames.find(
        (candidate) =>
          candidate?.actionable === true &&
          typeof candidate?.frameRef === "string" &&
          typeof candidate?.documentId === "string",
      )
    : undefined;
  if (!frame) {
    throw new Error("No actionable child frame was returned.");
  }
  return frame;
}

function findNode(nodes, name) {
  const node = Array.isArray(nodes)
    ? nodes.find(
        (candidate) =>
          candidate?.name === name && typeof candidate?.targetRef === "string",
      )
    : undefined;
  if (!node) {
    throw new Error(`Missing actionable node: ${name}.`);
  }
  return node;
}

function assertProjectedNodes(content, fields) {
  const allowed = new Set(["targetRef", ...fields]);
  const snapshots = [
    content?.snapshot,
    ...(Array.isArray(content?.frames)
      ? content.frames.map((frame) => frame?.snapshot)
      : []),
  ];
  for (const snapshot of snapshots) {
    if (!Array.isArray(snapshot?.nodes)) continue;
    for (const node of snapshot.nodes) {
      const unexpected = Object.keys(node ?? {}).filter(
        (field) => !allowed.has(field),
      );
      if (unexpected.length > 0) {
        throw new Error(
          `Observation projection leaked fields: ${unexpected.join(",")}`,
        );
      }
    }
  }
}

function requireTool(tools, name) {
  if (!Array.isArray(tools) || !tools.some((tool) => tool?.name === name)) {
    throw new Error(`${name} is missing from the packaged MCP tool surface.`);
  }
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
