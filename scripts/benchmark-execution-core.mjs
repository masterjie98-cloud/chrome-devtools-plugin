import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const prefixFlag = process.argv.indexOf("--tab-url-prefix");
const iterationsFlag = process.argv.indexOf("--iterations");
const tabUrlPrefix =
  prefixFlag >= 0 ? process.argv[prefixFlag + 1]?.trim() : undefined;
const iterations = normalizeIterations(
  iterationsFlag >= 0 ? Number(process.argv[iterationsFlag + 1]) : 7,
);

if (!tabUrlPrefix || !/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\//.test(tabUrlPrefix)) {
  throw new Error(
    "Pass --tab-url-prefix with an already-open loopback benchmark page.",
  );
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/mcp/server.js"],
});
const client = new Client({
  name: "execution-core-benchmark",
  version: "1.0.0",
});

try {
  await client.connect(transport);
  const tabsResult = await client.callTool({
    name: "browser_list_tabs",
    arguments: {},
  });
  const tabs = tabsResult.structuredContent?.tabs;
  const target = Array.isArray(tabs)
    ? tabs.find((tab) => String(tab?.url ?? "").startsWith(tabUrlPrefix))
    : undefined;
  if (!target || !Number.isSafeInteger(target.id)) {
    throw new Error("The loopback benchmark tab is not open in the connected Profile.");
  }

  await client.callTool({
    name: "browser_set_target_tab",
    arguments: { tabId: target.id },
  });

  const samples = [];
  for (let index = 0; index < iterations; index += 1) {
    const startedAt = performance.now();
    const result = await client.callTool({
      name: "browser_snapshot",
      arguments: {
        limit: 40,
        mode: "interactive",
        sourceLimit: 2000,
      },
    });
    const elapsedMs = performance.now() - startedAt;
    if (result.isError || !result.structuredContent) {
      throw new Error("The benchmark snapshot failed.");
    }
    const snapshot = result.structuredContent;
    samples.push({
      elapsedMs,
      resultChars: JSON.stringify(snapshot).length,
      outputChars: Number(snapshot.snapshot?.stats?.outputChars ?? 0),
      nodeCount: Number(snapshot.snapshot?.nodes?.length ?? 0),
      sourceVisited: Number(snapshot.observation?.sourceVisited ?? 0),
      sourceLimit: Number(snapshot.observation?.sourceLimit ?? 0),
      truncated: snapshot.observation?.truncated === true,
    });
  }

  const timings = samples.map((sample) => sample.elapsedMs).sort(ascending);
  const resultChars = samples.map((sample) => sample.resultChars).sort(ascending);
  const outputChars = samples.map((sample) => sample.outputChars).sort(ascending);
  const latest = samples.at(-1);
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        iterations,
        target: {
          origin: new URL(target.url).origin,
          title: target.title,
        },
        timingMs: summarize(timings),
        resultChars: summarize(resultChars),
        semanticOutputChars: summarize(outputChars),
        nodeCount: latest?.nodeCount ?? 0,
        sourceVisited: latest?.sourceVisited ?? 0,
        sourceLimit: latest?.sourceLimit ?? 0,
        truncated: latest?.truncated ?? false,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await client.close();
}

function normalizeIterations(value) {
  if (!Number.isSafeInteger(value) || value < 3 || value > 30) {
    throw new Error("--iterations must be an integer between 3 and 30.");
  }
  return value;
}

function summarize(sorted) {
  return {
    min: round(sorted[0] ?? 0),
    median: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
    max: round(sorted.at(-1) ?? 0),
  };
}

function percentile(sorted, quantile) {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * quantile) - 1),
  );
  return sorted[index] ?? 0;
}

function ascending(left, right) {
  return left - right;
}

function round(value) {
  return Math.round(value * 100) / 100;
}
