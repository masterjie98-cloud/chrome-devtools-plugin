# Chrome DevTools Plugin Threat Model

## 2026-07-30 multi-sidepanel approval synchronization update

An approval request is scoped to the Chrome Profile installation/session and is
sent only to authenticated sidepanel UI sockets in that session. More than one
sidepanel for the same Profile may render the request, but only a socket in the
request's captured allow-set can resolve it. After the first valid response, the
daemon removes the pending approval and sends an `APPROVAL_CANCELLED` terminal
event to every other allowed sidepanel so sibling cards cannot remain actionable
or appear pending. The responding socket is excluded from that notification
because its local decision already settles the card. Sidepanels in a different
Profile session receive neither the request nor its terminal event.

This closes the stale-card availability and approval-confusion path without
allowing one Profile to authorize another. A sidepanel connection that is
created only after a request was issued is not added retroactively; pending
approval replay across UI reconnect remains intentionally unsupported and the
requesting operation must be retried if all eligible panels disconnect.

## 2026-07-30 arbitrary page JavaScript and debugger update

`browser_evaluate`, `browser_debugger_breakpoint`, and
`browser_debugger_control` intentionally add DevTools-console-level authority to
the default `smart` and expert `full` MCP profiles. They execute only in the
exact task-bound page Profile/Tab/frame/document through CDP
`Runtime.evaluate` and `Debugger.*`.
This is not a sandbox: approved code can read logged-in same-origin data, mutate
page/application state, call page functions, and issue requests with the page's
effective authority.

The deployment assumption remains a local, single-user developer tool. Page
content and MCP/Provider output remain untrusted. A malicious process already
running as the same OS user and remote/multi-user daemon hosting remain outside
scope; distributing this capability in either model requires a separate trust
and administration design.

The execution path is model/Agent → strict MCP schema → daemon approval and
single-use signed grant → Chrome background grant/target revalidation →
registered CDP executor → selected page. Caller-provided JavaScript no longer
has a content-script message handler and never reaches `new Function`.

| Threat | Impact | Control | Residual risk |
| --- | --- | --- | --- |
| Prompt-injected code reads secrets or performs authenticated actions | Confidentiality/integrity loss | Every operation is `arbitrary_execution`, always approval-gated, never covered by a task grant, and the approval shows the bounded arguments/destination | A user can intentionally approve harmful code; approval fatigue remains |
| Navigation or Tab confusion after approval | Code runs on the wrong document | One-use HMAC grant binds internal tool, argument hash, Profile, Tab, frame, document, navigation and revision; background revalidates immediately before dispatch | A small renderer dispatch race remains; future `uniqueContextId` binding can narrow it |
| Oversized code/result or retained remote handles exhaust local resources/context | Extension/model availability loss | 12,000-character code limit, 10-second timeout, bounded previews/stacks/values/breakpoints, `returnByValue`, and object-group release in `finally` | Approved page code can still allocate memory before V8 termination |
| Breakpoint evaluation deadlocks its own MCP call | Tool stalls while the page is paused | Breakpoints are disabled during normal evaluation; deliberate hits require asynchronous scheduling with `awaitPromise: false` and `allowBreakpoints: true` | A caller can still intentionally freeze the page |
| Debugger cleanup leaves a page paused | Selected page unavailable | Paused targets are tracked and resumed before explicit detach, Tab-session switch, and child-target cleanup | Browser/worker crash can interrupt cleanup |
| Stale call-frame ID is reused after resume/navigation | Wrong-scope evaluation or confusing output | Call-frame IDs are accepted only when present in the current retained pause state and are discarded on resume/detach | A pause event can become stale between final validation and CDP dispatch |

Audit persistence retains the tool/policy, target metadata, argument hash,
egress classification/size, timing, and outcome; it does not persist raw
JavaScript results. The downstream MCP client or model may independently retain
returned values, so code that reads credentials or private state remains an
explicit egress decision.

## 2026-07-27 diagnostic automation V3 update

V3 adds five browser diagnostics, one adapter-local workspace lookup, and
stateful proxy scenarios. `browser_explain_css`,
`browser_performance_diagnostics`, and `browser_realtime_activity` run fixed
build-owned functions against the selected tab/frame/document and retain the
existing sensitive-read policy. They do not expose arbitrary JavaScript.
Realtime output contains WebSocket/EventSource URLs, counters, byte lengths,
Service Worker metadata, and IndexedDB names/versions/store names only; it
excludes frame payloads, database values, credentials, headers, and bodies.

Reproduction recipes are bounded JSON artifacts tied to the creating Profile
session, artifact TTL, and runtime schema identity. Creation grants no browser
authority. Execution reloads and validates the artifact, checks the current URL
precondition by default, obtains a fresh approval/execution grant, and delegates
only to the typed workflow executor. Unknown write outcomes remain terminal and
are never replayed automatically.

`browser_find_workspace_source` exists only in the stdio adapter. Roots come
from `AI_DEVTOOLS_WORKSPACE_ROOTS` or the adapter working directory, are
realpath-resolved, and are never accepted from the tool caller. Traversal,
symlink files, ignored build/dependency trees, files above 512 KiB, scans above
5,000 files, and more than 50 results are excluded. Optional excerpts are
explicit and capped. This bridge can disclose local path/symbol/source snippets
to the requesting MCP client, so it remains a local-workspace read boundary and
must not be routed from page or extension-originated messages.

Stateful Mock steps persist only rule cursor/hit metadata and advance after a
successful fulfilled response. Rule creation, reset, and removal remain
approval-gated network writes. Each step is schema-validated, bounded to 50
entries, and uses the existing response body/header limits. The cursor is saved
once per fulfilled request even when multiple response rules match.

Residual risks:

- CSS output identifies generated stylesheet origins but does not yet resolve
  original CSS source-map lines; callers must not infer an original source.
- PerformanceObserver availability and retained buffered entries vary by page
  and Chrome version; missing metrics are reported as warnings.
- Workspace roots intentionally trust the local adapter configuration. A
  compromised same-user MCP process is already inside the accepted local-only
  trust boundary.
- Replaying a logically destructive recipe can repeat a user-approved effect;
  this is why every replay remains a decision barrier rather than inheriting
  capture-time consent.

## 2026-07-27 activity, source mapping, and issue-evidence update

MCP clients may now subscribe to one stable, session-scoped activity resource.
Monitoring remains explicit: listing or subscribing to the resource does not
attach the debugger. `browser_activity_start` enables the selected target's
bounded DOM/Network/Console observers, while `browser_activity_stop` releases
only domains owned by that monitor. The daemon retains at most 200 sanitized
events in memory, does not persist the stream, and sends resource updates only
to subscribed MCP sockets bound to the same Profile session. DOM events omit
text, URL fragments are removed, query values and sensitive console patterns
are redacted, and dropped sequence ranges are reported.

`browser_locate_source` adds a sensitive read but no arbitrary-evaluation
surface. The background injects a fixed build-owned MAIN-world function into
the exact tab/frame/document to inspect bounded React Fiber or Vue instance
metadata. Source-map resolution is limited to flat Source Map v3 data referenced
by scripts already loaded in that debugger session; fetches omit credentials,
enforce timeout/byte/mapping ceilings, and fail closed for indexed or malformed
maps. Source excerpts are returned only when explicitly requested and present
in `sourcesContent`.

Network initiator frames and action timestamps can be associated with the
workflow's exact target, component, and original source. The API labels each
association with `stack`, `action-window`, or `navigation` reasoning and a
bounded confidence value. Consumers must not treat temporal proximity as proof
that a button caused a request.

