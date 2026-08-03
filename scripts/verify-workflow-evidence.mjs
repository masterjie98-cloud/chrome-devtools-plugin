import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ResourceUpdatedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";

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
  for (const toolName of [
    "browser_workflow",
    "browser_activity_start",
    "browser_activity_stop",
    "browser_locate_source",
    "browser_explain_css",
    "browser_find_workspace_source",
    "browser_create_reproduction_recipe",
    "browser_run_reproduction_recipe",
    "browser_performance_diagnostics",
    "browser_realtime_activity",
    "browser_proxy_enable",
    "browser_proxy_disable",
    "browser_proxy_upsert_rule",
    "browser_proxy_list_rules",
    "browser_proxy_remove_rule",
    "browser_capture_issue_evidence",
  ]) {
    requireTool(advertised.tools, toolName);
  }

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
    findChildFrame(
      observed.structuredContent?.frames,
      "Child input",
    ).snapshot?.nodes,
    "Child input",
  );
  findNode(
    findChildFrame(
      observed.structuredContent?.frames,
      "Same-process input",
    ).snapshot?.nodes,
    "Same-process input",
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
    "Child input",
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
    findChildFrame(
      verifiedFrames.structuredContent?.frames,
      "Child input",
    ).snapshot?.nodes,
    "Child input",
  );
  if (verifiedChildInput.value !== "direct-frame-value") {
    throw new Error(
      `Direct child-frame value verification failed: ${JSON.stringify(
        verifiedChildInput,
      )}`,
    );
  }

  const sameProcessObserved = await call("browser_observe", {
    mode: "interactive",
    limit: 80,
    sourceLimit: 3000,
    frameScope: "auto",
    maxFrames: 6,
    fields: ["role", "name", "value"],
  });
  assertSuccess(sameProcessObserved, "same-process iframe observation");
  const sameProcessFrame = findChildFrame(
    sameProcessObserved.structuredContent?.frames,
    "Same-process input",
  );
  const sameProcessInput = findNode(
    sameProcessFrame.snapshot?.nodes,
    "Same-process input",
  );
  const sameProcessAction = await call("browser_act", {
    actions: [
      {
        id: "same-process-input",
        type: "fill",
        frameRef: sameProcessFrame.frameRef,
        documentId: sameProcessFrame.documentId,
        ref: sameProcessInput.targetRef,
        value: "same-process-after",
      },
    ],
  });
  assertSuccess(sameProcessAction, "same-process iframe direct action");
  const sameProcessVerified = await call("browser_observe", {
    mode: "interactive",
    limit: 80,
    sourceLimit: 3000,
    frameScope: "auto",
    maxFrames: 6,
    fields: ["role", "name", "value"],
  });
  assertSuccess(sameProcessVerified, "same-process iframe verification");
  const verifiedSameProcessInput = findNode(
    findChildFrame(
      sameProcessVerified.structuredContent?.frames,
      "Same-process input",
    ).snapshot?.nodes,
    "Same-process input",
  );
  if (verifiedSameProcessInput.value !== "same-process-after") {
    throw new Error(
      `Same-process iframe value verification failed: ${JSON.stringify(
        verifiedSameProcessInput,
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

  const listedResources = await client.listResources();
  const activitySessionPath = `/session/${encodeURIComponent(
    target.sessionId,
  )}/`;
  const activityResource = listedResources.resources.find(
    (resource) =>
      resource.uri.includes(activitySessionPath) &&
      resource.uri.endsWith("/activity-stream"),
  );
  if (!activityResource) {
    throw new Error("The selected session did not expose an activity-stream resource.");
  }
  let resolveActivityNotification;
  const activityNotification = new Promise((resolve) => {
    resolveActivityNotification = resolve;
  });
  client.setNotificationHandler(
    ResourceUpdatedNotificationSchema,
    (notification) => {
      if (notification.params.uri === activityResource.uri) {
        resolveActivityNotification(notification.params.uri);
      }
    },
  );
  await client.subscribeResource({ uri: activityResource.uri });
  let activityWorkflow;
  let activityStream;
  try {
    const activityStarted = await call("browser_activity_start", {
      includeDom: true,
      includeNetwork: true,
      includeConsole: true,
      preserveLog: false,
      maxNetworkEntries: 100,
    });
    assertSuccess(activityStarted, "activity monitoring start");
    activityWorkflow = await call("browser_workflow", {
      observation: {
        mode: "interactive",
        limit: 80,
        sourceLimit: 3000,
        frameScope: "auto",
        maxFrames: 4,
        fields: ["role", "name", "value"],
      },
      actions: [
        {
          id: "activity-trigger",
          type: "click",
          selector: "#activity-trigger",
        },
        {
          id: "activity-settle",
          type: "wait",
          time: 0.2,
          dependsOn: ["activity-trigger"],
        },
      ],
      checks: [
        {
          id: "activity-completed",
          type: "text_contains",
          value: "activity complete",
        },
      ],
      evidence: {
        dom: true,
        url: true,
        network: true,
        console: true,
        networkLimit: 50,
        consoleLimit: 20,
      },
    });
    assertSuccess(activityWorkflow, "activity and causality workflow");
    const notificationUri = await Promise.race([
      activityNotification,
      new Promise((_, reject) => {
        setTimeout(
          () => reject(new Error("No resources/updated notification arrived.")),
          5_000,
        );
      }),
    ]);
    if (notificationUri !== activityResource.uri) {
      throw new Error("Activity notification targeted the wrong resource.");
    }
    const activityRead = await client.readResource({
      uri: activityResource.uri,
    });
    const activityText = activityRead.contents.find(
      (content) => typeof content.text === "string",
    )?.text;
    activityStream = activityText ? JSON.parse(activityText) : undefined;
    const activityKinds = new Set(
      Array.isArray(activityStream?.events)
        ? activityStream.events.map((event) => event?.kind)
        : [],
    );
    for (const kind of ["dom", "network", "console"]) {
      if (!activityKinds.has(kind)) {
        throw new Error(`Activity stream did not contain a ${kind} event.`);
      }
    }
  } finally {
    await call("browser_activity_stop", {}).catch(() => undefined);
    await client.unsubscribeResource({ uri: activityResource.uri });
  }

  const causalLinks =
    activityWorkflow?.structuredContent?.evidence?.network?.result?.causalLinks;
  const activityCausalLink = Array.isArray(causalLinks)
    ? causalLinks.find((link) =>
        String(link?.url ?? "").includes("/activity-fixture.json"),
      )
    : undefined;
  if (
    activityCausalLink?.action?.id !== "activity-trigger" ||
    activityCausalLink?.confidence === "unattributed"
  ) {
    throw new Error(
      `Activity request was not linked to its action: ${JSON.stringify(
        activityCausalLink,
      )}`,
    );
  }

  const sourceLocation = await call("browser_locate_source", {
    selector: "#activity-trigger",
    maxDepth: 8,
    includeSourceExcerpt: false,
  });
  assertSuccess(sourceLocation, "DOM framework/source lookup");
  if (sourceLocation.structuredContent?.matched !== true) {
    throw new Error(
      `Source lookup did not match the fixture button: ${JSON.stringify(
        sourceLocation.structuredContent,
      )}`,
    );
  }

  const cssExplanation = await call("browser_explain_css", {
    selector: "#trusted-button",
    properties: ["display", "width", "height", "font-family"],
    maxRules: 40,
    includeVariables: true,
  });
  assertSuccess(cssExplanation, "CSS cascade explanation");
  if (
    cssExplanation.structuredContent?.matched !== true ||
    typeof cssExplanation.structuredContent?.computed?.display !== "string" ||
    typeof cssExplanation.structuredContent?.boxModel?.rect?.width !== "number"
  ) {
    throw new Error(
      `CSS explanation is incomplete: ${JSON.stringify(
        cssExplanation.structuredContent,
      )}`,
    );
  }

  const workspaceSource = await call("browser_find_workspace_source", {
    sourceHint: "src/mcp/workspaceTools.ts",
    symbol: "registerWorkspaceSourceTool",
    limit: 5,
    includeExcerpt: true,
  });
  assertSuccess(workspaceSource, "workspace source mapping");
  if (
    !Array.isArray(workspaceSource.structuredContent?.matches) ||
    workspaceSource.structuredContent.matches[0]?.path !==
      "src/mcp/workspaceTools.ts"
  ) {
    throw new Error(
      `Workspace source mapping missed the configured root: ${JSON.stringify(
        workspaceSource.structuredContent,
      )}`,
    );
  }

  const recipeCreated = await call("browser_create_reproduction_recipe", {
    name: "Workflow performance fixture",
    targetUrlPattern: `${new URL(target.url).origin}/*`,
    workflow: {
      observation: {
        mode: "interactive",
        limit: 80,
        sourceLimit: 3000,
        frameScope: "auto",
        maxFrames: 4,
        fields: ["role", "name", "value"],
      },
      actions: [
        {
          id: "performance-trigger",
          type: "click",
          selector: "#performance-trigger",
        },
        {
          id: "performance-settle",
          type: "wait",
          time: 0.2,
          dependsOn: ["performance-trigger"],
        },
      ],
      checks: [
        {
          id: "performance-completed",
          type: "text_contains",
          value: "performance complete",
        },
      ],
      evidence: {
        dom: true,
        url: true,
        network: false,
        console: false,
      },
    },
  });
  assertSuccess(recipeCreated, "reproduction recipe creation");
  const recipeArtifactId = recipeCreated.structuredContent?.artifact?.id;
  if (typeof recipeArtifactId !== "string") {
    throw new Error("Reproduction recipe did not return an artifact id.");
  }
  process.stdout.write(
    "WAITING_FOR_REPLAY_APPROVAL: allow the session-bound reproduction recipe.\n",
  );
  const recipeRun = await call("browser_run_reproduction_recipe", {
    artifactId: recipeArtifactId,
    requireUrlMatch: true,
  });
  assertSuccess(recipeRun, "reproduction recipe replay");
  if (
    recipeRun.structuredContent?.workflow?.status !== "completed" ||
    recipeRun.structuredContent?.workflow?.verification?.passed !== true
  ) {
    throw new Error(
      `Reproduction recipe verification failed: ${JSON.stringify(
        recipeRun.structuredContent,
      )}`,
    );
  }

  const performanceDiagnostics = await call(
    "browser_performance_diagnostics",
    {
      resourceLimit: 20,
      longTaskLimit: 20,
    },
  );
  assertSuccess(performanceDiagnostics, "performance diagnostics");
  if (
    performanceDiagnostics.structuredContent?.version !==
      "browser-performance-diagnostics-v1" ||
    typeof performanceDiagnostics.structuredContent?.summary?.resourceCount !==
      "number"
  ) {
    throw new Error(
      `Performance diagnostics are incomplete: ${JSON.stringify(
        performanceDiagnostics.structuredContent,
      )}`,
    );
  }

  const realtimeActivity = await call("browser_realtime_activity", {
    limit: 30,
  });
  assertSuccess(realtimeActivity, "realtime application diagnostics");
  if (
    realtimeActivity.structuredContent?.version !==
      "browser-realtime-activity-v1" ||
    !Array.isArray(realtimeActivity.structuredContent?.websocket) ||
    !Array.isArray(realtimeActivity.structuredContent?.eventSource) ||
    !Array.isArray(realtimeActivity.structuredContent?.indexedDb)
  ) {
    throw new Error(
      `Realtime diagnostics are incomplete: ${JSON.stringify(
        realtimeActivity.structuredContent,
      )}`,
    );
  }
  const fixtureDatabase = realtimeActivity.structuredContent.indexedDb.find(
    (database) => database?.name === "ai-devtools-diagnostic-fixture",
  );
  if (!fixtureDatabase) {
    throw new Error("Realtime diagnostics did not report the fixture IndexedDB.");
  }

  const scenarioRuleId = "workflow-stateful-scenario";
  let scenarioWorkflow;
  let scenarioRule;
  const proxyBeforeScenario = await call("browser_proxy_list_rules", {});
  assertSuccess(proxyBeforeScenario, "proxy status before stateful scenario");
  const proxyWasEnabled =
    proxyBeforeScenario.structuredContent?.status?.fetchEnabled === true;
  try {
    if (!proxyWasEnabled) {
      const proxyEnabled = await call("browser_proxy_enable", {});
      assertSuccess(proxyEnabled, "stateful Mock proxy enable");
    }
    const scenarioUpsert = await call("browser_proxy_upsert_rule", {
      id: scenarioRuleId,
      urlContains: "/activity-fixture.json",
      mockStage: "request",
      scenarioSteps: [
        {
          name: "first",
          statusCode: 200,
          contentType: "application/json; charset=utf-8",
          responseBody: JSON.stringify({ ok: true, fixture: "scenario-one" }),
        },
        {
          name: "second",
          statusCode: 200,
          contentType: "application/json; charset=utf-8",
          responseBody: JSON.stringify({ ok: true, fixture: "scenario-two" }),
        },
      ],
      scenarioRepeat: "hold-last",
      resetScenario: true,
    });
    assertSuccess(scenarioUpsert, "stateful Mock scenario creation");
    scenarioWorkflow = await call("browser_workflow", {
      observation: {
        mode: "interactive",
        limit: 80,
        sourceLimit: 3000,
        frameScope: "auto",
        maxFrames: 4,
        fields: ["role", "name", "value"],
      },
      actions: [
        {
          id: "scenario-first",
          type: "click",
          selector: "#activity-trigger",
        },
        {
          id: "scenario-first-settle",
          type: "wait",
          time: 0.2,
          dependsOn: ["scenario-first"],
        },
        {
          id: "scenario-second",
          type: "click",
          selector: "#activity-trigger",
          dependsOn: ["scenario-first-settle"],
        },
        {
          id: "scenario-second-settle",
          type: "wait",
          time: 0.2,
          dependsOn: ["scenario-second"],
        },
      ],
      checks: [
        {
          id: "scenario-final-step",
          type: "text_contains",
          value: "activity complete: scenario-two",
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
    assertSuccess(scenarioWorkflow, "stateful Mock scenario execution");
    const scenarioRules = await call("browser_proxy_list_rules", {});
    assertSuccess(scenarioRules, "stateful Mock scenario status");
    scenarioRule = scenarioRules.structuredContent?.rules?.find(
      (rule) => rule?.id === scenarioRuleId,
    );
    if (
      scenarioWorkflow.structuredContent?.verification?.passed !== true ||
      scenarioRule?.scenarioHitCount !== 2 ||
      scenarioRule?.scenarioStepIndex !== 1
    ) {
      throw new Error(
        `Stateful Mock progression failed: ${JSON.stringify({
          workflow: scenarioWorkflow.structuredContent,
          rule: scenarioRule,
        })}`,
      );
    }
  } finally {
    await call("browser_proxy_remove_rule", {
      id: scenarioRuleId,
    }).catch(() => undefined);
    if (!proxyWasEnabled) {
      await call("browser_proxy_disable", {}).catch(() => undefined);
    }
  }

  const issueEvidence = await call("browser_capture_issue_evidence", {
    title: "Workflow verifier diagnostic bundle",
    description: "Bounded local fixture evidence.",
    captureScreenshots: true,
    observation: {
      mode: "interactive",
      limit: 80,
      sourceLimit: 3000,
      frameScope: "auto",
      maxFrames: 4,
      fields: ["role", "name", "value"],
    },
    evidence: {
      dom: true,
      url: true,
      network: true,
      console: true,
      networkLimit: 20,
      consoleLimit: 20,
    },
  });
  assertSuccess(issueEvidence, "issue evidence bundle");
  if (
    typeof issueEvidence.structuredContent?.artifact?.uri !== "string" ||
    JSON.stringify(issueEvidence.structuredContent).includes("data:image/")
  ) {
    throw new Error(
      `Issue evidence was not externalized correctly: ${JSON.stringify(
        issueEvidence.structuredContent,
      )}`,
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
        sameProcessFrame: {
          frameRef: sameProcessFrame.frameRef,
          documentBound: typeof sameProcessFrame.documentId === "string",
          completedActions: sameProcessAction.structuredContent?.completed,
          verifiedValue: verifiedSameProcessInput.value,
        },
        screenshotDiff: comparison,
        activitySubscription: {
          latestSequence: activityStream?.latestSequence,
          eventKinds: [
            ...new Set(
              Array.isArray(activityStream?.events)
                ? activityStream.events.map((event) => event?.kind)
                : [],
            ),
          ].sort(),
          causalConfidence: activityCausalLink.confidence,
          causalReason: activityCausalLink.reason,
        },
        sourceLocation: {
          matched: sourceLocation.structuredContent?.matched,
          framework: sourceLocation.structuredContent?.framework,
          reason: sourceLocation.structuredContent?.reason,
        },
        cssExplanation: {
          matched: cssExplanation.structuredContent?.matched,
          matchedRuleCount:
            cssExplanation.structuredContent?.matchedRules?.length ?? 0,
          sourceHintCount:
            cssExplanation.structuredContent?.sourceHints?.length ?? 0,
          boxWidth: cssExplanation.structuredContent?.boxModel?.rect?.width,
        },
        workspaceSource: {
          scannedFiles: workspaceSource.structuredContent?.scannedFiles,
          firstMatch: workspaceSource.structuredContent?.matches?.[0]?.path,
        },
        reproductionRecipe: {
          artifactId: recipeArtifactId,
          workflowStatus: recipeRun.structuredContent?.workflow?.status,
          verificationPassed:
            recipeRun.structuredContent?.workflow?.verification?.passed === true,
        },
        performanceDiagnostics: {
          summary: performanceDiagnostics.structuredContent?.summary,
          longTaskCount:
            performanceDiagnostics.structuredContent?.longTasks?.length ?? 0,
          layoutShiftCount:
            performanceDiagnostics.structuredContent?.layoutShifts?.length ?? 0,
          warnings: performanceDiagnostics.structuredContent?.warnings,
        },
        realtimeActivity: {
          websocketCount:
            realtimeActivity.structuredContent?.websocket?.length ?? 0,
          eventSourceCount:
            realtimeActivity.structuredContent?.eventSource?.length ?? 0,
          indexedDb: realtimeActivity.structuredContent?.indexedDb,
          serviceWorkers: realtimeActivity.structuredContent?.serviceWorkers,
        },
        statefulMock: {
          verificationPassed:
            scenarioWorkflow?.structuredContent?.verification?.passed === true,
          stepIndex: scenarioRule?.scenarioStepIndex,
          hitCount: scenarioRule?.scenarioHitCount,
        },
        issueEvidence: {
          workflowStatus: issueEvidence.structuredContent?.workflowStatus,
          causalLinkCount: issueEvidence.structuredContent?.causalLinkCount,
          artifactUri: issueEvidence.structuredContent?.artifact?.uri,
          screenshotDiff: issueEvidence.structuredContent?.screenshotDiff,
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
  if (!connected || typeof connected.sessionId !== "string") {
    throw new Error("No browser-connected Profile is available for the fixture.");
  }
  // A fresh adapter may list the daemon's active fallback session as selected
  // without yet owning an explicit resource/subscription binding.
  await call("browser_set_session", { sessionId: connected.sessionId });

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
  return {
    ...target,
    sessionId: connected.sessionId,
  };
}

function findChildFrame(frames, nodeName) {
  const frame = Array.isArray(frames)
    ? frames.find(
        (candidate) =>
          candidate?.actionable === true &&
          typeof candidate?.frameRef === "string" &&
          typeof candidate?.documentId === "string" &&
          Array.isArray(candidate?.snapshot?.nodes) &&
          candidate.snapshot.nodes.some((node) => node?.name === nodeName),
      )
    : undefined;
  if (!frame) {
    throw new Error(`No actionable child frame contains: ${nodeName}.`);
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
  const attempts = name === "browser_observe" ? 10 : 1;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await client.callTool(
      { name, arguments: args },
      undefined,
      { timeout: LONG_APPROVAL_TIMEOUT_MS },
    );
    const retryableFrameRegistration =
      result.isError === true &&
      JSON.stringify(result.content ?? []).includes("FRAME_UNAVAILABLE");
    if (!retryableFrameRegistration || attempt === attempts) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Unreachable retry state for ${name}.`);
}

function assertSuccess(result, label) {
  if (result.isError) {
    throw new Error(`${label} failed: ${JSON.stringify(result.content ?? [])}`);
  }
}
