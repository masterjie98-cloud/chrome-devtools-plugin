import assert from "node:assert/strict";
import test from "node:test";
import {
  canExecuteAgentToolBatchInParallel,
  executeAgentToolBatch,
} from "../src/sidepanel/services/agentToolBatch";
import type { AiRequestedToolCall } from "../src/sidepanel/services/aiClient";

const safeReads: AiRequestedToolCall[] = [
  { id: "read-1", name: "browser_snapshot", arguments: {}, rawArguments: "{}" },
  {
    id: "read-2",
    name: "browser_query_dom",
    arguments: { query: "button" },
    rawArguments: '{"query":"button"}',
  },
];

test("independent safe reads execute concurrently and retain request order", async () => {
  let active = 0;
  let peak = 0;
  let started = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const running = executeAgentToolBatch(safeReads, async (call) => {
    active += 1;
    started += 1;
    peak = Math.max(peak, active);
    await gate;
    active -= 1;
    return call.id;
  });

  await Promise.resolve();
  await Promise.resolve();
  const startedBeforeRelease = started;
  release();
  assert.deepEqual(await running, ["read-1", "read-2"]);
  assert.equal(startedBeforeRelease, 2);
  assert.equal(peak, 2);
});

test("mutations and approval-gated reads stay serialized", async () => {
  const mutationBatch: AiRequestedToolCall[] = [
    {
      id: "write",
      name: "browser_click",
      arguments: { selector: "#save" },
      rawArguments: '{"selector":"#save"}',
    },
    ...safeReads.slice(0, 1),
  ];
  const sensitiveBatch: AiRequestedToolCall[] = [
    {
      id: "cookies",
      name: "browser_cookie_list",
      arguments: { includeValues: true },
      rawArguments: '{"includeValues":true}',
    },
    ...safeReads.slice(0, 1),
  ];

  assert.equal(canExecuteAgentToolBatchInParallel(mutationBatch), false);
  assert.equal(canExecuteAgentToolBatchInParallel(sensitiveBatch), false);

  let active = 0;
  let peak = 0;
  await executeAgentToolBatch(mutationBatch, async (call) => {
    active += 1;
    peak = Math.max(peak, active);
    await Promise.resolve();
    active -= 1;
    return call.id;
  });
  assert.equal(peak, 1);
});

test("an ordered batch skips remaining calls after the first failed dependency", async () => {
  type BatchResult = {
    id: string;
    outcome: "failed" | "skipped";
    blockedBy?: string;
  };
  const calls: AiRequestedToolCall[] = [
    {
      id: "open-dialog",
      name: "browser_click",
      arguments: { selector: "#open" },
      rawArguments: '{"selector":"#open"}',
    },
    {
      id: "type-name",
      name: "browser_type",
      arguments: { selector: "#name", text: "demo" },
      rawArguments: '{"selector":"#name","text":"demo"}',
    },
    {
      id: "save-dialog",
      name: "browser_click",
      arguments: { selector: "#save" },
      rawArguments: '{"selector":"#save"}',
    },
  ];
  const executed: string[] = [];

  const results = await executeAgentToolBatch<BatchResult>(
    calls,
    async (call) => {
      executed.push(call.id);
      return { id: call.id, outcome: "failed" };
    },
    {
      shouldStopAfter: (result) => result.outcome === "failed",
      createSkippedResult: (call, blockedBy) => ({
        id: call.id,
        outcome: "skipped",
        blockedBy: blockedBy.id,
      }),
    },
  );

  assert.deepEqual(executed, ["open-dialog"]);
  assert.deepEqual(results, [
    { id: "open-dialog", outcome: "failed" },
    { id: "type-name", outcome: "skipped", blockedBy: "open-dialog" },
    { id: "save-dialog", outcome: "skipped", blockedBy: "open-dialog" },
  ]);
});
