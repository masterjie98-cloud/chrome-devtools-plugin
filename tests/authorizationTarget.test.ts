import assert from "node:assert/strict";
import test from "node:test";
import {
  canFollowAuthorizedPageEffectForRead,
  sameAuthorizedTopLevelTarget,
} from "../src/mcp/wsServer";
import type { ActiveTabSnapshot } from "../src/shared/wsProtocol";

const approvedTarget: ActiveTabSnapshot = {
  url: "https://app.example.test/form",
  title: "Form",
  targetId: "tab-17",
  tabId: 17,
  windowId: 4,
  frameId: 0,
  documentId: "document-before",
  navigationId: "navigation-before",
  revision: 8,
};

test("post-effect evidence may follow a new document in the same exact tab", () => {
  assert.equal(
    sameAuthorizedTopLevelTarget(approvedTarget, {
      ...approvedTarget,
      url: "https://login.example.test/authorize",
      documentId: "document-after",
      navigationId: "navigation-after",
      revision: 9,
    }),
    true,
  );
});

test("post-effect evidence cannot follow a different tab, target, or window", () => {
  assert.equal(
    sameAuthorizedTopLevelTarget(approvedTarget, {
      ...approvedTarget,
      tabId: 18,
      targetId: "tab-18",
    }),
    false,
  );
  assert.equal(
    sameAuthorizedTopLevelTarget(approvedTarget, {
      ...approvedTarget,
      targetId: "different-target",
    }),
    false,
  );
  assert.equal(
    sameAuthorizedTopLevelTarget(approvedTarget, {
      ...approvedTarget,
      windowId: 5,
    }),
    false,
  );
});

test("only a read after a dispatched page effect may follow the replacement document", () => {
  const replacementDocument = {
    ...approvedTarget,
    url: "https://app.example.test/complete",
    documentId: "document-after",
    navigationId: "navigation-after",
  };
  assert.equal(
    canFollowAuthorizedPageEffectForRead(
      true,
      "none",
      approvedTarget,
      replacementDocument,
    ),
    true,
  );
  assert.equal(
    canFollowAuthorizedPageEffectForRead(
      false,
      "none",
      approvedTarget,
      replacementDocument,
    ),
    false,
  );
  assert.equal(
    canFollowAuthorizedPageEffectForRead(
      true,
      "page",
      approvedTarget,
      replacementDocument,
    ),
    false,
  );
});
