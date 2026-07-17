# Architecture V2 Implementation Plan

> 2026-07-17 update: `docs/execution-core-optimization-plan.md` extends this
> ledger with dynamic risk policy, daemon-owned task grants, bounded DOM deltas,
> local action stages, adaptive visual checkpoints, Network observation
> sessions, and lifecycle metrics. Existing Profile, target, revision,
> execution-grant, idempotency, and audit boundaries remain authoritative.

- Status: In progress
- Started: 2026-07-10
- Product constraints: local single-user daemon; multiple Codex tasks and Chrome
  profiles; every mutation requires user confirmation
- Architecture decision: `docs/architecture-v2.md`
- Threat model: `chrome-devtools-plugin-threat-model.md`

This file is the durable execution ledger. Update the status, evidence, and
decision log whenever implementation scope changes. A checked item means its
acceptance evidence exists; code presence alone is not completion.

## Status legend

- `[ ]` not started
- `[~]` in progress
- `[x]` verified complete
- `[!]` blocked; the reason and required decision must be recorded

## Working rules

1. Preserve user changes. The repository has no commits and almost every file is
   staged or modified; do not reset, reformat, or replace unrelated work.
2. Use `apply_patch` for source and documentation edits.
3. Add tests with each behavior change. If a test cannot be added, record the
   missing evidence explicitly.
4. Run the narrowest check first, then typecheck, tests, build, and browser checks
   appropriate to the phase.
5. Do not call a migration complete while V1 fallback remains the active route.
6. Do not use MCP annotations as authorization. The daemon policy and Chrome
   executor are the enforcement boundaries.
7. Do not persist or print full bridge tokens, API keys, cookies, authorization
   headers, storage secrets, or base64 screenshots in test output.
8. Every new protocol field must have runtime validation and a negative test.

## Baseline evidence

- [x] Repository and runtime chains inspected.
- [x] User confirmed deployment and authorization constraints.
- [x] `npm run typecheck` passed before implementation.
- [x] No existing test or lint script was present in `package.json`.
- [x] Current worktree status recorded as no commits on `main` with existing
  staged/modified files.
- [x] Target architecture saved to `docs/architecture-v2.md`.
- [x] Threat model saved in the required repo-grounded format.

## Phase 0: Architecture and verification foundation

### P0.1 Documentation

- [x] Record current and target component boundaries.
- [x] Record product constraints and design invariants.
- [x] Define Protocol V3 identity, target, approval, cancellation, error, and
  artifact concepts.
- [x] Create `chrome-devtools-plugin-threat-model.md` with evidence anchors.
- [x] Add a short README with separate extension, daemon, and MCP startup paths
  after the daemon entrypoints exist.

### P0.2 Test harness

Planned files:

- `tests/**/*.test.ts`
- `package.json`

Tasks:

- [x] Add a TypeScript test script using the existing `tsx` dependency and
  Node's built-in test runner.
- [x] Add fixtures/builders for protocol messages without embedding secrets.
  Version, timestamp, hello shape, deterministic IDs, and the explicitly
  test-only bridge token now have one source under `tests/helpers`.
- [x] Add a deterministic clock/ID seam for session and approval tests. Daemon
  options can inject clock/ID functions without changing production defaults;
  connection IDs and approval IDs/timestamps are asserted exactly.
- [x] Add a temporary data-directory helper for daemon persistence tests. State,
  artifact, and integrated daemon tests use isolated config/state/artifact paths
  with recursive cleanup.

Acceptance evidence:

- `npm test`
- `npm run typecheck`

## Phase 1: Safety baseline in the current topology

These changes must remain valid after daemon extraction.

### P1.1 Canonical tool policy registry

Planned files:

- `src/shared/toolPolicy.ts` (new)
- `src/shared/tools.ts`
- `src/shared/mcpTools.ts`
- `src/sidepanel/App.tsx`
- `src/mcp/toolRuntime.ts`

Tasks:

- [x] Define policy classes: `safe_read`, `sensitive_read`, `reversible_write`,
  `page_action`, `destructive_write`, `arbitrary_execution`, `open_world`.
- [x] Define canonical metadata for every exposed MCP tool.
- [x] Default unknown tools to denied and approval-required.
- [x] Replace the hardcoded sidepanel approval set with the registry.
- [x] Derive MCP annotations from the same registry.
- [x] Add a coverage test proving every exposed tool has policy metadata.

Acceptance evidence:

- Unknown external tools require approval.
- Every tool with `writesPage: true` requires approval.
- Sensitive reads require approval even when they do not mutate the page.
- The policy registry and MCP exposed-tool list have equal coverage.

### P1.2 Tool-off execution gate

Planned files:

- `src/sidepanel/services/aiClient.ts`
- `src/sidepanel/services/autonomousAgent.ts`
- `src/sidepanel/App.tsx`

Tasks:

- [x] Pass an immutable per-run permission snapshot into the Agent.
- [x] When tools are disabled, do not parse or execute formal or pseudo tool
  calls.
- [x] Disable pseudo-call compatibility by default.
- [x] If compatibility is enabled, allow only tools included in the current
  advertised registry and validate arguments before approval. Both formal and
  pseudo calls are intersected with the exact request tool list, and daemon Zod
  validation runs before an approval is created.
- [x] Apply the same hard gate to built-in web search.
- [x] Add regression tests for JSON, tagged, inline, and formal tool calls while
  disabled, plus advertised-subset tests while tools are enabled.

Acceptance evidence:

- A model response containing `<tool_call>` cannot execute when tools are off.
- A code block that resembles a tool call remains visible text when tools are
  off.
- `enableWebSearch: false` prevents local and hosted search calls.

### P1.3 Untrusted page context separation

Planned files:

- `src/sidepanel/services/aiClient.ts`
- `src/shared/contextDigest.ts`

Tasks:

- [x] Remove DOM/page data from the system message.
- [x] Add a separate untrusted context message with source, target revision,
  capture time, byte count, and truncation flags. Background dispatch attaches
  exact tab/frame/document/navigation provenance; the Agent emits a structured
  `untrusted_page_context_v1` envelope with UTF-8 payload bytes. Legacy cached
  snapshots are explicitly target-unknown.
- [x] Keep system instructions limited to policy and tool-use rules.
- [x] Ensure page text cannot alter approval or tool-off state.
- [x] Add prompt-construction tests that assert page data is not in the system
  role.

Acceptance evidence:

- Test fixture page text containing instructions appears only in the untrusted
  context message.
- System content does not contain page visible text, DOM JSON, or selected
  element HTML.

### P1.4 Single Agent run and cancellation state

Planned files:

- `src/sidepanel/App.tsx`
- `src/sidepanel/components/ChatPanel.tsx`
- `src/sidepanel/services/autonomousAgent.ts`
- `src/shared/agentSession.ts`

Tasks:

- [x] Block Enter submission while a run is active, or enqueue through an
  explicit queue. The initial implementation uses one active run.
- [x] Give every callback a run ID and ignore stale updates.
- [x] Add `cancelled` to Agent session state instead of recording cancellation as
  failure.
- [x] Finalize sessions even when cancellation happens during context preparation.
- [x] Propagate AbortSignal into MCP and web-search calls. MCP/daemon/browser and
  standalone Bing/DuckDuckGo requests now share the Agent cancellation boundary;
  caller cancellation does not trigger the search fallback.

Acceptance evidence:

- Pressing Enter during a run cannot start a second run.
- Stop transitions the active run to `cancelled` and clears pending approval UI.
- A stale run cannot clear the busy state of a newer run.

### P1.5 Remove hidden page mutations

Planned files:

- `src/background/debuggerAdapter.ts`
- `src/background/toolDispatcher.ts`
- `src/content/browserAutomation.ts`
- `src/shared/tools.ts`

Tasks:

- [x] Remove automatic `frame.remove()` before debugger attach and read tools.
- [x] Report debugger conflicts with an actionable error.
- [x] Ensure read-only tools have no DOM mutation path. Every MCP tool now has
  a complete, typed binding to its allowed internal executor(s), every internal
  executor has a declared mutation scope, and both daemon dispatch and Chrome
  background grant verification fail closed on a binding/effect mismatch.
- [x] Remove persistent dialog-function overrides and replace them with a
  one-current-dialog CDP command. No page-global dialog function is modified.
- [x] Make `browser_evaluate` policy arbitrary-execution and either enforce a
  real deadline in an isolated executor or disable it until such an executor
  exists.

Acceptance evidence:

- Screenshot and network-read tests do not call frame cleanup with `remove:true`.
- Read-only policy tests fail if an MCP binding reaches a DOM, browser, or
  network mutation executor; target tab/frame selection remains explicitly
  classified as routing-only.

## Phase 2: Target identity, invalidation, and sensitive egress

### P2.1 Target and revision model

Planned files:

- `src/shared/wsProtocol.ts`
- `src/shared/dom.ts`
- `src/background/chromeApi.ts`
- `src/background/index.ts`
- `src/background/stateHubBridge.ts`
- `src/mcp/browserStateHub.ts`
- `src/mcp/wsSchemas.ts`

Tasks:

- [x] Add installation, browser session, target, frame, document, navigation, and
  revision identifiers. Content routing now binds to Chrome's `frameId` and
  `documentId`; top-level frame 0 remains the default.
- [x] Make the reported active target come from the same resolver used by tool
  execution.
- [x] Invalidate selected element, DOM snapshot, screenshot, and approvals on
  document change.
- [x] Separate `lastSeenAt`, state update time, and artifact capture time.
  Heartbeats advance only `lastSeenAt`; accepted state changes advance
  `stateUpdatedAt`; screenshots preserve their source `capturedAt` as
  `artifactCapturedAt`. The old output `updatedAt` remains a compatibility alias
  for `stateUpdatedAt`, and persisted legacy `updatedAt` values migrate on load.
- [x] Reject writes whose expected target or revision is stale. Approval-time
  revision changes fail, and the background validates the daemon-signed grant's
  exact tab/frame/document/navigation identity and revision before execution.
- [~] Add two-profile and two-tab routing tests. Two-Profile routing,
  wrong-socket isolation, top/child frame selection, and stale-document reuse
  are covered; a real two-tab Chrome run remains manual evidence.

Acceptance evidence:

- Manual tab pinning reports and executes against the same target.
- A command created for document A cannot execute after navigation to document B.
- Heartbeats do not make old page context appear freshly captured.

### P2.2 Structured sensitive-data policy

Planned files:

- `src/shared/sanitize.ts`
- `src/shared/wsProtocol.ts`
- `src/background/chromeApi.ts`
- `src/background/debuggerAdapter.ts`
- `src/content/browserAutomation.ts`
- `src/sidepanel/App.tsx`

Tasks:

- [x] Redact sensitive query and fragment parameters.
- [x] Represent cookies and storage with values omitted by default. Raw values
  require explicit `includeValues: true` on an approval-gated sensitive read.
- [x] Redact authorization, proxy authorization, Cookie, Set-Cookie, and common
  API-token headers structurally before browser results cross the daemon/model
  boundary.
- [x] Require sensitive-read approval for values, bodies, full DOM, screenshots,
  and saved downloads.
- [x] Add a redacted egress/side-effect preview and requester/target provenance
  to approval requests.
- [x] Prevent raw tool arguments and results from entering persisted Agent
  session snapshots. Snapshots retain tool names, argument keys, and result byte
  counts; the live in-memory Agent exchange still receives the approved result.
- [x] Persist bounded sensitive-result egress metrics by content class, exact
  serialized UTF-8 response bytes, and authenticated destination. Artifact reads
  are counted separately; raw values and bytes are never placed in audit rows.

Acceptance evidence:

- Cookie values are absent without a sensitive-read grant.
- Authorization and Cookie headers are redacted in AI and audit payloads.
- OAuth-style secrets in URL fragments are redacted.

## Phase 3: Daemon extraction and authenticated routing

### P3.1 Daemon entrypoint and config

Planned files:

- `src/daemon/server.ts` (new)
- `src/daemon/config.ts` (new)
- `src/daemon/store/**` (new)
- `src/mcp/server.ts`
- `package.json`
- daemon-specific TypeScript build configuration if required

Tasks:

- [x] Move WebSocket ownership and BrowserStateHub lifecycle into the daemon.
- [x] Generate a 256-bit bridge token with a user-readable-only config file.
- [x] Support data-directory isolation. `AI_DEVTOOLS_DATA_DIR` places
  `daemon.json`, `state.json`, and `artifacts/` under one user-only root;
  per-path overrides remain higher priority, and unset installations retain the
  prior config/state/artifact defaults without silently rotating the bridge
  token. Tests always use temporary roots.
- [x] Add `daemon:dev` and separate stdio adapter development scripts.
- [x] Ensure stdout remains clean for stdio MCP processes.
- [x] Add a production-entrypoint verifier using an isolated private data root,
  random loopback port, authenticated status calls, clean daemon shutdown, and
  same-config restart.