`browser_capture_issue_evidence` is an approval-gated sensitive composite. It
stores a bounded JSON manifest in the existing session artifact store and keeps
before/after screenshot bytes as separate image artifacts. The manifest never
embeds data URLs or raw response bodies and inherits artifact TTL, per-object,
per-session, and global quotas. It creates no Chrome download and performs no
external upload. Its nested actions retain the workflow approval, exact-target,
decision-barrier, single-use grant, and unknown-write no-replay rules.

Residual risks:

- Framework production builds may expose neither debug owners nor source maps;
  absence is reported rather than inferred.
- Source paths and source excerpts can reveal proprietary code and therefore
  remain sensitive output controlled by the requesting MCP client's egress
  destination.
- A high-rate page can overrun the 200-event window; sequence gaps are visible,
  but the system intentionally does not persist an unbounded forensic log.
- Initiator/action correlation can produce false positives when concurrent page
  work falls inside the same action window.

## 2026-07-23 workflow evidence and direct-frame update

This update makes previously read-only child-frame observations directly
actionable through opaque `frameRef + documentId + targetRef` tuples. It is a
trust-boundary change, but not an authority expansion. The MCP adapter remains
the authoritative reference store: raw frame IDs and selectors are resolved
only after the reference is proven to belong to the same MCP session, top-level
tab/window/navigation, exact child-frame document, and latest semantic snapshot
generation. The extension then revalidates the explicit `{frameId, documentId}`
address before routing. Document replacement, navigation, cross-session reuse,
mixed-frame batches, or fingerprint drift fail before mutation.

`browser_workflow` combines observation, bounded native actions, deterministic
verification, and correlated DOM/URL/Network/Console evidence into one
model-visible call. Nested operations do not bypass policy: the outer workflow
is still classified through the normal approval mode, commit-like clicks and
sensitive fields remain decision barriers, and the executor allowlist contains
no arbitrary JavaScript. If transport state becomes unknown after dispatching a
write, the result is `UNKNOWN_WRITE_OUTCOME` and the write is never replayed.
Network recording started by the workflow is bounded and is stopped only when
the workflow itself owns the recording session.

The WebSocket protocol now binds every adapter, daemon, background bridge and
sidepanel bridge to the same public `buildId` and canonical `schemaHash`.
Mismatches are rejected during hello/welcome before tools or browser state are
used, with instructions to reload the extension and restart the daemon/MCP
client. These identifiers are compatibility metadata, not credentials, and do
not replace the bridge token, Origin validation, immutable role registration,
or Profile isolation.

Semantic projection can return non-sensitive form `value` and
`selectedValues`; password, OTP, token, payment, file and other sensitive
control values remain omitted by the shared risk classifier. Successful actions
now include a fresh post-state read or an explicit reason why state could not be
observed. Element screenshots may be addressed through the same document-bound
references. Pixel diffs run locally with bounded dimensions, return only change
metrics when requested, do not duplicate `dataUrl` in `structuredContent`, and
do not create Chrome Downloads. Page pixels and all derived evidence remain
untrusted and approval-gated according to their existing egress policy.

Residual risks:

- Chrome/CDP frame lifecycle races can still occur between final validation and
  dispatch; executor document checks and one-use grants limit the result to a
  fail-closed error or an explicitly reported unknown write outcome.
- Pixel diffs detect rendered change but do not prove business success;
  deterministic DOM/value/URL checks remain the success oracle.
- A same-OS-user malicious process remains outside the accepted local-only
  threat model.

## 2026-07-21 multi-frame observation and latency update

`browser_observe` now defaults to a bounded `auto` frame scope. The background
reads registered content frames from the already selected tab in parallel and
returns a single provenance-bearing result. This is a read-coverage expansion,
not a permission or execution expansion: every frame retains its own
`frameId`, `documentId`, URL, and top-level navigation binding; stale or
unavailable frames are reported as partial failures rather than relabeled as
the selected frame.

Only the selected frame receives actionable semantic `targetRef` values.
Child-frame observations are explicitly marked non-actionable and their target
references are removed. A model must select that frame and obtain a fresh,
document-bound observation before attempting a mutation, after which the
existing approval and one-use signed execution-grant checks still apply.
Automatic scope reads at most four frames; explicit `all-accessible` reads at
most eight by default and twelve at the hard limit. Node and source-character
budgets are divided across the returned frames, preventing frame fan-out from
creating an unbounded page-content egress path.

The latency optimization changes scheduling, not trust decisions. Compact DOM
construction avoids duplicate selector/viewport work and legacy summary
materialization. State-hub synchronization and read-only audit persistence now
run asynchronously after the tool result is returned. Approval, grant,
mutation, and stale-target audit events remain on their existing durable path.

## 2026-07 execution-core trust-boundary update

The default MCP adapter now exposes a compact `smart` profile. It is a
model-visible capability reduction, not an authorization shortcut. High-level
`browser_observe`, `browser_act`, `browser_verify`, and
`browser_debug_activity` calls are bound to explicit internal executor
allowlists; all nested internal calls retain the outer MCP policy, target,
approval, and signed execution-grant context. The `full` expert profile remains
available explicitly.

Semantic snapshots now include actionable opaque `targetRef` values. A
reference is bound to the selected Profile/tab/frame/document/navigation and
semantic fingerprint. Resolving it performs a fresh bounded semantic read and
fails closed on target or fingerprint drift before the selector reaches the
existing trusted-input checks. A reference carries no authority by itself.

The optional macOS LaunchAgent runs the same loopback-only compiled daemon as
the manual command. It does not relax token authentication, extension Origin or
allowlist checks, Profile isolation, or filesystem permissions. Client
configuration generation deliberately omits the Bridge Token.

The local-only, single-user deployment assumption does not make page content or
Agent output trusted. The daemon now owns memory-only task capability grants.
Each grant is bound to the active extension conversation, Chrome Profile
session, tab/target, normalized HTTP origin, requester principal (`ui` or
`mcp`), stable registered client identity, egress destinations, capability set,
and expiry. The sidepanel is the only surface allowed to create or revoke a
grant. Chat, origin, Profile, provider/destination, or explicit toggle changes
fail closed and revoke or stop matching the grant.

Task grants cover only bounded page observation and ordinary current-page
interaction. Commit-like selectors, password/OTP/token/payment fields, raw
Network rows and bodies, cookies/storage values, cross-origin navigation,
close/delete/publish/send/submit actions, persistent proxy/mock/header rules,
and arbitrary JavaScript remain decision barriers or always-confirm operations.
The smart `browser_debug_activity` composite is covered only when it returns the
bounded grouped Network digest and sanitized console messages; it never turns
raw request rows, headers, response bodies, storage values, or arbitrary console
content into task-grant data. Sidepanel grant invalidation derives the egress
destination from the grant's actual requester principal, so an MCP grant is not
mistaken for an extension-provider grant and revoked immediately.
Executor-side one-shot signed grants, stale-target checks, idempotency conflict
checks, and the prohibition on replaying unknown writes remain unchanged.
Approval freshness is directional: every target identity field known when the
card is created must still match, while a previously missing opaque field may
be filled in for the same target. The daemon performs this check before it
creates a remembered task grant or records approval, and checks the target
again before dispatch.

The action-stage tool accepts only typed native-selector primitives. It cannot
contain JavaScript, stops on failure or an explicit barrier, and uses the same
executor allowlist as primitive tools. DOM delta journals and Network
observation sessions are bounded in memory. Timing telemetry stores numeric
phase durations and byte/character counts only, never raw arguments or page
content.

