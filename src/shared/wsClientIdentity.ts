import type { WsClientRole } from "./wsProtocol";

export type WsClientTransport = "chrome-extension" | "local-process";

export interface WsClientIdentity {
  clientName: string;
  assignedRole: WsClientRole;
  transport: WsClientTransport;
}

export const WS_CLIENT_IDENTITIES = {
  CHROME_BACKGROUND: {
    clientName: "chrome-extension-background",
    assignedRole: "browser",
    transport: "chrome-extension",
  },
  CHROME_SIDEPANEL: {
    clientName: "chrome-devtools-sidepanel",
    assignedRole: "ui",
    transport: "chrome-extension",
  },
  CHROME_SIDEPANEL_OBSERVER: {
    clientName: "sidepanel-ui",
    assignedRole: "observer",
    transport: "chrome-extension",
  },
  CODEX_STDIO_ADAPTER: {
    clientName: "codex-stdio-adapter",
    assignedRole: "mcp",
    transport: "local-process",
  },
} as const satisfies Record<string, WsClientIdentity>;

const IDENTITIES_BY_NAME = new Map<string, WsClientIdentity>(
  Object.values(WS_CLIENT_IDENTITIES).map((identity) => [
    identity.clientName,
    identity,
  ]),
);

export function resolveWsClientIdentity(
  clientName: string | undefined,
): WsClientIdentity | undefined {
  return clientName ? IDENTITIES_BY_NAME.get(clientName) : undefined;
}

export function wsClientNameForRole(role: WsClientRole): string {
  const identity = Object.values(WS_CLIENT_IDENTITIES).find(
    (candidate) => candidate.assignedRole === role,
  );
  if (!identity) {
    throw new Error(`No registered WebSocket client identity for role ${role}.`);
  }
  return identity.clientName;
}