Acceptance evidence:

- Daemon restart preserves configuration without printing the token in normal
  logs.
- MCP adapter start does not listen on port 17321.

### P3.2 Authenticated Protocol V3 handshake

Planned files:

- `src/shared/wsProtocol.ts`
- `src/daemon/wsSchemas.ts`
- `src/daemon/wsServer.ts`
- `src/background/bridgeConfig.ts`
- `src/background/stateHubBridge.ts`
- sidepanel bridge configuration UI

Tasks:

- [x] Require V3 hello as the first bounded frame. First-frame hello, 8 MiB max
  payload, numeric protocol version 3, fail-closed mismatch errors, and welcome
  validation are enforced.
- [x] Validate bridge token without logging it.
- [x] Validate browser Origin and optional paired extension-ID allowlisting.
  `daemon:allow-extension` atomically persists up to 32 exact IDs in the private
  config; `AI_DEVTOOLS_ALLOWED_EXTENSION_IDS` provides a strict per-run override.
  A non-empty allowlist rejects every other extension Origin.
- [x] Generate stable installation IDs per Chrome profile.
- [x] Assign immutable roles and connection IDs server-side. The daemon maps an
  exact registered `clientName + transport` identity to one role, rejects
  unknown identities and claim mismatches, and returns that server-selected role
  in `SERVER_WELCOME`. Chrome cannot attest service-worker versus sidepanel
  context within one extension Origin, so extension subroles remain routing
  controls inside the paired extension trust boundary.
- [x] Add inbound command allowlists per role and a bounded protocol-violation
  window. Schema/role violations return a negative ACK; three violations within
  one minute close the connection.
- [x] Close connections that do not complete `CLIENT_HELLO` within five seconds.
- [x] Send heartbeats from browser, observer, sidepanel UI, and stdio MCP clients;
  reclaim authenticated sockets after 90 seconds without inbound activity.
- [x] Remove implicit unknown-to-plugin upgrade.
- [x] Add capped exponential reconnect backoff with jitter and reset it only
  after a valid server welcome.

Acceptance evidence:

- Web-page Origin and wrong-token clients cannot read state or invoke tools.
- Unknown client identities, local/browser transport swaps, and role claims that
  do not match the daemon registry are rejected before connection registration.
- Two Chrome profiles connect with isolated installation/session IDs.

### P3.3 Stdio adapter client

Planned files:

- `src/mcp/daemonClient.ts` (new)
- `src/mcp/server.ts`
- `src/mcp/toolRuntime.ts`

Tasks:

- [x] Replace `startPluginWebSocketServer()` in the MCP process with daemon client
  connection.
- [x] Add explicit browser-session and target selection/read tools. Stdio MCP
  adapters expose adapter-only `browser_list_sessions` and
  `browser_set_session` plus tab/frame list/select tools. Runtime Profile
  selection updates only that adapter connection's routing, heartbeat, state,
  and artifact scope; other Codex tasks and daemon global fallback are unchanged.
- [x] Route pending requests to the adapter's bound Chrome Profile session.
- [x] Return actionable daemon-unavailable and no-target errors.
- [x] Treat stdio EOF/closure as a graceful adapter shutdown so the daemon
  WebSocket heartbeat cannot keep an orphaned adapter alive.
- [x] Verify two actual `dist/mcp/server.js` processes concurrently, close one
  while the other remains callable, then close both without stopping the daemon.

Acceptance evidence:

- Two simultaneous stdio MCP adapters connect to one daemon.
- Closing one adapter does not stop the daemon or disconnect Chrome.
- Each adapter can select a different Chrome profile without cross-routing.

## Phase 4: Approval broker, cancellation, and protocol reliability

### P4.1 Approval broker

Planned files:

- `src/daemon/approvalBroker.ts` (new)
- `src/shared/wsProtocol.ts`
- `src/sidepanel/services/mcpBridge.ts`
- `src/sidepanel/components/ChatPanel.tsx` or a dedicated approval component
- `src/background/stateHubBridge.ts`

Tasks:

- [x] Create approval request/resolution protocol messages.
- [x] Bind HMAC execution grants to requester request/connection, exact internal
  tool and arguments hash, target tab/frame/document/navigation/revision,
  deadline, browser session, and one request ID.
- [x] Render requester provenance, exact target identity, and redacted
  side-effect/egress preview.
- [x] Require daemon authorization before grant creation and verify signature,
  session, call, target freshness, expiry, and one-time consumption in the Chrome
  background executor. The sidepanel executor fallback now fails closed.
- [x] Fail closed when no approval UI is connected.
- [x] Expire and consume request-bound approvals exactly once.

Acceptance evidence:

- Codex and embedded Agent mutations both pause for the same approval UI.
- Reusing a grant or changing arguments fails.
- Navigating while approval is pending invalidates the request.

### P4.2 Cancellation, ACK, idempotency, and limits

Planned files:

- `src/shared/wsProtocol.ts`
- daemon routing modules
- extension and MCP clients

Tasks:

- [x] Implement `REQUEST_CANCEL` and terminal cancellation results.
- [x] Bind pending results to connection, browser session, and request.
- [x] Distinguish validation ACK from final operation result.
- [x] Add idempotency keys for retryable operations.
- [x] Enforce frame bytes, connection count, pending count, rate, deadline, and
  per-target mutation concurrency.
- [x] Enforce command-specific serialized UTF-8 byte budgets before Zod/role
  dispatch and advertise the exact map in `SERVER_WELCOME`. Unknown commands use
  a 4 KiB fail-closed default; oversize messages count as protocol violations.
- [x] Align tool timeout ranges with transport deadlines.
- [x] Enforce total embedded-Agent run budgets: 64 model requests, 128 tool
  calls, 32 effectful calls, 32 sensitive reads, and 10 minutes. Reserve each
  model-issued tool batch atomically before execution.

Acceptance evidence:

- A cancelled wait/evaluate request cannot complete later as a successful write.
- A result from the wrong socket is rejected.
- Valid 60-second wait either has a longer transport deadline or is rejected at
  schema validation; it never races a 30-second transport timeout.

Verified evidence:

- `REQUEST_CANCEL` propagates from the MCP SDK signal through the stdio adapter,
  daemon broker, and selected browser socket. The browser bridge suppresses any
  later success after terminal cancellation.
- Browser results resolve only the request routed to the same browser WebSocket;
  a result with a matching ID from another socket is ignored.
- Idempotency is scoped by adapter instance and browser session, caches matching
  results for five minutes, and rejects reuse with different arguments.
- The daemon advertises limits in `SERVER_WELCOME`: 8 MiB frames, 32 total
  connections, 300 messages/minute/connection, 128 pending browser operations,
  64 approvals, and a 120-second request deadline ceiling.
- Active executions are bounded to 16 per requester and 128 globally; mutations
  are serialized per browser session and target.
- Browser hops use at most 90 seconds, approvals use at most 30 seconds, and MCP
  callers use 120 seconds. Browser waits are clamped to 60 seconds.
- `npm run typecheck` passed and `npm test` passed 26/26 after this phase.

## Phase 5: Artifact store and MCP contract

### P5.1 Persistent metadata and artifacts

Planned files:

- `src/daemon/store/**`
- `src/daemon/artifacts/**`
- `src/mcp/state.ts`

Tasks:

- [x] Persist sanitized sessions, targets, revisions, and current-conversation
  metadata in an atomic bounded local state file.
- [x] Persist approval decisions and redacted audit events. Unit coverage and the
  daemon network integration verify requested/approved/completed audit rows,
  strict field allowlisting, argument hashes, and absence of screenshot base64.
- [x] Store screenshot and oversized MCP JSON payload bytes outside state and
  normal result JSON. Results above 256 KiB become session-bound payload
  artifacts; screenshots keep their dedicated image-content path.
- [x] Add TTL, count, per-session byte, and global byte cleanup.
- [x] Add conversation IDs and real clear/new-conversation semantics.

Acceptance evidence:

- Restarting the MCP adapter does not lose daemon state.
- Base64 screenshot data is absent from state rows and normal logs.
- New conversation does not return old messages through current-conversation
  resources.

### P5.2 Canonical MCP registry and outputs

Planned files:

- `src/shared/mcpTools.ts`
- `src/mcp/toolRuntime.ts`
- domain-specific registry modules as needed

Tasks:

- [x] Consolidate input schema, output schema, description, policy annotations,
  and executor binding in the canonical runtime registry used by registration
  and daemon tool listing.
- [x] Use strict Zod inputs and bounded per-tool output schemas. One exhaustive
  typed catalog covers every canonical browser tool, the adapter-only Profile
  routing tools have their own contract, stdio registration performs SDK output
  validation, and daemon `tools/list` advertises the same generated JSON Schema.
- [x] Return structured content with concise text summaries.
- [x] Return screenshots as image content or artifact links.
- [x] Add pagination/handles for DOM, network, conversation, and audit
  collections. `browser_snapshot` has semantic fingerprint cursors; Network,
  current-conversation, and approval-gated session audit reads use bounded
  snapshot cursors; oversized JSON returns session artifact handles. Collection
  cursors bind kind/source/filter/snapshot length and fail closed on mutation,
  truncation, filter changes, or incompatible collection ordering.
- [x] Advertise capability-scoped tool groups. Each stdio adapter can select
  `inspect`, `read`, or `full` through `AI_DEVTOOLS_MCP_TOOL_PROFILE`; daemon
  authorization remains authoritative for every profile.
- [x] Replace static global resources with session/target templates. Safe state
  resources require an explicitly selected adapter session; page resources also
  carry an opaque SHA-256 target key bound to tab/frame/document/navigation and
  revision. Resource listing/completion exposes current concrete URIs, stale or
  cross-session reads fail closed, and sensitive resources remain tool-only.

Acceptance evidence:

- Every MCP tool has complete annotations and registry coverage.
- Screenshot results render as image content without base64 JSON text.
- Large lists return pagination metadata and respect byte limits.
- Static global page-state URIs are absent; resource-template protocol tests
  cover discovery, exact-target reads, stale targets, cross-session attempts,
  and adapters without an explicit Profile selection.

## Phase 6: Browser fidelity, packaging, and end-to-end validation

### P6.1 Browser coverage

- [x] Add frame-aware target discovery and routing. Content scripts announce all
  frames and DOM/selector requests route by `tabId + frameId + documentId`.
- [~] Add OOPIF/child target attach where supported. Manifest injection covers
  cross-origin child-frame content scripts. Chrome 125+ now uses recursive
  flattened `Target.setAutoAttach` sessions and correlates CDP frame IDs with
  `webNavigation` frame/document IDs by unique parent structure plus normalized
  URL. Ambiguous siblings, same-process frames, stale documents, and missing
  sessions fail closed. A real Chrome cross-origin run remains required before
  this item is verified complete.
- [~] Prefer semantic/interactive snapshots over full DOM dumps.
  `browser_snapshot` now performs a fresh, session/target-bound semantic read
  with role/name/selector/state/bounds, stable page-local refs, bounded cursor
  pagination, and stale-cursor rejection. Real-Chrome extraction and cursor
  behavior still require the manual validation below before this item is done.
- [~] Use CDP trusted input for interactions that synthetic events cannot model.
  Coordinate mouse move/click/down/up/drag/wheel and selector-based
  click/hover/drag now use `Input.dispatchMouseEvent`. Selector resolution is
  document-bound and performs viewport/center hit testing before dispatch;
  uniquely mapped OOPIF input uses its exact child CDP session, while ambiguous,
  same-process, stale, or missing child routes fail closed.
  `browser_type` uses bounded focus plus `Input.insertText`, and
  `browser_press_key` uses a strict named/single-key map with
  `Input.dispatchKeyEvent`. Batch form filling now preflights every field, uses
  CDP text/mouse input for text and checkbox/radio controls, rejects native radio
  uncheck, and stops on post-preflight failure. Native select-by-value remains a
  documented scoped DOM exception (`inputMode: dom`) because CDP lacks a
  deterministic cross-platform primitive; exact/unique option resolution,
  element-token binding, and post-event selection verification constrain it.
  Uniquely mapped OOPIFs now route mouse, keyboard, and CDP-backed form controls
  through their child debugger session. Real-Chrome event fidelity remains
  pending evidence; same-process child-frame input intentionally remains
  unsupported instead of translating guessed coordinates.
- [x] Replace persistent dialog overrides with a scoped CDP design.
  `browser_handle_dialog` now accepts or dismisses only the currently open
  JavaScript dialog through `Page.handleJavaScriptDialog`, remains approval
  gated, and reports `NO_JAVASCRIPT_DIALOG` when there is nothing to handle.
  The content-script message, page-global function replacement, and injected
  override helper were deleted.

### P6.2 Packaging and setup

- [x] Build runnable daemon, MCP adapter, and status-command JavaScript
  artifacts under `dist/daemon` and `dist/mcp`.
