# AI DevTools Assistant

Chrome sidepanel + local daemon + Codex MCP adapter. The daemon is designed for
one local OS user and can serve multiple Codex tasks and multiple Chrome
Profiles at the same time.

The target architecture and migration decisions are recorded in
[`docs/architecture-v2.md`](docs/architecture-v2.md). Implementation status and
acceptance evidence are tracked in
[`docs/implementation-plan.md`](docs/implementation-plan.md). Security boundaries
are documented in
[`chrome-devtools-plugin-threat-model.md`](chrome-devtools-plugin-threat-model.md).
The requirement-by-requirement completion gate is
[`docs/completion-evidence.md`](docs/completion-evidence.md).
Codex installation, pairing, verification, and shareable onboarding steps are in
[`docs/codex-mcp-integration.md`](docs/codex-mcp-integration.md).
Manual Chrome/Profile/frame validation is documented in
[`docs/manual-browser-validation.md`](docs/manual-browser-validation.md).
The default task-oriented MCP protocol and evaluation are documented in
[`docs/smart-mcp-kernel.md`](docs/smart-mcp-kernel.md).
Record only sanitized results in
[`docs/browser-validation-results.md`](docs/browser-validation-results.md); it
starts as `not-run` so unexecuted browser checks cannot be mistaken for proof.

## Local distribution without Chrome Web Store

Build a versioned local package for trusted macOS users:

```bash
npm run package:local
```

The command runs the full build, bundles the daemon, MCP adapter, status, token,
and extension-allowlist tools into self-contained Node.js 20 entrypoints, and
creates these ignored artifacts:

```text
release/ai-devtools-assistant-local-<version>/
release/ai-devtools-assistant-local-<version>.zip
release/ai-devtools-assistant-local-<version>.zip.sha256
```

Recipients unzip the archive and double-click
`安装 AI DevTools Assistant.command`. The installer copies the runtime and
extension to a stable user directory, installs the macOS LaunchAgent, verifies
the daemon, and prints the local Chrome extension path plus the per-machine
Bridge Token. Chrome still requires the user to enable developer mode and load
that unpacked extension directory manually.

See [`docs/local-install.zh-CN.md`](docs/local-install.zh-CN.md) for the
shareable Chinese installation, update, Codex registration, and uninstall
instructions. Do not include a developer machine's daemon config, Bridge Token,
browser state, or Codex config in the release archive.

## Development startup

Install and build the extension:

```bash
npm install
npm run build
```

Load `dist/` as an unpacked extension in Chrome. Then start exactly one daemon:

```bash
npm run daemon:dev
```

For a production-style run, build once and start the compiled JavaScript:

```bash
npm run build
npm run daemon:start
```

On macOS, the same compiled daemon can run as a user LaunchAgent:

```bash
npm run daemon:install-service
npm run daemon:status
```

Print the daemon pairing token explicitly:

```bash
npm run daemon:token
```

Open the extension AI settings in each Chrome Profile, paste that value into
`本地 Bridge Token`, and save. The token is stored in that Profile's
`chrome.storage.local`; the daemon config is created with user-only file mode at
`~/.config/ai-devtools-assistant/daemon.json` by default. Set
`AI_DEVTOOLS_DATA_DIR` to place config, state, and artifacts under one isolated
root, or use the individual path overrides below.

The `Chrome Profile Installation ID` shown in the same settings page is the
session binding value for that Profile.

The token is the required local pairing credential. To additionally pin the
daemon to this unpacked extension build, copy its 32-character extension ID from
`chrome://extensions`, add it to the private daemon config, and restart the
daemon:

```bash
npm run daemon:allow-extension -- YOUR_EXTENSION_ID_FROM_CHROME
```

Repeat the command only when another Profile/build has a different extension
ID. An empty allowlist remains compatible with any `chrome-extension://` Origin
that possesses the token. Once at least one ID is configured, every other
extension Origin is rejected. For ephemeral configuration, set a comma-separated
`AI_DEVTOOLS_ALLOWED_EXTENSION_IDS`; it overrides the stored list for that daemon
run without printing or changing the bridge token.

## Codex MCP adapter

Each Codex task starts only the stdio adapter. It must not start another daemon:

```bash
npm run mcp:dev
```

