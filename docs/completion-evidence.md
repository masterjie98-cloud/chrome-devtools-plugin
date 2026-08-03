# Architecture V2 completion evidence

Last audited: 2026-08-03

This file is the completion gate for the Architecture V2 migration. A checked
implementation-plan item is not by itself proof. Each row below names the
current authoritative evidence and any remaining verification boundary.

Status meanings:

- **proven**: current code plus an executed automated or runtime check covers
  the stated scope;
- **partial**: implementation exists, but required real-browser/process evidence
  is still missing;
- **pending**: the required evidence has not been collected.

## Current ws11 delta

The historical sections below retain evidence collected before the daemon Agent
protocol was introduced. The current source uses `WS_PROTOCOL_VERSION = 11` and
adds daemon-owned concurrent Agent runs, per-run in-memory Provider credentials,
multi-root Source Map editor targets, and portable Node packaging. A prior
`0.1.0+ws10` handshake remains historical evidence. The current dirty worktree
has now passed 504/504 tests, `verify:packaged`, production build and portable
ZIP generation. After a LaunchAgent hot restart, the current adapter, daemon
and both reloaded Chrome Profiles reported the same ws11 build/schema identity.

## Phase evidence

| Requirement | Status | Current evidence | Remaining evidence |
| --- | --- | --- | --- |
| P0 architecture, protocol, migration, threat model, acceptance plan | proven | `docs/architecture-v2.md`, `docs/implementation-plan.md`, `chrome-devtools-plugin-threat-model.md` | Keep this matrix and execution log synchronized with later changes. |
| P0 deterministic test foundation | proven | protocol fixtures, injected daemon clock/ID seams, isolated data-directory helper, `tests/testInfrastructure.test.ts` | None for the declared test-harness scope. |
| P1 canonical policy, tools-off gate, untrusted page context, cancellation, hidden-mutation removal | partial | `tests/toolPolicy.test.ts`, `tests/aiSafety.test.ts`, `tests/agentCancellation.test.ts`, `tests/mcpExecutorPolicy.test.ts`, `tests/dialogHandling.test.ts`; general execution strategy and ordered-batch fail-fast coverage in `tests/agentExecutionStrategy.test.ts` and `tests/agentToolBatch.test.ts`; bounded local action-stage registration and independent/dependent batching coverage in `tests/actionStage.test.ts`; real fast-mode five-field execution used one broad pre-read, one batch form mutation, and one read-only verification | Final V5 action-stage and adaptive-observation Chrome regression below. |
| P2 Profile/target/document/revision routing | proven | Multi-client session routing, wrong-socket, child-frame, stale provenance/cursor/grant tests plus two actual Chrome Profiles with distinct installation IDs, isolated adapters, tabs, approvals and independent shutdown. Real reload/navigation rejected stale document and semantic cursors. | None for the declared routing scope. |
| P2 sensitive-data policy and egress accounting | proven | Redaction/default-omission tests, approval previews, strict persisted audit schema and `tests/egressMetrics.test.ts`; real Chrome then passed denied/approved Cookie, storage, Network details and response-body paths with Provider/MCP destination labels and redacted persisted audit. | Downstream Provider/client wire bytes remain outside daemon visibility by design. |
| P3 long-lived daemon plus many adapters, pairing and V5 handshake | proven | daemon/client integration, assigned identity/role, token/origin/extension-ID negative tests, reconnect tests, advertised command-specific ingress byte limits; `npm run verify:packaged` starts the real dist daemon and two real dist stdio adapters | None for the declared daemon/adapter process scope. |
| P4 one-time approval, grants, cancellation, idempotency and concurrency | proven | Approval/grant, stale target, cancellation, retry/idempotency, deadline, wrong-result-socket and broker tests plus real conversation-origin enable/reuse/revoke/origin-change, Stop, denial and cross-Profile isolation workflows. | None for the declared approval and cancellation scope. |
| P5 bounded state, redacted audit, artifacts, canonical MCP registry/resources/outputs | proven | State/artifact store, retention/TTL cleanup, pagination, registry, resource, output and screenshot image-content tests; a real MCP screenshot rendered in Chat with Profile-bound artifact metadata and no inline `dataUrl`. | None for the declared state/artifact scope. |
| V5 execution core: task grants, compact incremental DOM, action stage, adaptive visual, Network observation and lifecycle timing | proven | `docs/execution-core-optimization-plan.md`; dynamic policy and exact-bound grant tests; V5 schema/registry checks; action-stage batching test; MutationObserver delta and visual checkpoint tests; actual queue/transport/approval/executor/total audit fields; 317/317 suite; packaged 69-tool process verification; and the 2026-07-17 real-Chrome evidence below | None for the declared execution-core scope. The broader Architecture V2 Profile/OOPIF/artifact worksheet remains separate. |
| P6 frame/OOPIF, semantic snapshot and trusted input | proven | Frame routing, unique OOPIF correlation, semantic cursor, trusted mouse/keyboard/form/dialog tests plus real Chrome top-frame and OOPIF trusted input, stale routing and post-state verification. Same-process child trusted input remains intentionally unsupported/fail-closed. | None for the declared OOPIF and fail-closed scope. |
| P6 packaging and recovery documentation | proven | daemon/MCP/status build outputs, README setup/recovery commands, and successful `npm run verify:packaged` process lifecycle exercise | None for the declared packaging scope. |
| Durable Codex-to-extension Agent delegation | partial | strict request/claim/result schema; stable task fingerprint; duplicate-claim and immutable-result guards; Profile and exact opaque target binding; stale-before-acceptance terminal cancellation; bounded cancelable waiter; restored-result and explicit-resume tests; real loopback daemon/adapter async-flow test; reloaded Chrome closed a stale request as cancelled and completed a fresh Codex → accept → plugin Agent → waiter-return flow; source-labeled structured Chat card and no-auto-replay implementation | Reload the final UI-only Markdown patch and visually confirm formatted terminal summaries; explicit real rejection remains in the broader browser regression. |

