# P0-P2 capability closure plan

Status: P0-P2 implementation, automated validation, and scoped real-Chrome
acceptance complete; the broader Architecture V2 worksheet remains partial  
Scope: local single-user Chrome extension, local daemon, stdio MCP adapter,
embedded plugin Agent, collaboration workspace, Rules workbench, and Chat
history.

## 1. Objective

Close every still-relevant item from the earlier P0-P2 capability review
without weakening approval, exact-target routing, or unknown-write replay
protection. Existing implementations count only when current source, automated
tests, and the appropriate real-Chrome gate agree.

## 2. Current-state audit

| Capability | Current state | Closure required |
| --- | --- | --- |
| Agent result evidence arbiter | Implemented | Browser-effect completion now requires an executed mutation plus an independent successful read; unsupported claims receive one corrective model turn and then fail visibly. |
| MCP smooth restart/reconnect | Implemented | Proven-safe reads and durable collaboration waits reconnect with bounded backoff; an in-flight effect returns `UNKNOWN_WRITE_OUTCOME` and is never replayed. |
| Unified failure recovery | Implemented | Stale target, frame unavailable, missing/hidden/occluded target, transport loss, denial, cancellation and unknown writes share one classifier and bounded recovery policy. |
| Conditional workflow | Implemented | `browser_workflow` supports bounded preconditions, existing wait/navigation checkpoints, explicit action skipping and separately reported cleanup actions. |
| Collaboration tasks V2 | Implemented | Append-only progress, clarification, requirement and evidence events plus durable cancellation are task-, conversation- and Profile-bound. |
| Issue evidence workbench | Implemented | Chat renders the evidence timeline and exposes explicit sanitized Markdown/JSON copy/export paths without inline screenshot bytes. |
| Source and performance causality | Implemented | CSS evidence includes same-origin original source-map hints when readable; performance output includes bounded interaction/INP and trace summaries. |
| Conversation search/export | Implemented | Profile-local sanitized conversation snapshots support full-text search and explicit Markdown/JSON download. |

Items already implemented and requiring only evidence synchronization:

- sidepanel picker cancellation;
- actionable document-bound `targetRef`;
- Codex inbox acceptance, recovery and conversation isolation;
- frame-scoped workflow actions and screenshot diff;
- issue-evidence artifact capture;
- JavaScript source-map and Network initiator correlation;
- bounded navigation/LCP/layout-shift/long-task diagnostics.

## 3. Safety invariants

1. A final success claim must be supported by tool execution and the required
   independent verification evidence.
2. A transport loss after a browser effect is `unknown_write_outcome`; it is
   never replayed automatically.
3. Recovery may repeat only a proven-safe read or a call rejected before
   dispatch.
4. Conditions and cleanup never bypass the normal approval policy.
5. Collaboration events are append-only untrusted data, not browser authority.
6. Trace, source, conversation and evidence exports remain bounded and redact
   configured secret shapes.
7. Cross-Profile, cross-conversation and stale-document references fail closed.

## 4. Implementation order

1. Add reusable result-evidence and recovery-state classifiers with focused
   tests, then integrate them into the embedded Agent.
2. Add adapter reconnect state and safe-read recovery around daemon calls.
3. Extend the workflow schema/runtime/output with conditions, waits, navigation
   checkpoints and cleanup.
4. Version delegated task events and add V2 MCP mutations plus sidepanel
   rendering/actions.
5. Add an evidence viewer/export path and conversation search/export controls.
6. Extend CSS/performance diagnostics while keeping all data bounded.
7. Update MCP schemas, annotations, Smart Profile descriptions and protocol
   compatibility identity.
8. Synchronize completion evidence and remove superseded unchecked items.

## 5. Automated validation

```bash
npm run typecheck
npm test
npm run evaluate:smart-mcp
npm run build
npm run verify:packaged
npm run verify:browser-evidence
git diff --check
```

Final run on 2026-07-28:

- targeted P0-P2 regression: 80/80 passed;
- complete test suite: 370/370 passed;
- TypeScript and production extension/daemon/MCP/status builds passed;
- packaged-process verification passed with one restarted daemon, two
  independent adapter processes and 86 exposed tools;
- browser worksheet structural verifier: 6 pass, 12 not-run, 0 fail.

Scoped real-Chrome run on 2026-07-28:

- adapter, daemon and browser negotiated `0.1.0+ws8 / b442dc4c`;
- a four-action workflow and direct OOPIF/same-process iframe actions returned
  exact post-state plus DOM/URL/Network/Console evidence;
- element screenshot diff, activity subscription, high-confidence Network
  causal link, reproduction recipe, INP/trace summary, stateful Mock and issue
  evidence artifact passed;
- same-origin CSS source-map resolution returned
  `mapped.css -> mapped.css.map -> src/fixtures/trusted-button.scss`;
- collaboration V2 proved idempotent progress, appended requirement/evidence,
  durable Codex cancellation, and waiter recovery to `cancelled`;
- sidepanel history exposed full-text search and explicit Markdown/JSON export,
  and a live search reduced the list to the matching conversation;
- sidepanel Stop cancelled an active `browser_wait_for` run and rendered
  `Agent 已取消` without a delayed success result.

## 6. Real-Chrome validation

Run one final fixture-backed session covering:

- unsupported success claim rejection;
- active Stop;
- navigation while approval is pending;
- picker cancel and stale-tab handling;
- dialog and DNR approve/deny/cleanup;
- sensitive-read destination and redaction;
- daemon restart with a safe read and an in-flight unknown write;
- workflow branch/wait/navigation/cleanup;
- collaboration clarification/amend/cancel/evidence flow;
- issue evidence timeline plus JSON/Markdown export;
- CSS/source and performance evidence;
- conversation search/export;
- second Profile isolation only if a second real Profile is available.

The Architecture V2 completion gate remains incomplete until every required
worksheet row is `pass`. A missing second Profile is recorded as an explicit
environment limitation rather than converted to a pass.
