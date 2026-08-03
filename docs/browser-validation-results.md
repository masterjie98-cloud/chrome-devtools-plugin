# Browser validation results

This is the authoritative worksheet for evidence collected from
`docs/manual-browser-validation.md`. It intentionally starts as `not-run`.
Change a row to `pass` only after every step and failure condition in that
section has been checked. Use `fail` for any mismatch and record only sanitized
symptoms; never copy tokens, cookies, storage values, headers, bodies, page
content, or artifact bytes here.

The verifier blocks known disposable markers and common credential shapes, but
this is a bounded guard, not a general secret scanner. The tester remains
responsible for writing only error codes and sanitized behavior.

## Environment

- Date: 2026-07-13 to 2026-08-03
- Tester: Codex with user-operated extension reloads
- Chrome version: 149.0.7827.201
- OS version: macOS 26.5.1
- Extension build time or local revision: 2026-08-03 / 6c71be0c + dirty ws11 worktree
- Last live-validated extension shell: local dirty `ws11` worktree reloaded
  2026-08-03; Side Panel displayed `AI 已就绪 / Daemon 已连接` after the final
  LaunchAgent reload. The complete behavior worksheet below was subsequently
  closed through real Chrome operations.
- Current source/build protocol: `ws11`; production build, 504/504 tests,
  packaged-process verification and the strict 18/18 browser-evidence gate
  passed. Current adapter, daemon and both browser Profiles reported matching
  `0.1.0+ws11 / 0a990f43` build identity with `compatible=true`.
- Daemon mode (`daemon:dev` or packaged): installed LaunchAgent from current `dist/daemon/server.js`; earlier checks also used `daemon:dev`
- Profile A installation ID: redacted-592f2e4fbcce
- Profile B installation ID: redacted-f0fbdf7a

When filled, Profile IDs must use `redacted-<last4-to-12-characters>`, for
example `redacted-a1b2c3`; never store the complete installation ID here.

Allowed status values: `not-run`, `pass`, `fail`.