## Executive summary

The original highest risks combined a high-privilege Chrome extension, an
unauthenticated local WebSocket bus, untrusted page content, and autonomous
model tool execution. The first Architecture V2 implementation slice now adds
bridge-token pairing, optional extension-ID pinning, Chrome Origin validation,
first-frame authentication, server-registered immutable roles,
daemon-enforced one-time approval, untrusted prompt separation,
tool-off gates, Profile session routing, and navigation revisions. Remaining
high risks are remote-provider destination policy, approved raw response-body
egress, complete OOPIF/CDP fidelity, and real-browser regression coverage.

## Scope and assumptions

In scope:

- `public/manifest.json`
- `src/background/**`
- `src/content/**`
- `src/mcp/**`
- `src/shared/**`
- `src/sidepanel/**`
- runtime build and package configuration in `package.json`, `tsconfig.json`, and
  `vite.config.ts`

Out of scope:

- remote or shared daemon hosting
- malicious operating-system administrator
- a malicious process already running as the same OS user with access to Chrome
  profile and daemon configuration files
- supply-chain compromise of Chrome, Node.js, the configured AI provider, or
  installed npm packages
- cloud synchronization and multi-user tenancy

Confirmed context:

- The daemon is local-only and used by one operating-system user.
- Multiple Codex tasks, Chrome windows, and Chrome profiles must work
  concurrently.
- Browser mutations are allowed only after user confirmation.
- The extension may process sensitive application pages, cookies, storage,
  headers, request/response bodies, DOM, screenshots, and chat content.

Open questions that would change risk ranking:

- None for the accepted local deployment model. Exposing the daemon to LAN or
  remote clients would require a new threat model and stronger authentication.

## System model

### Primary components

- **Chrome extension background service worker:** owns Chrome tabs, cookies,
  downloads, DNR, debugger/CDP, WebSocket bridge, and tool dispatch. Evidence:
  `public/manifest.json`, `src/background/index.ts`,
  `src/background/toolDispatcher.ts`.
- **Content script:** reads and changes page DOM, simulates interactions, reads
  storage, and injects temporary/persistent page behavior. Evidence:
  `src/content/index.ts`, `src/content/domInspector.ts`,
  `src/content/browserAutomation.ts`.
- **Sidepanel Agent:** sends prompts to a configurable OpenAI-compatible API,
  parses model tool calls, requests browser/MCP tools, and renders approvals.
  Evidence: `src/sidepanel/App.tsx`,
  `src/sidepanel/services/aiClient.ts`,
  `src/sidepanel/services/autonomousAgent.ts`.
- **Local daemon:** owns the loopback WebSocket listener, authentication,
  approval, Profile routing, browser/session state, and the persisted bounded
  per-Profile AI collaboration workspace. Evidence:
  `src/daemon/server.ts`, `src/daemon/config.ts`, `src/mcp/wsServer.ts`,
  `src/mcp/browserStateHub.ts`.
- **MCP stdio adapter:** connects each Codex task to the existing daemon without
  listening on the daemon port. Evidence: `src/mcp/server.ts`,
  `src/mcp/daemonClient.ts`.
- **Codex MCP client:** launches the stdio process and can invoke all exposed MCP
  tools. It is external to the repository but is the intended MCP consumer.
- **Remote AI provider:** receives user messages, page context, screenshots, and
  tool results through a configurable HTTP endpoint.

### Data flows and trust boundaries

- Web page → Content script: DOM, visible text, attributes, storage, dialogs, and
  events cross from an untrusted origin into extension code. The content script
  applies bounded DOM sanitization in some read paths, but not an authorization
  boundary.
- Content/background → daemon: page state, selected elements,
  screenshots, chat, Agent events, and tool results cross loopback WebSocket.
  Zod validates message shapes; the first frame requires the paired token,
  Chrome clients require a `chrome-extension://` Origin, and the role is
  immutable after hello.
- Codex → MCP stdio process: MCP resource and tool requests enter through stdio.
  MCP arguments use Zod schemas; sensitive and mutating requests pass through
  the daemon approval broker and fail closed without a sidepanel UI.
- Sidepanel → Remote AI provider: prompts, untrusted page context, images, and
  tool results cross HTTPS, or HTTP only for recognized loopback development
  hosts. Authorization headers are added when an API key is configured.
  Structural credential-header redaction, sensitive approval previews,
  value-omission defaults, artifact handling, and keyed Provider-origin change
  confirmation apply before model egress.
- MCP/Agent → Chrome executor: privileged read and mutation commands cross the
  local bridge. The daemon validates policy/approval and signs a request-bound
  execution grant; the background executor validates exact call, Profile,
  Chrome document/navigation, expiry, and replay before dispatch.
- Chrome Network → Agent evidence: recording and request reads use the existing
  reversible-write and sensitive-read approval path. The derived activity
  digest strips query/fragment data, omits headers and bodies, groups repeated
  method/path/status entries, and collapses heartbeat-like traffic before model
  use. Raw approved request rows remain available and therefore sensitive.
- Daemon → Local state/artifacts: sanitized bounded session/audit metadata is
  written atomically with user-only permissions; screenshots and oversized
  payloads use a separate quota/TTL artifact store. Pending requests and grants
  remain memory-only and are not restored after restart.
- Extension AI/MCP AI → CollaborationWorkspace: typed style, DOM, semantic,
  screenshot, network, task, and code handoffs enter a shared Profile session.
  Item source, target, visibility, sensitivity, owner, revision, byte limits,
  and same-Profile broadcast checks are enforced before persistence or model
  context selection. Collaboration content remains untrusted evidence and never
  grants browser permission.
- Codex delegated text → sidepanel task inbox → embedded Agent: delegated text
  remains an unbound Profile-level inbox item until explicit user acceptance.
  Acceptance persists a conversation binding before the text crosses into Agent
  execution input. Only that conversation may project, resume, or complete the
  task. Acceptance creates no browser grant; every resulting sensitive read or
  mutation still traverses the existing policy, approval, freshness, and
  one-time execution-grant boundary. Reloaded or disconnected claimed tasks
  require explicit re-observe-and-resume in the bound conversation.

#### Diagram

```mermaid
flowchart LR
  W["Untrusted Web Page"] --> C["Content Script"]
  C --> B["Chrome Background"]
  B --> L["Local WebSocket and State Hub"]
  M["Codex MCP Client"] --> S["Stdio MCP Server"]
  S --> L
  A["Sidepanel Agent"] --> L
  A --> R["Remote AI Provider"]
  L --> B
```

## Assets and security objectives

| Asset | Why it matters | Security objective (C/I/A) |
| --- | --- | --- |
| Cookies and storage values | May contain authenticated sessions, tokens, private application state | C/I |
| Authorization headers and network bodies | Can expose credentials, personal data, source code, and business records | C/I |
| Page DOM, text, screenshots, and selected elements | May contain confidential customer or internal data | C/I |
| Browser target and document identity | Wrong routing can mutate or disclose a different page/profile | I/C |
| Chrome privileged capabilities | Debugger, DNR, downloads, tabs, and cookies can alter browser behavior | I/A/C |
| Tool approval decision | Represents the user's intent for a bounded side effect | I |
| Bridge token and local configuration | Grants access to the privileged local broker | C/I |
| Agent run and conversation state | Contains user intent, tool history, and potentially sensitive results | C/I/A |
| AI collaboration workspace | Coordinates selective page/code/task evidence between extension and MCP AIs | C/I/A |
| Daemon and MCP availability | Required for Codex and embedded Agent browser workflows | A |
| Audit events | Needed to explain actions, denials, sensitive egress, and failures | I/A |

