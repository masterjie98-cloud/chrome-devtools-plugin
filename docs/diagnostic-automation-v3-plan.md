# Diagnostic Automation V3 Plan

Status: implementation complete; automated and real Chrome validation passed  
Scope: local single-user Chrome extension, local daemon, stdio MCP adapter,
sidepanel Agent, existing Rules workbench, and disposable Chrome fixtures

## 1. Objective

Close the remaining gap between observing a browser symptom and producing a
repeatable, source-linked fix. V3 adds seven bounded capabilities without
introducing arbitrary page evaluation, arbitrary filesystem access, silent
write replay, or unbounded event retention.

## 2. Delivery slices

### 2.1 CSS source explanation

Add one document-bound diagnostic operation that returns:

- matched author rules and their stylesheet origin;
- winning declarations for requested properties;
- inherited/custom-property dependencies;
- active media/supports conditions;
- pseudo-state applicability where Chrome exposes it;
- box-model geometry;
- generated stylesheet location suitable for the existing source/workspace
  locators.

The V1 caller supplies an exact selector and a bounded property projection.
The extension injects one fixed build-owned MAIN-world function into the exact
document. React/Vue and JavaScript source maps remain the responsibility of the
existing `browser_locate_source`; the V1 CSS result does not claim an original
CSS source-map line.

### 2.2 Reproduction recipe

Represent a successful diagnostic workflow as a versioned recipe containing:

- exact origin and optional route precondition;
- bounded observations and actions;
- deterministic checks;
- requested evidence channels;
- cleanup metadata;
- source evidence artifact references;
- the runtime compatibility identity used at capture time.

Recipe execution performs a fresh observation and a compatibility check. Every
write is re-authorized under the current approval mode. A transport failure
after dispatch is terminal and is never replayed automatically.

### 2.3 Local workspace source bridge

The stdio MCP adapter may map browser source hints to local candidates only
inside explicitly configured workspace roots.

- Roots come from `AI_DEVTOOLS_WORKSPACE_ROOTS` or the adapter working directory.
- The page and extension never receive root paths.
- Input is a source URL/path suffix, component name, or symbol hint.
- Results contain bounded path, line, score, and reason metadata.
- An excerpt is returned only when explicitly requested and is capped at 1,500
  characters.
- Realpath containment rejects traversal and symlink escape.

This is adapter-local functionality. It does not cross the daemon-to-extension
browser authority boundary.

### 2.4 Stateful Mock scenarios

Extend debugger proxy rules with optional scenario state:

- ordered response steps;
- persisted current-step and total-hit counters;
- repeat policy (`hold-last` or `loop`);
- explicit reset;
- bounded runtime hit/step status on the existing rule.

Scenario state is persisted with the Profile-local proxy rules. Editing or
resetting a scenario is a write and follows the existing approval policy.
Response bodies retain the existing byte limits and redaction behavior.

### 2.5 Performance diagnostic bundle

Capture a bounded performance window containing:

- navigation/resource timing summary;
- Long Task count and duration;
- layout-shift count and score;
- largest-contentful-paint when the browser reports it;
- warnings when a metric is unsupported or incomplete.

The V1 uses buffered browser PerformanceObserver entries. INP, raw trace
streams, heap snapshots, and action-attributed performance windows remain out
of scope.

### 2.6 Realtime application state

Add sanitized incremental summaries for:

- WebSocket open/close/error and frame direction/byte length;
- EventSource messages by URL/event name/byte length;
- Service Worker controller and registration metadata;
- IndexedDB database/version/store schema snapshots.

Message bodies, IndexedDB values, credentials, and arbitrary storage dumps are
excluded. WebSocket/EventSource summaries are retained only in the bounded
debugger session. The existing 200-event DOM/Network/Console activity ring,
sequence gaps, subscription resource, and target binding remain authoritative.

### 2.7 Real Chrome regression

The disposable fixture and workflow verifier now covers:

- same-process iframe pointer click plus multi-field input;
- CSS winning-rule and box-model evidence;
- recipe capture and explicit replay;
- stateful Mock step progression and reset;
- performance metrics plus a deterministic Long Task/layout change;
- payload-free WebSocket/SSE result shapes and IndexedDB schema metadata;
- no message body, storage value, local source content, or inline screenshot
  bytes leak into structured summaries.

## 3. MCP surface

Prefer workflow tools over exposing raw CDP primitives:

- `browser_explain_css`
- `browser_create_reproduction_recipe`
- `browser_run_reproduction_recipe`
- `browser_find_workspace_source`
- `browser_performance_diagnostics`
- `browser_realtime_activity`

Stateful Mock remains part of the existing proxy-rule surface so Rules UI, MCP,
audit, approval, and target routing share one implementation.

Every new tool requires:

- strict Zod input and output schemas;
- explicit annotations and internal executor allowlist;
- bounded collections and character counts;
- actionable errors;
- Smart Profile inclusion only when it reduces model round trips;
- unit and integration coverage;
- a real-browser gate for Chrome-only behavior.

## 4. Trust boundaries

- Browser/page input remains untrusted evidence.
- CSS/source inspection is a sensitive read.
- Workspace mapping runs only in the stdio adapter and cannot be requested by a
  page-originated message.
- Recipe creation is a sensitive read; recipe execution is classified from its
  nested actions and never inherits the old execution grant.
- Mock scenario mutation is a browser/network write.
- Performance and realtime metadata are sensitive reads.
- Raw WebSocket/SSE payloads and IndexedDB values require a separately approved
  future design and are not part of V3.
- Activity and recipe artifacts inherit session binding, TTL, per-object,
  per-session, and global quotas.

## 5. Validation

Automated:

```bash
npm run typecheck
npm test
npm run build
npm run verify:packaged
git diff --check
```

Real Chrome:

```bash
npm run verify:workflow-evidence -- \
  --tab-url-prefix http://127.0.0.1:8765/index.html
```

Automated evidence currently passes:

- TypeScript compilation;
- 342-test full suite;
- production extension/daemon/MCP build;
- packaged two-adapter lifecycle verification with 84 exposed tools;
- syntax validation for the combined real-Chrome verifier.

Real Chrome evidence captured on 2026-07-28:

- adapter, daemon, and browser agreed on build `0.1.0+ws8` and schema
  `91428723`;
- one four-action workflow completed with four post-action states, successful
  verification, and DOM/URL/Network/Console evidence;
- both OOPIF and same-process iframe writes used document-bound frame
  references and were verified by a fresh observation;
- the second identical element screenshot returned
  `changed=false`, `changedPixelRatio=0`, and no replacement baseline;
- the activity subscription delivered console, DOM, navigation, and network
  events, and linked the fixture request with high confidence;
- source lookup, CSS explanation, bounded workspace lookup, recipe replay,
  performance diagnostics, realtime metadata, Stateful Mock progression, and
  issue-evidence artifact creation all completed;
- Stateful Mock reached step index 1 after two hits, with verification passing;
- IndexedDB metadata exposed the fixture database and `events` store without
  returning stored values.

The verifier returned `"ok": true`. Unsupported browser metrics must still be
reported as unavailable; they cannot be represented as zero or success.