| Manual section | Required evidence | Status | Sanitized notes |
| --- | --- | --- | --- |
| 1 | Extension, daemon, token pairing and MCP tools available | pass | Token pairing, live Profile connection, 65 exposed daemon tools and a real stdio adapter were verified. |
| 3 | Exact tab/frame/document routing and stale document rejection | pass | Top frame and child frame routed to distinct documents; after reload, old frame 6617 was rejected and the new child frame 6621 returned `Child frame content`. No child announcement or stale selection fell back to frame 0. |
| 3.1 | Session-bound resource templates and stale/cross-Profile denial | pass | Six safe templates and five opaque session/target resources passed. Unbound access returned `RESOURCE_SESSION_UNBOUND`; a stale target returned `STALE_CONTEXT`. With two real Profiles online, adapter B reading adapter A's URI returned `ROLE_FORBIDDEN`, while each adapter could read its own bound resource. |
| 3.2 | Fresh semantic snapshot, pagination and stale cursor | pass | Live top/child snapshots, nonrepeating pagination and exact target metadata passed. Five child-to-top races returned either `STALE_CONTEXT` or correctly child-bound results. On 2026-08-03 the A3 fixture found that an identical-DOM reload reused an old cursor. The fingerprint now includes a per-document key; after rebuild/reload, that old cursor returned `TOOL_FAILED: STALE_SNAPSHOT_CURSOR`. |
| 3.3 | Network/conversation/audit pagination and Profile isolation | pass | A current ws11 adapter recorded nine fixture requests, read five nonrepeating pages of two and rejected an old recording cursor with `STALE_PAGINATION_CURSOR`. Two connected Profiles then retained separate targets, adapter routing and resource ownership; switching or closing adapter B did not move or disconnect A. |
| 3.4 | Sidepanel page read, element selection, cancel and stale-tab handling | pass | In the actual working Profile, the fixture returned `#trusted-button`; explicit cancel removed the overlay without triggering the button, and switching Tabs automatically restored the Side Panel picker action with no overlay or selection in the new Tab. A separate non-authoritative test browser that likely loaded another extension directory was excluded. |
| 3.5 | Tool-result completeness, virtual scrolling and copy | pass | A live read returned 15.6k characters and the collapsed row labeled it complete. Expansion reported the same complete count, used a 578-line virtual viewport, scrolled to later content, and changed the copy control to `已复制`. No 8k display-side slice remained. |
| 4 | Deny/approve/one-time grants, trusted click and OOPIF routing | pass | Denial, fresh one-time approval, same-chat/domain grants, grant switch-off, origin invalidation and all three approval modes passed. A task remained pinned to A2 while approvals were handled from B2. Trusted top-frame and OOPIF input, fail-closed stale routing, requester-specific egress text and daemon audit were verified without cross-Tab mutation. |
| 4.1 | One-current-dialog CDP handling | pass | Current-build live run on 2026-08-03: exact Profile A target was pre-armed; one approved call dismissed Confirm and another accepted Prompt with the exact text. No-dialog failed quickly; a later Confirm remained open until a new approval. A read confirmed native `window.confirm` remained intact. |
| 4.2 | Trusted typing/key input and fail-closed targets | pass | Replace/Unicode typing and key input used trusted CDP events; invalid key, readonly and oversized inputs failed before mutation. The 2026-07-24 direct-frame gate supersedes the earlier unsupported child result: a fresh bound reference wrote the OOPIF input and a follow-up observation verified its exact value. Same-process coordinate routing remains automated-only. |
| 4.3 | Form preflight, CDP controls and scoped DOM select | pass | Preflight and fail-closed edge cases passed. A real five-field task used one broad read, one `browser_fill_form` and one verification; all requested values changed while excluded controls did not. The 2026-07-24 OOPIF direct fill also passed exact post-value verification; multi-field child-frame form fill was not separately exercised. |
| 4.4 | Stale approval, active Stop, pending Stop and unavailable UI | pass | Approval remained visible for 52 seconds; rejection preserved `not clicked`. Reload returned `STALE_CONTEXT`; caller abort removed its card. With the Side Panel closed, an approval-gated read failed before execution with `APPROVAL_REQUIRED`; reopening restored the UI but not its grant. On 2026-07-28 an embedded Agent entered a 30-second `browser_wait_for`; Stop immediately rendered `Agent 已取消`, removed the Stop action and produced no delayed success result. |
| 4.5 | Sensitive default omission, deny/approve, redaction and destination | pass | Current-build live verification passed keys-only defaults, denied then approved value reads, separately approved Cookie write/delete, sanitized Network list/details, denied then approved response-body access, persisted audit redaction and cleanup. Query values, credentials, bodies and Cookie values were absent from default metadata and audit output. |
| 4.6 | Screenshot MCP image, artifact binding and bounded metadata | pass | Live MCP screenshot returned `image/png` content and a session artifact URI with MIME type, byte length, SHA-256 and expiry. `structuredContent` omitted `dataUrl`, Chrome Downloads was not used, and daemon audit separated 33,776 ms approval wait from 81 ms executor time. |
| 4.7 | DNR upsert/remove deny/approve, one-time grant and exact cleanup | pass | On 2026-08-03 a fresh ws11 adapter started from an empty rule set. A denied upsert preserved the baseline; a one-time-approved upsert created one new numeric rule ID; retrying the replacement required a fresh approval and denial preserved the rule; denied removal preserved it; approved removal deleted exactly that ID. Final rules returned to the empty baseline with no unrelated changes. |
| 5 | Credential migration and Provider-origin confirmation | pass | In Profile B a disposable loopback Provider stored its marker once under `aiDevtools.aiCredentialsV1`, never in profile localStorage or another extension key; reload restored it, and cancelling a changed-origin confirmation kept the original Provider. In Profile A a plain reply captured no image; an explicit Agent screenshot required approval, then the fixture drawer opened, client route changed and a read-only verification passed. |
| 6 | V3 reconnect/backoff/heartbeat without duplicate mutation | pass | Both Profiles stayed on the same sessions for more than 90 seconds while 15-second heartbeats advanced and revisions remained stable. A LaunchAgent hot restart changed the daemon PID, both Profiles automatically reconnected, build/schema identities stayed compatible and a safe status read resumed. Automated recovery also proves writes are never transport-replayed. |
| 7 | Two real Chrome Profiles and two adapter routing isolation | pass | Two real Profiles exposed distinct redacted installation IDs. Two ws11 adapters saw only their bound Profile's tabs; switching adapter B did not move adapter A. Unknown session and cross-Profile resource access were denied. Both approvals appeared only in Profile B. Closing adapter B left adapter A, daemon and Profile B connected. |

## Supplementary live evidence

- Provider credential and adaptive visual flow (live passed on 2026-08-03): a
  disposable Profile B configuration proved metadata localStorage omitted its
  credential, extension credential storage contained exactly one matching
  entry, reload restored the field and cancelling an origin change retained
  the prior destination. In Profile A a plain no-tools message produced no
  screenshot. A later explicit visual task showed one screenshot approval,
  opened the benchmark drawer, changed the client route to `?view=details` and
  verified `drawer-open`, drawer accessibility and all 30 drawer controls.