## Attacker model

### Capabilities

- Controls content, DOM, text, attributes, frames, network responses, and scripts
  on a page visited by the user.
- Can cause the page to include prompt-injection text intended for the embedded
  Agent or Codex operator.
- Can attempt WebSocket connections to the loopback port from a browser origin,
  subject to Chrome platform network restrictions.
- Can submit malformed, oversized, repeated, or role-spoofed protocol messages if
  a loopback connection is established.
- Can influence output returned by a configured remote AI provider or external
  MCP tool.
- Can cause normal races through navigation, multiple profiles, multiple Codex
  tasks, disconnects, and timeouts without controlling the local OS.

### Non-capabilities

- Cannot read daemon configuration files or Chrome profile storage directly.
- Cannot run arbitrary local processes as the user.
- Cannot change extension source code or npm dependencies.
- Cannot administer the local machine.
- Cannot access a daemon bound only to loopback from a different machine.

## Entry points and attack surfaces

| Surface | How reached | Trust boundary | Notes | Evidence |
| --- | --- | --- | --- | --- |
| Loopback WebSocket | Connect to local port and send JSON frames | Browser/local client → privileged state hub | Requires paired token and protocol v5; Chrome clients also require an extension Origin; daemon assigns an immutable role | `src/mcp/wsServer.ts:startPluginWebSocketServer`, `handleClientHello` |
| MCP stdio tools | Codex invokes an exposed MCP tool | MCP client → browser executor | Capability profile defaults to smart and supports inspect/read/full subsets; policy and approval stay daemon-enforced; arbitrary evaluate is not exposed; dialog handling is a one-current-dialog CDP action | `src/shared/mcpTools.ts:MCP_EXPOSED_TOOL_ORDER`, `src/mcp/toolRuntime.ts` |
| Sidepanel chat input | User sends prompt or image | User → remote model and Agent loop | May include page context and tools | `src/sidepanel/App.tsx:handleSendChat` |
| Profile-local chat history | Sidepanel debounces text and draft updates | User/remote model → Chrome Profile storage | Stores bounded user/assistant text only; omits tools, status, queues, attachment metadata, and image bytes | `src/sidepanel/services/chatWorkspace.ts`, `src/sidepanel/App.tsx` |
| Page context ingestion | Agent automatically reads active page | Web page → model input | Page data is a separately labeled untrusted user message, never a system instruction | `src/sidepanel/services/aiClient.ts:buildSystemPrompt` |
| Model tool output | Formal or pseudo tool call in model response | Remote model → privileged executor | Formal calls pass policy; pseudo-call compatibility is off by default and tools-off is an execution-boundary gate | `src/sidepanel/services/aiClient.ts:parsePseudoToolCalls`, `src/sidepanel/services/autonomousAgent.ts` |
| Content-script message handler | Background sends extension requests | Background → page DOM/storage | Performs bounded DOM/input/storage operations; legacy arbitrary evaluate remains unreachable and persistent dialog override code has been deleted | `src/content/index.ts:handleContentRequest`, `src/background/toolDispatcher.ts` |
| Chrome debugger/DNR/cookies APIs | Tool dispatcher invokes Chrome APIs | Extension → browser-wide capabilities | Broad permissions and all-URL host access | `public/manifest.json`, `src/background/toolDispatcher.ts` |
| Configurable AI endpoint | User saves API URL/key | Sidepanel → remote endpoint | Remote URLs require HTTPS; loopback HTTP is allowed; credentials in URLs and active schemes are rejected | `src/sidepanel/services/aiEndpointPolicy.ts`, `src/sidepanel/services/aiClient.ts:requestChatCompletion` |
| Screenshot/full DOM payload | Tool captures large binary/text data | Browser → WS/MCP/model | Screenshot/oversized results use bounded session artifacts; semantic snapshots are capped and cursor-paginated; explicit full DOM remains sensitive | `src/daemon/artifacts/store.ts`, `src/shared/semanticSnapshot.ts`, `src/content/domInspector.ts` |
| Incremental activity subscription | MCP subscribes and extension emits DOM/Network/Console changes | Browser → daemon memory → subscribed MCP task | Explicit start; exact Profile routing; 200-event in-memory ring; sanitized summaries; no raw DOM text, bodies, or durable event history | `src/shared/browserActivity.ts`, `src/mcp/browserStateHub.ts`, `src/mcp/server.ts` |
| Framework/source locator | MCP asks where an exact DOM target came from | Page MAIN world/CDP script metadata → MCP | Fixed injected function only; exact document binding; bounded React/Vue owners; credential-free, size-limited flat source maps; sensitive-read policy | `src/background/sourceLocator.ts`, `src/background/sourceMapResolver.ts`, `src/background/debuggerAdapter.ts` |
| Issue evidence bundle | MCP captures workflow and diagnostic evidence | Browser/daemon artifacts → requesting MCP task | Approval-gated composite; action policy remains nested; manifest and images separated; no Downloads side effect; TTL and quotas inherited | `src/mcp/toolRuntime.ts`, `src/daemon/artifacts/store.ts` |
| Collaboration publication/resource | Extension AI or MCP AI publishes/reads a typed item | AI participant → Profile state → other AI/model | Same-Profile only; strict kinds/schema, owner and revision controls, redaction, private/sensitive filtering, aggregate limits, relevance selection | `src/shared/collaborationWorkspace.ts`, `src/mcp/collaborationTools.ts`, `src/mcp/browserStateHub.ts`, `src/sidepanel/services/aiClient.ts` |
| Durable collaboration delegation | Codex creates a task; user accepts it in the sidepanel | MCP text → Profile inbox → conversation-bound user decision → embedded Agent input | Stable task ID/fingerprint, Profile/target/conversation binding, explicit claim, immutable result, cancelable wait, no cross-conversation or reload replay; accept is not a browser approval | `src/shared/collaborationTasks.ts`, `src/mcp/collaborationTaskRuntime.ts`, `src/sidepanel/App.tsx`, `src/sidepanel/components/ChatPanel.tsx` |

## Top abuse paths

1. A malicious page embeds instructions in visible text → auto-read places the
   text in the Agent system prompt → model emits an unapproved click/type or
   sensitive-read call → the extension executes it and returns data to the model.
2. A loopback WebSocket client self-declares `plugin` → requests cookie/storage
   or browser tools → global browser routing sends the request to a connected
   extension → raw result returns to the unauthenticated client.
3. A user pins tab A and activates tab B → state hub reports B while executor
   still resolves A → Codex approves an action believing it targets B → mutation
   occurs on A.
4. Navigation replaces document A with B → old selected element/page snapshot
   remains cached → Agent combines old and new state → action targets a stale or
   semantically different element.
5. Model output contains pseudo tool markup while tools are disabled → parser
   reconstructs the call → Agent loop executes it because enablement is not
   checked at the execution boundary.
6. A cookie/network/storage read returns raw credentials → result is serialized
   into chat or Agent session → result is sent to the remote AI provider and/or
   exposed through MCP state resources.
7. A screenshot or network-read operation attaches CDP → cleanup deletes a
   different extension iframe → the page or security extension UI is silently
   modified by a tool classified as read-only.
8. The daemon is not started or exits unexpectedly → stdio adapters cannot reach
   browser state → tasks lose browser capability until the local daemon restarts;
   bounded persisted state survives but active requests do not.
9. A Codex task embeds misleading instructions → the sidepanel treats arrival as
   user approval or silently auto-resumes after reload → embedded Agent performs
   unintended work or repeats a write whose first outcome is unknown.
