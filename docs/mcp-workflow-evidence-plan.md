# MCP Workflow and Evidence Upgrade Plan

- Status: Complete; automated and real Chrome workflow gates passed
- Date: 2026-07-23 to 2026-07-24
- Scope: Chrome extension, local daemon, MCP adapter, shared protocol and tests
- Depends on:
  - `docs/architecture-v2.md`
  - `docs/execution-core-optimization-plan.md`
  - `docs/smart-mcp-kernel.md`

## 1. Objective

Reduce model-visible MCP round trips while improving action correctness and
evidence quality. One `browser_workflow` call must be able to observe the page,
execute a bounded action stage, verify the requested outcome and return compact
DOM, URL, Network and Console evidence.

This upgrade also makes cross-frame targets directly actionable without
changing global frame selection, detects stale extension/daemon/adapter builds
before tool execution, and adds bounded field projection and visual diffs to
reduce context usage.

## 2. Fixed constraints

1. The daemon is local-only and serves one operating-system user.
2. Page content, screenshots, Network data, Console data and model input remain
   untrusted.
3. A model cannot grant itself a broader capability.
4. Every mutation remains bound to an approved top-level target and a fresh
   frame document.
5. A stale `targetRef`, `frameRef`, `documentId`, navigation or signed execution
   grant fails closed before mutation.
6. Cross-frame execution must route directly to the referenced frame; it must
   not silently change the user's selected frame.
7. A workflow must not replay an unknown-state write after transport loss.
8. Screenshot bytes remain artifacts or MCP image content and must not be
   duplicated in `structuredContent`.
9. No screenshot is attached merely because the user sends a chat message.
10. Existing primitive MCP tools remain available for expert/debug use.

## 3. Current baseline

- `browser_observe`, `browser_act`, `browser_verify` and
  `browser_debug_activity` are separate model-visible calls.
- Multi-frame observation already reads registered frames in parallel, but
  child-frame semantic nodes are intentionally non-actionable.
- Snapshot references are stored per MCP session for only one selected-frame
  snapshot.
- Browser execution grants bind tab, frame, document and navigation identity,
  but the verifier currently compares only the selected active target.
- Element screenshots exist by selector for the selected frame.
- Network and Console evidence exist, but action correlation is currently
  reconstructed by the model rather than returned as one causal evidence
  window.
- Verification supports semantic state flags but does not expose control
  `value`, multi-select `selectedValues` or deterministic per-action post-state.
- WebSocket compatibility is checked only by numeric protocol version.

## 4. Public protocol additions

### 4.1 `browser_workflow`

Input:

- bounded observation options;
- optional semantic field projection;
- zero or more action-stage actions;
- zero or more verification checks;
- evidence flags for DOM delta, URL, Network and Console;
- optional visual checkpoint configuration.

Output:

- `version: "browser-workflow-v1"`;
- before/after target provenance;
- compact before observation;
- per-action result and post-state;
- verification results;
- correlated evidence window:
  - DOM revision delta;
  - URL/navigation change;
  - Network digest since workflow start;
  - Console entries since workflow start;
- bounded timing and payload metadata;
- explicit completeness and truncation markers.

The workflow stops on denial, stale context, navigation/document drift,
decision barrier or failed action. It never hides partial completion.

### 4.2 Verification state

Semantic nodes and verification checks gain:

- `value` for non-sensitive value-bearing controls;
- `selectedValues` for select/listbox controls;
- action `postState` containing the observed target state after execution.

Password, file, OTP-like and other sensitive fields must omit or redact values.
Checks support exact value equality and set-equality for selected values.

### 4.3 Build compatibility identity

Every adapter, daemon and browser hello/welcome payload gains:

- `buildId`;
- `schemaHash`.

The hash is derived from the canonical tool input definitions, explicit output
schema revision and WebSocket protocol revision. A mismatch rejects the
connection with an actionable diagnostic naming the stale component and asking
the user to restart the daemon, restart the MCP client or reload the extension.

`browser_status` reports the three identities and compatibility state without
page data.

### 4.4 Frame-scoped references

Multi-frame observations return:

- opaque `frameRef`;
- explicit `documentId`;
- frame-scoped actionable `targetRef` values.