- Sensitive-data boundary (live passed on 2026-08-03): Profile A used one
  bounded disposable fixture and cleaned it at the end. Default Storage/Cookie
  reads omitted values; explicit value reads required independent approval.
  Cookie mutation output retained its schema-safe metadata object, while raw
  values stayed redacted. Network list/details removed query values, credential
  headers and request bodies. The first response-body approval was denied, the
  second was allowed while recording remained active, and persisted audit
  metadata contained none of the disposable values.
- Idle heartbeat and daemon reconnect (live passed on 2026-08-03): both Profile
  sessions remained connected for more than 90 seconds with stable revisions
  and advancing heartbeats. Restarting the installed LaunchAgent changed the
  listening daemon PID from 54424 to 66694; both Profiles reconnected with the
  same session identities, current target bindings and compatible ws11
  build/schema identities. A subsequent `browser_status` safe read succeeded.

- Native dialog lifecycle (live passed on 2026-08-03): the first implementation
  tried to attach and enable the Page domain only after the native dialog had
  blocked the renderer, causing `REQUEST_DEADLINE_EXCEEDED`. Target selection
  now pre-arms `Page.enable`; dialog handling only sends
  `Page.handleJavaScriptDialog`, and an unprepared session fails immediately
  with `DIALOG_SESSION_NOT_ARMED`. The live verifier passed Confirm dismissal,
  Prompt text acceptance, no-dialog rejection, future-dialog isolation and
  native-function preservation against one exact Profile A Tab.
- Dual-Profile isolation (live passed on 2026-08-03): Profile A and Profile B
  connected to the same installed daemon with different installation IDs.
  `scripts/verify-profile-isolation-live.mjs` started two current ws11 stdio
  adapters, bound them independently, rejected an unknown session, returned
  `ROLE_FORBIDDEN` for a Profile A resource read from Profile B, and confirmed
  that closing one adapter did not disconnect either browser Profile. A
  no-visual-effect CSS variable write and its cleanup were both approved only
  in Profile B; Profile A displayed no approval card.

- Historical installed-runtime handshake (live passed on 2026-08-03): a newly started
  current `dist/mcp/server.js` adapter connected to the installed LaunchAgent;
  adapter, daemon and Chrome extension all reported
  `0.1.0+ws10 / 4e215a6f` with `compatible=true`. The daemon exposed 90 tools,
  one redacted Profile was browser-connected, and 34 scriptable tabs were
  listed. An older manually started `daemon:dev` process had been holding port
  17321 and causing the LaunchAgent to exit with `EADDRINUSE`; after its exact
  PID tree was stopped, the current LaunchAgent became `running`. This proves
  the installed single-Profile handshake, not two-Profile isolation.

- P0-P2 closure (live passed on 2026-07-28): adapter, daemon and browser
  negotiated `0.1.0+ws8 / b442dc4c`. The complete workflow verifier passed
  four top-frame actions, direct OOPIF and same-process actions, exact values
  and selected values, DOM/URL/Network/Console evidence, screenshot diff,
  high-confidence request causality, recipe replay, interaction/INP plus trace
  summary, realtime schema, stateful Mock and a bounded issue-evidence artifact.
  A cache-busted fixture then proved the positive CSS chain
  `mapped.css -> mapped.css.map -> src/fixtures/trusted-button.scss`.
  Collaboration V2 proved idempotent progress, requirement and evidence events,
  durable Codex cancellation, and waiter recovery to `cancelled`. The sidepanel
  history drawer exposed full-text search and explicit Markdown/JSON export; a
  live `重定向` query retained only the matching conversation. The active Stop
  result is recorded in Section 4.4.

- Workflow-evidence upgrade (live passed on 2026-07-24): adapter, daemon and
  browser negotiated `0.1.0+ws7 / f085f1dd`. One `browser_workflow` completed
  four top-frame actions, returned four post-states, passed exact text,
  checkbox, single-select and multi-select verification, and returned
  DOM/URL/Network/Console evidence. A fresh child reference then completed one
  OOPIF fill without changing the selected frame; a follow-up observation read
  `direct-frame-value`. Two identical element screenshots produced
  `baselineAvailable: true`, `changed: false` and `changedPixelRatio: 0`; the
  unchanged result contained no image bytes and did not write Chrome Downloads.
  Live hardening repaired three defects found by the gate: snapshot-scoped test
  refs were refreshed before reuse, screenshot diff no longer calls
  service-worker `fetch(data:)`, and trusted child-frame input now routes unique
  OOPIF roots plus same-process frame content-box coordinates while preserving
  exact document binding.