10. A model supplies a screenshot filename → the extension interprets naming as
    permission to write Chrome Downloads → a read-only MCP observation creates an
    unexpected local filesystem side effect.

### Execution-approval mode amendment

The current implementation replaces the earlier embedded-Agent-only remembered
grant with an always-visible, memory-only three-mode selector. `ask` is the
default lifecycle state; `agent` automatically answers only `task_grant`
policies; `full` automatically answers all approval modes exposed by this
extension. Both automatic modes bind the active conversation, Chrome Profile
session, and Provider destination. `agent` additionally binds normalized
HTTP(S) origin and fails closed on a cross-origin redirect. `full` instead binds
the exact user-selected Tab/target, so an authentication redirect may cross
origins and return only inside that Tab. A different chat, Profile, Provider, or
Tab/target resets or stops matching the decision. A transient authenticated Hub
disconnect pauses execution but does not silently erase it. Both modes apply to
embedded and MCP requesters, but do not reuse execution grants: the daemon still
binds the concrete requester, late-validates the current document/navigation,
records the decision, and signs a new single-use grant per operation. `full`
does not create operating-system file/process authority that the extension does
not expose.

For a high-level action workflow, an already-dispatched page or browser effect
may be followed by read-only post-action evidence from the replacement document
only while the Chrome Profile session, `tabId`, `targetId`, and window still
match. This continuation cannot authorize another effectful internal call and
cannot cross to a different Tab; it prevents successful navigation from being
misreported and replayed while preserving the target trust boundary.

Fast Agent execution now defaults on as an orchestration strategy. It remains
DOM-first and does not capture a screenshot merely because the user sends a
message. Visual checkpoints remain unavailable when the configured model lacks
image support and still require the Agent to activate the existing
approval-controlled visual chain. This amendment supersedes older table wording
that describes fast execution as default-off or remembered approval as
embedded-only.

## Threat model table

