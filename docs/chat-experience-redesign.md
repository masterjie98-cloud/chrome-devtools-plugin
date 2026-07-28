# Chat Experience Redesign

Status: implemented; final live verification in progress

Date: 2026-07-14

## Scope

This redesign covers the Chrome sidepanel workspace. The queue and cancellation
contract is specific to Chat; the same pass also simplifies the Inspect and
Rules information hierarchy without changing their existing execution policy.

Grounding came from the current `ChatPanel`, the Agent execution path in
`App.tsx`, and a real Chrome sidepanel inspection in idle and long-conversation
states. The captured Chrome screen contained private workspace content and is
therefore not committed to the repository.

## Current defects

1. `ChatPanel.submit()` returns while `busy`, and `App.handleSendChat()` also
   rejects a second request while an Agent run is active. Users cannot type a
   follow-up into a queue or steer an active run.
2. The send button changes into Stop. One control therefore changes meaning at
   the moment users most need both actions.
3. Four runtime tags, three permission switches, six icon-only composer actions,
   messages, approvals, and the composer compete inside a narrow sidepanel.
4. Every tool result occupies a conversation card. Long Agent runs become a
   tool log with the answer visually buried below it.
5. `新对话` is an unlabeled clear icon and remains reachable while a run can
   still append output, which risks mixing lifecycle state across conversations.
6. Element picking has a start action but no reachable sidepanel cancel action;
   page-level Escape is unreliable after focus moves to the sidepanel.
7. Chinese and English status/placeholder copy are mixed, and icon-only controls
   depend on tooltips rather than stable accessible names.
8. The page-read, picker, and screenshot buttons all used the aggregate `busy`
   flag as their loading state. A normal AI response therefore made three
   unrelated actions spin at once even though no shortcut was executing.

## Interaction contract

### Sending while idle

- `Enter` sends immediately.
- `Shift+Enter` inserts a newline.
- The run receives a fresh page-context read when that permission is enabled.

### Sending while an Agent is running

- `Enter` adds the draft and its current attachments to a bounded FIFO queue.
- The normal send button remains a send action and displays queue semantics.
- `Ctrl+Enter` or `Cmd+Enter`, and the visible force-send action, place the draft
  at the front of the queue, cancel the current Agent, reject its pending
  approval if present, then start the forced message after cancellation settles.
- Stop remains a separate control. If queued messages exist, the oldest queued
  message starts only after the current run has fully finalized.
- Queue entries can be removed, promoted to immediate send, or cleared together.

### Queue lifecycle

- Maximum queue length: 5 messages.
- Queue state is memory-only and is discarded when the sidepanel closes.
- A queued message is added to the conversation and MCP state only when its run
  starts, preserving actual execution order.
- Only one Agent run may own an abort controller, pending approval, and tool-call
  sequence at a time.
- Page context, selected target, tool definitions, and permission state are
  resolved again when a queued run starts. Execution grants and tool-call
  idempotency keys are never reused.
- Starting a new conversation is disabled while an Agent is active or messages
  are queued.

### Local history and draft recovery

- Text history and the active draft are stored in the current Chrome Profile's
  `chrome.storage.local`; ordinary browser profiles do not share the workspace.
- Retention is bounded to 20 conversations, 80 user/assistant messages per
  conversation, 12,000 characters per message or draft, and 240,000 text
  characters per conversation.
- Tool result messages, runtime status, image bytes, attachment metadata, and
  queued messages are deliberately excluded from persisted history.
- Writes are serialized and normalized before storage so an older debounce
  cannot overwrite a newer conversation switch.
- The history drawer exposes switching and per-conversation deletion. Switching,
  deletion of the active conversation, and creating a new conversation are
  blocked while an Agent run or queue can still mutate state.
- Restoring or switching a conversation resets and republishes the MCP current
  conversation snapshot using the same conversation ID, preventing stale or
  duplicate messages in the daemon resource.

### Safe retry and edit-and-fork

- Retrying an assistant answer creates a new conversation branch from the
  nearest preceding user message; the original conversation remains unchanged.
- A safe retry hard-disables automatic page reads, cached page context, selected
  element context, tools, and web search for that run. It never reuses an
  approval, execution grant, tool call, or idempotency key.
- Tool result messages are excluded from branch seeds. Earlier user/assistant
  text remains as the model-visible prefix.
- If the source message contains images in the live session, the UI requires an
  explicit confirmation before resending them to the configured AI Provider.
- Editing a user message also creates a new branch. It follows the current
  permissions and normal approval path, while the source conversation and its
  draft are preserved.

## UI hierarchy

