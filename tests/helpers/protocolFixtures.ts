import {
  WS_COMMANDS,
  WS_PROTOCOL_VERSION,
  type WsClientRole,
} from "../../src/shared/wsProtocol";
import { wsClientNameForRole } from "../../src/shared/wsClientIdentity";
import {
  RUNTIME_BUILD_ID,
  RUNTIME_SCHEMA_HASH,
} from "../../src/shared/runtimeIdentity";

export const TEST_BRIDGE_TOKEN =
  "test-only-bridge-token-000000000000000000000000";
export const TEST_PROTOCOL_TIME = "2026-07-13T00:00:00.000Z";
export const TEST_EXTENSION_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
export const TEST_EXTENSION_ORIGIN = `chrome-extension://${TEST_EXTENSION_ID}`;

export interface ProtocolFixtureOptions {
  requestId: string;
  sentAt?: string;
}

export function protocolMessage(
  command: string,
  payload: Record<string, unknown>,
  options: ProtocolFixtureOptions,
): Record<string, unknown> {
  return {
    requestId: options.requestId,
    command,
    sentAt: options.sentAt ?? TEST_PROTOCOL_TIME,
    payload,
  };
}

export function clientHelloMessage(
  clientRole: WsClientRole,
  sessionId: string,
  options: ProtocolFixtureOptions & {
    bridgeToken?: string;
    clientName?: string;
  },
): Record<string, unknown> {
  return protocolMessage(
    WS_COMMANDS.CLIENT_HELLO,
    {
      protocolVersion: WS_PROTOCOL_VERSION,
      buildId: RUNTIME_BUILD_ID,
      schemaHash: RUNTIME_SCHEMA_HASH,
      clientRole,
      clientName: options.clientName ?? wsClientNameForRole(clientRole),
      ...(clientRole === "mcp" ? {} : { installationId: sessionId }),
      sessionId,
      bridgeToken: options.bridgeToken ?? TEST_BRIDGE_TOKEN,
    },
    options,
  );
}

export function createDeterministicIdFactory(prefix = "fixture-id"): () => string {
  let sequence = 0;
  return () => `${prefix}-${++sequence}`;
}
