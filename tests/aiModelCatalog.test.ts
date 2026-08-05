import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveAiChatCompletionsUrl,
  resolveAiModelsUrl,
} from "../src/sidepanel/services/aiEndpointPolicy";
import {
  fetchAiModelCatalog,
  parseOpenAiModelList,
} from "../src/sidepanel/services/aiModelCatalog";

test("OpenAI-compatible endpoints derive chat and model-list URLs from a base URL", () => {
  assert.equal(
    resolveAiChatCompletionsUrl("https://llm.example.test/"),
    "https://llm.example.test/v1/chat/completions",
  );
  assert.equal(
    resolveAiModelsUrl("https://llm.example.test/"),
    "https://llm.example.test/v1/models",
  );
  assert.equal(
    resolveAiModelsUrl("https://llm.example.test/v1/chat/completions"),
    "https://llm.example.test/v1/models",
  );
  assert.equal(
    resolveAiModelsUrl("http://127.0.0.1:11434/v1"),
    "http://127.0.0.1:11434/v1/models",
  );
  assert.throws(
    () => resolveAiModelsUrl("https://llm.example.test/custom-generate"),
    /无法.*推导模型列表地址/,
  );
  assert.throws(
    () => resolveAiModelsUrl("https://llm.example.test/v1/models"),
    /不能填写模型列表地址/,
  );
});

test("model catalog accepts OpenAI list shape, de-duplicates IDs, and sends the configured key", async () => {
  let requestedUrl = "";
  let authorization = "";
  const result = await fetchAiModelCatalog(
    {
      apiUrl: "https://llm.example.test/",
      apiKey: "secret-test-key",
    },
    {
      fetchImpl: async (input, init) => {
        requestedUrl = input;
        authorization = new Headers(init?.headers).get("authorization") ?? "";
        return new Response(
          JSON.stringify({
            object: "list",
            data: [
              { id: "Kimi-K2.7-Code", object: "model" },
              { id: "deepseek-chat", object: "model" },
              { id: "Kimi-K2.7-Code", object: "model" },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    },
  );

  assert.equal(requestedUrl, "https://llm.example.test/v1/models");
  assert.equal(authorization, "Bearer secret-test-key");
  assert.deepEqual(result.models, ["Kimi-K2.7-Code", "deepseek-chat"]);
});

test("model catalog reports authentication failures without exposing the key", async () => {
  await assert.rejects(
    fetchAiModelCatalog(
      { apiUrl: "https://llm.example.test/v1", apiKey: "do-not-print" },
      {
        fetchImpl: async () =>
          new Response(
            JSON.stringify({ error: { message: "No api key passed in." } }),
            { status: 401 },
          ),
      },
    ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /模型列表鉴权失败/);
      assert.doesNotMatch(error.message, /do-not-print/);
      return true;
    },
  );
});

test("model list parser rejects incompatible shapes", () => {
  assert.throws(
    () => parseOpenAiModelList({ models: ["one"] }),
    /OpenAI-compatible/,
  );
});