1. Keep the existing Chat / Inspect / Rules navigation.
2. Replace the four equal-weight status tags with a compact runtime summary:
   AI state, context state, and only exceptional connection warnings.
3. Keep permission controls visible because they change data egress, but reduce
   their visual weight below the conversation.
4. Render tool calls as a compact execution timeline rather than full message
   bubbles. Details remain expandable.
5. Add a queue tray directly above the composer with order, text preview,
   attachment count, immediate-send, and remove actions.
6. Keep Stop, force-send, and normal/queue-send as distinct controls.
7. Move settings to the runtime row, remove duplicated low-value composer
   controls, use Chinese labels, and add `aria-label` to icon-only actions.
8. Turn the picker action into a visible start/cancel toggle in Chat and Inspect.
9. Add a compact local-history drawer and message-level branch actions without
   adding more permanent composer buttons.
10. Only the shortcut that owns `runningTool` displays a spinner. An Agent run
    disables page shortcuts but leaves their icons visually stable.
11. Collapsed tool rows report whether their character count is complete. On
    expansion, results use a dedicated scroll viewport rather than Markdown;
    results above 240 lines use line virtualization and remain copyable.

## Workspace hierarchy changes

- Removed the internal product title and `idle` line because Chrome already
  renders the extension name in the sidepanel shell. The tab workspace now uses
  the full remaining height.
- Renamed the tabs to `对话`, `检查`, and `规则` and kept one compact navigation
  bar as the only internal top-level navigation.
- Inspect now follows the task order `页面 → 选中元素 → DOM 查询 → 临时样式`.
  The CSS Patch editor is an advanced, default-collapsed section rather than a
  permanently visible equal-weight card.
- Rules now has one proxy enable switch and one Mock response switch. Redundant
  enable/disable button pairs and the extra status tag were removed. The legacy
  DNR editor is grouped in a default-collapsed `DNR 兼容规则` section.
- Header rows reflow at sidepanel widths below 420 px so the value field gets a
  full second row instead of forcing four controls into one narrow line.
- Chat adds message copy, a sticky return-to-bottom action, compact tool rows,
  a visible queue tray, and separate Stop, force-send, and queue-send controls.

## Security and correctness invariants

- Queueing cannot bypass approval, tool policy, target binding, or egress
  controls.
- Force-send cannot overlap two Agent runs or leave an approval resolvable after
  cancellation.
- A queued run cannot use a page snapshot, selected document, execution grant,
  or idempotency key captured by the previous run.
- Queue bounds apply before accepting the draft; rejected drafts remain in the
  composer.
- Attachments remain subject to existing vision support and count/size limits.
- Stop and force-send must propagate cancellation to active MCP requests.
- The always-visible execution selector defaults to `请求批准`. `替我审批` covers
  only ordinary `task_grant` policies; `完全访问权限` covers all exposed approval
  modes. Both automatic choices are memory-only and limited to the active chat,
  normalized HTTP(S) origin, Profile session, and AI Provider destination. They
  serve embedded and MCP requests, while every concrete call still receives a
  requester-bound single-use execution grant. Unbound and non-HTTP(S) requests
  cannot use either automatic mode.
- The selector can change while a task is waiting and resets to `请求批准` when the
  chat, origin, Profile session, Provider, or browser-hub connection changes.
  A transparent tool-WebSocket reconnect is allowed only after the replacement
  connection authenticates. Same-origin paths and revisions
  do not preserve stale execution state; every call still passes fresh
  target/revision checks.
- Every automatically answered request still receives a fresh daemon approval
  record and a new single-use, argument-bound execution grant.
- Agent tool-call idempotency is bound to the Agent run ID as well as the
  provider's tool-call ID. Providers may reuse call IDs such as
  `functions.browser_click:0` in later replies; those later runs must create a
  new approval and execution instead of receiving a cached result.
- With automatic continuation enabled, reaching the configured per-segment tool
  boundary keeps the latest 12 exchanges exact, compresses older exchanges, and
  continues the same Agent run. Disabling automatic continuation completes the
  final batch, disables tools, and requests one tools-off stage summary.
- Model-request, tool-call, effectful/sensitive-call, and duration safety budgets
  span every segment and may stop the run while preserving visible progress.
- The sidepanel preserves `browser_snapshot` cursor/limit arguments instead of
  normalizing them away. If the same read-only batch and arguments produce the
  same semantic result twice, a third identical execution is blocked and the
  Agent receives a visible no-progress notice plus a tools-off summary.
- Interleaving another tool no longer resets all no-progress evidence. If the
  same read-only tool, arguments, and semantic result recur three times across
  alternating rounds, the Agent stops the loop and requests one tools-off
  summary. Text attached to a model response that also contains tool calls is
  treated as transient progress: it stays in the provider exchange but is not
  committed to the durable assistant reply.
