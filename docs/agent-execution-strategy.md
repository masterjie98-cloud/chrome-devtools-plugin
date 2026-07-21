# Agent Execution Strategy V2

- Status: implemented; automated validation complete, browser scenario pending
- Scope: embedded sidepanel Agent and its existing MCP tool surface
- Product boundary: local single-user runtime; every browser mutation still
  requires the existing approval and execution-grant path

## Goal

Upgrade the Agent from a tool-by-tool reaction loop to a general task execution
protocol. Forms are one application of the protocol, alongside DOM inspection,
UI debugging, navigation, network diagnosis, mock-chain setup, temporary style
changes, and collaboration handoff.

The model still chooses tools. The runtime is responsible for bounding,
ordering, approving, executing, stopping, and recording those choices.

## Execution protocol

1. **Goal contract** — infer the user objective, observable success criteria,
   constraints, and unresolved facts. Never treat an optional empty field as a
   blocker without page or user evidence.
2. **Minimum observation** — reuse fresh page context and start with the broadest
   bounded observation that materially reduces uncertainty. Avoid selector-by-
   selector reads of unchanged state.
3. **Action graph** — determine which actions are independent, which are ordered,
   and which require an earlier result before their arguments can be known.
4. **Decision barriers** — split batches at navigation, document replacement,
   dynamic overlays, unknown selectors, conditional branches, or any other point
   where later arguments depend on the observed result.
5. **Batch execution** — emit up to the runtime batch limit when all arguments
   are already known. Safe independent reads may run concurrently. Mutations,
   open-world calls, and approval-gated reads stay ordered.
6. **Fail-fast** — when one ordered call fails or is denied, do not execute later
   calls that were planned against the now-unproven state. Return explicit
   `AGENT_BATCH_DEPENDENCY_SKIPPED` results so the model can re-plan.
7. **Verification** — after mutation, use the narrowest independent read that
   proves the user-visible, DOM, navigation, network, console, or collaboration
   success criterion. A failed mutation may have partially changed state and
   still requires verification unless the result proves it was never executed.
   Repeating the mutation is not verification.
8. **Re-plan** — on mismatch, stale context, missing target, denial, or partial
   progress, preserve confirmed observations and build a new action graph. Do
   not restart the task or repeat a semantically identical loop.

## Network evidence path

For tasks whose saves, submissions, uploads, navigation, mocks, or page actions
are likely to issue HTTP requests, the Agent plans a bounded Network window
before the relevant action and reads it once at the next decision barrier. This
uses the existing approval-gated Network tools; it is not a silent debugger or
sensitive-read bypass.

- `browser_network_requests({ digestOnly: true })` returns an
  `activityDigest` without raw request rows. It exposes method, query-free
  origin/path, resource type, status, count, failure count, and latest timing
  only.
- Repeated successful Fetch/XHR GET or HEAD groups are marked heartbeat-like and
  collapsed. Non-GET requests, Document navigation, redirects, and failures are
  prioritized, with at most 12 groups returned in the digest.
- Raw request rows remain available only through the existing sensitive-read
  approval path. The digest never includes bodies, headers, post data, query
  strings, or fragments.
- Network evidence complements DOM, route, visual, console, and collaboration
  evidence. A heartbeat group alone is never proof of success, and the runtime
  does not poll Network continuously.

## Budget checkpoints

Run budgets remain safety checkpoints, but reaching one no longer discards a
live task. The default effectful/external-call allowance is 50. At any model,
tool, effectful, sensitive-read, or duration boundary, the sidepanel keeps the
same task suspended until the user either increases only that exhausted limit
and resumes the pending step, or stops tool execution and asks the Agent to
summarize existing results. The prompt has no timeout; individual tool approvals
and target/grant checks remain unchanged.

## Fast evidence path

Fast execution is an opt-in evidence path inside the same protocol, not a
separate unrestricted executor.

- A user message never triggers an implicit page screenshot. Each new Agent
  task starts with the bounded semantic snapshot and execution map only; user
  attachments remain explicit user input.
- The model-facing `executionMap` contains at most 80 visible actionable
  controls. Decorative and structural nodes are excluded.