- [x] Add setup instructions for daemon start, Codex MCP configuration, Chrome
  extension loading, and bridge-token pairing.
- [x] Add a health/status command that reports only daemon URL, session-bound
  state, and tool count; it does not expose token, page URL, or page content.
- [x] Document recovery for daemon unavailable, wrong token, stale target, and
  debugger conflict.

### P6.3 Validation matrix

Required before goal completion:

The live requirement-to-evidence status is maintained in
`docs/completion-evidence.md`; this table defines the required areas but does not
claim they are complete.

| Area | Required evidence |
| --- | --- |
| Static types | `npm run typecheck` |
| Unit/integration | `npm test` |
| Production build | `npm run build` |
| Daemon lifecycle | start, health, restart, clean shutdown |
| MCP multi-instance | two stdio adapters connected simultaneously |
| Chrome profiles | two isolated extension installation IDs |
| Approval | read allowed; mutation and sensitive read paused; deny/approve paths |
| Stale context | navigation invalidates pending action |
| Cancellation | active tool reaches terminal cancelled state |
| Data egress | cookie/header/storage/body and URL-fragment fixtures redacted |
| Artifacts | screenshot image/artifact response and retention cleanup |
| Browser regression | sidepanel load, page read, pick, approval, action, stop |
| Security negative tests | wrong origin/token/role/session/result socket rejected |

## Phase 7: AI collaboration and intelligent execution kernel

### P7.1 Typed collaboration workspace

- [x] Define versioned item kinds, actor provenance, Profile/target binding,
  visibility, sensitivity, lifecycle status, parent linkage, and revisions.
- [x] Enforce structural redaction, JSON shape limits, 32 KiB item content,
  100 items, and a 256 KiB per-Profile aggregate ceiling.
- [x] Persist sanitized state across daemon restart and preserve compatibility
  with sessions created before the workspace existed.
- [x] Limit observer replay and publication broadcasts to the authenticated
  Profile session.

### P7.2 Bidirectional extension/MCP collaboration

- [x] Add extension publication/subscription messages with strict role and Zod
  validation; the server assigns actor identity and rejects source spoofing.
- [x] Add the session resource
  `ai-devtools://session/{sessionId}/collaboration-workspace` and
  `browser_publish_collaboration_item`.
- [x] Omit private items and withhold sensitive content from the direct MCP
  resource. Treat all selected collaboration content as untrusted model data.
- [x] Select at most eight relevant active items and honor the page-context
  switch for `page_content` items.
- [ ] Complete real-Chrome style-only handoff and two-way task/code handoff.

### P7.3 Stateful intelligent task execution

- [x] Add `AgentTaskState v1` with Observe-Plan-Execute-Verify phases,
  criteria, observations, actions, verification evidence, blockers, and
  revisions.
- [x] Require an independent successful read-only observation after a browser
  mutation before a task can be completed.
- [x] Record safety-budget, disabled auto-continuation, and no-progress stops as
  `blocked` rather than `completed`.
- [x] Guide the model to use broad bounded observation, batch independent
  actions, avoid unchanged-state loops, and not treat optional empty controls as
  blockers.
- [x] Require native browser CSS for selector actions, reject common
  Playwright/jQuery/XPath locator syntax before browser execution, and guide
  stale/missing-target recovery through one fresh bounded observation.
- [x] Replace hard Agent-budget termination with an indefinite user checkpoint.
  The default effectful/external-call allowance is 50; continuing extends only
  the exhausted dimension in the same task, while stopping performs a bounded
  tools-off summary. Concrete tool approvals remain independent.
- [x] Add a bounded Network `activityDigest` for action verification. It strips
  query/fragment data, groups repeated method/path/status entries, collapses
  heartbeat-like GET/HEAD traffic, and prioritizes mutations, navigation,
  redirects, and failures without exposing headers or bodies. Agent verification
  uses `digestOnly: true`, so heartbeat-heavy raw request rows are omitted.
- [x] Execute independent safe/no-approval read batches concurrently while
  preserving request-order results; serialize mutations, sensitive reads,
  open-world calls, and mixed batches.
- [ ] Add user-visible resume/takeover controls for a selected blocked task
  state; current handoff is available through MCP/resource context but is not a
  dedicated sidepanel interaction.

### P7.4 Scenario-oriented network orchestration

- [~] `network.mock_scenario` can describe a multi-request collaboration plan,
  while existing proxy tools can create individual rules.
- [ ] Add an explicit ordered scenario schema with request dependencies,
  stateful response steps, match counts, reset/rollback, and verification
  checkpoints.
- [ ] Add atomic scenario validation and staged enable/disable so a complex
  mock chain cannot be left half-configured after one rule fails.
- [ ] Verify a real multi-interface mock chain end to end before marking the
  intelligent kernel complete.

## Risk register

| Risk | Mitigation | Status |
| --- | --- | --- |
| Existing user work is uncommitted | Patch narrow files; inspect diff after each phase | active |
| Protocol migration temporarily duplicates V1/V2 | Reject V1 at the authenticated handshake; retain only explicitly documented name aliases at tool parsing boundaries | mitigated; no V1 transport route found in current audit |
| Approval UI unavailable when Codex requests mutation | Fail closed with actionable error | accepted |
| Chrome extension cannot read daemon config directly | Manual one-time token pairing per profile | accepted |
| Local same-user process can read bridge config | Out of primary threat model; file mode and log hygiene | accepted |
| Full DOM and screenshots exceed model limits | Artifact handles, semantic snapshot, explicit budgets | implemented; browser rendering evidence pending |
| Browser runtime behavior differs from typecheck | Extension browser tests required before completion | active |

## Decision log

### 2026-07-10

- Confirmed local single-user deployment only.
- Confirmed multiple Codex tasks, Chrome windows, and Chrome profiles are required.
- Confirmed every mutation requires user confirmation.
- Selected one long-lived daemon plus many stdio MCP adapters.
- Selected default-deny policy with sensitive reads distinct from ordinary reads.
- Selected explicit per-profile bridge-token pairing.
- Selected target/document revision binding for every action.
- Selected structured/binary artifacts instead of base64 state JSON.
- Selected incremental migration: durable safety fixes first, then daemon split.

## Execution log

### 2026-07-10 - Planning baseline

- Completed repository-wide read-only architecture and security review.
- Verified baseline `npm run typecheck` passes.
- Created Architecture V2 and this durable implementation plan.
- Created the repo-grounded threat model and verified its required section
  structure with `rg`; `git diff --check` passed.
- The baseline entry above predates implementation; subsequent work is recorded
  below.

### 2026-07-10 - Safety baseline and daemon extraction

- Added a canonical tool policy, daemon-enforced approval, tool-off hard gates,
  untrusted page-context separation, single-run Agent state, and explicit
  `cancelled` sessions.
- Removed automatic debugger-frame deletion and made debugger conflicts fail
  without mutating the page.
- Split the long-lived daemon (`daemon:dev`) from the stdio MCP adapter
  (`mcp:dev`); added daemon state RPC and multi-adapter integration coverage.
- Added per-Profile installation/session IDs and session-bound routing. The
  integration suite verified two adapters route to two distinct browser
  sessions without cross-routing.
- Added a 256-bit local bridge token, `0600` config storage, Chrome Profile
  pairing UI, first-frame authentication, Chrome Origin checks, immutable
  roles, and negative token/origin tests.
- Added navigation revisions and stale-approval rejection. These paths are now
  included in the current passing integration suite.
- `npm run build` passed after the authentication, routing, approval, revision,
  README, and settings changes; this includes TypeScript, Vite extension, and
  bundled content-script builds.

### 2026-07-10 - Cancellation and protocol reliability

- Added server-issued connection IDs and `SERVER_WELCOME` limit discovery,
  explicit deadlines, structured protocol errors, and `REQUEST_CANCEL`.
- Added a daemon execution broker with requester/global concurrency bounds,
  per-target mutation serialization, deadline aborts, and five-minute
  idempotency caching. Adapter-instance namespacing prevents two Codex tasks in
  the same browser session from colliding on JSON-RPC request IDs.
- Bound pending browser results to the exact selected socket and propagated
  cancellation through the sidepanel Agent, stdio adapter, daemon, and Chrome
  background bridge.
- Enforced 8 MiB WebSocket frames, 32 connections, 300 messages/minute per
  connection, 128 pending browser calls, and 64 pending approvals.
- Verified `npm run typecheck`, `npm test` (26 tests, 26 passed), and
  `npm run build` (TypeScript, Vite extension, and content-script bundle). The sandboxed
  test attempt failed only because `tsx` could not create its IPC socket; the
  permitted rerun completed successfully.

### 2026-07-10 - Persistent state, artifacts, and sensitive egress

- Added an atomic `0600` daemon state store for sanitized browser sessions,
  targets, revisions, current conversation, approval decisions, and redacted
  audit events. Audit records accept only a strict field allowlist and store an
  arguments SHA-256, never raw tool arguments.
- Added a `0700/0600` artifact store with SHA-256 deduplication, atomic metadata,
  24-hour TTL, per-object/session/global count and byte budgets, and
  session-bound reads.
- Screenshot bytes now live outside daemon state JSON. MCP screenshot calls
  return an image content block plus bounded `structuredContent` and an artifact
  URI; base64 is omitted from text and structured JSON.
- Added `ai-devtools://artifact/{artifactId}` and daemon artifact read protocol.
  Artifact reads require `AI_DEVTOOLS_SESSION_ID`; they do not use the global
  active-session fallback.
- Added explicit conversation IDs and `PLUGIN_CONVERSATION_STARTED`, so “新对话”
  removes prior messages from current-conversation state.
- Removed direct MCP static-resource/`STATE_GET` access to plugin conversation,
  screenshots, and Agent session content. Sensitive data must go through an
  approval-gated tool.
- Added a canonical MCP runtime registry with strict unknown-field rejection,
  generic declared output schemas, bounded `structuredContent`, and shared
  metadata for tool registration/listing.
- Added per-adapter `inspect`, `read`, and `full` tool profiles so a Codex task
  can reduce its model-visible attack surface without weakening daemon policy.
- Added 256 KiB inline JSON output budgeting; larger stdio-MCP results become
  session-bound `payload` artifacts while local sidepanel result shapes remain
  unchanged.
- Made connection-bound `STATE_GET` sessions immutable and added a shared direct
  resource allowlist used by both daemon enforcement and MCP registration.
- Verified `npm run typecheck`, 20/20 non-network unit tests, and
  `npm run build`. The artifact/structured-output daemon integration slice had
  passed 14/14 before the final audit and sensitive-resource restriction. The
  requested latest loopback rerun was rejected by the Codex execution quota, so
  that network regression remains explicitly pending.

### 2026-07-10 - Node packaging and recovery

- Extended `npm run build` to emit runnable Node 20 ESM artifacts for the daemon,
  stdio MCP adapter, and daemon status command. Added `daemon:start` and
  `mcp:start` production-style scripts while retaining `*:dev` for source mode.
- Added `daemon:status`; its output is restricted to reachability, daemon URL,
  whether a session binding is configured, and exposed tool count.
- Documented recovery for daemon unavailability, bridge-token mismatch, wrong
  Profile binding, stale context, debugger conflicts, and corrupt state/index
  files.
- Verified the full extension + content script + Node artifact build and ran
  `node --check` on all three generated Node entrypoints.

### 2026-07-10 - Trusted coordinate input

- Replaced DOM-synthetic coordinate mouse operations with CDP
  `Input.dispatchMouseEvent`, including correct button masks, ordered double-click
  counts, paced drag steps, and viewport-centered wheel fallback.
- Kept selector-based click/type/form behavior unchanged pending focused browser
  regression tests; this avoids silently changing form semantics in the same
  slice.
- Verified the complete non-network suite (32 tests, 32 passed), including Agent
  cancellation/safety, execution broker, state/artifacts, MCP registry/output,
  policy, and CDP event sequence builders. The full extension + Node build and
  generated-entrypoint syntax checks passed after the dispatcher hard-disable.
- Hard-disabled the remaining background `evaluate` and persistent dialog
  override execution branches. Their legacy content handlers remain unreachable
  migration code until a scoped design replaces or removes the protocol types.

### 2026-07-13 - Explicit tab/frame/document routing

- Added `all_frames`, `match_about_blank`, and origin-fallback content-script
  injection so same-origin and cross-origin child documents can announce their
  Chrome `frameId` and `documentId`.
- Added a frame registry that defaults to frame 0, never lets child announcements
  steal selection, routes content messages to the selected document, and fails
  closed when Chrome reuses a frame ID for a new document.
- Exposed strict MCP tools for listing/selecting tabs and frames. Selection is a
  routing operation; it does not mutate page content. Sensitive reads and page
  mutations retain their existing approval policy.
