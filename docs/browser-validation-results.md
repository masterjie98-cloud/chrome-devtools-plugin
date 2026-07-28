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

- Date: 2026-07-13 to 2026-07-28
- Tester: Codex with user-operated extension reloads
- Chrome version: 149.0.7827.201
- OS version: macOS 26.5.1
- Extension build time or local revision: local dirty worktree built 2026-07-15
- Daemon mode (`daemon:dev` or packaged): packaged (`daemon:start`); earlier checks also used `daemon:dev`
- Profile A installation ID: redacted-592f2e4fbcce
- Profile B installation ID: not-run

When filled, Profile IDs must use `redacted-<last4-to-12-characters>`, for
example `redacted-a1b2c3`; never store the complete installation ID here.

Allowed status values: `not-run`, `pass`, `fail`.

| Manual section | Required evidence | Status | Sanitized notes |
| --- | --- | --- | --- |
| 1 | Extension, daemon, token pairing and MCP tools available | pass | Token pairing, live Profile connection, 65 exposed daemon tools and a real stdio adapter were verified. |
| 3 | Exact tab/frame/document routing and stale document rejection | pass | Top frame and child frame routed to distinct documents; after reload, old frame 6617 was rejected and the new child frame 6621 returned `Child frame content`. No child announcement or stale selection fell back to frame 0. |
| 3.1 | Session-bound resource templates and stale/cross-Profile denial | not-run | Six safe templates and five listed resources used only session/target-scoped opaque URIs; `active-tab` carried the matching target binding. A separate unbound adapter returned `RESOURCE_SESSION_UNBOUND`. After reload, target key, revision and document changed and the old URI returned `STALE_CONTEXT`. Real sidepanel sync produced a nonempty `page-context-digest-v1` for the fixture with title, capture time, outline and interactive elements. The Profile B `ROLE_FORBIDDEN` case remains. |
| 3.2 | Fresh semantic snapshot, pagination and stale cursor | not-run | Live top/child snapshots, refs s1-s4, nonrepeating pagination, exact target metadata and stale=false freshness passed. Five child-to-top races produced three `STALE_CONTEXT` results and two correctly child-bound results, with no relabeling. The daemon-restart target-cache defect behind `EXECUTION_GRANT_INVALID` was repaired; a real retry synchronized the target and returned a live 50-node snapshot, and a same-adapter retry wrote a readable context digest. `STALE_SNAPSHOT_CURSOR` remains. |
| 3.3 | Network/conversation/audit pagination and Profile isolation | not-run | Audit pagination passed with a stable session-bound snapshot, no repeats, and no direct sensitive fields. Real conversation sync passed. A limit-1 cursor kept its six-message snapshot after two messages were appended, advanced to offset 1, and returned no repeat. After starting a new conversation, the retained cursor returned `STALE_PAGINATION_CURSOR`. Network and Profile isolation remain. |
| 3.4 | Sidepanel page read, element selection, cancel and stale-tab handling | not-run | Sidepanel `读取页面` synchronized a 46-node fixture context with 28 interactive elements and MCP returned `page-context-digest-v1`. Picking selected `button#trusted-button`; `#trusted-result` remained `not clicked`. MCP cancellation removed the overlay and preserved the prior selection, but the sidepanel has only a start button and page-level Escape is unreliable after sidepanel focus. A sidepanel cancel control and stale-tab case remain. |
| 3.5 | Tool-result completeness, virtual scrolling and copy | pass | A live read returned 15.6k characters and the collapsed row labeled it complete. Expansion reported the same complete count, used a 578-line virtual viewport, scrolled to later content, and changed the copy control to `已复制`. No 8k display-side slice remained. |
| 4 | Deny/approve/one-time grants, trusted click and OOPIF routing | not-run | Denial, one-time approval, same-chat/domain grant, grant switch-off, origin invalidation and trusted input passed. The three approval modes passed bounded wait checks: agent mode covered ordinary task grants but not decision barriers; full mode resumed a pending barrier; ask mode restored prompting. A new chat reset to ask mode. Audit, OOPIF and remaining Section 4 cases are still pending. |
| 4.1 | One-current-dialog CDP handling | not-run | |
| 4.2 | Trusted typing/key input and fail-closed targets | pass | Replace/Unicode typing and key input used trusted CDP events; invalid key, readonly and oversized inputs failed before mutation. The 2026-07-24 direct-frame gate supersedes the earlier unsupported child result: a fresh bound reference wrote the OOPIF input and a follow-up observation verified its exact value. Same-process coordinate routing remains automated-only. |
| 4.3 | Form preflight, CDP controls and scoped DOM select | pass | Preflight and fail-closed edge cases passed. A real five-field task used one broad read, one `browser_fill_form` and one verification; all requested values changed while excluded controls did not. The 2026-07-24 OOPIF direct fill also passed exact post-value verification; multi-field child-frame form fill was not separately exercised. |
| 4.4 | Stale approval, active Stop, pending Stop and unavailable UI | pass | Approval remained visible for 52 seconds; rejection preserved `not clicked`. Reload returned `STALE_CONTEXT`; caller abort removed its card. With the Side Panel closed, an approval-gated read failed before execution with `APPROVAL_REQUIRED`; reopening restored the UI but not its grant. On 2026-07-28 an embedded Agent entered a 30-second `browser_wait_for`; Stop immediately rendered `Agent 已取消`, removed the Stop action and produced no delayed success result. |
| 4.5 | Sensitive default omission, deny/approve, redaction and destination | not-run | |
| 4.6 | Screenshot MCP image, artifact binding and bounded metadata | pass | Live MCP screenshot returned `image/png` content and a session artifact URI with MIME type, byte length, SHA-256 and expiry. `structuredContent` omitted `dataUrl`, Chrome Downloads was not used, and daemon audit separated 33,776 ms approval wait from 81 ms executor time. |
| 4.7 | DNR upsert/remove deny/approve, one-time grant and exact cleanup | not-run | |
| 5 | Credential migration and Provider-origin confirmation | not-run | Historical fast mode first-enable displayed the configured Provider destination. The former send-time initial screenshot behavior has been removed: current acceptance must prove a plain message captures no image, an Agent-requested screenshot still prompts, and only a successful explicit visual observation activates adaptive route/drawer/repeated-DOM checkpoints. API-key migration and Provider-origin-change confirmation remain. |
| 6 | V3 reconnect/backoff/heartbeat without duplicate mutation | not-run | Live disconnect produced no false tool row, and a normal read recovered. Repeated collaboration-target schema violations caused the frequent close. After outbound projection and reload, three consecutive real reads stayed connected. Fast reconnect and disconnect-after-mutation evidence remain. |
| 7 | Two real Chrome Profiles and two adapter routing isolation | not-run | Deferred by product scope on 2026-07-14: current usage does not require two simultaneous Chrome Profiles. Automated multi-adapter/session routing coverage remains, but real Profile isolation must be tested before claiming support or completion. |