- Multi-frame observation (live fixture passed on 2026-07-23):
  after loading the latest extension build and restarting the LaunchAgent,
  `browser_observe(frameScope=auto)` read the 8765 top frame and the cross-origin
  8766 child in one call. Ten warm calls all returned 19 top-frame nodes and 2
  child-frame nodes; the child was `actionable=false`, exposed no `targetRef`,
  and retained its own frame/document provenance. Median model-visible latency
  was 40 ms (P95 80 ms); content scans were 0.2–1.1 ms in the warm samples.
- Batch action and screenshot evidence (live fixture passed on 2026-07-23):
  one `browser_act` changed five controls and the page truth was 5/5 correct.
  Daemon audit separated 81,802 ms of approval wait from 324 ms executor time.
  A screenshot returned MCP image content plus a bounded artifact URI, omitted
  `dataUrl` from structured content, and did not write Chrome Downloads.
- Verification protocol gap (code repaired; live retest pending):
  `browser_verify(target_state)` now accepts `value` for the current single-select
  value and `selectedValues` for exact set-equivalent multi-select verification.
  The fresh semantic read returns both fields; the earlier misuse of
  `selected=true` against a select root is no longer required.
- Disclosure state: the approval-mode trigger exposed controlled open/closed
  state; the pending approval parameter control changed `展开` -> `收起`,
  mounted the full JSON region, then returned to `展开` and unmounted it. The
  shared chevrons now rotate from the same state and disable animation under
  reduced-motion preferences.
- Agent pointer: an approved click displayed the compact transparent pointer
  with blue glow. A second move after three seconds remained continuously
  visible, and MCP DOM querying did not expose the overlay host.
- Fast Agent evidence path: first enable showed the Provider screenshot-egress
  confirmation. The previously observed automatic initial screenshot is now
  superseded and must not occur. A five-field fixture task
  then produced the redacted audit sequence `browser_query_dom` ->
  `browser_fill_form` -> `browser_query_dom`, with one mutation approval and all
  requested values verified on the page. A later local project-detail task
  visibly attached its initial fast screenshot, executed overlay/navigation/back
  actions, crossed to a different local origin, and performed repeated context
  observations. That run exposed the heartbeat-loop defect below; the repaired
  guard was then confirmed live with exactly two executed digest result cards
  and a pre-execution block on the third request. Adaptive route/drawer visual
  checkpoint completion evidence remains pending.
- The default effectful-call boundary is now 50 and presents a no-timeout
  “increase and continue / stop and summarize” card; its live boundary test is
  still pending. A harmless dropdown task passed the Network evidence flow:
  recording started before the click, `digestOnly: true` returned no raw rows,
  the unrelated `logo.png` image stayed outside the success evidence, and DOM
  plus visual state proved the dropdown opened. The first attempt reproduced a
  stale daemon rejecting the new input field; after restart, the call passed.
  Protocol V3 and zero-count digest pagination are built and automated. The
  final reload/restart smoke task connected successfully, reported
  `digestOnly: true`, summarized 17 underlying requests into 16 groups, returned
  zero raw rows, and verified the project-monitor action from the relevant API
  response plus the new workbench/iframe DOM. A dedicated repeated-heartbeat
  fixture is still required before Section 5.2 can be marked fully passed.

## Task-pinned multi-Tab approval evidence — 2026-08-03

The built extension and installed LaunchAgent were exercised through
`npm run verify:workflow-evidence -- --tab-url-prefix
'http://127.0.0.1:8765/?stream=A2'` while two real fixture tabs were open:

- task target A2: `http://127.0.0.1:8765/?stream=A2`;
- approval/UI tab B2: `http://127.0.0.1:8765/?stream=B2`;
- the user switched to B2 before approving the queued tool calls; every
  approval was completed from B2 while the workflow remained bound to A2;
- the verifier completed four top-frame actions with four post-states, direct
  child-frame and same-process iframe fills, DOM/URL/Network/Console evidence,
  high-confidence request causality, Source Map/CSS explanation, workspace
  scan, reproduction recipe, performance/realtime summaries, stateful mock and
  bounded issue evidence;
- final browser truth on A2 was `checked=true`, `country=us`,
  `name=Workflow Ada`, `tags=[beta,gamma]`;
- final browser truth on B2 remained `checked=false`, `country=cn`,
  `name=old name`, `tags=[]`.

