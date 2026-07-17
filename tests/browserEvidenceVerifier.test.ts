import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createTestDataDirectory } from "./helpers/tempDataDir";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const verifierPath = resolve(rootDir, "scripts/verify-browser-evidence.mjs");
const evidencePath = resolve(rootDir, "docs/browser-validation-results.md");

test("browser evidence verifier reports the authoritative worksheet consistently", () => {
  const result = runVerifier();
  assert.equal(result.status, 0, result.stderr);
  const report = parseReport(result.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.complete, false);
  assert.equal(
    report.counts.notRun + report.counts.pass + report.counts.fail,
    18,
  );
  assert.equal(report.environmentComplete, false);
  assert.equal(
    report.remainingSections.length,
    report.counts.notRun + report.counts.fail,
  );
});

test("browser evidence completion gate fails closed while rows remain not-run", () => {
  const result = runVerifier(["--require-complete"]);
  assert.equal(result.status, 2, result.stderr);
  assert.equal(parseReport(result.stdout).complete, false);
});

test("browser evidence completion gate accepts a fully populated sanitized worksheet", async () => {
  const dataDir = await createTestDataDirectory("browser-evidence-complete-");
  try {
    const source = await readFile(evidencePath, "utf8");
    const completed = populateEnvironment(source).replace(
      /^\| (\d(?:\.\d)?) \| ([^|]+) \| (?:not-run|pass|fail) \|.*\|$/gm,
      "| $1 | $2 | pass | |",
    );
    const file = resolve(dataDir.rootDir, "complete.md");
    await writeFile(file, completed, "utf8");

    const result = runVerifier([
      "--file",
      file,
      "--require-complete",
    ]);
    assert.equal(result.status, 0, result.stderr);
    const report = parseReport(result.stdout);
    assert.equal(report.ok, true);
    assert.equal(report.complete, true);
    assert.deepEqual(report.counts, { notRun: 0, pass: 18, fail: 0 });
    assert.equal(report.environmentComplete, true);
  } finally {
    await dataDir.cleanup();
  }
});

test("browser evidence verifier rejects duplicate rows and sensitive notes without echoing them", async () => {
  const dataDir = await createTestDataDirectory("browser-evidence-invalid-");
  try {
    const source = await readFile(evidencePath, "utf8");
    const rawProfileId = "profile-installation-id-must-not-be-recorded";
    const invalid = setEnvironmentField(
      source,
      "Profile A installation ID",
      rawProfileId,
    ).replace(
      /^\| 1 \|[^\n]+$/m,
      "| 1 | Extension, daemon, token pairing and MCP tools available | fail | manual-header-marker |\n| 1 | Duplicate | pass | |",
    );
    const file = resolve(dataDir.rootDir, "invalid.md");
    await writeFile(file, invalid, "utf8");

    const result = runVerifier(["--file", file]);
    assert.equal(result.status, 1);
    const report = parseReport(result.stdout);
    assert.equal(report.ok, false);
    assert.ok(report.errors.includes("DUPLICATE_SECTION:1"));
    assert.ok(report.errors.includes("SENSITIVE_CONTENT_DETECTED:section:1"));
    assert.ok(
      report.errors.includes(
        "PROFILE_ID_NOT_REDACTED:Profile A installation ID",
      ),
    );
    assert.equal(result.stdout.includes("manual-header-marker"), false);
    assert.equal(result.stdout.includes(rawProfileId), false);
  } finally {
    await dataDir.cleanup();
  }
});

test("browser evidence verifier never echoes an invalid argument", () => {
  const result = runVerifier(["--manual-header-marker"]);
  assert.equal(result.status, 1);
  assert.equal(result.stderr.includes("manual-header-marker"), false);
  assert.deepEqual(JSON.parse(result.stderr), {
    ok: false,
    errors: ["EVIDENCE_VERIFICATION_FAILED:Error"],
  });
});

function runVerifier(args: string[] = []): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync(process.execPath, [verifierPath, ...args], {
    cwd: rootDir,
    encoding: "utf8",
  });
  return {
    status: result.status,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
  };
}

function populateEnvironment(source: string): string {
  const values: Record<string, string> = {
    Date: "2026-07-13",
    Tester: "local-user",
    "Chrome version": "126.0.0.0",
    "OS version": "macOS-test",
    "Extension build time or local revision": "local-revision",
    "Daemon mode (`daemon:dev` or packaged)": "packaged",
    "Profile A installation ID": "redacted-a1b2c3",
    "Profile B installation ID": "redacted-d4e5f6",
  };
  return Object.entries(values).reduce(
    (text, [label, value]) => setEnvironmentField(text, label, value),
    source,
  );
}

function setEnvironmentField(
  source: string,
  label: string,
  value: string,
): string {
  const prefix = `- ${label}: `;
  return source
    .split("\n")
    .map((line) => (line.startsWith(prefix) ? `${prefix}${value}` : line))
    .join("\n");
}

function parseReport(output: string): {
  ok: boolean;
  complete: boolean;
  counts: { notRun: number; pass: number; fail: number };
  environmentComplete: boolean;
  remainingSections: string[];
  errors: string[];
} {
  return JSON.parse(output) as {
    ok: boolean;
    complete: boolean;
    counts: { notRun: number; pass: number; fail: number };
    environmentComplete: boolean;
    remainingSections: string[];
    errors: string[];
  };
}
