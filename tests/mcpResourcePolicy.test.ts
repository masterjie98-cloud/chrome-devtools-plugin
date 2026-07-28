import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  isDirectMcpStateResource,
  MCP_DIRECT_STATE_RESOURCES,
} from "../src/shared/mcpResources";
import type { DaemonStateResourceKey } from "../src/shared/wsProtocol";
import {
  assertTargetResourcePayload,
  assertResourceSessionSelection,
  createResourceTargetKey,
  createSessionResourceUri,
  createTargetResourceUri,
  parseResourceSessionSummaries,
  withResourceBinding,
} from "../src/mcp/resourceRouting";
import {
  registerStateResources,
  type StateResourceDaemonClient,
} from "../src/mcp/stateResourceRegistry";

test("direct MCP resources contain only the shared safe-state allowlist", () => {
  assert.equal(
    MCP_DIRECT_STATE_RESOURCES.every((resource) =>
      isDirectMcpStateResource(resource.stateKey),
    ),
    true,
  );

  const sensitiveKeys: DaemonStateResourceKey[] = [
    "pluginConversation",
    "lastPluginMessage",
    "lastScreenshot",
    "agentSessions",
    "activeAgentSession",
    "lastAgentConclusion",
  ];
  assert.equal(
    sensitiveKeys.every((key) => !isDirectMcpStateResource(key)),
    true,
  );
  assert.equal(
    MCP_DIRECT_STATE_RESOURCES.every(
      (resource) =>
        resource.scope === "session" || resource.scope === "target",
    ),
    true,
  );
  assert.equal(
    MCP_DIRECT_STATE_RESOURCES.filter(
      (resource) =>
        resource.stateKey === "currentConversationId" ||
        resource.stateKey === "collaborationWorkspace" ||
        resource.stateKey === "activityStream",
    ).every((resource) => resource.scope === "session"),
    true,
  );
  assert.equal(
    MCP_DIRECT_STATE_RESOURCES.filter(
      (resource) =>
        resource.stateKey !== "currentConversationId" &&
        resource.stateKey !== "collaborationWorkspace" &&
        resource.stateKey !== "activityStream",
    ).every((resource) => resource.scope === "target"),
    true,
  );
});

test("resource target keys bind tab, frame, document, navigation, and revision", () => {
  const target = exactTarget();
  const key = createResourceTargetKey(target);
  assert.match(key ?? "", /^t1_[a-f0-9]{32}$/);
  assert.equal(createResourceTargetKey({ ...target, documentId: undefined }), null);
  assert.notEqual(
    createResourceTargetKey({ ...target, frameId: 3 }),
    key,
  );
  assert.notEqual(
    createResourceTargetKey({ ...target, documentId: "document-2" }),
    key,
  );
  assert.notEqual(
    createResourceTargetKey({ ...target, revision: 8 }),
    key,
  );
});

test("target resource payloads reject stale or incomplete target provenance", () => {
  const target = exactTarget();
  const key = createResourceTargetKey(target);
  assert.ok(key);

  assert.doesNotThrow(() =>
    assertTargetResourcePayload(
      "activeTab",
      { value: target },
      key,
    ),
  );
  assert.doesNotThrow(() =>
    assertTargetResourcePayload(
      "selectedElement",
      { activeTab: target, selectedElement: {} },
      key,
    ),
  );
  assert.doesNotThrow(() =>
    assertTargetResourcePayload(
      "pageContext",
      { value: { provenance: { target } } },
      key,
    ),
  );
  assert.throws(
    () =>
      assertTargetResourcePayload(
        "activeTab",
        { value: { ...target, documentId: "stale-document" } },
        key,
      ),
    /STALE_CONTEXT/,
  );
  assert.throws(
    () => assertTargetResourcePayload("pageContext", { value: {} }, key),
    /RESOURCE_TARGET_INCOMPLETE/,
  );
});

test("resource reads require an explicit matching adapter session", () => {
  assert.doesNotThrow(() =>
    assertResourceSessionSelection("profile-a", "profile-a"),
  );
  assert.throws(
    () => assertResourceSessionSelection(undefined, "profile-a"),
    /RESOURCE_SESSION_UNBOUND.*browser_set_session/,
  );
  assert.throws(
    () => assertResourceSessionSelection("profile-a", "profile-b"),
    /ROLE_FORBIDDEN/,
  );
});