After `npm run build`, Codex can use `npm run mcp:start` (or invoke
`node dist/mcp/server.js` directly).

For deterministic routing when more than one Chrome Profile is connected, set
`AI_DEVTOOLS_SESSION_ID` to the Profile Installation ID in that MCP server's
environment, or call `browser_list_sessions` followed by `browser_set_session`
at runtime. Runtime selection affects only the current Codex adapter. If no
binding is selected, ordinary reads/tools use the daemon's active-session
fallback for compatibility; artifact resources require an explicit environment
or runtime selection.

The adapter reads the bridge token from the same local daemon config. Override
locations only when needed:

- `AI_DEVTOOLS_DAEMON_URL` — default `ws://127.0.0.1:17321`
- `AI_DEVTOOLS_SESSION_ID` — explicit Chrome Profile binding
- `AI_DEVTOOLS_DATA_DIR` — umbrella root for `daemon.json`, `state.json`, and
  `artifacts/`; individual path variables override their child
- `AI_DEVTOOLS_CONFIG_PATH` — daemon config path
- `AI_DEVTOOLS_BRIDGE_TOKEN` — explicit token override; avoid shell history
- `AI_DEVTOOLS_ALLOWED_EXTENSION_IDS` — optional comma-separated Chrome
  extension ID allowlist
- `AI_DEVTOOLS_DAEMON_PORT` — daemon listener port
- `AI_DEVTOOLS_MCP_TOOL_PROFILE` — `smart` (default), `inspect`, `read`, or
  `full`
- `AI_DEVTOOLS_WORKSPACE_ROOTS` — optional platform-delimited allowlist for
  `browser_find_workspace_source`; defaults to the adapter working directory
- `AI_DEVTOOLS_STATE_PATH` — sanitized daemon state JSON path
- `AI_DEVTOOLS_ARTIFACT_DIR` — binary artifact directory

### Extension AI and MCP AI collaboration

After selecting a Chrome Profile, Codex can read the typed collaboration state
from `ai-devtools://session/{sessionId}/collaboration-workspace` and publish one
bounded handoff with `browser_publish_collaboration_item`. Choose the narrowest
kind: use `page.style` for relevant computed styles, `task.state` for resumable
execution, `code.finding` or `implementation.note` for code-side results, and
`network.mock_scenario` for a multi-request mock plan. Do not publish a full DOM
or secrets when a selector, summary, and artifact reference are sufficient.

The extension AI subscribes to the same Profile workspace and includes only
relevant shared non-sensitive items in its untrusted model context. Publishing
collaboration state never grants browser permissions and does not bypass normal
approval for page, browser, cookie, storage, network-body, screenshot, or other
sensitive operations.

Durable delegation uses `browser_delegate_collaboration_task` followed by
`browser_wait_for_collaboration_result`. V2 tasks can receive append-only
progress, clarification, requirement and evidence events through
`browser_update_collaboration_task`, and Codex can terminate pending work with
`browser_cancel_collaboration_task`. Event IDs are idempotent, long IDs retain a
collision-resistant suffix, and no event grants execution authority.

`browser_observe` is the preferred fresh page entrypoint. `browser_act` executes
one bounded current-page stage, and `browser_verify` checks the outcome from one
fresh read. `browser_debug_activity` combines an approved compact Network digest
and sanitized console evidence only when both sources belong to the adapter's
same selected tab; a target change or mixed-tab recorder fails closed instead of
merging unrelated evidence. The default `smart` profile exposes these
task-oriented tools plus routing and explicit screenshot tools; use `full` only
when an expert workflow needs the primitive surface.

The diagnostic workflow also exposes:

- `browser_explain_css` for bounded matched rules, computed values, CSS
  variables, box geometry, generated stylesheet hints, and same-origin
  original source-map hints when the map is readable;
- `browser_create_reproduction_recipe` and
  `browser_run_reproduction_recipe` for session-bound, explicitly reauthorized
  workflow replay;
- adapter-local `browser_find_workspace_source` for bounded path/symbol matching
  under configured workspace roots;
- `browser_performance_diagnostics` for Navigation/Resource Timing, buffered
  LCP, layout-shift and Long Task summaries, plus bounded interaction/INP and
  trace summaries;
- `browser_realtime_activity` for payload-free WebSocket/EventSource counters,
  Service Worker metadata, and IndexedDB database/store schema;