## Supplementary live evidence

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
- Verification protocol gap (live failure on 2026-07-23):
  `browser_verify(target_state)` passed checkbox/radio checks but cannot express
  the selected value(s) of a select control; using `selected=true` against the
  select root returned false despite the exact page value being `us` and
  selected tags being `beta,gamma`.
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

## Sanitized failures

Add one entry per failure. Reference the manual section and an error code or a
description of behavior only. Do not paste raw payloads.

- Section 4 (environment issue resolved): `TOOL_FAILED` occurred while a foreign
  extension frame was injected into the fixture. After disabling that injection
  for the test and refreshing, the approved top-frame CDP click returned
  `trusted`. Remaining Section 4 cases were not run.
- Section 3.4: picker cancellation works through the underlying tool and removes
  the overlay, but the sidepanel has no cancel action after starting the picker;
  focus remains in the sidepanel, so the page-level Escape listener is not a
  dependable user path.
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
- Section 4 (separate unresolved Agent issue): during repeated test prompts, the
  Provider twice returned prose claiming a page write had completed without
  emitting a tool call. No new tool row existed and the fixture state was
  unchanged. The authorization layer was not bypassed, but final-response
  reconciliation still needs to reject unsupported execution claims.
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

## Completion rule

Real-Chrome evidence is complete only when every required row above is `pass`,
`npm test`, `npm run build`, and `npm run verify:packaged` still pass for the
same code state, and `docs/completion-evidence.md` is updated from this
worksheet. A green automated suite never converts a `not-run` browser row.
Run `npm run verify:browser-evidence` while recording results. Before claiming
completion, `npm run verify:browser-evidence:complete` must exit successfully.