- Added deterministic top/child/stale-document tests and cross-origin manual
  fixtures.
- Fixed the daemon WebSocket schema and cache invalidation path so `documentId`
  survives validation and a same-URL frame document change clears document-
  scoped state.
- Cookie and storage values are now omitted by default, and persisted Agent
  snapshots omit raw tool arguments/results even when the live Agent was allowed
  to consume them.
- Verified the final slice with `npm run typecheck`, `npm test` (48/48 passed),
  and `npm run build` (extension, content script, daemon, MCP adapter, and status
  entrypoint).
- Attempted automated headed-Chrome validation. The fixture loaded, including
  its cross-origin iframe, but the temporary Playwright Chrome showed no loaded
  extension or extension service worker. This is recorded as not verified; use
  `docs/manual-browser-validation.md` for the required real Chrome run.

### 2026-07-13 - Executor grants and structured egress controls

- Replaced the daemon's approval-only boolean boundary with signed execution
  grants for every daemon-to-browser call. Grants use HMAC-SHA-256 and bind the
  browser request, requester request/connection, Profile session, exact internal
  tool/arguments hash, target identity, daemon revision, issue time, and expiry.
- The Chrome background verifies the grant against its paired bridge token and
  current Chrome document/navigation identity, then consumes the grant once
  before dispatch. Tampered, expired, cross-session, stale-target, and replayed
  grants fail closed. The daemon no longer falls back to a sidepanel/plugin
  socket for browser execution.
- Approval UI payloads now contain redacted arguments, requester provenance,
  tab/frame/document target, and explicit sensitive-egress/side-effect summaries.
- Added structural credential-header redaction on normal browser result
  serialization, covering both header records and CDP name/value arrays.
- Added grant signature/binding/tamper/expiry/replay tests, approval provenance
  assertions, Header redaction tests, and AI endpoint policy tests.
- Added execution-time and settings-time AI Provider URL policy: remote endpoints
  require HTTPS; HTTP is limited to loopback hosts; embedded URL credentials and
  non-HTTP schemes are rejected. This prevents modified persisted config from
  bypassing the UI validator.
- Removed the sidepanel's obsolete direct browser executor and pending-call path;
  daemon browser calls now have one executable sink: the grant-validating
  background bridge.
- Verified `npm run typecheck`, `npm test` (54/54 passed), and `npm run build`
  after the final cleanup.

### 2026-07-13 - AI credential boundary and protocol negotiation

- Moved per-profile AI API keys out of localStorage into the current Chrome
  Profile's `chrome.storage.local`. Metadata serialization always strips keys,
  old profile/single-config keys migrate once, and deleted profiles remove their
  stored credentials on the next save.
- New profiles copy model/settings but start with an empty API key, preventing
  silent credential reuse across Provider configurations.
- Added a blocking Provider-origin confirmation before capability probing when
  an existing keyed profile changes scheme, host, or port. The dialog shows only
  old/new origins and never the key.
- Added required WebSocket protocol version 3 hello/welcome fields. The daemon
  rejects incompatible clients with `PROTOCOL_VERSION_UNSUPPORTED`; Chrome
  browser/UI/observer clients and the stdio adapter wait for and validate the
  welcome before using the connection.
- Replaced fixed extension reconnect delays with capped exponential backoff and
  bounded jitter.
- Added migration/metadata leakage, Provider-origin comparison, protocol
  mismatch, and deterministic reconnect-backoff tests. Verified
  `npm run typecheck`, `npm test` (60/60 passed), and `npm run build`.

### 2026-07-13 - Protocol abuse limits and approval destinations

- Added explicit inbound command allowlists for browser, plugin, UI, observer,
  and MCP roles. Forbidden commands now receive `ROLE_FORBIDDEN` instead of the
  previous generic success ACK.
- Added a five-second unauthenticated hello timeout and a bounded violation
  counter that closes a connection after three schema/role violations within
  one minute. These limits are returned in `SERVER_WELCOME`.
- Approval cards now show concrete egress destinations: embedded Agent results
  show the configured AI Provider origin, extension web search lists Bing and
  DuckDuckGo fallback origins, and MCP requests state that downstream egress is
  controlled by the MCP client.
- Added role-policy, violation-window, hello-timeout, forbidden-command, and
  approval-destination tests.
- Added 15-second heartbeats for UI/MCP clients and 90-second daemon idle
  cleanup, including integration coverage that proves silent clients are closed
  and stdio adapter heartbeats keep the same connection alive. `npm test` passed
  69/69 before the final build verification for this batch.

### 2026-07-13 - Semantic snapshots and session-scoped state reads

- Changed `browser_snapshot` from a legacy page-context alias into a fresh,
  accessibility-oriented snapshot of the explicitly bound Chrome Profile and
  selected tab/frame/document. `browser_get_page_context` remains the bounded
  compatibility API.
- Added semantic roles, accessible names/descriptions, selectors, element state,
  viewport bounds, stable page-local refs, a 1000-node source cap, and bounded
  pages of at most 100 nodes.
- Added opaque fingerprint-bound cursors. Malformed cursors fail with
  `SNAPSHOT_CURSOR_INVALID`; semantic changes fail old cursors with
  `STALE_SNAPSHOT_CURSOR` so results from different page versions are not mixed.
- Made direct MCP state reads use the adapter's bound `sessionId`, closing a
  cross-Profile gap where browser execution was session-routed but built-in
  page/context resources could still resolve through the daemon's active
  session.
- Snapshot reads compare the selected target before and after capture. A
  concurrent tab/frame/document switch returns `STALE_CONTEXT` instead of
  labeling content from the old target with the new target metadata.
- Added semantic pagination/staleness/schema tests and expanded the two-Profile
  integration test to assert page-context isolation. `npm test` passed 72/72.
  Real Chrome extraction, frame switching, and cursor invalidation remain manual
  evidence and are not claimed by this entry.

### 2026-07-13 - Validation-before-approval and complete Agent cancellation

- Restricted formal and compatibility pseudo tool calls to the exact tool names
  advertised in each model request. A response cannot invoke a capability that
  was hidden by the current MCP profile or per-run tool list.
- Moved strict known-tool Zod parsing ahead of daemon policy approval. Invalid
  arguments now return an actionable schema error without displaying an
  approval card or reaching a browser executor.
- Propagated the active Agent `AbortSignal` into standalone Bing/DuckDuckGo
  search. Caller cancellation aborts the current request and suppresses fallback;
  the independent ten-second search timeout remains intact.
- Added JSON-block, tagged, inline, formal, advertised-subset, pre-approval
  schema rejection, and web-search cancellation regressions. The complete suite
  passed 77/77 after these changes; real Chrome validation remains separate.

### 2026-07-13 - Page capture provenance and stale-context rejection

- Moved tab navigation ID/revision state into a shared background module and
  attached provenance when `DOM_GET_PAGE_INFO` is dispatched to the selected
  tab/frame/document. Page-controlled content supplies data, never target identity.
- Extended `PageSnapshot`, WebSocket Zod validation, MCP sanitization, daemon
  cache, persistence, and semantic snapshot output to preserve bounded target
  provenance without exposing a Chrome Profile installation ID.
- Replaced the Agent's free-form compressed-context line with a structured
  `untrusted_page_context_v1` user-message envelope containing source, exact
  target, capture/observation timestamps, serialized UTF-8 payload bytes, and
  truncation status. Old cached rows remain readable but use
  `targetKnown: false` and `target: null`.
- Added a daemon guard that ignores late provenance-bearing page-context updates
  for an older tab/frame/document/navigation target, preventing state rollback.
- Added provenance binding/sanitization/navigation lifecycle, legacy envelope,
  exact byte-count, protocol preservation, and stale rollback tests. The full
  suite passed 84/84 after semantic-target mismatch and first-capture target
  establishment regressions, followed by a successful production build.

### 2026-07-13 - Bounded collection pagination and session audit reads

- Added one shared `cp1_` cursor contract for Network, current plugin
  conversation, and redacted audit collections. It records collection kind,
  source/filter fingerprint, first-page length, and offset; malformed, changed,
  truncated, or cross-filter cursors fail closed.
- Kept append-only conversation and audit pagination on the first-page snapshot,
  so messages or self-generated approval/audit events added during paging do not
  make forward progress impossible. Network is newest-first, so new requests
  still invalidate an old cursor; callers should stop recording before paging.
- Added `browser_get_audit_events` as a sensitive-read MCP tool. Normal daemon
  approval occurs before execution, rows are filtered by the adapter-selected
  Profile before optional filters, and only the strict persisted redacted audit
  fields are returned. It has no browser executor binding.
- Added pagination, append stability, stale cursor, filter mismatch,
  cross-Profile exclusion, missing-session/store, schema, policy, and executor
  tests. The non-WebSocket suite passed 92/92 and `npm run build` passed. The
  loopback daemon integration suite remains for local execution with
  `npm test`.

### 2026-07-13 - Trusted selector mouse input

- Replaced content-script synthetic click/hover/drag dispatch in the canonical
  browser tool path. The selected document now resolves selector geometry,
  scrolls when appropriate, and performs a center-point hit test; the background
  revalidates tab/navigation and emits `Input.dispatchMouseEvent` to the exact
  tab.
- Added fail-closed errors for missing, offscreen, occluded, stale, and
  non-top-frame targets. Coordinate tools also reject a selected child frame,
  preventing local frame coordinates from being misapplied to the top viewport.
- Added `inputMode: cdp` and resolved coordinates to selector mouse results,
  tightened MCP output schemas, pure geometry-gate tests, and a fixture cover
  toggle for real Chrome verification. OOPIF trusted input and trusted
  typing/form controls remain explicit follow-up work.

### 2026-07-13 - One-current-dialog CDP handling

- Re-exposed `browser_handle_dialog` as an approval-gated page action that sends
  exactly one `Page.handleJavaScriptDialog` command to the selected tab. Accept
  may provide bounded prompt text; dismiss never forwards prompt text.
- Replaced the old `configured` response with `handled: true` and an actionable
  `NO_JAVASCRIPT_DIALOG` error when no native dialog is open.
- Deleted the content-script protocol command, handler, injected script helper,
  and all replacements of `window.alert`, `window.confirm`, and `window.prompt`.
  Static regression coverage prevents those override markers from returning;
  the fixture and manual checklist cover confirm, prompt, no-dialog, denial, and
  future-dialog behavior.
- Verified the complete non-WebSocket suite (96/96), `npm run build`, and
  `git diff --check`. Real native-dialog and `Event.isTrusted` behavior remain
  manual Chrome evidence and are not claimed by this entry.

### 2026-07-13 - Trusted selector keyboard input

- Migrated canonical `browser_type` and `browser_press_key` away from content
  script value mutation and synthetic `KeyboardEvent`. Selector targets reuse
  the exact document geometry gate, perform bounded focus without a click, and
  confirm focus before any CDP keyboard command.
- Text uses `Input.insertText`; replace executes the CDP `selectAll` editing
  command followed by Backspace; submit and explicit key presses use strict
  `Input.dispatchKeyEvent` pairs. Supported keys are one Unicode character,
  common navigation/editing/modifier keys, or F1-F12. Combination strings fail
  schema validation, and slow typing is capped at 500 characters.
- Deleted the legacy type/press content-message protocol and handlers. Added
  event-map, replacement, unsupported-key, focus, schema/output, and static
  contract tests plus a native `Event.isTrusted` fixture. Typing fails closed for
  buttons, checkbox/radio controls, disabled/readonly fields, and other
  non-editable targets instead of reporting a false success. Batch form and
  select tools remain separate follow-up work.
- Verified the complete non-WebSocket suite (102/102), `npm run build`, and
  `git diff --check`. Real Chrome `Event.isTrusted`, native editing-command, and
  form-submit behavior remain manual evidence and are not claimed by this entry.

### 2026-07-13 - Trusted batch form input and scoped native select

- Replaced the content-script batch value writer with a two-phase form executor.
  Every field first resolves its exact document, control type, disabled/readonly
  state, element token, and (for selects) exact option plan before any field is
  changed. Execution revalidates the token and stops on the first stale or
  dynamic-page failure; a post-preflight failure is reported as potentially
  partial because browser pages have no transactional rollback boundary.
- Text controls now use the same focused CDP text path as `browser_type`.
  Checkbox/radio controls use trusted CDP mouse clicks only when their state must
  change and verify the resulting checked state. Direct native-radio uncheck is
  rejected instead of reporting false success.
- Kept native `<select>` as an explicit, narrowly scoped DOM exception: exact
  value matching takes precedence over unique exact label/text matching;
  duplicate, missing, ambiguous, disabled, oversized, stale-element, and
  post-event state mismatches fail closed. Results identify `inputMode: dom`,
  while batch output schemas reject submitted field values.