- ordered `scenarioSteps` on `browser_proxy_upsert_rule` for stateful API Mock
  sequences with `hold-last` or `loop` progression and explicit reset.

`browser_capture_issue_evidence` returns a readable action/DOM/URL/Network/
Console/screenshot-diff timeline in Chat and explicit sanitized Markdown/JSON
exports. Profile-local conversation history supports full-text search and
explicit Markdown/JSON download; tool payloads and image bytes are not stored
in those conversation exports.

Recipe artifacts are bound to the selected Profile session. Replaying a recipe
never reuses the old execution grant and remains approval-gated; a lost write
result is not automatically replayed. The workspace tool never accepts a
caller-supplied root and does not make arbitrary filesystem paths reachable.

`browser_snapshot` remains the expert-compatible accessibility-oriented snapshot for the
adapter's bound Chrome Profile and selected tab/frame/document. Nodes include a
stable page-local `ref`, an actionable target-bound `targetRef`, semantic
role/name, selector, state, and viewport bounds. Prefer `targetRef` in later
actions. Use `limit` and the returned `nextCursor` for pagination. If the page's
semantic structure changes, reusing an old cursor fails with
`STALE_SNAPSHOT_CURSOR`; start again without a cursor. The older
`browser_get_page_context` tool remains available for bounded text/DOM-summary
compatibility reads.

`browser_get_plugin_conversation`, `browser_network_requests`,
`browser_network_list_requests`, and the approval-gated
`browser_get_audit_events` also return bounded pages. Their `cp1_` cursors bind
the collection kind, filters/Profile source, first-page snapshot length, and a
content fingerprint. Tail appends do not alter an in-progress conversation or
audit snapshot; edits, truncation, filter changes, and Network's newest-first
updates fail closed with `STALE_PAGINATION_CURSOR`. Start again without a
cursor. Audit results are restricted to the adapter-selected Profile and expose
only the persisted redacted audit allowlist.

MCP inputs reject unknown fields. Successful structured outputs are validated
against a tool-specific Zod contract before the stdio SDK returns them; the
daemon advertises the matching JSON Schema in `tools/list`. Text summaries,
collections, nested values, and image-bearing structured JSON are independently
bounded, while screenshots use MCP image content plus an artifact URI.

Safe state resources no longer use global URIs. First call
`browser_list_sessions` and `browser_set_session`, then use `resources/list` to
obtain concrete URIs such as
`ai-devtools://session/{sessionId}/target/{targetKey}/context-digest`. The opaque
target key binds the current tab, frame, document, navigation, and revision. A
URI from an older document returns `STALE_CONTEXT`; a URI for another Profile is
rejected by the adapter session boundary.

Fresh page snapshots also carry capture provenance recorded by the Chrome
background at dispatch time: tab, frame, document, navigation ID/revision,
capture time, and background observation time. The embedded Agent sends page
data as an `untrusted_page_context_v1` user-message envelope with this target,
an exact UTF-8 payload byte count, and truncation status. Legacy cached snapshots
without provenance are labeled `targetKnown: false`; their target is never
guessed from the current active tab.

## Safety behavior

- The first WebSocket frame must authenticate with the bridge token.
- The daemon assigns a role from a fixed client identity registry; changing the
  claimed role or using an unknown client name fails authentication.
- Chrome clients require a valid `chrome-extension://` Origin. When configured,
  the extension ID allowlist is enforced before a Profile session is accepted.
- Chrome clients must have a `chrome-extension://` Origin.
- Unknown, sensitive, mutating, destructive, arbitrary-execution, and
  open-world tools require a one-time sidepanel approval.
- Model-emitted formal and compatibility pseudo tool calls are accepted only if
  the tool was advertised for that exact model request. Known MCP arguments are
  strictly validated before an approval is created, so malformed calls cannot
  trigger a misleading confirmation prompt.
- If the sidepanel is unavailable, the approval is denied.
- Navigation while approval is pending invalidates the request with
  `STALE_CONTEXT`.
- Every daemon-to-Chrome call carries a short-lived HMAC execution grant bound to
  its requester, Profile, original MCP policy, exact internal tool/arguments,
  and tab/frame/document target. Exhaustive typed registries constrain MCP tools
  to declared internal executors and classify each executor's mutation scope;
  daemon and Chrome background both validate that boundary before dispatch.