test("resource discovery exposes only bounded session and opaque target routing", () => {
  const targetKey = createResourceTargetKey(exactTarget());
  assert.ok(targetKey);
  const summaries = parseResourceSessionSummaries({
    sessions: [
      {
        sessionId: "profile-a",
        selected: true,
        resourceTargetKey: targetKey,
      },
      {
        sessionId: "../invalid",
        selected: false,
        resourceTargetKey: targetKey,
      },
      {
        sessionId: ".hidden",
        selected: false,
        resourceTargetKey: targetKey,
      },
      "[1 additional entries omitted]",
    ],
  });
  assert.deepEqual(summaries, [
    {
      sessionId: "profile-a",
      selected: true,
      resourceTargetKey: targetKey,
    },
  ]);
  assert.equal(
    createSessionResourceUri("profile-a", "current-conversation"),
    "ai-devtools://session/profile-a/current-conversation",
  );
  assert.equal(
    createSessionResourceUri("profile:work", "current-conversation"),
    "ai-devtools://session/profile:work/current-conversation",
  );
  assert.equal(
    createTargetResourceUri("profile-a", targetKey, "active-tab"),
    `ai-devtools://session/profile-a/target/${targetKey}/active-tab`,
  );
  assert.deepEqual(
    withResourceBinding({ value: "conversation-1" }, {
      scope: "session",
      sessionId: "profile-a",
    }),
    {
      value: "conversation-1",
      resourceBinding: {
        scope: "session",
        sessionId: "profile-a",
      },
    },
  );
});

test("MCP state templates list and read only the selected exact target", async () => {
  const target = exactTarget();
  const targetKey = createResourceTargetKey(target);
  assert.ok(targetKey);
  let selectedSessionId: string | undefined = "profile-a";
  let sessionListCalls = 0;
  const daemon: StateResourceDaemonClient = {
    selectedSessionId: () => selectedSessionId,
    callTool: async () => {
      sessionListCalls += 1;
      return {
        sessions: [
          {
            sessionId: "profile-a",
            selected: selectedSessionId === "profile-a",
            resourceTargetKey: targetKey,
          },
        ],
      };
    },
    readState: async (key, sessionId) => {
      assert.equal(sessionId, "profile-a");
      if (key === "activeTab") return { value: target };
      if (key === "selectedElement") {
        return { activeTab: target, selectedElement: { selector: "#save" } };
      }
      if (key === "pageContext") {
        return { value: { provenance: { target } } };
      }
      if (key === "contextDigest") {
        return { activeTab: target, contextDigest: { version: "test" } };
      }
      if (key === "collaborationWorkspace") {
        return {
          workspace: {
            version: "collaboration-workspace-v1",
            revision: 1,
            items: [],
          },
        };
      }
      return { value: "conversation-1" };
    },
  };
  const server = new McpServer({ name: "state-resource-test", version: "1.0.0" });
  registerStateResources(server, daemon);
  const client = new Client({ name: "state-resource-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  try {
    const templates = await client.listResourceTemplates();
    assert.equal(templates.resourceTemplates.length, 7);
    assert.equal(
      templates.resourceTemplates.every((template) =>
        template.uriTemplate.startsWith("ai-devtools://session/{sessionId}/"),
      ),
      true,
    );
    assert.equal(
      templates.resourceTemplates.some((template) =>
        template.uriTemplate.includes("ai-devtools://active-tab"),
      ),
      false,
    );

    const listed = await client.listResources();
    assert.equal(sessionListCalls, 1);
    assert.equal(listed.resources.length, 7);
    assert.equal(
      listed.resources.filter((resource) => resource.uri.includes("/target/"))
        .length,
      4,
    );
    const activeTabUri = createTargetResourceUri(
      "profile-a",
      targetKey,
      "active-tab",
    );
    assert.equal(
      listed.resources.some((resource) => resource.uri === activeTabUri),
      true,
    );

    const activeTab = await client.readResource({ uri: activeTabUri });
    const activeTabJson = readTextResourceJson(activeTab.contents);
    assert.deepEqual(activeTabJson.resourceBinding, {
      scope: "target",
      sessionId: "profile-a",
      targetKey,
    });

    const staleUri = createTargetResourceUri(
      "profile-a",
      `t1_${"f".repeat(32)}`,
      "active-tab",
    );
    const stale = readTextResourceJson(
      (await client.readResource({ uri: staleUri })).contents,
    );
    assert.match(String(stale.error), /STALE_CONTEXT/);

    const crossSession = readTextResourceJson(
      (
        await client.readResource({
          uri: createSessionResourceUri(
            "profile-b",
            "current-conversation",
          ),
        })
      ).contents,
    );
    assert.match(String(crossSession.error), /ROLE_FORBIDDEN/);

    selectedSessionId = undefined;
    const unbound = readTextResourceJson(
      (
        await client.readResource({
          uri: createSessionResourceUri(
            "profile-a",
            "current-conversation",
          ),
        })
      ).contents,
    );
    assert.match(String(unbound.error), /RESOURCE_SESSION_UNBOUND/);
  } finally {
    await client.close();
    await server.close();
  }
});

function exactTarget() {
  return {
    url: "https://example.test/page",
    title: "Example",
    targetId: "17",
    tabId: 17,
    windowId: 3,
    frameId: 0,
    documentId: "document-1",
    navigationId: "navigation-1",
    revision: 7,
  };
}

function readTextResourceJson(
  contents: Array<{ type?: string; text?: string } | Record<string, unknown>>,
): Record<string, unknown> {
  const first = contents[0];
  assert.ok(first && "text" in first && typeof first.text === "string");
  return JSON.parse(first.text) as Record<string, unknown>;
}
