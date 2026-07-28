import packageJson from "../../package.json";
import { MCP_TOOL_DEFINITIONS } from "./mcpTools";
import { WS_PROTOCOL_VERSION } from "./wsProtocol";

/**
 * Increment when an MCP output shape changes without a corresponding input
 * definition change. Input definitions are hashed directly below.
 */
export const MCP_OUTPUT_SCHEMA_REVISION = 4;

export const RUNTIME_BUILD_ID =
  `${packageJson.version}+ws${WS_PROTOCOL_VERSION}`;

export const RUNTIME_SCHEMA_HASH = fnv1a32(
  stableJsonStringify({
    wsProtocolVersion: WS_PROTOCOL_VERSION,
    mcpOutputSchemaRevision: MCP_OUTPUT_SCHEMA_REVISION,
    tools: MCP_TOOL_DEFINITIONS.map((definition) => ({
      name: definition.name,
      parameters: definition.parameters,
    })),
  }),
);

export const RUNTIME_IDENTITY = Object.freeze({
  buildId: RUNTIME_BUILD_ID,
  schemaHash: RUNTIME_SCHEMA_HASH,
});

export interface RuntimeIdentity {
  buildId: string;
  schemaHash: string;
}

export function runtimeIdentityMismatch(
  remote: { buildId?: unknown; schemaHash?: unknown },
): "buildId" | "schemaHash" | undefined {
  if (remote.buildId !== RUNTIME_BUILD_ID) {
    return "buildId";
  }
  if (remote.schemaHash !== RUNTIME_SCHEMA_HASH) {
    return "schemaHash";
  }
  return undefined;
}

function fnv1a32(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function stableJsonStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJsonStringify(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([key, entry]) =>
          `${JSON.stringify(key)}:${stableJsonStringify(entry)}`,
      )
      .join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  return serialized === undefined ? "null" : serialized;
}