## Required validation matrix

| Area | Status | Evidence collected | Required before goal completion |
| --- | --- | --- | --- |
| Static types | proven | Current `ws11` worktree: `npm run typecheck` passed after daemon Agent migration and Side Panel dead-path removal. | Rerun after any later TypeScript change. |
| Unit/integration | proven | Current `ws11` `npm test` passed 504/504 outside the restricted sandbox after the Network/Cookie redaction, response-body verification and completed browser-evidence gate repairs. Earlier full runs found a stale task-sync expectation and a real cross-conversation authorization self-comparison; both were repaired before the green rerun. | None for the current source state. |
| Production build | proven | Current `npm run build` passed TypeScript, Vite, content, daemon, MCP, status, print-token and update-notice; the generated build id is `0.1.0+ws11`. | Rebuild after any later source change. |
| Daemon lifecycle | proven | Current `npm run verify:packaged` started the real `dist` daemon, restarted it with persistent config, verified private modes and clean shutdown. | Rerun after later daemon/package changes. |
| MCP multi-instance | proven | Current packaged verifier started two distinct `dist/mcp/server.js` processes, proved independent shutdown and daemon survival, and reported 90 tools. | Rerun after later MCP registry/protocol changes. |
| Installed runtime compatibility | proven | The current extension was reloaded, the LaunchAgent hot restart changed PID without losing either Profile, daemon status returned 90 tools, and adapter/daemon/browser all reported `0.1.0+ws11 / 0a990f43` with `compatible=true`. | None for the declared three-party identity and reconnect scope. |
| Release ZIP update | partial | Release transaction/rollback tests pass. `package:local` downloaded and SHA-256-verified Node v22.22.0 for macOS arm64/x64 and Windows x64 and generated a 108,429,466-byte current ZIP with SHA-256 `fbbdf434…85fe0dc2`; ZIP integrity, sidecar checksum, no-side-effect installer help/dry-run and the bundled macOS arm64 Node were independently executed successfully. | Install on macOS x64 and Windows x64, then exercise one real published GitHub Release upgrade on each required platform. |
| Multi-Tab activity monitoring | proven | The background owns independent bounded CDP activity sessions per Tab (maximum 8), daemon state is isolated by Profile plus Tab, and 15 activity/CDP/MAIN-world tests prove separate attach/stop ownership, event-kind gating, the eight-Tab limit, separate streams/cursors and restart recovery without a false active status. Stopping one activity monitor no longer disables a Network/Runtime domain owned by an ordinary debugger/proxy session on the same Tab. | Real Chrome still needs a two-Tab attach/switch/single-stop visual smoke test. |
| Agent restart state | proven | Agent task snapshots persist with tool arguments/results omitted. A daemon restart converts an interrupted `running` task to `blocked`, preserves its task/conversation/Tab binding and progress, clears the false active pointer, and appends an explicit recovery event. | The original in-memory model/tool execution stack is intentionally not replayed; the user or MCP client must re-observe before continuing. |
| Daemon Agent concurrency and Side Panel disconnect | partial | Current implementation owns model loops in daemon, isolates one run per `{browserSessionId, conversationId}`, permits different conversations concurrently, persists sanitized AgentSession updates and lets a reloaded Side Panel reattach by run id. Start/completion event loss is recovered from replayed sessions, every terminal path persists before notifying UI, and Stop propagates through the execution broker to pending approval/queued/browser work. API keys are absent from session/events and cleared after completion. | Run the real Provider flow with two conversations, close/reopen Side Panel during one run, approve a queued browser operation after reconnect, and confirm only the owning run is cancelled by Stop/delete. |
| Portable Node one-click install | partial | Current packager downloaded and verified all three official Node v22.22.0 targets, generated the ZIP, and executed its macOS arm64 Node. Installers use only bundled Node and default to LaunchAgent/Windows Startup; wrapper/flag tests pass. | Install the generated artifact on clean macOS arm64/x64 and Windows x64 systems. |
| Agent result evidence | proven | `agentResultEvidence` rejects prose-only browser-effect success claims without a successful mutation record and requires a later independent read after mutation. `autonomousAgent` gives the model one correction opportunity, then exposes an explicit blocked reason instead of accepting an unsupported result. | Real Provider behavior remains part of the browser regression, but unsupported claims already fail closed in code and tests. |
| Element-picker cancellation and select verification | proven | Both Chat and Inspector render an explicit cancel action while `elementPickerActive`; the background dispatches `DOM_CANCEL_ELEMENT_PICK`. In the real working Profile, explicit cancel removed the overlay without triggering the target, and switching Tabs automatically cancelled the old picker without leaking overlay/selection. `browser_verify(target_state)` accepts and compares `value` and set-equivalent `selectedValues` from a fresh semantic read; the multi-field live workflow verified single- and multi-select post-state. | None for the declared picker/select scope. |
| Chrome profiles | proven | Two real Chrome Profiles connected with distinct installation IDs. Two current ws11 adapters retained independent bindings and isolated tab lists; unknown-session and cross-Profile resource reads failed closed, Profile B approvals did not appear in Profile A, and closing one adapter did not stop the daemon or either browser Profile. | None for the declared two-Profile routing and approval-isolation scope. |
| Approval | proven | safe-read policy plus sensitive/mutation approve/deny/grant tests; three execution modes; chat/origin/Profile/Provider invalidation; dynamic pending-card continuation; requester-bound single-use grants; real Side Panel confirmation that the whole approval-mode strip opens the three-item menu and expanded tool arguments have a usable independently scrollable viewport that fully unmounts when collapsed; live MCP mode regression proved request/one-time approval, ordinary `task_grant` auto-approval under `替我审批`, decision-barrier interception, pending-card continuation after switching to `完全访问权限`, later full-mode auto-approval, restored denial after switching back to `请求批准`, new-chat reset with no grant leakage, and immediate fail-closed behavior while the owning Profile had no connected approval UI | None for the declared approval-mode and invalidation scope. |
| Stale context | proven | Navigation revision, provenance, stale cursor/resource/grant tests; approval regression proves same-target identity enrichment remains valid while a changed navigation fails before browser execution. Real A2/B2 routing stayed pinned, reload during approval returned `STALE_CONTEXT`, and an identical-DOM A3 reload returned `STALE_SNAPSHOT_CURSOR` for the pre-reload cursor. | None for the declared stale-document and cursor scope. |
| Cancellation | proven | AI, web search, adapter, daemon and browser terminal-cancel tests; the suite proves the sidepanel AbortSignal reaches MCP request cancellation and the daemon cancels the selected browser request. On 2026-07-28 a live embedded Agent entered `browser_wait_for`; Stop immediately rendered `Agent 已取消`, removed the Stop action, and produced no delayed success result. | None for the declared cancellation scope. |
| Data egress | proven | Cookie/storage defaults; header/body/query/fragment redaction; class/UTF-8 and artifact byte metrics; real Chrome confirmed a plain request produced no screenshot, an explicit screenshot required approval, route/drawer visual follow-ups ran only after activation, Provider-origin change required confirmation, and sensitive reads displayed the correct destination. | Downstream Provider/client wire bytes remain outside daemon visibility by design. |
| Artifacts | proven | Screenshot externalization, session binding, image content, retention and cleanup tests plus a real Profile-bound screenshot artifact rendered through MCP with bounded metadata and no inline `dataUrl`. | None for the declared artifact scope. |
| Browser regression | proven | Disposable fixtures, `docs/manual-browser-validation.md`, the authoritative worksheet in `docs/browser-validation-results.md`, and the fail-closed 18-row `verify:browser-evidence:complete` gate. All 18 rows are real-Chrome `pass`, including Profile isolation, OOPIF, stale context, approval/Stop, DNR, dialog, sensitive egress, screenshot artifact, credential storage and visual route/drawer behavior. | None for the current 18-row browser worksheet. |
| Security negative tests | proven | wrong token/origin/client identity/role/session/result socket/extension ID tests | Optional manual reconnect with extension-ID pinning enabled. |