- Deleted the old `CONTENT_FILL_FORM` protocol and content-side generic form
  mutator. Added strict bounded MCP/internal/content contracts, approval-policy
  assertions, option-resolution/value-redaction regressions, a disposable form
  fixture, and manual Chrome cases in section 4.3.
- Verified the complete non-WebSocket suite (108/108), `npm run build`, and
  `git diff --check`. The loopback WebSocket daemon integration test and real
  Chrome `Event.isTrusted`/select event evidence remain separate local/manual
  validation and are not claimed by this entry.

### 2026-07-13 - Server-assigned client identities and extension-ID pinning

- Added one build-owned WebSocket client identity registry. Browser background,
  sidepanel tool/approval UI, sidepanel observer, and Codex stdio adapter names
  each map to exactly one role and transport class. The daemon
  rejects unknown names, browser/local transport swaps, and a `clientRole` claim
  that does not match the registry; `SERVER_WELCOME.assignedRole` comes from the
  registry instead of copying the claim.
- The broad legacy `plugin` role remains parseable only for protocol migration;
  no registered production identity can be assigned that role.
- Added an optional exact Chrome extension ID allowlist to the private daemon
  config. IDs are normalized, deduplicated, capped at 32, written with an atomic
  user-only replacement, and enforced against the authenticated
  `chrome-extension://` Origin. `daemon:allow-extension` updates the persistent
  list without printing the token; `AI_DEVTOOLS_ALLOWED_EXTENSION_IDS` is a
  strict per-run override.
- Bound extension `installationId` and `sessionId` at hello, tightened the hello
  payload schema, and documented that Chrome cannot attest background versus
  sidepanel within one paired extension Origin. Subroles are routing controls;
  the token plus optional extension-ID pin is the local authentication boundary.
- Made the audit pagination network fixture establish its own target instead of
  depending on singleton state left by another test. Added config persistence,
  client identity, role escalation, webpage Origin, wrong-token, paired, and
  unpaired-origin regressions.
- Verified the complete suite with real loopback WebSocket servers (132/132),
  `npm run build`, and `git diff --check`. A manual real-Chrome reconnect after
  enabling the optional allowlist remains in the browser checklist and is not
  claimed by this entry.

### 2026-07-13 - Deterministic protocol and persistence test foundation

- Added shared protocol fixture builders for V3 hello/messages, a centralized
  test-only bridge token, fixed fixture timestamps, and sequence-based IDs.
- Added daemon `clock` and `createId` dependency seams. Production continues to
  use `Date.now` and cryptographic message IDs; tests now assert exact connection
  IDs, approval IDs, requestedAt, and expiry without wall-clock assumptions.
- Added one temporary daemon data-directory helper exposing isolated config,
  state, and artifact paths. Replaced all direct `mkdtemp/tmpdir/rm` use in
  state-store, artifact-store, and daemon artifact integration tests.
- Added helper lifecycle tests proving deterministic messages and recursive
  cleanup. The complete suite passed 86/86, followed by a successful production
  build.

### 2026-07-13 - Exact OOPIF trusted-input routing

- Enabled Chrome 125+ flattened `Target.setAutoAttach` for iframe targets and
  repeats auto-attach on each child session so nested OOPIFs can be discovered.
  Child debugger sessions are capped at 128; excess sessions are detached.
- Added a fail-closed correlation layer between CDP frame IDs and Chrome
  `webNavigation` frame/document IDs. A route exists only when parent structure
  and normalized URL are unique. Duplicate sibling URLs, inactive documents,
  more than 512 frames, excessive nesting, same-process frames without a child
  session, and missing flat-session support remain unroutable.
- Routed selector and coordinate mouse operations, keyboard input, and the
  CDP-backed portions of batch form filling through the exact root or OOPIF
  debugger session. Every child dispatch re-reads both frame trees and requires
  the selected `documentId`; refresh generations prevent older asynchronous
  mappings from overwriting newer navigation state.
- Added `webNavigation` permission, pure mapping/staleness/ambiguity/budget
  tests, and cross-origin child fixture outputs that report `Event.isTrusted`.
  Updated architecture, threat-model, README, and manual browser evidence.
- Stabilized the existing heartbeat integration test by keeping its observation
  window longer than the idle timeout while allowing scheduling margin under
  parallel test load. The targeted daemon suite passed 21/21, the complete suite
  passed 137/137, and `npm run build` succeeded. Real Chrome OOPIF click/type/form
  evidence is still manual and is not claimed by this entry.

### 2026-07-13 - Agent run budgets, egress metrics, and completion audit

- Added one per-run Agent budget shared by every model request and tool-loop
  branch: 64 model requests, 128 total tools, 32 effectful tools, 32 sensitive
  reads, and 10 minutes. Tool batches reserve capacity atomically, so crossing a
  boundary cannot execute only the early mutations in a model-issued batch.
- Budget exhaustion is a visible bounded terminal state rather than a transport
  failure. The Agent preserves already produced content, records a sanitized
  session event, and does not make an extra summary-model request after the
  model-request ceiling is reached.
- Added sensitive-result egress classification and exact serialized UTF-8 byte
  counts at the authenticated daemon boundary. Audit rows store only class,
  bytes, and `extension_agent`/`mcp_adapter` destination. Successful screenshot
  and payload artifact reads are accounted separately; raw results, base64, and
  artifact IDs remain absent except for the pre-existing argument hash.
- Added `docs/completion-evidence.md` as the durable requirement-to-evidence
  gate. It distinguishes automated proof from packaged-process and real-Chrome
  evidence, so P6 and the goal stay open until the manual rows are actually run.
- Corrected the stale P6 OOPIF text and removed the obsolete risk-register claim
  that a V1 transport compatibility route is still planned.
- The focused Agent/egress/daemon/storage/MCP suite passed 37/37. The complete
  intermediate suite passed 146/146, `npm run build` passed for all extension and Node
  artifacts, and `git diff --check` passed before this log update. At that
  checkpoint, real Chrome and packaged stdio-process evidence were still
  pending; the packaged-process evidence is completed in the later entry below.

### 2026-07-13 - Message-specific Protocol V2 ingress budgets

- Added a complete inbound-command byte-budget registry on top of the 8 MiB
  WebSocket frame ceiling. Small control messages are limited to 2-4 KiB;
  selected element/chat/MCP/Agent messages receive bounded intermediate budgets;
  page context is capped at 2 MiB; only screenshots and browser results may use
  the full 8 MiB frame.
- The daemon measures the exact UTF-8 serialized frame after JSON decoding but
  before Zod schema and role dispatch. Unknown commands default to 4 KiB;
  oversized messages receive `PAYLOAD_TOO_LARGE`, count toward the protocol
  violation window, and cannot enter command handlers. Untrusted request IDs and
  command labels are bounded before they can be reflected in an error ACK.
- `SERVER_WELCOME.limits.maxInboundMessageBytes` advertises the command map so
  extension and stdio clients can discover the daemon contract instead of
  relying on hidden constants.
- Added pure UTF-8/limit tests and a real loopback regression proving an
  oversized heartbeat is rejected while a later valid heartbeat on the same
  authenticated connection succeeds. The complete suite passed 148/148 and
  `npm run build` passed for the extension, content script, daemon, MCP adapter,
  and status command.

### 2026-07-13 - Packaged daemon and dual-adapter lifecycle

- Fixed the stdio adapter lifecycle so stdin EOF/closure closes its daemon
  WebSocket heartbeat and MCP transport before exiting. A Codex client can now
  close an adapter normally without leaving a local orphan process.
- Added `npm run verify:packaged`. It builds and launches the actual
  `dist/daemon/server.js`, `dist/daemon/status.js`, and two concurrent
  `dist/mcp/server.js` processes against a random loopback port and isolated
  temporary data directory.
- The process verifier proved distinct adapter PIDs, authenticated tool calls
  from both adapters, independent first-adapter shutdown while the second stayed
  callable, daemon health after both adapters exited, clean daemon `SIGTERM`,
  `0700` data directory, `0600` config, and daemon restart using the same
  persisted config. The verifier completed successfully without printing the
  bridge token and removed its temporary directory.

### 2026-07-13 - Browser evidence gate audit

- Re-audited every unchecked/partial plan item, architecture completion
  criterion, threat-model gap, and completion-matrix row. No unimplemented
  required task remains outside real-Chrome evidence; same-process child trusted
  input is an intentional fail-closed boundary, while per-role connection
  quotas and an OS service installer remain optional enhancements.
- Expanded the disposable browser fixture with fixed non-secret storage,
  cookie, authorization-header, query, and response-body markers. Expanded the
  manual checklist to cover stale pending approval, active/pending Stop,
  approval-UI unavailability, value omission and deny/approve egress,
  cookie mutation confirmation, structural redaction, screenshot rendering, and
  cross-Profile artifact isolation.
- Added `docs/browser-validation-results.md` as a default-`not-run` evidence
  worksheet. Automated green checks cannot mutate those rows to pass. Corrected
  stale architecture/threat statements about persistence, packaging, trusted
  selector/form input, durable audit, and Provider-origin approval rendering.
- Added a read-only browser-evidence verifier with normal progress and strict
  completion modes. It requires exactly 17 matching manual sections, validates
  status and redacted Profile formats, requires sanitized notes for failures,
  rejects known disposable/raw credential markers without echoing them, and
  never edits the worksheet. Positive, incomplete, duplicate/sensitive, and
  invalid-argument paths have dedicated tests.
- The complete suite passed 153/153, `npm run build` passed for extension and
  Node artifacts, and the live worksheet verifier reported a valid incomplete
  state with 17 `not-run` rows and no schema errors. The strict completion gate
  intentionally remains non-zero until real Chrome evidence is recorded.

### 2026-07-14 - Authenticated UI state publication repair

- Real-Chrome conversation validation found that the sidepanel completed an AI
  exchange while the daemon still exposed an empty current conversation. The
  authenticated `ui` role reached `handleUiMessage()`, but valid sidepanel state
  commands fell through its dispatch switch and were silently discarded.
- Extracted one shared published-state dispatcher for browser and UI clients.
  The UI role can now publish its bound conversation, chat messages, page
  context, screenshots, selected elements, and Agent session state. Active-tab
  ownership remains browser-only, and the daemon continues to derive the
  installation session from the authenticated socket rather than trusting a
  payload session identifier.
- Added a loopback regression that publishes a conversation, two chat messages,
  and page context through an authenticated UI connection and asserts that all
  state lands only in the server-bound session. The complete suite passed
  164/164, `npm run typecheck` passed, and `npm run build` passed.
- After rebuilding and restarting the packaged daemon, a real sidepanel
  exchange was visible through MCP as exactly one user and one assistant
  message in the current Profile session. Pagination and mutation behavior are
  still being validated before Section 3.3 can pass.

### 2026-07-14 - Page-context schema and target synchronization repair

- Real sidepanel validation exposed two independent page-context defects. The
  generic text truncator appended its marker after the requested maximum, so a
  240-character semantic name became 265 characters and failed the WebSocket
  schema. Truncation now treats the marker as part of the final bound.
- Chrome target, document, and navigation IDs are opaque local routing values,
  not user text. They now receive only control-character removal and length
  bounds; the PII sanitizer no longer rewrites a numeric Chrome target ID as a
  phone placeholder and breaks strict target comparison.
- A daemon restart can retain a target that the still-running extension cannot
  prove is current. The background republishes its browser-authoritative target
  before every execution-grant check. Authoritative `ACTIVE_TAB_UPDATED`
  messages now replace optional routing fields instead of merging an obsolete
  document ID forever; state publications from page context and element
  selection remain conservative partial merges.
- Execution-grant target failures now report only mismatched field names, never
  field values or page content. Added regressions cover final sanitizer bounds,
  opaque numeric routing IDs, provenance agreement, and clearing stale optional
  routing fields.
- Real validation confirmed sidepanel `读取页面` produced a nonempty
  `page-context-digest-v1`, then `browser_snapshot` recovered after target
  synchronization with a live 50-node semantic snapshot. The complete suite
  passed 166/166 and `npm run build` passed for extension and Node artifacts.

### 2026-07-14 - Real Chrome Profile isolation deferred

- Product scope currently uses one local Chrome Profile, so the two-real-Profile
  manual validation in Section 7 is explicitly deferred. The row remains
  `not-run`; automated multi-session and multi-adapter routing tests are not a
  substitute for real Profile evidence.
- Before claiming simultaneous multi-Profile support, load the same unpacked
  extension in a second independent Chrome Profile and complete session,
  resource, conversation, approval, adapter-switching, and shutdown isolation
  checks from `docs/manual-browser-validation.md` Section 7.

### 2026-07-14 - Sidepanel workspace redesign and force-send cancellation repair

- Removed the duplicate internal extension title and `idle` label, expanded the
  tab workspace, and simplified the top-level labels to `对话`, `检查`, and
  `规则`.
