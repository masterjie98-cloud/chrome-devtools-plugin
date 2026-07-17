import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const EXPECTED_BROWSER_EVIDENCE_SECTIONS = [
  "1",
  "3",
  "3.1",
  "3.2",
  "3.3",
  "3.4",
  "3.5",
  "4",
  "4.1",
  "4.2",
  "4.3",
  "4.4",
  "4.5",
  "4.6",
  "4.7",
  "5",
  "6",
  "7",
];

const ENVIRONMENT_LABELS = [
  "Date",
  "Tester",
  "Chrome version",
  "OS version",
  "Extension build time or local revision",
  "Daemon mode (`daemon:dev` or packaged)",
  "Profile A installation ID",
  "Profile B installation ID",
];

const MANUAL_HEADINGS = new Map([
  ["1", "## 1. Build and start the local components"],
  ["3", "## 3. Verify tab and frame routing"],
  ["3.1", "### 3.1 Verify session/target resource templates"],
  ["3.2", "### 3.2 Verify semantic snapshot pagination and freshness"],
  ["3.3", "### 3.3 Verify Network, conversation, and audit pagination"],
  ["3.4", "### 3.4 Verify sidepanel page read and element picker"],
  ["3.5", "### 3.5 Verify sidepanel tool-result completeness and scrolling"],
  ["4", "## 4. Verify trusted coordinate input and approval"],
  ["4.1", "### 4.1 Verify one-dialog CDP handling"],
  ["4.2", "### 4.2 Verify trusted typing and key presses"],
  ["4.3", "### 4.3 Verify batch form preflight and scoped select behavior"],
  ["4.4", "### 4.4 Verify stale approval, Stop, and unavailable UI"],
  ["4.5", "### 4.5 Verify sensitive values, redaction, and egress destination"],
  ["4.6", "### 4.6 Verify screenshot artifact rendering"],
  ["4.7", "### 4.7 Verify Network-rule mutation confirmation and cleanup"],
  ["5", "## 5. Verify AI credential storage and Provider confirmation"],
  ["6", "## 6. Protocol negotiation and reconnect"],
  ["7", "## 7. Profile isolation"],
]);

const PROHIBITED_EVIDENCE_PATTERNS = [
  /manual-local-value/i,
  /manual-session-value/i,
  /manual-cookie-value/i,
  /manual-mutation-value/i,
  /manual-header-marker/i,
  /manual-query-marker/i,
  /manual-response-body-marker/i,
  /manual-rule-marker/i,
  /\bBearer\s+[A-Za-z0-9._~-]+/i,
  /access_token\s*=/i,
];

try {
  const args = parseArguments(process.argv.slice(2));
  const evidencePath = resolve(rootDir, args.file);
  const manualPath = resolve(rootDir, args.manual);
  const [evidenceText, manualText] = await Promise.all([
    readFile(evidencePath, "utf8"),
    readFile(manualPath, "utf8"),
  ]);
  const report = validateBrowserEvidence(evidenceText, manualText);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) {
    process.exitCode = 1;
  } else if (args.requireComplete && !report.complete) {
    process.exitCode = 2;
  }
} catch (error) {
  process.stderr.write(
    `${JSON.stringify(
      {
        ok: false,
        errors: [
          `EVIDENCE_VERIFICATION_FAILED:${safeErrorCode(error)}`,
        ],
      },
      null,
      2,
    )}\n`,
  );
  process.exitCode = 1;
}