| Threat ID | Threat source | Prerequisites | Threat action | Impact | Impacted assets | Existing controls (evidence) | Gaps | Recommended mitigations | Detection ideas | Likelihood | Impact severity | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TM-001 | Web page or unintended local client | Client can reach loopback WebSocket | Spoof browser/plugin/observer role and invoke tools or read state | Sensitive browser data disclosure and privileged browser actions | Cookies, storage, page data, Chrome capabilities | Loopback binding, Zod parsing, paired token, optional exact extension-ID allowlist, protocol-version negotiation, five-second hello timeout, Chrome Origin validation, fixed client identity-to-role registry, immutable role/connection ID, per-role command allowlist, rate/violation/idle limits, raw-command denial (`src/daemon/config.ts`, `src/shared/wsClientIdentity.ts`, `src/mcp/wsServer.ts`, `src/mcp/wsSchemas.ts`, `src/mcp/protocolPolicy.ts`) | Extension ID pinning is optional by default; same-user processes that possess the token are intentionally inside the local trust boundary; Chrome cannot attest service-worker versus sidepanel context within one paired extension Origin | Pin known extension IDs where desired; protect the user-only daemon config and treat extension subroles as routing controls rather than isolation from a compromised extension | Count failed handshakes, unpaired extension IDs, identity/role/origin violations, idle closes, and command violations without logging tokens | low | high | low to medium |
| TM-002 | Malicious page or remote model output | Auto page context and Agent tools are enabled | Inject instructions or pseudo tool markup that executes despite user/tool policy, exploit a remembered approval outside its intended scope, or use automatic segment continuation to extend malicious execution | Browser mutation, sensitive read, external action, loss of user trust | Browser integrity, approval decision, sensitive data | Page context is an untrusted user message; tools-off is hard-gated; pseudo calls default off; formal/pseudo calls are intersected with the exact advertised tools; strict known-tool parsing precedes approval; conversation-origin approval is memory-only and binds chat, normalized HTTP(S) origin, owning sidepanel instance, Profile session, and Provider destination; destructive, arbitrary, open-world, unknown, unbound, non-HTTP(S), and external MCP requests remain one-time; pending approval has no UI expiry or pre-issued grant; after allow, target/revision and a single-use HMAC grant are revalidated; reaching a run budget creates a separate no-timeout user checkpoint that extends only the exhausted dimension or stops for a tools-off summary and never grants a concrete tool (`src/sidepanel/services/aiClient.ts`, `src/sidepanel/services/autonomousAgent.ts`, `src/sidepanel/agentRunApprovals.ts`, `src/shared/agentRunBudget.ts`, `src/mcp/wsServer.ts`, `src/daemon/executionBroker.ts`, `src/shared/executionGrant.ts`) | Real Chrome budget-card behavior and active-grant chat switching remain manual evidence | Complete browser regression; never treat a budget continuation as tool approval or broaden remembered decisions across chats, origins, Profiles, sidepanel instances, Providers, destructive/open-world tools, or external MCP callers | Audit model-requested, UI-prompted, auto-answered, budget-extended, and executed tools; alert on scope/grant/schema/stale-target mismatches | low | high | medium |
| TM-003 | Normal concurrency or malicious session messages | Multiple profiles/tasks/tabs or crafted session heartbeat/resource URI/cursor | Route state or commands through global active session/latest socket, reuse a resource URI after navigation, switch another adapter's Profile, reuse a collection cursor with another Profile/filter, or make stale cached data look fresh by sending heartbeats | Read or mutate the wrong profile/tab/document; model acts on stale state; cross-Profile audit metadata disclosure | Target identity, page data, audit metadata, browser integrity | Stable Profile installation IDs; per-connection runtime Profile list/select tools restricted to MCP adapter roles; adapter-local heartbeat/state/artifact binding; safe MCP resources require an explicit matching session and opaque tab/frame/document/navigation/revision target key; audit rows are filtered by the bound Profile before filtering/paging; collection cursors bind kind/source/filter/snapshot; matching browser-socket routing; explicit tab/frame/document targets; background-attached page provenance; stale provenance/resource/cursor rejection; navigation invalidation; socket-bound result checks; HMAC execution grants; separate clocks; and protocol/runtime-switch tests (`src/mcp/stateResourceRegistry.ts`, `src/mcp/resourceRouting.ts`, `src/shared/collectionPagination.ts`, `src/mcp/toolRuntime.ts`, `src/mcp/wsServer.ts`) | Tab-close invalidation and all observer broadcasts still need real-Chrome multi-Profile evidence | Complete real-Chrome routing/tab-close/resource/audit regression and keep all state/resource broadcasts session-scoped | Log route selection and stale provenance/resource/cursor/grant rejections using redacted target IDs; alert when liveness is current but state age exceeds policy | low | high | medium |
| TM-004 | Model, MCP client, or page-induced tool request | Sensitive tool is available and returns data | Read raw cookie/storage/header/body/screenshot/full DOM and send it across WS or remote AI | Credential theft, private data disclosure | Cookies, tokens, application data, screenshots | Cookie/storage values default omitted; credential headers use structural redaction; ordinary sensitive reads require approval with egress preview and concrete destination; sending a chat message never captures a page image; optional fast Agent mode defaults off and confirms the displayed Provider origin before first enable and after origin change; the Agent must explicitly call the approval-gated `browser_take_screenshot` tool before visual observation is active; only then may later page-state barriers produce at most 8 adaptive capture attempts and 8 MiB per task, coalesced per tool batch, latest-only, sampled-fingerprint deduplicated, and degraded to fresh DOM without replay; Safe Retry disables the path; tool-produced screenshots and large payloads use session artifacts; persisted Agent/audit state omits raw arguments/results; completed sensitive tool/artifact responses record only class, exact serialized bytes, and authenticated destination (`src/shared/sensitiveData.ts`, `src/shared/agentSession.ts`, `src/shared/egressMetrics.ts`, `src/sidepanel/App.tsx`, `src/sidepanel/services/aiClient.ts`, `src/sidepanel/services/autonomousAgent.ts`, `src/sidepanel/services/fastAgentVisualCheckpoints.ts`, `src/sidepanel/components/AiSettingsDrawer.tsx`, `src/mcp/wsServer.ts`, `src/daemon/artifacts/`) | Fast-mode consent is Profile-persistent rather than chat/origin-scoped, so after one explicitly approved screenshot a user who leaves it enabled can send later page-state checkpoints to the configured Provider without another prompt; the daemon does not meter these direct Provider image requests, and repeated adaptive captures can disclose more of a task than the first explicit screenshot alone; response bodies and explicitly requested cookie/storage values remain intentionally available after approval; the daemon cannot observe how a downstream MCP client or Provider repackages bytes after its authenticated boundary | Keep the active mode visible in context labels, default it off, require confirmation on enable/destination change, preserve the explicit first screenshot approval and the 8-attempt/8-MiB/latest-only boundaries, and tell users to disable it before entering pages they do not want captured; if broader deployments are added, replace persistent consent with chat-and-origin-scoped consent; retain origin-only destination rendering and keep raw values out of logs/state | Metrics for sensitive reads and bytes egressed by class/destination; audit fast-mode enable/disable, Provider-origin changes, explicit screenshot approvals, checkpoint attempts/acceptance/deduplication, and cap exhaustion without image or prompt content | medium | high | medium |
| TM-005 | MCP/Agent tool caller | Caller invokes screenshot, input, network, evaluate, dialog, or another mislabeled tool | Read tool is wired to a mutation executor; screenshot naming is interpreted as download permission; selector geometry becomes stale/occluded or child-frame coordinates are sent to the wrong renderer; focus clicks a control before typing; batch form execution changes an early field before a later dynamic failure; select labels resolve ambiguously; evaluate hangs; dialog handling persists | Page breakage, unexpected local file write, wrong-target interaction, renderer hang, unintended state change | Page integrity, local Downloads, and availability | Canonical policy/executor registries and bound grants; MCP screenshot schemas expose no filename/download arguments and return image content plus Artifact only; internal download requires explicit `saveToDownloads: true`; selector mouse actions revalidate target and require center hit tests; keyboard targets confirm bounded focus without click and use CDP; form fill performs all-field preflight, element-token/type rechecks, CDP text/toggle input, radio-uncheck denial, bounded field counts, and partial-failure reporting; select is an explicit scoped DOM exception with exact unique option matching, disabled-option denial, token binding, post-event verification, `inputMode: dom`, and no returned field values; Chrome 125+ recursively auto-attaches flat OOPIF sessions and maps CDP/webNavigation trees only on exact or unique active URL matches bound to the exact document; same-process child coordinates are translated from the frame content box before CDP mouse dispatch; ambiguous, duplicate-URL, missing, and stale routes fail closed; dialog handling is one CDP command; arbitrary evaluate is not exposed; real Chrome now verifies exact-value direct fill in both OOPIF and same-process child frames; invariant tests (`src/shared/mcpExecutionPolicy.ts`, `src/shared/executionGrant.ts`, `src/shared/trustedKeyboard.ts`, `src/shared/formControls.ts`, `src/background/debuggerFrameRouting.ts`, `src/background/debuggerAdapter.ts`, `src/background/toolDispatcher.ts`, `src/background/dialogHandling.ts`) | Dynamic multi-field pages can partially change after successful preflight if a later post-check fails; dedicated same-process pointer-click and multi-field child-form paths remain automated-only; no isolated evaluator exists, so arbitrary evaluate remains intentionally hidden | Keep ambiguous and duplicate-URL child routes fail closed; add real same-process iframe pointer-click and multi-field regressions; preserve select's non-trusted semantics; keep legacy evaluate unreachable unless a separately isolated design is approved | Count policy, stale-context/control, focus, route-ambiguity, option-resolution, partial-fill, unsupported-frame/radio/key, download attempts, and no-dialog rejections; review every new mutation mapping | low | high | low to medium |
| TM-006 | Malicious/large page or protocol client | Client can send or produce large DOM/image/events | Exhaust memory/context/disk or keep Agent/tool loop running | Daemon, extension, renderer, or model-cost denial of service | Availability and cost budget | 8 MiB frame cap; advertised command-specific UTF-8 byte ceilings with a 4 KiB unknown-command default; hello/idle timeouts; per-connection rate limit; pending/active execution caps; Agent cancellation across AI/MCP/browser/standalone search; aligned deadlines; bounded inline MCP output; semantic and Network/conversation/audit cursor pagination; Agent-run-bound SHA-256 idempotency keys; 256,000-character sidepanel tool-result retention with explicit truncation metadata and line virtualization above 240 lines; per-object/session/global artifact budgets; per-Agent duration/model/tool/effectful/sensitive ceilings with atomic batch reservation; and fast-mode visual checkpoints coalesced to one per tool batch, sampled-fingerprint deduplicated, latest-only, and capped at 8 adaptive capture attempts and 8 MiB per task (`src/mcp/wsServer.ts`, `src/mcp/protocolPolicy.ts`, `src/sidepanel/services/webSearch.ts`, `src/sidepanel/agentRunApprovals.ts`, `src/sidepanel/toolResultPresentation.ts`, `src/sidepanel/services/fastAgentVisualCheckpoints.ts`, `src/shared/agentRunBudget.ts`, `src/shared/semanticSnapshot.ts`, `src/shared/collectionPagination.ts`, `src/daemon/executionBroker.ts`, `src/daemon/artifacts/store.ts`) | Limits are statically calibrated; real high-complexity pages may reveal a command or visual-checkpoint budget that is too loose or too strict | Keep fail-closed ceilings and tune only from redacted rejection/size telemetry; do not raise the global frame or visual-checkpoint ceiling to mask one workflow | Monitor connection/message bytes, pending counts, idle closes, cursor rejection, artifact bytes, run duration, visual-checkpoint cap exhaustion, and budget/limit rejections | low | medium | low |
| TM-007 | Normal multi-client use | Local daemon is stopped, crashes, or is not started before adapters | Adapters cannot reach the single local daemon | Browser integration unavailable; active requests are lost | Availability, bounded Agent state | One daemon plus many stdio adapters, atomic bounded state/artifact persistence, status command, separate packaged entrypoints, graceful adapter shutdown on stdio EOF, multi-client/restart tests, and a real-dist two-adapter lifecycle verifier (`src/daemon/server.ts`, `src/daemon/status.ts`, `src/daemon/store/stateStore.ts`, `src/mcp/daemonClient.ts`, `src/mcp/server.ts`, `scripts/verify-packaged-processes.mjs`) | No OS-level packaged supervisor/autostart; active requests and approvals intentionally do not survive restart | Add an optional launchd/system service installer and clear startup diagnostics without coupling daemon lifetime to one adapter | Daemon health, adapter negotiation failures, restart counters | low | medium | low |
| TM-008 | Misconfiguration or malicious endpoint | User or modified persisted config supplies an unsafe provider URL | Send API key, prompts, page context, and results to an unintended endpoint | AI credential and page-data disclosure | API key, page data, chat, screenshots | Settings/fetch-time policy require remote HTTPS and verified loopback HTTP; URL credentials/non-HTTP schemes are rejected; keys migrate to Profile-scoped `chrome.storage.local`; metadata serialization strips keys; Provider-origin changes require explicit confirmation when either an API key or fast-mode screenshot egress is active; sending a message never creates an image; the first Agent-requested screenshot keeps its sensitive-read approval and displays the current Provider origin; only a successful explicit screenshot activates bounded runtime checkpoints to that same origin; embedded-Agent approvals render the current Provider origin only, while MCP approvals identify client-managed downstream egress (`src/sidepanel/services/aiConfig.ts`, `src/sidepanel/services/aiEndpointPolicy.ts`, `src/sidepanel/services/approvalPresentation.ts`, `src/sidepanel/services/aiClient.ts`, `src/sidepanel/components/AiSettingsDrawer.tsx`, `src/sidepanel/components/ChatPanel.tsx`) | Extension storage is not an OS keychain and remains readable by compromised extension code; persistent fast-mode consent does not prompt separately for each later route, drawer, or visual-state checkpoint after the explicit visual chain has started | Keep extension code/CSP narrow, retain origin-only destination rendering on every model-egress approval or persistent-mode confirmation, keep adaptive checkpoints bounded and latest-only, and consider chat/origin-scoped consent or OS keychain integration only if the local threat model expands | Audit Provider origin/TLS policy, fast-mode consent changes, explicit screenshot approvals, checkpoint counters, and migration failures without logging keys, prompts, or screenshots | low | high | medium |
| TM-009 | Compromised extension code or a process already inside the single-user local trust boundary | Access to the current Chrome Profile or extension execution context | Read persisted chat text/drafts or corrupt history and branch metadata | Disclosure of prompts/model responses; misleading restored context | Chat content and conversation integrity | Separate versioned Profile-local key; strict normalization; serialized bounded writes; 20-conversation, 80-message, per-text, and per-conversation caps; tool results, runtime status, queues, attachments, and image bytes omitted; inactive conversations are user-deletable; safe retry creates a fresh conversation and requires confirmation before resending live image attachments (`src/sidepanel/services/chatWorkspace.ts`, `src/sidepanel/chatBranches.ts`, `src/sidepanel/components/ChatPanel.tsx`) | Persisted text is intentionally plaintext in Chrome storage and has no time-based expiry or bulk-delete control; compromised extension code remains able to read it | Keep storage Profile-local and bounded; do not add raw tool/image persistence; add retention duration and clear-all only if the product requires longer-lived history | Report storage failures and normalization drops without logging content; never include stored text in daemon audit logs | low | high | low to medium |
| TM-010 | Malicious page, remote model, or one local AI participant | Collaboration publication, consumption, or delegated-task acceptance is enabled | Publish prompt-injection text, overwrite another AI's state, smuggle secrets into direct MCP context, reuse a task ID for different work, treat arrival/acceptance as browser approval, inject a task into every Chat, resume or finish it from another conversation, auto-resume after reload, flood persisted state, or broadcast evidence across Profiles | Wrong AI action, cross-conversation context contamination, duplicate unknown-state writes, sensitive disclosure, corrupted task takeover, connection denial of service | Collaboration workspace, task and conversation integrity, approval intent, page/code evidence, Profile isolation | Fixed item kinds and strict schemas; actor assigned at authentication; owner/revision checks; redaction and sensitivity filtering; bounded workspace; exact Profile broadcasts; request fingerprint and deterministic task IDs; unaccepted and legacy-unbound recovery tasks remain in a Profile inbox; explicit claim persists a sanitizer-safe conversation binding; UI projection, resume, queued execution, and first terminal publication reject another conversation; unbound terminal tasks are hidden from Chat; target-fresh acceptance; immutable terminal result; bounded cancelable waiters keyed by task ID; arrival never runs the Agent; acceptance creates no execution grant; claimed tasks never auto-resume after reload; explicit recovery prompt requires re-observation before any write (`src/shared/collaborationWorkspace.ts`, `src/shared/collaborationTasks.ts`, `src/mcp/collaborationTaskRuntime.ts`, `src/mcp/collaborationTools.ts`, `src/mcp/wsServer.ts`, `src/sidepanel/App.tsx`, `src/sidepanel/components/ChatPanel.tsx`) | Same-actor client IDs are descriptive rather than a tenant boundary in the accepted single-user model; the conversation key is a routing boundary rather than authentication; a user may explicitly resume while another stale sidepanel is still alive; real-Chrome new-Chat isolation remains | Keep collaboration text untrusted and separate from permission; retain Profile/target/conversation binding and immutable results; never auto-resume or replay unknown-state writes; keep Codex waiters task-ID-bound and Chat-independent; move oversized content to artifacts; add stronger leases only if simultaneous sidepanels become a supported product scenario | Count ID conflicts, duplicate claims, cross-conversation claim/completion rejections, stale targets, waiter capacity/cancellation, recovery attempts, revision/owner/size/schema rejections, and cross-session broadcasts without logging item or conversation content | low | high | medium |
| TM-011 | Remote model or page-induced planning error | The model emits an ordered batch whose later calls assume an earlier mutation succeeded | Deny or fail the first action, then continue later clicks, input, navigation, or external calls against an unverified page state | Wrong-target mutation, unintended workflow progress, repeated approval loops, loss of user trust | Browser integrity, approval intent, task state | General Goal/Observation/Dependency/Barrier/Verification/Re-plan protocol; maximum four calls per model batch; parallel execution restricted to independent safe reads; all effectful, sensitive, open-world, and mixed batches remain ordered; ordered batches stop after the first failed or denied result and synthesize `AGENT_BATCH_DEPENDENCY_SKIPPED` for later calls; success classification treats explicit error, denial, skip, and unmatched results as failures; every actually executed call still receives an independent policy check, approval, idempotency key, target binding, and one-time execution grant (`src/sidepanel/services/agentExecutionStrategy.ts`, `src/sidepanel/services/agentToolBatch.ts`, `src/sidepanel/services/agentToolResult.ts`, `src/sidepanel/App.tsx`, `src/sidepanel/services/autonomousAgent.ts`) | Dependency inference and decision-barrier placement are model-guided; a semantically wrong first action can still execute after user approval; runtime evidence for re-planning after a real Chrome failure is pending | Keep fail-fast enforcement in runtime rather than prompt only; never reuse approval or execution grants across a batch; retain post-mutation read-only verification and no-progress guard; add real-Chrome failed-first-action evidence | Count skipped dependent calls, failed batch position, re-plan attempts, stale-target rejections, and repeated semantic results without logging raw arguments or page data | medium | high | medium |
| TM-012 | Normal WebSocket/daemon failure | A tool request was dispatched but its response is lost during a connection close | Treat a transport failure as successful tool data or automatically replay an operation whose first execution outcome is unknown | Duplicate external/page side effects, misleading Agent state, wasted model rounds | Browser integrity, task state, approval intent, availability | Sidepanel uses typed `MCP_TRANSPORT_CLOSED` failures with bounded close metadata; only a known non-sensitive `safe_read` may reconnect and retry once with its run-scoped idempotency key; sensitive, mutating, open-world, and unknown calls stop without replay; unrecovered transport errors block the Agent and preserve progress instead of creating a tool result; approval uses a separate cancellable in-memory input wait with no active execution slot/grant and creates fresh bounded authorization only after late target validation (`src/sidepanel/services/mcpTransport.ts`, `src/sidepanel/services/mcpBridge.ts`, `src/sidepanel/services/toolRecovery.ts`, `src/sidepanel/App.tsx`, `src/sidepanel/services/autonomousAgent.ts`, `src/daemon/executionBroker.ts`, `src/mcp/wsServer.ts`) | Real disconnect-after-dispatch ambiguous-write evidence is pending; an input wait intentionally ends when its requester/run/socket or daemon disappears and does not survive restart | Add live safe-read reconnect-success and ambiguous-write no-replay tests; preserve fail-closed cancellation and late-context invalidation | Count transport close reasons, safe-read recovery attempts/outcomes, ambiguous effectful stops, and late-context invalidations without logging raw tool data | medium | high | medium |

