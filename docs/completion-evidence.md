# Architecture V2 completion evidence

Last audited: 2026-07-16

This file is the completion gate for the Architecture V2 migration. A checked
implementation-plan item is not by itself proof. Each row below names the
current authoritative evidence and any remaining verification boundary.

Status meanings:

- **proven**: current code plus an executed automated or runtime check covers
  the stated scope;
- **partial**: implementation exists, but required real-browser/process evidence
  is still missing;
- **pending**: the required evidence has not been collected.

## Phase evidence

| Requirement | Status | Current evidence | Remaining evidence |
| --- | --- | --- | --- |
| P0 architecture, protocol, migration, threat model, acceptance plan | proven | `docs/architecture-v2.md`, `docs/implementation-plan.md`, `chrome-devtools-plugin-threat-model.md` | Keep this matrix and execution log synchronized with later changes. |
| P0 deterministic test foundation | proven | protocol fixtures, injected daemon clock/ID seams, isolated data-directory helper, `tests/testInfrastructure.test.ts` | None for the declared test-harness scope. |
| P1 canonical policy, tools-off gate, untrusted page context, cancellation, hidden-mutation removal | partial | `tests/toolPolicy.test.ts`, `tests/aiSafety.test.ts`, `tests/agentCancellation.test.ts`, `tests/mcpExecutorPolicy.test.ts`, `tests/dialogHandling.test.ts`; general execution strategy and ordered-batch fail-fast coverage in `tests/agentExecutionStrategy.test.ts` and `tests/agentToolBatch.test.ts`; bounded local action-stage registration and independent/dependent batching coverage in `tests/actionStage.test.ts`; real fast-mode five-field execution used one broad pre-read, one batch form mutation, and one read-only verification | Final V5 action-stage and adaptive-observation Chrome regression below. |
| P2 Profile/target/document/revision routing | partial | multi-client session routing, wrong-socket, child-frame, stale provenance/cursor/grant tests | Two actual Chrome Profiles/installation IDs, two tabs/windows, navigation and tab-close behavior in Chrome. |
| P2 sensitive-data policy and egress accounting | partial | redaction/default-omission tests; approval previews; strict persisted audit schema; `tests/egressMetrics.test.ts`; daemon screenshot and artifact egress integration | Confirm the approval card and Provider/MCP destination labels in real Chrome. Downstream Provider/client wire bytes are outside daemon visibility. |
| P3 long-lived daemon plus many adapters, pairing and V5 handshake | proven | daemon/client integration, assigned identity/role, token/origin/extension-ID negative tests, reconnect tests, advertised command-specific ingress byte limits; `npm run verify:packaged` starts the real dist daemon and two real dist stdio adapters | None for the declared daemon/adapter process scope. Real Chrome Profile isolation remains a separate row below. |
| P4 one-time approval, grants, cancellation, idempotency and concurrency | partial | approval/grant, stale target, cancellation, retry/idempotency, deadline, wrong-result-socket and broker tests; conversation-origin matching/invalidation/exclusion tests | Real conversation-origin enable/reuse/revoke/origin-change behavior and Stop interactions. |
| P5 bounded state, redacted audit, artifacts, canonical MCP registry/resources/outputs | partial | state/artifact store, retention/TTL cleanup, pagination, registry, resource, output and screenshot image-content tests | Render an actual screenshot through Codex MCP and record its Profile-bound artifact evidence in `docs/browser-validation-results.md`. |
| V5 execution core: task grants, compact incremental DOM, action stage, adaptive visual, Network observation and lifecycle timing | proven | `docs/execution-core-optimization-plan.md`; dynamic policy and exact-bound grant tests; V5 schema/registry checks; action-stage batching test; MutationObserver delta and visual checkpoint tests; actual queue/transport/approval/executor/total audit fields; 317/317 suite; packaged 69-tool process verification; and the 2026-07-17 real-Chrome evidence below | None for the declared execution-core scope. The broader Architecture V2 Profile/OOPIF/artifact worksheet remains separate. |
| P6 frame/OOPIF, semantic snapshot and trusted input | partial | frame routing, unique OOPIF correlation, semantic cursor, trusted mouse/keyboard/form/dialog tests | Chrome 125+ OOPIF `Event.isTrusted`, same checklist on a real page, and the complete browser regression. Same-process child trusted input remains intentionally unsupported/fail-closed. |
| P6 packaging and recovery documentation | proven | daemon/MCP/status build outputs, README setup/recovery commands, and successful `npm run verify:packaged` process lifecycle exercise | None for the declared packaging scope. |
| Durable Codex-to-extension Agent delegation | partial | strict request/claim/result schema; stable task fingerprint; duplicate-claim and immutable-result guards; Profile and exact opaque target binding; stale-before-acceptance terminal cancellation; bounded cancelable waiter; restored-result and explicit-resume tests; real loopback daemon/adapter async-flow test; reloaded Chrome closed a stale request as cancelled and completed a fresh Codex → accept → plugin Agent → waiter-return flow; source-labeled structured Chat card and no-auto-replay implementation | Reload the final UI-only Markdown patch and visually confirm formatted terminal summaries; explicit real rejection remains in the broader browser regression. |