This proves that selecting another tab or window to review approvals no longer
changes the running task's target. It does not replace the separate negative
test that navigates the original task Tab while approval is pending.

## Sanitized failures

Add one entry per failure. Reference the manual section and an error code or a
description of behavior only. Do not paste raw payloads.

- Section 4 (environment issue resolved): `TOOL_FAILED` occurred while a foreign
  extension frame was injected into the fixture. After disabling that injection
  for the test and refreshing, the approved top-frame CDP click returned
  `trusted`. Remaining Section 4 cases were not run.
- Section 3.4 (live-confirmed after excluding a non-authoritative test browser):
  Profile B's real Side Panel picker returned `#trusted-button`; the
  explicit `取消选择元素` action removed the page highlight and did not trigger
  the selected button's business action. Switching Tabs correctly leaked no
  overlay or selection and automatically restored the Side Panel picker action.
  The final repair makes background cancellation publish one terminal event on
  every outcome, suppresses duplicate content announcements, reconciles a
  foreground change that races with picker start, and prevents a late start
  Promise from reactivating the button. Eight picker lifecycle/UI tests plus the
  affected 17-test target/DOM set pass. A later test in a different browser
  instance reproduced the old behavior, but that instance was not using the
  authoritative working Profile/build and is not counted as product evidence.
- Section 4 (repaired during tool-boundary validation): the sidepanel normalized
  `browser_snapshot` as a no-argument tool, so requested cursor pagination was
  discarded and automatic continuation repeated the same full snapshot. The
  argument normalizer now preserves cursor/limit, and a semantic no-progress
  guard blocks a third identical read-only batch before execution.
- Section 4 (repaired during conversation-origin validation): the first
  implementation bound the remembered decision to a transient WebSocket
  connection ID, so a later eligible tool prompted again after a transparent
  reconnect. The scope now remains local to the owning sidepanel instance while
  checking every incoming requester against that instance's current
  authenticated connection. The live cross-tool retry then completed without a
  second card; another sidepanel still cannot consume the decision.
- Section 4 (code repaired; live Provider retest pending): during repeated test
  prompts, the Provider twice returned prose claiming a page write had completed
  without emitting a tool call. Final-result arbitration now rejects such a
  claim without a successful mutation record, requires a later independent read
  after a mutation, and allows only one corrective continuation before returning
  an explicit blocked result. The authorization layer remains fail-closed.
- Section 6 (repaired): Agent collaboration publication passed a runtime page
  target containing page-only `title` metadata into a strict routing binding.
  Repeated schema violations closed the sidepanel socket. The WebSocket boundary
  now projects the exact collaboration target fields; strict positive/negative
  protocol tests and three consecutive live read calls passed after reload.
- Section 5.1 (repaired and live-confirmed): after navigation reached a new
  local origin before page-context synchronization, repeated context-digest
  reads returned the same error but different heartbeat timestamps and escaped
  the semantic loop guard. The task was stopped manually. Fingerprinting now
  ignores only context-digest transport timestamps, including the nested digest
  generation/page-capture clocks. The cross-round guard also blocks a third
  identical read before execution when failed page actions are interleaved.
  After rebuild and extension reload, a read-only live retest displayed exactly
  two real `browser_get_context_digest` cards; the third request was blocked and
  the Agent summarized from the first two results without touching the page.
- Section 5.1 (code repaired; live retest pending): the Agent previously emitted
  invalid Playwright/jQuery selectors and retried missing targets. Known
  non-native syntax now fails before browser execution, target-not-found errors
  require one fresh snapshot/query and exact returned CSS, and network-relevant
  actions are planned with bounded request evidence.
- Section 3.2 (repaired and live-confirmed): semantic snapshot cursors were
  previously bound to URL/title plus semantic structure only, so a reload with
  identical DOM could preserve the fingerprint across a new document. The
  content script now adds a stable per-document nonce to the source key. A
  ws11 A3 live retest changed `documentId` while keeping URL and DOM identical;
  reuse of the pre-reload cursor failed with `STALE_SNAPSHOT_CURSOR`.

## Completion rule

Real-Chrome evidence is complete only when every required row above is `pass`,
`npm test`, `npm run build`, and `npm run verify:packaged` still pass for the
same code state, and `docs/completion-evidence.md` is updated from this
worksheet. A green automated suite never converts a `not-run` browser row.
Run `npm run verify:browser-evidence` while recording results. Before claiming
completion, `npm run verify:browser-evidence:complete` must exit successfully.
