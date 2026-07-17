import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSafeAiProviderUrl,
  getAiProviderOrigin,
  hasAiProviderOriginChanged,
  validateAiProviderUrl,
} from "../src/sidepanel/services/aiEndpointPolicy";

test("AI provider policy allows HTTPS and loopback HTTP", () => {
  for (const url of [
    "https://api.openai.com/v1",
    "http://localhost:11434/v1",
    "http://model.localhost:1234/v1",
    "http://127.0.0.1:8080/v1",
    "http://127.9.8.7:8080/v1",
    "http://[::1]:8080/v1",
  ]) {
    assert.equal(validateAiProviderUrl(url), undefined, url);
  }
});

test("AI provider origin comparison ignores paths but includes scheme and port", () => {
  assert.equal(
    hasAiProviderOriginChanged(
      "https://provider.example/v1/chat/completions",
      "https://provider.example/v2/responses",
    ),
    false,
  );
  assert.equal(
    hasAiProviderOriginChanged(
      "https://provider.example/v1",
      "https://other.example/v1",
    ),
    true,
  );
  assert.equal(
    hasAiProviderOriginChanged(
      "http://localhost:11434/v1",
      "http://localhost:1234/v1",
    ),
    true,
  );
  assert.equal(
    getAiProviderOrigin("https://provider.example/path"),
    "https://provider.example",
  );
});

test("AI provider policy rejects plaintext remote, credentials, and active schemes", () => {
  for (const url of [
    "http://api.example.com/v1",
    "https://user:password@api.example.com/v1",
    "javascript:alert(1)",
    "file:///tmp/provider",
    "not-a-url",
  ]) {
    assert.ok(validateAiProviderUrl(url), url);
    assert.throws(() => assertSafeAiProviderUrl(url));
  }
});