The broader Architecture V2 umbrella remains incomplete while its required rows
are **partial** or **pending**. The V5 execution-core scope is tracked by its
dedicated row and evidence section below. Automated coverage must never be used
to claim unrelated missing Chrome or packaged-process evidence.

## V5 real-Chrome execution-core evidence — 2026-07-17

The following results were collected through the built `dist/mcp/server.js`
adapter against the disposable
`tests/fixtures/execution-core/index.html` page in the connected Chrome
Profile:

- ordinary task grant: one user authorization completed four field operations
  plus one dependent drawer click in one action stage (`completed: 5`,
  `stoppedAt: null`); page inspection confirmed every value and the visible
  drawer;
- Network observation: `digestOnly=true` returned zero raw rows and one grouped
  non-heartbeat `GET benchmark-ping.json` Fetch with status 200;
- incremental DOM: revision 1 to 4, available delta, 33 additions, 2 removals,
  2 attribute changes, no journal truncation;
- decision barrier: an opaque selector resolving to a submit control failed
  closed with `DECISION_BARRIER_REQUIRED`; the separate high-risk approval was
  denied and the page remained unsubmitted;
- revoke: after the visible task authorization was disabled, an ordinary
  operation produced a fresh approval and denial prevented execution;
- grant audit: approval-gated MCP filtering returned one real
  `grant.created` event and one real `grant.revoked` event. Grant lifecycle
  types are now present in both input and output schemas;
- compact DOM benchmark: 7 runs against the 10,000-node fixture, median
  11.35 ms, P95 27.9 ms, 1,321 semantic output characters, 2,219 structured
  result characters, source scan capped at 2,000/2,000 with `truncated: true`;
- lifecycle telemetry: the persisted redacted audit contained 50 completed
  tool events with all seven numeric fields. Recent real audit reads showed
  nonzero approval wait separated from queue, executor, transport and total
  wall time, plus exact result-character and payload-byte counts.

The first ordinary regression exposed a false `STALE_CONTEXT`: the browser
published a previously missing `documentId` while approval was pending. The
daemon now binds every identity field known at request time, permits only
same-target field enrichment, checks freshness before creating a remembered
grant, and checks the same projection again before executor dispatch. The
targeted integration test also proves that changing `navigationId` still fails
before browser execution.
