import type { DaemonStateResourceKey } from "./wsProtocol";

export const MCP_DIRECT_STATE_RESOURCES = [
  {
    name: "active-tab",
    stateKey: "activeTab",
    scope: "target",
  },
  {
    name: "selected-element",
    stateKey: "selectedElement",
    scope: "target",
  },
  {
    name: "current-conversation",
    stateKey: "currentConversationId",
    scope: "session",
  },
  {
    name: "page-context",
    stateKey: "pageContext",
    scope: "target",
  },
  {
    name: "context-digest",
    stateKey: "contextDigest",
    scope: "target",
  },
  {
    name: "collaboration-workspace",
    stateKey: "collaborationWorkspace",
    scope: "session",
  },
] as const satisfies readonly {
  name: string;
  stateKey: DaemonStateResourceKey;
  scope: "session" | "target";
}[];

const DIRECT_STATE_KEYS = new Set<DaemonStateResourceKey>(
  MCP_DIRECT_STATE_RESOURCES.map((resource) => resource.stateKey),
);

export function isDirectMcpStateResource(
  key: DaemonStateResourceKey,
): boolean {
  return DIRECT_STATE_KEYS.has(key);
}