- Added a bounded five-message Chat queue with FIFO send, promote, remove, clear,
  Stop, and force-send semantics. Queued messages enter the conversation and MCP
  state only when execution starts; new conversations remain disabled while a
  run or queue is active.
- Reworked Inspect into page, selection, query, and default-collapsed temporary
  style sections. Reworked Rules around one proxy switch, one Mock switch, a
  compact target toolbar, responsive header rows, and a default-collapsed DNR
  compatibility editor.
- Added message copy and return-to-bottom controls while deliberately deferring
  conversation persistence and mutation-safe retry until their storage and
  replay contracts are designed.
- Live force-send testing exposed a cancellation deadlock: the MCP abort helper
  attempted to assign `name` on Chrome's read-only native `AbortError`. The
  thrown `TypeError` prevented the pending MCP promise from being rejected.
  Cancellation now preserves native Error reasons, rechecks the signal after
  MCP connection establishment, rethrows cancellation from the tool executor,
  and releases the Agent even if an underlying executor never settles.
- Added queue, abort-error, and hanging-tool cancellation regressions. The full
  suite passed 174/174; `npm run typecheck`, `npm run build`, and
  `git diff --check` passed. In real Chrome, a page-query run finalized as
  cancelled, the force-sent message started next without overlap, completed,
  and returned the sidepanel to idle.

### 2026-07-14 - Profile-local Chat workspace and safe branching

- Added a versioned, bounded Chat workspace in the current Chrome Profile. It
  retains at most 20 conversations and 80 user/assistant text messages per
  conversation, restores the active draft, serializes writes, and omits tool
  results, runtime status, queues, attachment metadata, and image bytes.
- Added a local-history drawer with conversation switching and inactive-history
  deletion. Restoring a conversation resets and republishes the MCP current
  conversation snapshot, including when the conversation ID matches a daemon
  snapshot left by an earlier sidepanel lifecycle.
- Added edit-and-fork and mutation-safe retry. Both preserve the source
  conversation and create a new conversation ID. Safe retry excludes prior tool
  results and hard-disables page context, automatic reads, selected elements,
  tools, and web search; resending live image attachments requires an explicit
  confirmation.
- Split shortcut execution state from aggregate Agent activity. An Agent run now
  disables page shortcuts without showing three false spinners; only the
  shortcut matching the actual `runningTool` renders loading.
- Added workspace normalization, tool-heavy retention, branch safety,
  attachment resend, same-ID MCP reset, and shortcut-state regressions. The
  complete suite passed 185/185;
  `npm run typecheck`, `npm run build`, and `git diff --check` passed. Chrome
  loaded the rebuilt extension; final live interaction/visual verification is
  pending an unlocked foreground browser session.

### 2026-07-14 - Run-scoped approvals and tool-round boundary

- Added a three-way approval decision for eligible embedded-Agent requests:
  reject, allow once, or allow the same tool for the rest of the current Agent
  run. The remembered decision is memory-only and is cleared when the run
  completes, stops, is replaced, or a new message starts.
- The reusable scope is bound to the exact tool, policy class, requester
  connection, Agent session, page target/revision, and egress destinations. It
  is unavailable to external MCP requesters, destructive writes, arbitrary
  execution, and page tools without a bound target.
- Reusing an approval never reuses an execution grant. The daemon still creates
  and audits each approval request and issues a fresh, single-use,
  argument-bound execution grant for each accepted call.
- Reframed `maxToolRounds` as a per-segment boundary. By default the Agent keeps
  the latest 12 tool exchanges exact, compresses older exchanges, and continues
  without requiring a user `继续`; users can turn automatic continuation off to
  retain the old final-batch plus tools-off-summary behavior. Independent
  model-request, total-tool, effectful/sensitive-tool, and duration budgets span
  all segments and remain the hard stop.
- Added focused scope-invalidation and both tool-boundary regressions. The
  complete suite passed 192/192; `npm run typecheck`, `npm run build`, and
  `git diff --check` passed. Chrome loaded the rebuilt extension and showed the
  migrated default-on `自动压缩并续跑` switch with its segment-boundary copy.
  Verification of the new three-button approval card remains in the manual
  checklist because generating that card sends a prompt to the configured
  external AI provider.
- Removed the sidepanel's silent 8,000-character tool-result slice. Tool rows
  now carry exact presentation metadata, retain up to 256,000 characters,
  distinguish source pagination from UI truncation, and use a dedicated viewer
  with line virtualization above 240 lines. Four focused regressions brought
  the complete suite to 196/196; TypeScript, production build, and
  `git diff --check` passed. Live Chrome then rendered a 15.6k-character result
  as complete, virtualized its 578 lines, scrolled to later content, and
  confirmed copy state. This evidence is recorded as manual section 3.5.
- Real Chrome then exposed a cross-run idempotency defect during the new
  approval test. The configured Provider reused `functions.browser_click:0` in
  a later reply, while the sidepanel used only that call ID as its idempotency
  key; the daemon therefore returned the prior success without a new approval
  or click. The key is now a bounded SHA-256 digest of Agent run ID plus
  tool-call ID. Focused tests prove same-run stability, cross-run separation,
  different-call separation, and bounded provider-controlled IDs. After reload,
  two consecutive new Agent runs each showed a fresh approval card; the last
  request was denied and executed no page interaction.

### 2026-07-14 - Snapshot pagination and Agent no-progress repair

- A one-round live continuation test exposed that `browser_snapshot` advertised
  `cursor` and `limit` to the model but the sidepanel argument normalizer grouped
  it with no-argument tools and replaced every call with `{}`. The model kept
  retrying the requested pagination, producing repeated full 11.2k-character
  results instead of two-node pages.
- The normalizer now preserves a nonempty cursor and positive integer limit;
  the MCP runtime remains the strict enforcement point for the opaque cursor
  format and the `1..100` bound. A focused formal-tool regression proves the
  Provider-supplied pagination arguments reach execution unchanged.
- Added a generic read-only no-progress guard. It compares tool names,
  normalized arguments, and semantic result content while ignoring only known
  volatile snapshot capture timestamps at explicit metadata paths. Two
  identical comparisons are allowed;
  a third identical batch is blocked before execution, a visible reason is
  added to the conversation/session, and the model receives one tools-off
  summary request. Mutating/open-world batches are not reclassified by this
  guard and remain controlled by approval and hard run budgets.
- Live Chrome with a one-round segment and automatic continuation enabled
  produced exactly two complete ~2k `browser_snapshot` results at offsets 0 and
  2 without a user `继续`. With continuation disabled in a fresh conversation,
  exactly one page executed and the UI displayed the segment-limit/tools-off
  summary notice. The configured 50-round/default-on values were restored.
- `npm test` passed 201/201 in the authorized local environment, including the
  loopback daemon suite, pagination/no-progress regressions, and a negative
  regression proving changing business fields named `updatedAt` remain
  semantic progress. `npm run typecheck`, `npm run build`, and
  `git diff --check` passed for the same code state.

### 2026-07-14 - Alternating Agent-loop and transient narration repair

- A real service-creation task alternated `browser_query_dom`, click, and
  `browser_wait_for` operations for dozens of rounds. Because the earlier guard
  compared only adjacent all-read-only batches, an intervening tool reset its
  evidence and the run stopped only at the 64-model-request hard budget.
- The Agent now records semantic observations per read-only tool and normalized
  argument signature across the whole run. The third occurrence of the same
  semantic result stops execution and requests one tools-off summary. Mutating
  and open-world tools are excluded from this heuristic; their approval and
  hard budgets remain unchanged.
- Model text returned together with tool calls is now transient progress rather
  than durable assistant content. It remains in the provider tool exchange for
  protocol continuity, while the sidepanel exposes execution through its status
  row and commits only a final no-tool answer or tools-off summary.
- Added regressions for an interleaved `query -> wait -> query -> wait -> query`
  loop and for tool-call narration leaking into the final reply. The complete
  suite passed 203/203; `npm run typecheck`, `npm run build`, and
  `git diff --check` passed. Chrome reloaded the unpacked extension and reopened
  the rebuilt sidepanel successfully. No new prompt was sent to the configured
  external AI Provider during this verification.

### 2026-07-14 - Profile collaboration workspace and verified task state

- Reframed the kernel around a Profile-scoped `CollaborationWorkspace` rather
  than a task-only data model. Extension AI and MCP AI can publish typed,
  provenance-bearing `page.style`, DOM/semantic/screenshot, network trace/mock
  scenario, task state, code finding, implementation note, or note items.
- Added strict runtime schemas, structural redaction, owner/revision rules,
  private/sensitive MCP exposure filters, 32 KiB item and 256 KiB workspace
  ceilings, daemon restart persistence, and a session-scoped direct MCP
  resource. Added `browser_publish_collaboration_item` for bounded MCP-to-plugin
  handoff. Observer replay and updates are now limited to the same Profile;
  cross-Profile UI broadcast is no longer possible.
- The embedded Agent relevance-selects at most eight active shared items and
  treats them as untrusted evidence. Page-content collaboration items still
  honor the page-context switch. The system prompt requires minimal selective
  publication instead of full-page sharing.
- Added `AgentTaskState v1` with Observe-Plan-Execute-Verify phases, success
  criteria, observations, planned/active actions, verification evidence, and
  blockers. Browser mutations now force a later read-only verification call.
  Safety-budget, disabled auto-continuation, and no-progress stops are recorded
  as `blocked`, preserving progress for extension/MCP AI handoff instead of
  falsely marking the task complete.
- Final automated evidence for this slice: `npm test` passed 218/218, including
  the safe-read concurrency and mutation/sensitive-read serialization
  regressions. `npm run build` passed the TypeScript, Vite extension,
  content-script, daemon, MCP adapter, and status builds, and
  `git diff --check` passed. A real-Chrome
  style-only handoff, blocked-task takeover, and post-mutation verifier remain
  manual browser evidence and are not claimed complete.

### 2026-07-14 - Chat presentation and trusted-interaction recovery

- Removed the redundant `你` / `AI` bubble headers. User and assistant messages
  now use alignment, restrained surface color, directional corners, and an
  adjacent action rail; accessible message labels remain available to assistive
  technology. Tool rows keep their tool identity because it carries operational
  meaning.
- Added provider-control-token cleanup for the
  `<|tool_calls_section_begin|>` / `<|tool_call_begin|>` format, including an
  incomplete trailing block. The cleanup runs both when final Agent content is
  committed and when previously stored assistant messages are rendered or
  copied. Marker-only or otherwise non-displayable final responses now stop as
  blocked with a visible retry-oriented fallback instead of committing an empty
  completed response. Streaming placeholders remain empty while generation is
  active.
- Trusted pointer resolution now chooses the first visible/rendered selector
  candidate, computes points from the element/viewport intersection, and tries
  bounded visible-area probes while preserving hit-test and occlusion checks.
  This fixes partially visible and hidden-duplicate targets without adding a
  force-click path.
- The daemon now gives the background's live target publication a bounded
  350 ms window to replace persisted target state after reconnect. The embedded
  Agent retries `STALE_CONTEXT` or `EXECUTION_GRANT_INVALID` exactly once with a
  new idempotency key and a new authorization; geometry and unrelated failures
  are never blindly repeated. Real navigation still invalidates approval and
  execution grants.
- Current evidence: `npm test` passed 229/229, including AI safety, target
  freshness/recovery, approval/grants, daemon routing, state safety, trusted
  input, and the reconnect-to-live-target integration case. `npm run typecheck`,
  the final production build, and `git diff --check` passed.
  `npm run verify:packaged` also passed with the real dist daemon and two
  concurrent dist MCP adapter processes. Live Chrome confirmed the updated chat
  presentation, provider-marker cleanup, and a fresh approved `browser_click`
  against `#trusted-button`; the fixture reported `trusted`, confirming a real
  CDP trusted event, and a follow-up `browser_query_dom` read the same value.
  A suspected blank historical assistant bubble was investigated through the
  sidepanel DevTools DOM: its article contained the full 129-character final
  response. The apparent blank was an offscreen accessibility-tree omission,
  not a rendered empty bubble; the new empty-response fallback is preventive.

### 2026-07-15 - General Agent execution strategy and batch failure barrier

- Replaced form-oriented or selector-by-selector planning guidance with one
  general Goal -> Observe -> Dependency graph -> Decision barrier -> Execute ->
  Verify -> Re-plan protocol. Forms, UI operations, network/mock chains,
  diagnosis, styles, and collaboration handoff are task shapes rather than
  separate reasoning modes.
- Centralized the four-call model batch limit and task-state planning summaries.
  Independent safe reads can still run concurrently; effectful, sensitive,
  open-world, and mixed batches remain ordered and keep their existing policy,
  approval, target, idempotency, and single-use execution-grant boundaries.
- Added a runtime fail-fast barrier for ordered batches. Once a call fails or is
  denied, later calls are not executed against an unverified page state; the
  model receives explicit `AGENT_BATCH_DEPENDENCY_SKIPPED` results and must
  re-plan from confirmed evidence. A failed mutation is conservatively treated
  as possibly partial unless its result proves denial, skip, block, or no match,
  so a later read-only verification is still required.
