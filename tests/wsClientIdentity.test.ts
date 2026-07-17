import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveWsClientIdentity,
  WS_CLIENT_IDENTITIES,
  wsClientNameForRole,
} from "../src/shared/wsClientIdentity";

test("WebSocket client identities assign one fixed role and transport", () => {
  for (const identity of Object.values(WS_CLIENT_IDENTITIES)) {
    assert.deepEqual(resolveWsClientIdentity(identity.clientName), identity);
    assert.equal(wsClientNameForRole(identity.assignedRole), identity.clientName);
  }
  assert.equal(resolveWsClientIdentity("caller-selected-admin"), undefined);
  assert.equal(
    resolveWsClientIdentity("chrome-devtools-legacy-plugin"),
    undefined,
  );
  assert.equal(resolveWsClientIdentity(undefined), undefined);
});
