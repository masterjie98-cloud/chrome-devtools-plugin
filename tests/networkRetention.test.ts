import assert from "node:assert/strict";
import test from "node:test";
import {
  networkRequestRetentionPriority,
  selectNetworkRequestToEvict,
} from "../src/shared/networkRetention";

test("Network retention evicts completed static GET noise before business requests", () => {
  const selected = selectNetworkRequestToEvict([
    {
      requestId: "navigation",
      method: "GET",
      resourceType: "Document",
      status: 200,
      finished: true,
    },
    {
      requestId: "mutation",
      method: "POST",
      resourceType: "Fetch",
      status: 201,
      finished: true,
    },
    {
      requestId: "failed-read",
      method: "GET",
      resourceType: "XHR",
      status: 500,
      failed: true,
      finished: true,
    },
    {
      requestId: "image-noise",
      method: "GET",
      resourceType: "Image",
      status: 200,
      finished: true,
    },
  ]);

  assert.equal(selected, "image-noise");
});

test("Network retention keeps failures, mutations, navigation, and API reads ordered by importance", () => {
  const priorities = {
    image: networkRequestRetentionPriority({
      requestId: "image",
      method: "GET",
      resourceType: "Image",
      status: 200,
      finished: true,
    }),
    api: networkRequestRetentionPriority({
      requestId: "api",
      method: "GET",
      resourceType: "Fetch",
      status: 200,
      finished: true,
    }),
    navigation: networkRequestRetentionPriority({
      requestId: "navigation",
      method: "GET",
      resourceType: "Document",
      status: 200,
      finished: true,
    }),
    mutation: networkRequestRetentionPriority({
      requestId: "mutation",
      method: "PATCH",
      resourceType: "Fetch",
      status: 200,
      finished: true,
    }),
    failure: networkRequestRetentionPriority({
      requestId: "failure",
      method: "POST",
      resourceType: "Fetch",
      status: 500,
      failed: true,
      finished: true,
    }),
  };

  assert.ok(priorities.api > priorities.image);
  assert.ok(priorities.navigation > priorities.api);
  assert.ok(priorities.mutation > priorities.navigation);
  assert.ok(priorities.failure > priorities.mutation);
});