- Added shared tool-result outcome classification and regressions for general
  strategy invariants, ordered failure, skipped dependent calls, and prompt
  safety. Automated and browser evidence is recorded in
  `docs/completion-evidence.md`; the real-Chrome failed-first-action scenario
  remains a separate manual gate.

### 2026-07-15 - Conversation-origin approval and fixed attention UI

- Replaced the narrow same-tool/current-run shortcut with a memory-only
  conversation-origin permission for the embedded sidepanel Agent. Its identity
  includes chat, normalized HTTP(S) origin, Profile session, owning sidepanel
  instance, and Provider destination; eligible policy classes are limited to
  sensitive reads, reversible writes, and page actions.
- Kept daemon policy and execution authorization independent: each automatically
  answered request still creates a separate daemon approval and a fresh,
  single-use, exact-call execution grant. Destructive, arbitrary-execution,
  open-world, unknown, unbound, non-HTTP(S), and external MCP calls are never
  remembered.
- Moved the pending approval card out of scrollable history into a fixed
  attention stack above the composer. Added assertive alert-dialog semantics,
  stronger orange contrast, explicit waiting copy, deny/once/chat-origin
  decisions, and a persistent visible revoke switch while permission is active.
- Added proactive invalidation for chat, origin, Provider, and hub changes, plus
  request-time fail-closed checks for Profile session and current authenticated
  sidepanel ownership. The user's choice survives a transparent WebSocket
  reconnect, but another sidepanel connection cannot consume it.
  Same-origin path/revision changes keep the decision but never bypass stale
  target validation.
- Automated evidence: focused tests passed 28/28; full suite passed 235/235;
  TypeScript, Vite, content-script, daemon, MCP-adapter, and status builds passed;
  `git diff --check` passed. Real Chrome then verified a fixed card above the
  composer, enable on one origin, cross-tool reuse without a second card,
  manual revoke followed by re-prompt, and automatic expiry/re-prompt after an
  origin change. The initial transient-connection mismatch found by this live
  test was repaired by checking each request against the owning panel's current
  authenticated connection. Active-grant chat switching remains a separate
  manual check.

### 2026-07-15 - Resilient transport and durable-approval design

- Traced the recurring `MCP tool connection closed before a result was
  returned.` JSON to the sidepanel bridge rather than to the invoked browser
  tool. The previous catch path serialized that infrastructure exception as an
  ordinary tool result and allowed the Agent to spend later rounds on it.
- Saved the approved boundary and staged implementation plan in
  `docs/resilient-approval-browser-control.md`. Approval UI may eventually
  remain in a memory-only `input_required` logical task, but MCP/browser
  requests and signed grants stay bounded. A late allow decision must create a
  fresh target/revision-bound request instead of reviving stale execution.
- [x] Add typed sidepanel transport failures with WebSocket close code/reason.
- [x] Retry one known `safe_read` after reconnect; never retry sensitive,
  mutating, open-world, or unknown calls automatically.
- [x] Stop the Agent as blocked and preserve progress when transport recovery
  fails or a non-safe call has an ambiguous outcome; do not append a false tool
  result card.
- [x] Replace the 30-second UI approval expiry with a logical
  `input_required` state that owns no active broker slot or grant and
  invalidates on user/run/chat/origin/Profile/Provider/target change.
- [ ] Make semantic snapshot refs directly actionable and target-bound. Current
  selector and coordinate tools already dispatch trusted CDP mouse/keyboard
  input; this item removes the model's need to reconstruct selectors from a
  descriptive ref.
- Target evidence passed: `tests/toolRecovery.test.ts`,
  `tests/agentCancellation.test.ts`, and `tests/agentToolBatch.test.ts` (9/9),
  TypeScript `--noEmit`, the complete suite (237/237), Vite/content/daemon/MCP/
  status production builds, `git diff --check`, and the packaged daemon plus two
  concurrent adapters. The complete suite now passes 238/238 after adding the
  collaboration-target projection regression. Real Chrome also passed three
  consecutive `browser_query_dom` calls beyond the former three-violation close
  threshold. A live disconnect showed no false tool-result row and a normal
  read succeeded after daemon recovery; the fast reconnect-success and
  disconnect-after-effect ambiguous-write cases remain pending.
- Durable approval evidence: unit/integration coverage confirms the wait owns
  no execution slot or grant and remains pending until an explicit decision.
  A real Chrome `browser_click` approval remained visible for 52 seconds;
  explicit rejection then removed the card, stopped the Agent, and preserved
  the fixture's `not clicked` state. Late allow still revalidates the target and
  only then creates a fresh bounded execution request and signed grant.

### 2026-07-15 - Collaboration target protocol-drift repair

- Root cause: `buildAgentTaskCollaborationItem` received a runtime
  `PageSnapshotTarget`. Structural typing hid its extra `title` property when it
  was treated as `CollaborationTargetBinding`; strict daemon parsing rejected
  `payload.item.target`, and repeated Agent state updates closed the socket at
  the protocol violation threshold.
- Added a shared, bounded `toCollaborationTargetBinding` projection and applied
  it at `McpBridge.sendCollaborationItem`, the final sidepanel WebSocket boundary.
  The receiver schema stays strict rather than accepting page-only metadata.
- Added positive and negative protocol coverage, rebuilt every runtime target,
  and verified the fix in the reloaded Chrome sidepanel with consecutive real
  read calls and no transport-close response.

### 2026-07-15 - Visible Agent pointer and task-scoped lifecycle

- Added a closed-Shadow-DOM Agent pointer overlay for trusted browser mouse,
  keyboard, form, selection, drag, wheel, and coordinate actions. The overlay
  uses the exact selected tab/frame/document target, remains non-interactive,
  and is excluded from DOM inspection results.
- Replaced the initial blue cursor, badge, action ring, and drag trail with the
  user-selected compact black pointer: a wide short head, concave triangular
  notch, thin light edge, transparent background, and soft blue glow.
- First use now glides in from a nearby point; later actions animate from the
  last confirmed position. The pointer remains visible across an active
  embedded Agent run, clears on run completion/cancellation/failure, sidepanel
  disconnect, navigation/content teardown, and before screenshots. External MCP
  callers without a run-end signal use a 30-second inactivity fallback.
- Pointer presentation is an internal best-effort content message and never
  changes whether the trusted CDP action executes. Every action still updates
  the exact coordinates, but this is not an additional model-visible tool call.
- Automated evidence: `tests/agentPointer.test.ts` passed 4/4; the complete
  suite passed 244/244; TypeScript, Vite, content-script, daemon, MCP adapter,
  and status builds passed; `git diff --check` passed. Real Chrome confirmed
  the compact transparent shape and continuous visibility across a click and a
  second move after three seconds.

### 2026-07-15 - Timing-wait no-progress false-positive repair

- Root cause: the cross-round loop guard treated every read-only result as a
  semantic page observation. `browser_wait_for({ time: 2 })` always returns the
  same normalized result, so three ordinary delays could be mistaken for a
  repeated page-state read even when mutations occurred between them.
- Pure timing waits are now excluded from both adjacent-batch and cross-round
  semantic-observation counters. Selector, text, and text-disappearance waits
  remain observations and still stop after the configured repeated-result
  threshold. The hard model/effect/time budgets remain unchanged.
- The stop notice now identifies the tool and observed repeat count, so a real
  loop can be distinguished from surrounding clicks, typing, or assistant
  narration.
- Automated evidence: all three new boundary regressions passed; the complete
  suite passed 247/247; TypeScript `--noEmit`, Vite, content-script, daemon, MCP
  adapter, and status builds passed; `git diff --check` passed. Reloaded-Chrome
  confirmation of the original timing-wait sequence remains pending.

### 2026-07-15 - Long-task wall-clock budget correction

- Increased the default Agent wall-clock budget from 10 minutes to 24 hours.
  Model-request, total-tool, effectful-tool, and sensitive-read limits remain
  unchanged, and the user can still stop an active Agent explicitly.
- Duration-limit notices now use human-readable hours, minutes, seconds, or
  milliseconds instead of exposing a large raw millisecond value.
- Automated evidence: the duration-boundary and 24-hour default regressions
  passed; the complete suite passed 248/248; TypeScript `--noEmit`, Vite,
  content-script, daemon, MCP adapter, and status builds passed; `git diff
  --check` passed. Reloading the unpacked extension remains required before an
  existing Chrome sidepanel uses the new default.

### 2026-07-15 - Opt-in fast Agent evidence and batch-form execution (superseded visual bootstrap)

Historical record: the automatic initial-screenshot behavior in this section
was removed by the 2026-07-16 Agent-owned visual-acquisition change below.

- Added a default-off `fastAgentMode` profile setting for vision-capable
  Providers. First enable explicitly confirms that one current-viewport
  screenshot per new Agent task will be sent to the displayed Provider origin;
  changing that origin while the mode is active requires confirmation again.
- A fast task captures at most one screenshot before its first model request and
  reuses it for later tool rounds. Capture failure or the six-attachment limit
  degrades to DOM-only evidence instead of blocking the task. Safe Retry always
  disables the mode so an image is never silently resent.
- Initial automatic page context is capped at 100 semantic nodes and exposes an
  `executionMap` containing at most 80 visible actionable controls. Ordinary
  fields whose selectors and requested values are already known are planned as
  one bounded `browser_fill_form` call instead of one query/fill model round per
  field. Navigation, document replacement, dynamic overlays, unknown targets,
  or failed actions remain decision barriers that require fresh evidence.
- The mode does not parallelize mutations or weaken approval, target freshness,
  idempotency, execution-grant, fail-fast, or post-mutation verification rules.
  Custom widgets that cannot be represented by the existing bounded form tools
  still use the general observe/re-plan path.
- Automated evidence: focused fast-mode, AI safety, credential migration,
  strategy, and Safe Retry tests passed 25/25; the complete suite passed
  252/252; TypeScript, Vite, content-script, daemon, MCP-adapter, and status
  builds passed; `git diff --check` passed. After extension reload, real Chrome
  confirmed the first-enable Provider destination, exactly one screenshot for
  one task, and a five-field form path with one broad DOM pre-read, one
  `browser_fill_form`, and one read-only DOM verification. All requested fields
  changed and excluded controls remained unchanged.

### 2026-07-15 - Adaptive fast-mode visual checkpoints (superseded activation)

Historical record: the initial automatic screenshot that activated this path
was removed on 2026-07-16. Current checkpoints activate only after an explicit
Agent screenshot tool result or an explicit user screenshot attachment.

- Extended the opt-in fast evidence path beyond its initial screenshot. After a
  successful navigation or visual action, a successful conditional wait, an
  uncertain visual-action failure, or two DOM/snapshot observations in one
  visual stage, the Agent refreshes a 100-node semantic snapshot and may capture
  the current viewport before its next model decision.
- Checkpoint creation is runtime-owned rather than model-requested. Multiple
  triggering tools in one batch coalesce to one refresh, byte-identical images
  are not sent again, and the initial or previous visual is invalidated before a
  changed page is re-planned. User-uploaded images remain attached.
- Each task permits one initial fast screenshot plus at most 12 adaptive capture
  attempts. After that boundary, the Agent continues refreshing DOM evidence
  without another automatic image. Capture or DOM failure degrades explicitly
  and never restores stale visual evidence.
- Adaptive screenshots keep the existing fast-mode Provider-origin consent and
  do not alter tool approval, target freshness, execution grants, fail-fast,
  mutation ordering, post-mutation verification, Safe Retry, or total Agent
  budgets.
- Automated validation covers trigger classification, pure-time-wait exclusion,
  repeated-DOM observation, denied versus uncertain failures, task-cap fallback,
  exact-image deduplication, initial-image retirement, untrusted checkpoint
  placement, and end-to-end replacement of the initial image after a click.
  The complete suite passed 262/262; TypeScript, Vite, content-script, daemon,
  MCP-adapter, and status builds passed; `git diff --check` passed. Real-Chrome
  route, drawer, and repeated-DOM visual-stage validation remains.

### 2026-07-15 - Context-digest heartbeat loop repair

- Real fast-mode navigation reached a different local origin before its page
  context synchronized. Repeated `browser_get_context_digest` results carried
  the same unsynced-state error and target but different top-level heartbeat
  timestamps, so the semantic no-progress guard incorrectly treated every round
  as new evidence.
- Result normalization now removes `lastSeenAt`, `stateUpdatedAt`,
  `artifactCapturedAt`, and the compatibility `updatedAt` only at the root of a
  context-digest result, plus `contextDigest.generatedAt` and
  `contextDigest.page.capturedAt`. Business timestamps from snapshots and other
  tools remain part of the semantic fingerprint.