- Tool results are retained in full up to a 256,000-character in-memory display
  ceiling. Crossing that ceiling is never silent: the row and expanded toolbar
  show displayed/original counts, a warning points to pagination/cursor, and the
  source result's own `truncated` field remains a separate status.

## Validation

- Pure queue ordering, capacity, remove, promote, and take-next tests.
- Agent cancellation regression and pending approval cancellation coverage.
- Run-scoped approval matching and target/requester/run invalidation coverage.
- Tool-round boundary coverage for both default compressed continuation and the
  opt-out path where the final batch executes once and the last model request
  cannot call another tool.
- Production build rendering for idle and picker-active states in real Chrome.
- Real Chrome checks: enqueue two messages, remove one, force-send one, verify
  FIFO order, verify no concurrent tool approvals, and verify picker cancel.
- `npm test`, `npm run build`, `git diff --check`, and the browser evidence
  verifier must pass before the change is handed off.
- Tool-result presentation tests cover exact small-result counts, removal of the
  former silent 8,000-character slice, explicit bounded truncation, and
  serialization failure.

## Implementation status

- Queue ordering, capacity, remove, promote, and empty-queue behavior are covered
  by unit tests.
- Cancellation preserves the browser-native `AbortSignal.reason` instead of
  mutating its read-only `name` property. The Agent also races a hanging tool
  executor against the run signal, and MCP calls recheck cancellation after
  connection establishment.
- The complete 174-test suite, TypeScript check, production build, and
  `git diff --check` pass.
- Real Chrome confirms the duplicate header is gone; Chat, Inspect, and Rules
  render with the new hierarchy; Inspect advanced styles and DNR compatibility
  stay collapsed by default; and picker cancel remains reachable.
- Live AI validation sent a normal page-query prompt followed by a force-send.
  The first run finalized as `Agent 已取消。`, the forced message started without
  overlap, returned `强制发送成功`, and the UI returned to `AI 已就绪`.
- Profile-local history/draft recovery, safe-retry branching, edit-and-fork,
  same-ID MCP snapshot replacement, and shortcut-specific loading states are
  implemented with focused regression coverage.
- Tool results no longer use the former silent 8,000-character slice. The
  dedicated result viewer retains up to 256,000 characters, virtualizes results
  above 240 lines, exposes complete/truncated counts, and copies the loaded
  content without routing it through Markdown.
- The complete 196-test suite, TypeScript check, production build, and
  `git diff --check` pass. Live Chrome rendered a 15.6k-character result as
  complete, expanded it into a 578-line virtual viewport, scrolled to later
  content, and confirmed the copy action.
- Live approval testing exposed a cross-run idempotency collision: a provider
  reused the same tool-call ID in a later reply, so the daemon returned the old
  result without a new approval or browser action. Idempotency keys now hash the
  Agent run ID plus tool-call ID. Six focused approval/idempotency tests,
  TypeScript, production build, and live Chrome regression pass. Two later runs
  both displayed fresh approval cards; the final request was denied and did not
  interact with the page.
- Live one-round continuation testing exposed two additional defects:
  `browser_snapshot` pagination arguments were erased by the AI argument
  normalizer, and repeated unchanged reads could continue until the global
  safety budget. Cursor/limit are now preserved, and a semantic no-progress
  guard allows two comparisons but blocks the third identical read-only batch.
  In real Chrome, default-on continuation produced exactly two complete ~2k
  pages at offsets 0 and 2 without user input; the opt-out path in a fresh
  conversation executed exactly one page and displayed the tools-off stage
  summary. The full suite passes 201/201, including a regression that preserves
  changing business data named `updatedAt`; TypeScript and production build
  pass, and the user's 50-round/default-on configuration was restored.
- A later live task exposed a wider alternating loop: DOM queries and waits were
  separated by clicks, so the consecutive-batch guard reset and the run reached
  the 64-request hard budget. The Agent now also counts identical semantic
  read-only observations across interleaved rounds and stops on the third.
  Tool-call narration is no longer appended to the reply body, so progress text
  such as “I will try another namespace” cannot remain above the final answer.
  The complete suite passes 203/203; TypeScript, production build, and
  `git diff --check` pass. Chrome reloaded the unpacked extension and reopened
  the rebuilt sidepanel successfully; a fresh external-Provider conversation
  was not sent during this verification.

## Follow-up capability boundary

Local history, draft recovery, mutation-safe retry, edit-and-fork, full-text
search, and explicit Markdown/JSON export now have storage and replay contracts.
Search/export operate only on the same sanitized text snapshots; raw tool
results, runtime status, and image payloads are excluded.