The adapter stores the authoritative mapping. An action may supply
`frameRef + documentId + targetRef`; the raw selector remains server-side.

The daemon may sign a frame-scoped execution grant only when:

- the referenced frame belongs to the already-approved tab/window;
- the top-level navigation still matches;
- the registered frame still has the exact document ID;
- the reference belongs to the same MCP session and snapshot generation.

The extension revalidates all of these conditions before routing directly with
Chrome's `{frameId, documentId}` address.

### 4.5 Projection and visual comparison

Observation supports an allowlisted semantic field projection. Safety fields
needed for reference resolution and action classification remain internal even
when omitted from model output.

Screenshot improvements:

- accept element `targetRef` and optional frame scope;
- support comparison with the previous compatible visual baseline;
- return compact change metrics and changed bounds;
- allow callers to omit the new image when unchanged;
- retain explicit completeness and baseline-availability markers.

No new production dependency is added for image diff. Pixel comparison runs in
the extension environment with bounded dimensions and memory.

## 5. Internal design

### 5.1 Reference store

Replace the single snapshot reference set with a session-owned generation that
contains one frame reference set per observed frame. Each set binds:

- top-level tab/window/navigation identity;
- frame ID and exact document ID;
- snapshot fingerprint and source budget;
- opaque `frameRef`;
- target reference to selector and semantic target metadata.

Navigation, document replacement, session disposal or a new incompatible
snapshot generation invalidates the mappings.

### 5.2 Direct frame routing

Add an optional internal execution scope to browser tool requests and signed
execution grants. The scope is never accepted directly from MCP input; it is
resolved from the stored opaque frame reference.

Content-script reads and actions use the existing explicit
`sendTabRequest(tabId, request, { frameId, documentId })` path. Coordinate-based
trusted input additionally resolves the child element into top-level viewport
coordinates before CDP dispatch. If the coordinate transform cannot be proven,
the operation fails rather than falling back to the selected frame.

### 5.3 Evidence window

`browser_workflow` captures a local cursor before the first action:

- target/navigation identity;
- DOM revision;
- Network recorder cursor;
- Console cursor;
- monotonic start time.

After the action stage it reads only entries produced after those cursors,
collapses heartbeat-like Network groups, bounds Console data and returns
causality as evidence rather than as a success claim. Verification determines
success.

### 5.4 Failure semantics

- Observation failure: no actions run.
- Preflight failure: no actions run.
- Action failure: later dependent/effectful actions do not run.
- Transport loss after a write dispatch: result is
  `UNKNOWN_WRITE_OUTCOME`; the workflow does not replay it.
- Verification failure: completed actions remain reported; workflow status is
  `verification_failed`.
- Evidence truncation: workflow remains valid but marks the affected channel
  incomplete.
- Build/schema mismatch: connection rejected before state or tools are used.

## 6. Implementation order

1. Add compatibility identity constants, hello/welcome schemas, mismatch errors
   and handshake tests.
2. Extend semantic node collection with safe values and field projection.
3. Replace snapshot reference storage with multi-frame generations and opaque
   frame references.
4. Extend execution grants and background routing for directly addressed
   frames.
5. Add verification value checks and deterministic action post-state.
6. Add action evidence cursors and the `browser_workflow` registry, schemas,
   policy and runtime.
7. Add frame-aware element screenshots and bounded visual diff.
8. Update prompts, tool descriptions and compatibility documentation.
9. Run targeted tests, full tests, typecheck, smart-MCP evaluation, build and
   packaged verification.
10. Run a real Chrome regression covering top frame, iframe, route change,
    Network/Console evidence, stale references and screenshot diff.

## 7. Acceptance criteria

### Workflow efficiency

- A five-field same-page form can be observed, filled and verified through one
  model-visible `browser_workflow` call after any required approval.
- Independent fields use the existing bounded batch executor.
- The result contains per-action state and final verification without requiring
  a second model-directed DOM query.

### Evidence

- A route-changing action reports before/after URL and navigation identity.
- A DOM-only action reports a bounded revision delta.
- A request-producing action reports only Network activity after workflow
  start, with heartbeat groups collapsed.
