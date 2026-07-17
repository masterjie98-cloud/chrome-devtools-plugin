# Execution Core Optimization Plan

Last updated: 2026-07-17

## Objective

Complete one integrated upgrade of the extension Agent, local daemon and Codex
MCP adapter so that ordinary browser tasks execute with fewer model round trips,
fewer approval interruptions and smaller page payloads, while commit-like or
sensitive actions remain fail-closed.

This plan extends Architecture V2. It does not replace the existing Profile,
target, document, revision, idempotency, audit or collaboration boundaries.

## Fixed product assumptions

- The daemon is local-only and the intended deployment is one local user.
- Page content, screenshots, Network data and tool results remain untrusted.
- The extension AI provider and an MCP client are separate egress principals.
- A user may explicitly authorize the extension AI, Codex MCP, or both for one
  bounded task on one selected tab and origin.
- A grant must be visible, revocable and invalidated by task/chat, tab, origin,
  Profile, provider/destination or expiry changes.
- Passwords, OTPs, cookies with values, raw response bodies, proxy/mock/header
  mutations, cross-origin navigation, delete/payment/publish/send/submit-style
  commits and arbitrary JavaScript never inherit a low-risk task grant.
- Sending a chat message never automatically attaches a screenshot.

## Architecture changes

### 1. Dynamic policy and capability grants

Keep the canonical `ToolPolicy` registry, but separate three decisions:

1. tool effect: read, local observation state, page interaction, browser
   navigation, network mutation or arbitrary execution;
2. data sensitivity: safe metadata, page content, sensitive value or raw body;
3. approval mode: none, task grant, decision barrier or always confirm.

Introduce a daemon-owned task capability grant with:

- stable grant ID and revision;
- owning Profile session;
- requester principals (`ui`, `mcp`, or both) and stable client identity;
- task/conversation ID;
- tab ID, target ID and normalized origin;
- egress destinations;
- allowed capabilities;
- issue and expiry times;
- explicit revoke reason.

The sidepanel remains the only UI that can create or revoke a grant. A model or
MCP client cannot broaden one.

### 2. Approval matrix

No per-call approval:

- bounded DOM/snapshot/wait/routing reads;
- Network stop;
- cleanup owned by the active observation session;
- clearing extension highlights and pointer state.

Task grant:

- screenshot and sanitized visual checkpoints;
- Network start and digest-only grouped reads;
- bounded sanitized console reads;
- hover, move, wheel, ordinary field fill/select/type;
- non-commit page interactions after deterministic target preflight.

Decision barrier or always confirm:

- commit-like controls and form submission;
- sensitive fields, file chooser and clipboard transfer;
- cross-origin navigation, close tab and document replacement without an
  explicit task route;
- cookies/storage values, raw Network rows or bodies;
- proxy, mock, request/response header and persistent rule mutation;
- arbitrary JavaScript;
- raw coordinate click/down/up/drag and selector drag, because those primitives
  cannot prove the final target semantics before dispatch; move and wheel remain
  task-grant eligible.

### 3. Network observation session

Add one bounded task-owned observation session:

- `start(preserveLog=false)` atomically clears and starts;
- repeated start by the owner is idempotent;
- stop is safe cleanup and never needs a separate approval;
- `digestOnly=true` is covered by the observation capability;
- raw rows and bodies retain a sensitive decision barrier;
- action correlation records action ID, start/end timestamps, route revision and
  DOM revision without storing unbounded raw traffic;
- heartbeats remain collapsed in the digest.

### 4. DOM observation

Replace the current independent DOM-summary and semantic scans with one bounded
walker that:

- filters by tag/role before layout reads;
- visits only up to an explicit source budget;
- computes visibility/layout only for retained candidates;
- produces `interactive`, `outline` or `full` output modes;
- exposes a monotonically increasing document-local DOM revision;
- keeps a bounded MutationObserver journal for `sinceRevision` delta reads;
- reports truncation and source budgets honestly;
- supports explicit frame routing rather than claiming a top-frame snapshot is
  whole-page evidence.

The fast-Agent prompt receives `interactive` context by default. Full DOM is an
explicit sensitive/budgeted request.

### 5. Local action stage executor

Add a high-level MCP tool that executes a bounded current-page stage without a
model round trip after every primitive action.

Each action has:

- stable action ID;
- native CSS selector and typed arguments;
- optional dependencies;
- precondition and expected observable outcome;
- risk hint used only as input to executor-side classification;
- barrier flag.

The executor must:

- validate all schemas and native selectors first;
- resolve and classify the actual DOM target before mutation, including native
  submit/reset/file control type, accessible name, label, autocomplete and
  sensitive-field semantics;
- fail without mutation when an ordinary task grant reaches a resolved
  commit-like or sensitive target, returning `DECISION_BARRIER_REQUIRED`;
- accept `decisionBarrier=true` only as a request for a fresh user approval,
  never as proof of approval; the signed single-use execution grant remains the
  proof consumed by the extension executor;
- execute ready independent ordinary fields as one form batch;
- preserve ordered effectful actions;
- stop on failure, denial, navigation, target/document drift or an explicit
  barrier;
- return per-action outcome and a compact verification requirement;
- never accept page JavaScript or replay an unknown write after reconnect.

### 6. Adaptive visual observation

Visual observation is activated by a user attachment, an explicit successful
screenshot request or a task grant that explicitly includes visual observation.

Capture candidates:

- initial visual/layout/occlusion task;
- route or document change;
- modal, drawer or large DOM delta;
- ambiguous/covered/offscreen target;
- uncertain action outcome;
- final visual success criterion.

Do not capture merely because every click or field write succeeded. Replace the
two-DOM-read rule with an uncertainty trigger that does not perform a third full
DOM refresh.

Adaptive screenshots use:

- latest-only delivery;
- target/change-region clip when possible;
- maximum long edge and encoded-byte budget;
- JPEG for ordinary visual checkpoints and PNG only when fidelity requires it;
- perceptual/change fingerprint rather than exact data URL equality;
- per-task image-byte, count and cooldown budgets.

### 7. Timing and observability

Every tool lifecycle records bounded timing metadata:

- approval wait;
- daemon queue wait;
- executor time;
- transport time;
- total wall time;
- model-visible result characters;
- image/payload bytes and egress class.

Timing fields never contain tool arguments or page data. Audit pagination and
retention remain unchanged.

## Compatibility and migration

- Preserve canonical MCP tool names and current primitive tools.
- Add optional fields only; reject unknown protocol versions as before.
- Keep existing approval requests working when no capability grant is present.
- Bind a pending approval to every target identity field known at request time.
  A later browser update may add a previously unavailable `documentId` or other
  opaque routing field for the same target, but changing any already-bound
  field fails closed before a task grant or one-shot execution grant is issued.
- Migrate active sidepanel conversation-origin state into the daemon only after
  the user creates a new grant; do not silently restore prior broad consent.
- Persist no grant across daemon restart unless it is explicitly configured as
  resumable and still matches the exact task and destination. Initial release
  uses memory-only grants.
- Bump the shared WebSocket protocol version when the new messages are wired so
  stale extension/daemon combinations fail closed.

## Implementation order

1. Shared policy/effect/grant schemas and tests.
2. Daemon authorization, grant create/list/revoke and audit integration.
3. Sidepanel grant UI and requester/principal routing.
4. Network observation-session semantics.
5. DOM walker, revision journal and output modes.
6. Local action-stage schema, preflight, broker and executor.
7. Adaptive visual checkpoints and image preprocessing.
8. Lifecycle timing and output metrics.
9. MCP registry/output schemas, docs and threat-model update.
10. One integrated validation pass.

## Acceptance criteria

### Ordinary five-field form

- At most one task authorization.
- One bounded observation, one local mutation stage and one verification read.
- No screenshot unless ambiguity or visual success criteria require it.
- All requested fields change; unrelated fields do not.
- Trusted input remains used where CDP supports it.

### Network-verified action

- At most one observation authorization for start plus digest reads.
- Stop and owned cleanup never show approval cards.
- Digest contains no raw request rows and collapses heartbeats.
- Success is based on causal Network plus DOM/route evidence.

### Visual task

- No image is attached merely by sending a message.
- The first required visual observation is explicit in the task grant or tool
  request.
- Navigation/overlay/uncertain-state checkpoints are latest-only and bounded.
- Identical or immaterially changed images are not resent.

### Security

- Grants never cross Profile, task/chat, tab, origin or egress destination.
- MCP and UI principals can be authorized separately.
- High-risk decision barriers cannot be covered by an ordinary task grant.
- Opaque selectors such as `.ant-btn-primary` or `#field-7` cannot bypass a
  barrier: the browser-authoritative resolved element semantics are checked
  immediately before trusted input, and all-field preflight happens before the
  first form mutation.
- Unknown write result is never replayed after transport loss.
- Every grant lifecycle and decision barrier is audit-visible without storing
  raw sensitive arguments.

### Performance

- Report cold and warm timings separately.
- The fixed fixture interactive snapshot is below 2,000 model-visible chars.
- A 10,000-element synthetic page has a measured median and P95, with source
  budgets preventing unbounded scans.
- The final benchmark reports model requests, primitive browser operations,
  approvals, wall time, result chars and image bytes.

## Unified validation pass

After implementation is complete:

1. `npm run typecheck`
2. targeted policy, grant, DOM, action-stage, visual and Network tests
3. full `npm test`
4. `npm run build`
5. `npm run verify:packaged`
6. benchmark fixture with repeated cold/warm runs
7. one real Chrome workflow covering grant creation/revoke, form stage,
   navigation/visual checkpoint, Network digest and a retained high-risk barrier
8. update `docs/browser-validation-results.md` and
   `docs/completion-evidence.md` only from collected evidence

The Architecture V2 goal remains incomplete until the existing pending real
Profile, sensitive egress, artifact and browser-regression rows are either
validated or explicitly deferred by product scope.

## Collected integrated validation

Completed on 2026-07-17:

- final typecheck, 296/296 tests, production build and packaged-process
  verification passed;
- packaged verification exercised a real dist daemon, private 0700/0600 local
  state, clean restart, two concurrent independent dist MCP adapters and 69
  exposed tools;
- the real Chrome fixture completed one five-action stage under one task grant,
  one compact Network observation, one incremental DOM read, a denied resolved
  submit decision barrier and a revoke/re-prompt denial;
- real audit reads returned both task-grant lifecycle events and persisted
  complete numeric lifecycle metrics;
- the 10,000-node compact snapshot benchmark completed 7 runs with an
  11.35 ms median, 27.9 ms P95, 1,321 semantic characters and a truthful
  2,000-node source cap.

The two-real-Profile isolation scenario was explicitly deferred by product
scope. It remains listed in the broader Architecture V2 worksheet and is not
claimed as execution-core evidence.