export function validateBrowserEvidence(evidenceText, manualText) {
  const errors = [];
  const rows = parseEvidenceRows(evidenceText, errors);
  const seenSections = new Set();

  for (const row of rows) {
    if (seenSections.has(row.section)) {
      errors.push(`DUPLICATE_SECTION:${row.section}`);
    }
    seenSections.add(row.section);
    if (!EXPECTED_BROWSER_EVIDENCE_SECTIONS.includes(row.section)) {
      errors.push(`UNEXPECTED_SECTION:${row.section}`);
    }
    if (row.status === "fail" && !row.notes) {
      errors.push(`FAILURE_NOTE_REQUIRED:${row.section}`);
    }
    if (row.notes.length > 500) {
      errors.push(`NOTE_TOO_LONG:${row.section}`);
    }
    if (containsProhibitedEvidence(row.notes)) {
      errors.push(`SENSITIVE_CONTENT_DETECTED:section:${row.section}`);
    }
  }

  for (const section of EXPECTED_BROWSER_EVIDENCE_SECTIONS) {
    if (!seenSections.has(section)) {
      errors.push(`MISSING_SECTION:${section}`);
    }
    const heading = MANUAL_HEADINGS.get(section);
    if (!heading || !manualText.split("\n").includes(heading)) {
      errors.push(`MANUAL_SECTION_MISSING:${section}`);
    }
  }

  const environment = parseEnvironment(evidenceText, errors);
  const failureNotes = extractFailureNotes(evidenceText);
  if (containsProhibitedEvidence(failureNotes)) {
    errors.push("SENSITIVE_CONTENT_DETECTED:failures");
  }

  const counts = { notRun: 0, pass: 0, fail: 0 };
  for (const row of rows) {
    if (row.status === "not-run") counts.notRun += 1;
    if (row.status === "pass") counts.pass += 1;
    if (row.status === "fail") counts.fail += 1;
  }
  const environmentComplete = ENVIRONMENT_LABELS.every(
    (label) => environment.get(label) !== "not-run",
  );
  const complete =
    errors.length === 0 &&
    rows.length === EXPECTED_BROWSER_EVIDENCE_SECTIONS.length &&
    counts.pass === EXPECTED_BROWSER_EVIDENCE_SECTIONS.length &&
    environmentComplete;

  return {
    ok: errors.length === 0,
    complete,
    counts,
    environmentComplete,
    remainingSections: rows
      .filter((row) => row.status !== "pass")
      .map((row) => row.section),
    errors: [...new Set(errors)].sort(),
  };
}

function parseEvidenceRows(text, errors) {
  const rows = [];
  for (const line of text.split("\n")) {
    if (!/^\|\s*\d/.test(line)) continue;
    const cells = line
      .slice(1, line.endsWith("|") ? -1 : undefined)
      .split("|")
      .map((cell) => cell.trim());
    if (cells.length !== 4) {
      errors.push("INVALID_TABLE_ROW");
      continue;
    }
    const [section, _evidence, status, notes] = cells;
    if (!section || !status || notes === undefined) {
      errors.push("INVALID_TABLE_ROW");
      continue;
    }
    if (!new Set(["not-run", "pass", "fail"]).has(status)) {
      errors.push(`INVALID_STATUS:${section}`);
      continue;
    }
    rows.push({ section, status, notes });
  }
  return rows;
}

function parseEnvironment(text, errors) {
  const values = new Map();
  const lines = text.split("\n");
  for (const label of ENVIRONMENT_LABELS) {
    const prefix = `- ${label}: `;
    const matches = lines.filter((line) => line.startsWith(prefix));
    if (matches.length !== 1) {
      errors.push(`ENVIRONMENT_FIELD_COUNT:${label}`);
      values.set(label, "not-run");
      continue;
    }
    const value = matches[0].slice(prefix.length).trim();
    if (!value || value.includes("not-run")) {
      values.set(label, "not-run");
      continue;
    }
    if (containsProhibitedEvidence(value)) {
      errors.push(`SENSITIVE_CONTENT_DETECTED:environment:${label}`);
    }
    if (
      label.startsWith("Profile ") &&
      !/^redacted-[A-Za-z0-9_-]{4,12}$/.test(value)
    ) {
      errors.push(`PROFILE_ID_NOT_REDACTED:${label}`);
    }
    values.set(label, value);
  }
  return values;
}

function extractFailureNotes(text) {
  const start = text.indexOf("## Sanitized failures");
  const end = text.indexOf("## Completion rule");
  if (start === -1 || end === -1 || end <= start) return "";
  return text.slice(start, end);
}

function containsProhibitedEvidence(value) {
  return PROHIBITED_EVIDENCE_PATTERNS.some((pattern) => pattern.test(value));
}

function parseArguments(argv) {
  const result = {
    file: "docs/browser-validation-results.md",
    manual: "docs/manual-browser-validation.md",
    requireComplete: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--require-complete") {
      result.requireComplete = true;
      continue;
    }
    if (argument === "--file" || argument === "--manual") {
      const value = argv[index + 1];
      if (!value) throw new Error(`Missing value for ${argument}`);
      result[argument === "--file" ? "file" : "manual"] = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return result;
}

function safeErrorCode(error) {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[A-Z0-9_]{1,40}$/.test(error.code)
  ) {
    return error.code;
  }
  return error instanceof Error ? error.name : "unknown";
}