### Resolved-target decision-barrier invariant

Selector strings are attacker- and model-controlled hints, not authorization
evidence. For selector-based trusted input, the content script projects the
browser-authoritative resolved target's native control type, accessible name,
labels, autocomplete and sensitive-field semantics. The background executor
checks that projection immediately before mutation. An ordinary task grant that
reaches a submit/reset/file control, commit-like element, password, OTP, token
or payment field fails with `DECISION_BARRIER_REQUIRED` before input dispatch.
The caller can request a new approval with `decisionBarrier=true`; the boolean
never authorizes execution by itself. Only a signed single-use grant with
`approvalRequired=true` satisfies the executor. Whole-form preflight performs
this check for every requested field before the first field changes.

## Criticality calibration

### Critical

A realistic page/model input can cause high-impact browser action or sensitive
data disclosure without an effective user decision.

- Page prompt injection causing unconfirmed browser actions.
- Cookie/token/network body exfiltration to a remote model.
- Cross-profile routing that mutates a different authenticated application.

### High

High-impact compromise requires a local connection condition, a specific tool,
or normal concurrency, but existing controls do not reliably contain it.

- Unauthenticated loopback role spoofing.
- Hidden DOM mutation by a read-classified tool.
- Multiple stdio tasks making the browser integration unavailable.