- Raw browser commands from clients are rejected; only registered MCP tools can
  reach the browser executor.
- DOM and selector tools route to an explicitly selected `tabId + frameId +
  documentId`; top-level frame 0 is the safe default, and stale documents are
  rejected after navigation.
- Selector click, hover, and drag resolve bounded element geometry in the
  selected document, require a visible unobscured center, revalidate the target,
  and dispatch trusted CDP mouse input. On Chrome 125+, uniquely mapped
  cross-process child frames use recursive flat CDP sessions bound to the exact
  `frameId + documentId`; same-process frames, duplicate sibling URLs, stale
  documents, and unavailable child sessions fail closed instead of receiving
  top-frame input.
- Selector typing requires a writable text input, textarea, or contenteditable,
  confirms focus without clicking the target, then uses CDP text insertion. Key
  presses accept only one character or a documented named key and use CDP
  keyboard events. Unsupported combinations fail schema validation.
- `browser_fill_form` preflights every field before changing values. Text and
  checkbox/radio controls use CDP input; native select-by-value is an explicit
  bounded DOM exception because CDP has no deterministic cross-platform select
  command. Select results report `inputMode: dom`, reject ambiguous/disabled
  options, and never expose submitted field values in MCP output.
- `browser_handle_dialog` handles only the currently open native JavaScript
  dialog through one approval-gated CDP command; it never changes future page
  dialog behavior.
- Plugin conversations, screenshots, Agent sessions, cookies, storage, headers,
  and response bodies are not direct MCP state resources. Use the corresponding
  approval-gated tool.
- Daemon audit history is available only through the approval-gated
  `browser_get_audit_events` tool. It filters by the adapter-bound Profile
  before applying optional event/tool/outcome filters and pagination. Completed
  sensitive results add only their content class, serialized UTF-8 byte count,
  and authenticated destination; audit rows never contain result values.
- Cookie and storage values are omitted unless the caller explicitly sets
  `includeValues: true`; persisted Agent session snapshots never retain raw tool
  arguments or results.
- Credential-bearing request/response headers are structurally redacted even
  after a sensitive-read approval.
- Remote AI Providers must use HTTPS. Plain HTTP is accepted only for loopback
  development hosts (`localhost`, `*.localhost`, `127.0.0.0/8`, and `::1`), and
  provider URLs cannot embed credentials.
- AI API keys are stored separately in the current Chrome Profile's
  `chrome.storage.local`; profile metadata in `localStorage` is always written
  with an empty key. Existing localStorage keys migrate on first load. Changing
  a keyed profile to a different Provider origin requires an explicit warning
  confirmation before the capability probe or chat request can send the key.
- WebSocket clients and the daemon negotiate protocol version 5. Unsupported
  versions fail with `PROTOCOL_VERSION_UNSUPPORTED`; extension reconnects use
  capped exponential backoff with jitter and reset only after a valid welcome.
- Connections must send `CLIENT_HELLO` within five seconds. Each authenticated
  role has an inbound-command allowlist; three schema/role violations within one
  minute close the socket instead of returning a misleading success ACK.
- The 8 MiB WebSocket frame ceiling is supplemented by command-specific UTF-8
  limits advertised in `SERVER_WELCOME` (for example, 2 KiB heartbeats, 4 KiB
  hello/state/artifact/approval controls, 256 KiB MCP calls, 2 MiB page context,
  and 8 MiB screenshot/browser-result messages). Oversized commands return
  `PAYLOAD_TOO_LARGE` and count as protocol violations.
- Authenticated connections send a heartbeat every 15 seconds and are reclaimed
  after 90 seconds without inbound activity, including UI and stdio MCP clients.
- Heartbeats advance only `lastSeenAt`; state payloads expose a separate
  `stateUpdatedAt`, while screenshots retain their own capture time. The legacy
  `updatedAt` response field aliases `stateUpdatedAt` for compatibility.
- Stopping an Agent run aborts AI, MCP/daemon/browser, and standalone extension
  web-search requests; a cancelled Bing request does not fall through to a new
  DuckDuckGo request.