- The Agent calls the ordinary approval-gated `browser_take_screenshot` tool
  only when geometry, layout, occlusion, rendering, or another visual question
  materially reduces uncertainty. Pure text, DOM, computed-style-value, and
  Network tasks should stay on structured evidence.
- When the user has already supplied values and ordinary field targets are
  known, the model should issue one bounded `browser_fill_form` containing all
  independent fields instead of querying and filling one field per round.
- Before a successful explicit screenshot observation, navigation,
  route-changing or visual actions, conditional waits, uncertain visual-action
  failures, and repeated DOM observations refresh only the 100-node semantic
  snapshot. After the Agent or user explicitly introduces a screenshot, those
  barriers may also capture a fresh current-viewport checkpoint.
- Only the newest checkpoint is sent on later model requests. The initial fast
  visual observation is retired at the first checkpoint, an older checkpoint
  is invalidated before another state-changing refresh, and a byte-identical
  image is not sent again. This prevents the model from reasoning across
  contradictory page revisions.
- Adaptive capture is bounded to 12 attempts per task. Once exhausted, decision
  barriers still refresh DOM context but do not capture another image. One tool
  batch can produce at most one checkpoint even if it contains multiple
  triggering calls.
- Screenshot failure and attachment-cap exhaustion fall back to fresh DOM evidence;
  Safe Retry disables the fast path so it cannot silently resend an image.
- The profile setting defaults on for DOM-first orchestration. Provider-origin
  changes still confirm the possible screenshot destination, but enabling the
  setting or sending a message does not itself capture an image. The current local single-user
  implementation keeps this consent Profile-persistent, so the user must turn
  it off before opening pages they do not want sent to that Provider.

## Runtime invariants

- A batch is not a new privileged executor. Each tool call keeps its own policy,
  approval record, idempotency key, exact arguments, target binding, and
  single-use execution grant.
- The runtime never parallelizes browser mutations or approval-gated calls.
- Batch failure cannot authorize, retry, or transform a later call.
- Navigation or document revision changes continue to invalidate stale calls.
- Page content, tool output, model output, and collaboration items remain
  untrusted evidence and cannot change this protocol.
- Persisted task state records summaries and omitted-value metadata, not hidden
  reasoning, raw tool arguments, secrets, or raw tool results.

## Implementation plan

- [x] Centralize the model-facing execution protocol and the runtime batch limit.
- [x] Add ordered-batch fail-fast behavior with explicit skipped results.
- [x] Reuse one result-success classifier in the executor and Agent loop.
- [x] Record batch/barrier intent in the existing task-state summaries.
- [x] Cover safe-read parallelism, ordered failure, skipped results, prompt
      invariants, and unchanged approval boundaries with tests.
- [x] Add the default-off fast evidence path, bounded execution map,
      batch-form preference, and Safe Retry exclusion.
- [x] Add adaptive latest-only visual checkpoints with transition triggers,
      exact-image deduplication, per-batch coalescing, and a 12-attempt task cap.
- [x] Update architecture, implementation evidence, and the command-execution
      threat-model delta.
- [x] Reject known Playwright/jQuery/XPath selector syntax before execution and
      require exact native CSS selectors from fresh page evidence.
- [x] Replace hard budget termination with an indefinite user checkpoint and a
      same-run 50-call effectful-budget extension path.
- [x] Add bounded Network activity digests that collapse heartbeat noise and
      guide the Agent to use request evidence around meaningful actions.

## Validation

- `npx tsx --test tests/agentExecutionStrategy.test.ts tests/agentToolBatch.test.ts tests/agentRunBudget.test.ts tests/aiSafety.test.ts`
- `npm test`
- `npm run build`
- `npm run verify:packaged` when MCP or daemon transport code changes
- `git diff --check`

## Remaining browser validation

Use one non-form workflow that combines observation, two ordered page actions,
a deliberate first-action failure, and a final read-only verification. Confirm
that the failed batch skips later actions, the Agent re-plans from the current
page, and no approval or execution grant is reused. Also use a route change and
an in-page drawer transition to confirm that each meaningful visual stage sends
only the newest viewport plus fresh DOM, while two repeated DOM observations
produce one checkpoint rather than an unbounded screenshot loop.