- New Console errors after the action are included; older entries are excluded.
- Evidence channels declare completeness and truncation.

### Verification

- Text input value verification succeeds on exact value.
- Single-select and multi-select verification use `selectedValues`.
- Sensitive input values are absent or redacted.
- Every successful mutation result includes action post-state or an explicit
  reason it could not be observed.

### Cross-frame operation

- `browser_observe(frameScope="auto")` returns an actionable child-frame target.
- An action using `frameRef + documentId + targetRef` reaches the child frame
  without changing selected-frame state.
- Replacing the frame document makes the old action fail before mutation.
- A reference from another MCP session is rejected.

### Compatibility

- Matching adapter, daemon and extension identities connect normally.
- A build or schema mismatch is rejected with component-specific restart
  guidance.
- `browser_status` exposes compatibility identity but no sensitive page data.

### Visual context

- Element screenshot works from an observed target reference.
- A second unchanged capture can return metrics without duplicate image bytes.
- A changed capture reports ratio and bounded changed region.
- Missing baseline is explicit and never reported as unchanged.

## 8. Validation commands

Run narrow checks first:

```bash
npx tsx --test tests/daemonAdapter.test.ts
npx tsx --test tests/debuggerFrameRouting.test.ts tests/actionStage.test.ts
npx tsx --test tests/smartMcpEvaluation.test.ts tests/mcpOutput.test.ts
npx tsx --test tests/domQueryAndScreenshot.test.ts
```

Then run the repository gates:

```bash
npm test
npm run typecheck
npm run evaluate:smart-mcp
npm run build
npm run verify:packaged
```

Browser validation is separate from build validation and is recorded in
`docs/browser-validation-results.md`.

## 9. Delivery evidence

Completion requires:

- exact changed-file list;
- targeted and full command results;
- real-browser evidence for all states that require Chrome;
- explicit remaining risks;
- an update to `docs/mcp-efficiency-benchmark.md` only when new measured data
  exists;
- no claim of Codex Chrome parity without side-by-side measured evidence.

## 10. Current execution record

Implemented on 2026-07-23 and live-hardened on 2026-07-24:

- `browser_workflow` with bounded actions, verification and correlated
  DOM/URL/Network/Console evidence;
- safe semantic `value` and `selectedValues`, projected observation fields and
  per-action post-state;
- WebSocket protocol v7 with adapter/daemon/browser `buildId + schemaHash`
  negotiation and explicit legacy-client restart errors;
- session-owned `frameRef + documentId + targetRef` resolution and direct child
  frame routing;
- frame-aware element screenshots, bounded pixel diff and unchanged-image byte
  suppression;
- screenshot diff decoding that does not rely on service-worker `fetch(data:)`;
- direct child-frame trusted input for both OOPIF and same-process frames,
  including conservative document binding, unique OOPIF URL correlation and
  same-process content-box coordinate translation;
- a repeatable live gate in `scripts/verify-workflow-evidence.mjs`;
- bounded LaunchAgent bootstrap retry so a version-mismatch recovery does not
  fail on the macOS bootout/bootstrap race.

Verified on the final code state:

- `npm test`: 332 passed, 0 failed;
- `npm run evaluate:smart-mcp`: 17 passed, 0 failed;
- `npm run verify:packaged`: passed with 75 exposed daemon tools and two
  independent packaged adapters;
- `npm run verify:browser-evidence`: worksheet valid, with 12 historical manual
  sections still intentionally `not-run`;
- `npm run daemon:install-service` twice consecutively: both installs and
  follow-up status checks passed.

The real Chrome workflow gate passed on 2026-07-24 against the loopback
top-frame/OOPIF fixture:

- adapter, daemon and browser all reported `0.1.0+ws7 / f085f1dd`;
- one `browser_workflow` completed four actions, returned four action
  post-states and passed exact `value`, checkbox and single/multi-select checks;
- DOM, URL, Network and Console evidence channels were returned;
- `frameRef + documentId + targetRef` completed one OOPIF action and a fresh
  observation verified `value: "direct-frame-value"`;
- the second identical element screenshot reported `changed: false`,
  `changedPixelRatio: 0` and returned no image bytes.