### Medium

Impact is bounded, noisy, recoverable, or requires user misconfiguration.

- Memory/context exhaustion with bounded local recovery.
- API key sent to user-configured non-HTTPS remote endpoint.
- Loss of non-durable cached state without browser data compromise.

### Low

Low-sensitivity disclosure or cosmetic/temporary behavior requiring unlikely
preconditions and having straightforward recovery.

- Disclosure of already-public page metadata.
- A rejected malformed message with no state change.
- Temporary UI status inconsistency without wrong execution.

## Focus paths for security review

| Path | Why it matters | Related Threat IDs |
| --- | --- | --- |
| `public/manifest.json` | Declares broad extension and host permissions | TM-001, TM-004, TM-005 |
| `src/mcp/wsServer.ts` | Network entrypoint, role handling, routing, pending results | TM-001, TM-003, TM-006 |
| `src/mcp/wsSchemas.ts` | Runtime boundary for untrusted WebSocket frames | TM-001, TM-006 |
| `src/mcp/protocolPolicy.ts` | Per-role inbound commands, hello timeout, violation window | TM-001, TM-006 |
| `src/mcp/browserStateHub.ts` | Session identity, retention, stale-state composition | TM-003, TM-004, TM-007 |
| `src/mcp/server.ts` | Couples stdio lifecycle to WebSocket daemon | TM-007 |
| `src/mcp/toolRuntime.ts` | Exposes privileged tools to MCP clients | TM-001, TM-003, TM-004 |
| `src/shared/wsProtocol.ts` | Shared protocol, state payloads, and current sanitization | TM-001, TM-003, TM-004, TM-006 |
| `src/shared/collaborationWorkspace.ts` | Cross-AI provenance, ownership, sensitivity, revision, and persistence bounds | TM-003, TM-004, TM-006, TM-010 |
| `src/shared/agentTaskState.ts` | Durable task phase, verification requirement, and blocker semantics | TM-002, TM-006, TM-010 |
| `src/shared/tools.ts` | Browser capability list, validation, side-effect metadata | TM-002, TM-005 |
| `src/shared/mcpTools.ts` | MCP exposure and AI tool schemas | TM-002, TM-004, TM-006 |
| `src/shared/sanitize.ts` | Regex redaction and URL handling | TM-004, TM-008 |
| `src/shared/sensitiveData.ts` | Structural credential-header and approval-argument redaction | TM-002, TM-004 |
| `src/shared/executionGrant.ts` | HMAC call/target binding, expiry, and replay defense | TM-002, TM-003 |
| `src/shared/reconnectBackoff.ts` | Bounded reconnect behavior under daemon failure | TM-006, TM-007 |
| `src/background/stateHubBridge.ts` | Executes daemon-originated browser calls | TM-001, TM-003 |
| `src/background/toolDispatcher.ts` | Privileged capability dispatch chokepoint | TM-002, TM-004, TM-005 |
| `src/background/chromeApi.ts` | Cookies, tabs, navigation, downloads, target selection | TM-003, TM-004, TM-005 |
| `src/background/debuggerAdapter.ts` | CDP, network bodies/headers, proxy rules, frame cleanup | TM-004, TM-005, TM-006 |
| `src/content/browserAutomation.ts` | Arbitrary evaluate, storage, synthetic input, hidden mutations | TM-002, TM-004, TM-005 |
| `src/content/domInspector.ts` and `src/shared/semanticSnapshot.ts` | Page-data capture, semantic pagination, full DOM, sanitization limits | TM-002, TM-004, TM-006 |
| `src/sidepanel/services/aiClient.ts` | Trust placement, remote endpoint, pseudo tool parsing | TM-002, TM-004, TM-008 |
| `src/sidepanel/services/aiEndpointPolicy.ts` | Remote HTTPS/loopback URL enforcement | TM-008 |
| `src/sidepanel/services/aiConfig.ts` | API-key migration, Profile-scoped credential storage, metadata stripping | TM-004, TM-008 |
| `src/sidepanel/services/approvalPresentation.ts` | Origin-only egress destination labels for Agent, search, and MCP approvals | TM-004, TM-008 |
| `src/sidepanel/components/AiSettingsDrawer.tsx` | Provider-origin and fast screenshot-egress confirmation before persistence | TM-004, TM-008 |
| `src/sidepanel/services/fastAgentVisualCheckpoints.ts` | Agent-activated visual-chain gating, capture cap, exact-image dedupe, and DOM-only fallback | TM-004, TM-006, TM-008 |
| `src/sidepanel/services/autonomousAgent.ts` | Tool loop, budget, cancellation, result reuse | TM-002, TM-006 |
| `src/sidepanel/App.tsx` | Approval policy, sensitive result flow, concurrency | TM-002, TM-004 |
| `src/sidepanel/services/mcpBridge.ts` | Sidepanel-to-daemon command and timeout path | TM-001, TM-003, TM-006 |
| `src/sidepanel/services/mcpTransport.ts` and `src/sidepanel/services/toolRecovery.ts` | Transport failure classification and the only allowed automatic replay boundary | TM-007, TM-012 |
| `src/mcp/collaborationTools.ts` | MCP publication schema and shared-state mutation surface | TM-003, TM-006, TM-010 |

## Quality check

- [x] Covered discovered runtime entry points: WebSocket, MCP stdio, sidepanel AI,
  content messages, Chrome APIs, AI endpoint, DOM/image payloads.
- [x] Covered every primary trust boundary in at least one threat.
- [x] Separated runtime behavior from build/dev/test behavior.
- [x] Reflected confirmed local single-user, multi-instance, and confirmation
  requirements.
- [x] Stated attacker capabilities and non-capabilities.
- [x] Anchored major claims to repository paths and symbols.
- [x] Kept bridge tokens, API keys, cookies, and other secrets out of the report.