- Each embedded Agent run is bounded to 64 model requests, 128 total tool calls,
  50 effectful calls, 32 sensitive reads, and 24 hours. Reaching one boundary
  asks the user whether to extend only that dimension or summarize. Tool
  batches that do not fit are held before any call in that batch executes.
- Screenshot bytes are stored as local artifacts; normal daemon state and audit
  files contain metadata and hashes, not base64 images or raw tool arguments.

## Verification

The requirement-by-requirement implementation and manual-evidence status lives
in [`docs/completion-evidence.md`](docs/completion-evidence.md). Automated green
checks do not mark the real-Chrome rows complete.

```bash
npm run typecheck
npm test
npm run build
```

`npm test` uses `tsx` and opens loopback WebSocket listeners for integration
tests. In restricted sandboxes it may require permission to create the local IPC
pipe and loopback listener.

After building, verify the actual packaged daemon and two actual stdio adapter
processes together:

```bash
npm run verify:packaged
```

The verifier uses a temporary user-only data directory and a random loopback
port. It checks authenticated status, two concurrent adapters with distinct
process IDs, independent adapter shutdown on stdio EOF, daemon survival after
both adapters exit, clean daemon shutdown, private `0700`/`0600` permissions,
and restart with the same persisted config. It deletes the temporary directory
and never prints the bridge token.

Validate the browser-evidence worksheet while recording manual results:

```bash
npm run verify:browser-evidence
```

This command validates all 17 required rows, status values, matching manual
sections, bounded failure-note structure, environment fields, and redacted
Profile ID format. It blocks the fixture markers and common raw credential
shapes covered by its tests, but cannot prove that arbitrary text contains no
secret; the tester must still record only sanitized error codes/behavior. It
reports incomplete work without failing. Only the strict completion gate fails
while any row or environment field remains unfinished:

```bash
npm run verify:browser-evidence:complete
```

Neither command changes the worksheet or echoes its notes/environment values.

Run the combined real-Chrome diagnostic regression against an already open
loopback fixture after rebuilding, reloading the unpacked extension, and
refreshing that fixture tab:

```bash
npm run verify:workflow-evidence -- \
  --tab-url-prefix http://127.0.0.1:8765/
```

The verifier covers multi-frame workflow actions, post-state checks, screenshot
diffs, activity subscriptions, source mapping, CSS explanation, workspace
mapping, recipe replay, performance/realtime summaries, a two-step stateful
Mock, and issue-evidence artifacts. It may wait indefinitely for the sidepanel
approval cards required by the selected approval mode.

After that command returns an `issueEvidence.artifactUri`, run the scoped P0-P2
acceptance against the same fixture:

```bash
npm run verify:p0-p2-live -- \
  --tab-url-prefix http://127.0.0.1:8765/ \
  --artifact-uri ai-devtools://artifact/<artifact-id>
```

This verifies the positive CSS/source-map chain and collaboration V2 progress
deduplication, requirement/evidence append, durable cancellation, and waiter
recovery. It creates and cancels a real collaboration task but does not mutate
the fixture page.

Check daemon reachability without printing the bridge token, page URL, or page
content:

```bash
npm run daemon:status
```

## Recovery

- **Daemon unavailable:** start `npm run daemon:dev` or `npm run daemon:start`,
  then rerun `npm run daemon:status`.
- **Wrong bridge token:** run `npm run daemon:token`, copy the value into the
  extension AI settings for that Chrome Profile, and reconnect. Do not paste the
  token into logs or chat.
- **Wrong Profile/session:** call `browser_list_sessions`, then
  `browser_set_session` with the intended Profile. Alternatively set
  `AI_DEVTOOLS_SESSION_ID` and restart that Codex MCP adapter.
- **`STALE_CONTEXT`:** the tab navigated after evidence/approval was captured;
  reread page context and request the action again. Never reuse the old approval.
- **`STALE_SNAPSHOT_CURSOR`:** the page changed between semantic snapshot pages;
  call `browser_snapshot` again without `cursor` and continue from the new result.
- **Debugger conflict:** close the other DevTools/CDP client or detach it
  explicitly, then retry. The extension does not silently remove another
  debugger session.
- **Corrupt state/artifact index:** stop the daemon and move the affected
  `state.json` or artifact directory aside for inspection. Do not delete it while
  the daemon is running; pending writes are serialized and atomic.