## Required validation matrix

| Area | Status | Evidence collected | Required before goal completion |
| --- | --- | --- | --- |
| Static types | proven | `npm run build` reran TypeScript `--noEmit` successfully on 2026-07-20 | Rerun after any later code change. |
| Unit/integration | proven | The complete `tsx --test tests/*.test.ts` suite passed 317/317 on 2026-07-20, including task capability binding/expiry/revoke, three execution approval modes, bounded action-stage exposure and dependency-aware batching, same-target approval enrichment, mixed-tab debug-activity rejection, grant lifecycle audit schemas, actual queue timing, large-DOM visual checkpoints, delegated-task durability, trusted input, Network digest, routing, state and recovery coverage. | Rerun after any later code change. |
| Production build | proven | TypeScript, Vite, content script, daemon, MCP adapter, and status command builds passed on 2026-07-20 | Rerun after any later code change. |
| Daemon lifecycle | proven | Final `npm run verify:packaged`: actual dist daemon, authenticated status, clean shutdown, private config, same-config restart | Rerun the verifier after lifecycle or packaging changes. |
| MCP multi-instance | proven | Final `npm run verify:packaged`: 69 exposed tools, two simultaneous actual `dist/mcp/server.js` processes with distinct PIDs; one exits independently and the daemon survives adapter exit | Rerun the verifier after adapter transport or lifecycle changes. |
| Chrome profiles | pending | deterministic Profile/session tests only | Two isolated extension installation IDs in two real Chrome Profiles. |
| Approval | proven | safe-read policy plus sensitive/mutation approve/deny/grant tests; three execution modes; chat/origin/Profile/Provider invalidation; dynamic pending-card continuation; requester-bound single-use grants; real Side Panel confirmation that the whole approval-mode strip opens the three-item menu and expanded tool arguments have a usable independently scrollable viewport that fully unmounts when collapsed; live MCP mode regression proved request/one-time approval, ordinary `task_grant` auto-approval under `替我审批`, decision-barrier interception, pending-card continuation after switching to `完全访问权限`, later full-mode auto-approval, restored denial after switching back to `请求批准`, new-chat reset with no grant leakage, and immediate fail-closed behavior while the owning Profile had no connected approval UI | None for the declared approval-mode and invalidation scope. |
| Stale context | partial | navigation revision, provenance, stale cursor/resource/grant tests; approval regression proves same-target `windowId`/`frameId`/`documentId` enrichment remains valid while a changed `navigationId` fails before browser execution | Navigate a real selected tab while approval is pending and confirm rejection. |
| Cancellation | partial | AI, web search, adapter, daemon and browser terminal-cancel tests | Stop an active real-browser tool from the sidepanel. |
| Data egress | partial | cookie/storage defaults; header/body/query/fragment redaction; class/UTF-8 byte metrics; artifact byte metrics; fast mode defaults on for DOM-first orchestration, is disabled by Safe Retry, never auto-attaches a screenshot on message send, and requires an approval-gated Agent screenshot request before bounded visual follow-ups | Real initial request with zero screenshots, Agent-requested screenshot approval, adaptive route/drawer/large-DOM checkpoint delivery after activation, Provider-origin-change confirmation, and the remaining sensitive-read destination cases in the Side Panel. |
| Artifacts | partial | screenshot externalization, session binding, image content, retention and cleanup tests | Render a real screenshot through Codex MCP. |
| Browser regression | partial | disposable fixtures, `docs/manual-browser-validation.md`, the authoritative worksheet in `docs/browser-validation-results.md`, and a fail-closed 18-row `verify:browser-evidence:complete` gate. In addition to prior browser evidence, the final V5 execution-core workflow below passed in real Chrome. | The broader Architecture V2 worksheet still requires its unrelated Profile, OOPIF, artifact, DNR, dialog, Stop and remaining egress rows; these do not redefine the completed V5 execution-core scope. |
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