- Cross-round observation history is consulted before execution. Two identical
  semantic reads therefore block a third matching read even when invalid or
  ineffective page actions are interleaved; a changed read result remains the
  evidence of real progress.
- Regressions matching both the unsynchronized payload and the live
  `failed click -> digest` trajectory prove that only two identical digest reads
  execute. The complete suite passed 262/262; TypeScript, Vite, content-script,
  daemon, MCP-adapter, and status builds passed. After extension reload, the
  final live retest showed exactly two real digest cards, blocked the third
  request before execution, and summarized without modifying the page.

### 2026-07-15 - Recoverable budgets, native selectors, and Network evidence

- Raised the default effectful/external-call budget from 32 to 50. Reaching any
  run-budget dimension now suspends the same Agent task behind a visible,
  no-timeout checkpoint. The user can extend only the exhausted dimension and
  retry the not-yet-executed step, or stop and generate a tools-off summary from
  the current tool history. No page-action approval is implied by continuation.
- Removed the misleading “Playwright-style” selector guidance. Selector actions
  now require native CSS, known Playwright/jQuery/XPath patterns fail before
  execution, and missing targets return an explicit one-observation recovery
  instruction instead of encouraging unchanged retries.
- Added a bounded Network activity digest to existing approval-gated Network
  reads. It groups method plus query-free origin/path plus status, collapses
  repeated heartbeat-like GET/HEAD Fetch/XHR traffic, prioritizes state-changing
  requests/navigation/failures, and returns at most 12 groups. The Agent is
  instructed to start recording before a network-relevant action and read once
  with `digestOnly: true` after the action barrier, not continuously poll.
- Automated evidence: targeted budget/selector/Network tests passed; the exact
  final code state passed 268/268 tests, TypeScript `--noEmit`, and Vite,
  content-script, daemon, MCP-adapter, and status production builds. A live
  harmless dropdown task proved recording-before-action, one digest-only read,
  empty raw rows, and DOM/visual verification without treating an unrelated
  image request as success. That run also exposed a stale version-2 daemon and
  contradictory pagination count; Protocol V3 now fails closed across stale
  processes, and digest results explicitly report `digestOnly` with zero raw
  returned counts. After rebuilding, restarting the daemon, and reloading the
  extension, a final V3 smoke task captured 17 underlying requests, returned
  zero raw rows, bounded the digest to 12 of 16 groups, and verified a project
  monitor action from its API response plus DOM/iframe state.

### 2026-07-16 - Durable Codex-to-extension Agent delegation plan

Status: implementation complete; the earlier delegation path has primary real
Chrome evidence, while the new inbox/conversation isolation still needs the
manual new-Chat acceptance check below.

Product boundary:

- A Codex/MCP message is untrusted text. An unaccepted delegation is shown only
  in the Profile-level inbox, not projected into every Chat.
- A delegated task never starts merely because it arrived. The user must accept
  it in the extension task inbox.
- Acceptance binds the task to the active plugin conversation. A bound task may
  be rendered, resumed, and completed only from that conversation; switching or
  creating a Chat never moves or auto-runs it.
- Accepting a task starts the existing embedded Agent with the delegated text as
  input; it grants no browser permission. Every sensitive read and page/browser
  mutation continues through the existing policy, approval, target-freshness,
  one-time execution-grant, cancellation, and audit path.
- A disconnected or reloaded sidepanel never automatically resumes a delegated
  run whose last write outcome may be unknown. It exposes an explicit
  re-observe-and-resume action instead.

Protocol and persistence model:

1. `browser_delegate_collaboration_task` creates one `task.request` item in the
   adapter-selected Profile workspace. The caller supplies a stable `taskId`;
   the daemon stores a canonical request fingerprint.
2. Repeating the same `taskId` and request returns the existing item. Reusing
   the ID with different content fails with `IDEMPOTENCY_CONFLICT`.
3. The sidepanel atomically claims the request with its active conversation ID
   before queuing or starting the Agent. The daemon persists a deterministic,
   sanitizer-safe conversation binding in the extension-owned claim child, so
   it survives sidepanel and daemon restarts without exposing the task in other
   conversations.
4. Agent progress continues to publish bounded `task.state` evidence. Terminal
   completion publishes one deterministic `task.result` child whose `parentId`
   points at the request.
5. `browser_wait_for_collaboration_result` first checks persisted state, then
   enters an abortable daemon input wait. A stored terminal result returns
   immediately after adapter reconnection. Cancelling or disconnecting the
   waiter does not cancel, restart, or replay the delegated task.
6. Reject, cancel, failure, and success are terminal results. A repeated
   terminal publication may return the same stored result but cannot overwrite
   it with different content.

Task states:

```text
pending -> claimed -> running -> completed
                            |-> failed
                            |-> cancelled
pending --------------------|-> rejected
claimed/running -- sidepanel loss --> recovery_required
recovery_required -- explicit user resume --> running
```

Chat/UI model:

- Show unbound pending and legacy-recovery `task.request` items in a compact,
  Profile-level `Codex 收件箱`.
- After acceptance, project the task only into its bound Chat timeline with a
  visible `Codex · MCP` source label. Terminal cards remain in that conversation;
  unbound terminal tasks are hidden from all Chat timelines.
- Existing assistant messages use a `插件 AI` source label. User messages keep
  their current right-aligned treatment without a redundant `你` label.
- A compact inbox shows actionable pending/recovery tasks with task scope,
  freshness, accept/resume, and reject actions. Target-scoped tasks cannot be
  accepted after their bound document/navigation changes.
- MCP-origin messages are not editable or retryable as user-authored messages.
  The linked extension AI answer remains a normal assistant reply and is also
  persisted as the terminal collaboration result.

Implementation slices:

- [x] Add strict delegated request/claim/result schemas and shared selectors.
- [x] Add MCP delegate/wait registrations and structured output schemas.
- [x] Add daemon task deduplication, atomic claim, terminal result, abortable
      waiter, capacity bounds, and Profile/session isolation.
- [x] Bump the shared extension-visible WebSocket protocol to V4.
- [x] Add Chat source metadata, MCP message projection, inbox UI, and responsive
      states without a new UI dependency.
- [x] Link delegated submissions to Agent progress and terminal results.
- [x] Add explicit recovery language and prevent automatic sidepanel-reload
      replay.
- [x] Bind acceptance and terminal publication to one plugin conversation;
      keep pending tasks in the global inbox and prevent cross-chat auto-run,
      resume, completion, or terminal-card projection.
- [x] Update architecture, threat model, MCP onboarding, and completion evidence.

Automated acceptance:

- Same task ID plus same request deduplicates; different request conflicts.
- Two sidepanel claim attempts cannot start two runs.
- Wait returns an existing result immediately, waits for a later result, aborts
  cleanly, and can be called again after adapter/daemon reconnection.
- Profile A cannot claim, complete, wait for, or read Profile B's delegated
  task through a bound adapter or sidepanel.
- Target-scoped acceptance fails closed after target/document/navigation drift.
- Reject/cancel/fail/success produce exactly one immutable terminal result.
- MCP messages render with `Codex · MCP`; extension replies render with
  `插件 AI`; MCP messages cannot use edit/fork/retry controls.
- A new Chat does not render another Chat's accepted or terminal Codex cards;
  pending unbound tasks remain actionable only through the global inbox.
- No delegated task executes before explicit user acceptance, and task
  acceptance does not suppress any existing per-tool approval.
- Focused tests, full `npm test`, `npm run build`, `npm run verify:packaged`,
  `git diff --check`, and real Codex -> extension -> Codex validation pass.

Remaining real-Chrome acceptance for conversation isolation:

- [ ] A fresh pending task appears in `Codex 收件箱`, not directly in the active
      Chat timeline.
- [ ] Accepting it adds the task card to the current Chat and completes the same
      task ID through the Codex waiter.
- [ ] Creating a new Chat hides the accepted/terminal card; reopening the
      original Chat restores it without moving or rerunning the task.

Current automated status on 2026-07-16: the task state, same-ID deduplication/conflict,
duplicate claim, immutable result, Profile isolation, target drift, cancelable
wait, restored-result, conversation binding/migration/exclusion, and real
loopback daemon/adapter async-flow cases pass. Together with the later
Agent-owned visual-acquisition coverage, the full suite passes 285/285;
production build, packaged two-adapter lifecycle,
and `git diff --check` pass. A reloaded real extension closed a previously stale
request as `cancelled` with `executed:false`, then accepted a fresh target-bound
request, ran the embedded Agent read-only, persisted `completed`, and returned
the stored result immediately to the Codex waiter. The fresh request preserved
its exact numeric target ID and UUID navigation ID.

#### 2026-07-16 - Stale target repair and delegated-task card polish

- Routing identities (`targetId`, `documentId`, and `navigationId`) are opaque
  protocol values. They now bypass human-text PII redaction so persistence does
  not corrupt the exact page binding used by acceptance freshness checks.
- A target-scoped request that becomes stale before acceptance may publish one
  terminal `cancelled` result without first claiming the task. This path cannot
  execute the Agent or browser tools; fresh unclaimed cancellation remains
  forbidden. The terminal result wakes an existing Codex waiter instead of
  leaving it pending indefinitely.
- The Chat task card now uses a compact source/status/title/body/criteria/footer
  hierarchy adapted from the Linear reference in `awesome-design-md`: light
  hairline surfaces, sparse blue accent, 8-10px radii, integrated copy control,
  explicit scope and approval boundaries, and distinct pending, running,
  recovery, success, failure, rejection, and cancellation states.
- Delegated rendering is source-bound: only the `mcp_ai` request becomes a task
  card. The linked `extension_ai` answer remains a normal Markdown reply. This
  removes the duplicated cards that previously inherited two different width
  rules (720px MCP card versus the ordinary 82% assistant bubble). Completed
  cards show a compact returned-to-Codex status instead of duplicating the full
  answer, and every MCP card now uses the same 100%-up-to-720px width contract.
- Timeline merging now preserves the chat array's intentional tool-before-final
  answer order and inserts persisted Codex cards by time without re-sorting chat
  messages. Codex cards use a restrained blue protocol accent; extension AI
  replies use a subtle violet label, border, and surface so the two agents remain
  visually distinct without adding another saturated panel.
- Automated evidence: opaque-ID preservation, stale-unclaimed terminal closure,
  fresh-unclaimed rejection, and delegated-stale error classification tests were
  added. The exact code state passes 282/282 tests, the complete production
  build, and `git diff --check`. Real Chrome stale cancellation and fresh
  delegate -> accept -> Agent -> completed waiter return pass. The final UI-only
  Markdown rendering patch still requires one extension reload and visual check.

### 2026-07-16 - Rules interaction-state repair

Status: automated verification complete; reloaded-extension acceptance pending.

- Removed the whole-Agent `aiBusy` state from the Rules workbench. Agent model
  generation or approval waiting no longer marks every Rules action as loading.
- Rules actions now show loading only for their matching local tool call; other
  conflicting mutations are temporarily disabled without displaying false
  spinners. The hit refresh action uses the normal reload icon and Ant Design's
  own loading replacement only while `debugger.proxy.listHits` is active.
- Proxy-rule save now awaits the real mutation result. A successful save exits
  edit mode and resets the editor; a failed save preserves the draft and edit
  marker. The edit banner also exposes an explicit `取消编辑` action.
- Current-tree evidence: 282/282 tests and the complete production build pass.

### 2026-07-16 - Agent-owned visual acquisition

Status: automated verification complete; reloaded-extension acceptance pending.

- Removed the pre-model screenshot capture from Chat submission. Sending a
  message now preserves only user-selected image attachments; fast mode adds a
  bounded DOM execution map but no implicit page image.
- The system prompt makes screenshot acquisition an Agent Observe decision. The
  Agent calls the normal approval-gated `browser_take_screenshot` tool only when
  geometry, layout, occlusion, or rendering evidence materially reduces task
  uncertainty. Pure DOM, text, style-value, and Network tasks remain image-free.
- A successful model-requested screenshot, or a screenshot the user explicitly
  attached, activates adaptive visual checkpoints for that task. Before this
  activation, navigation and UI changes still refresh DOM context but cannot
  capture an image. After activation, the existing 12-attempt, latest-only,
  exact-image-deduplication boundary remains.
- Safe Retry still disables fast mode. Screenshots and tool results remain out
  of persisted Chat history, and Agent screenshot calls retain sensitive-read
  approval, target binding, cancellation, artifact, and audit controls.
- Automated coverage verifies no image in the initial fast-mode model request,
  an actionable execution map, DOM-only barrier refresh before activation, and
  model-requested screenshot -> visual action -> adaptive checkpoint ordering.
- Current-tree validation passes 285/285 tests, the production build, and the
  packaged daemon plus two concurrent MCP-adapter lifecycle verifier. Reloading
  the unpacked extension remains required for the real Side Panel acceptance.
