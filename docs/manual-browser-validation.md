# Manual Chrome validation

This checklist covers the browser-only evidence that Node unit/integration tests
cannot provide. Use a disposable page/Profile where possible. Do not paste the
bridge token into logs or chat.

## 1. Build and start the local components

```bash
npm run build
npm run daemon:dev
```

Before browser-specific checks, `npm run verify:packaged` can independently
recheck the compiled daemon and two concurrent stdio adapter lifecycles in an
isolated temporary data directory. It does not replace any Chrome/Profile row
in this document.

Load `dist/` from `chrome://extensions` with Developer mode enabled. Run
`npm run daemon:token`, paste the token into the extension's `本地 Bridge Token`
setting, and save it. Copy the displayed Profile Installation ID into the MCP
adapter's `AI_DEVTOOLS_SESSION_ID` environment and start `npm run mcp:dev`, or
start without that variable and select it with `browser_set_session`.

Expected:

- `npm run daemon:status` reports the daemon as reachable.
- The extension connects without exposing the token in its UI logs.
- The MCP adapter exposes `browser_list_tabs`, `browser_set_target_tab`,
  `browser_list_frames`, `browser_set_target_frame`, `browser_list_sessions`,
  and `browser_set_session`.

Optional extension-ID pinning check:

1. Copy the unpacked extension's ID from `chrome://extensions`.
2. Run `npm run daemon:allow-extension -- <extension-id>` and restart the daemon.
3. Confirm the paired extension reconnects. A different unpacked extension ID
   using the same token must receive `AUTH_INVALID` and remain disconnected.

## 2. Start the cross-origin frame fixture

Use two terminals:

```bash
cd tests/fixtures/frame-host
python3 -m http.server 8765 --bind 127.0.0.1
```

```bash
cd tests/fixtures/frame-child
python3 -m http.server 8766 --bind 127.0.0.1
```

Open `http://127.0.0.1:8765/`. The child uses
`http://localhost:8766/child.html`, so it has a different origin from the host.

## 3. Verify tab and frame routing

1. Call `browser_list_tabs`; select the fixture tab with
   `browser_set_target_tab` if it is not already selected.
2. Call `browser_list_frames`.
3. Confirm one top frame (`frameId: 0`) and one child frame are returned, each
   with its own URL and `documentId`.
4. With frame 0 selected, call `browser_snapshot` or query `#top-heading`.
   Expected text: `Top frame`.
5. Call `browser_set_target_frame` with the child frame's `frameId` and exact
   `documentId`, then query `#child-heading`.
   Expected text: `Child frame content`.
6. Reload the fixture page. Retry `browser_set_target_frame` with the old child
   `documentId` before using the new list result.
   Expected: a stale-document error; the old document must not be selected.
7. Call `browser_list_frames` again and select the new child document. The child
   query should work again.

Failure conditions:

- a child-frame announcement silently changes the selected frame;
- a DOM query returns top-frame data while the child is selected;
- an old `documentId` succeeds after reload;
- an unavailable frame silently falls back to frame 0.

### 3.1 Verify session/target resource templates

1. Call `browser_list_sessions`, then `browser_set_session` for Profile A.
2. List MCP resource templates. Confirm safe state templates start with
   `ai-devtools://session/{sessionId}/`; target state also includes
   `/target/{targetKey}/`. The old global `ai-devtools://active-tab` and similar
   URIs must not be advertised.
3. Call `resources/list`. Read the Profile A `active-tab` and `context-digest`
   URIs. Confirm `resourceBinding` contains Profile A's session ID, `scope:
   target`, and the URI's opaque `t1_` target key.
4. Reload or navigate the selected document, then retry the old URI. Expected:
   `STALE_CONTEXT`.
5. Select Profile B in a second Codex adapter. Try a Profile A resource URI from
   that adapter. Expected: `ROLE_FORBIDDEN`.
6. Start an adapter without `AI_DEVTOOLS_SESSION_ID` and do not call
   `browser_set_session`. Attempt a listed safe resource read. Expected:
   `RESOURCE_SESSION_UNBOUND`.

Failure conditions:

- a resource read follows the daemon's global active session;
- an old target key succeeds after document/navigation revision changes;
- resource names or URIs expose page URL/content;
- sensitive conversation, screenshot, Agent, cookie, storage, header, or body
  state appears as a direct resource.

### 3.2 Verify semantic snapshot pagination and freshness

1. Select frame 0 and call `browser_snapshot` with `limit: 2` and no cursor.
2. Confirm the result identifies the exact Profile session target and reports
   `freshness.source: live-browser`, `stale: false`, and a capture timestamp.
3. Confirm nodes include stable `ref` values (`s1`, `s2`, ...), semantic role,
   accessible name where available, selector, viewport bounds, and applicable
   state fields such as `disabled`, `checked`, `pressed`, `expanded`,
   `selected`, `required`, `readOnly`, and `focused`. Input and password field
   values must not appear; submit/button labels may use their native button
   value.
4. If `nextCursor` is present, call `browser_snapshot` with that cursor and the
   same limit. Confirm refs continue rather than restarting and no node repeats.
5. Keep the cursor, then change the fixture's semantic structure or reload the
   document. Retry with the old cursor. Expected: `STALE_SNAPSHOT_CURSOR`; the
   tool must not combine old and new nodes.
6. Select the child frame and repeat once. Expected: the target/freshness data
   belongs to the child document and its nodes contain child-frame content only.
7. Confirm the result target includes the selected tab/frame/document and a
   navigation revision. Switch back to frame 0 while a snapshot is in flight;
   an old-frame completion must return `STALE_CONTEXT` or be ignored, never
   relabel child content as frame 0.

Failure conditions:

- a snapshot comes from another Profile or the globally active browser session;
- an old cursor succeeds after semantic structure changes;
- pagination repeats refs or silently skips to a different document;
- ordinary text/password input values appear in semantic node names.

### 3.3 Verify Network, conversation, and audit pagination

1. Start Network recording, load enough fixture requests for at least two pages,
   then stop recording. Call `browser_network_requests` with `limit: 2`,
   follow `nextCursor`, and confirm no request repeats. Start recording and
   produce a new request before reusing that cursor. Expected:
   `STALE_PAGINATION_CURSOR`.
2. Create at least three sidepanel chat messages. Approve
   `browser_get_plugin_conversation` with `limit: 1`, append another message,
   then follow the returned cursor. Expected: the remaining messages from the
   original three-message snapshot only. Start a new conversation and retry the
   old cursor. Expected: `STALE_PAGINATION_CURSOR`.
3. Approve `browser_get_audit_events` with `limit: 1`. Confirm every row has the
   adapter-selected Profile `sessionId` and contains only redacted metadata such
   as IDs, tool/policy names, revision, outcome, timestamp, and argument hash.
   Follow `nextCursor`; approvals generated by the audit reads must not prevent
   reaching page two.
4. Open a second Chrome Profile/session and generate a tool event there. From
   the first adapter selection, query audit events again. Expected: no row from
   the second Profile. Switch with `browser_set_session`, approve again, and
   confirm only the second Profile's rows appear.

Failure conditions:

- a cursor silently mixes two snapshots or filters;
- raw arguments, results, cookies, tokens, page content, or another Profile's
  audit rows appear;
- an audit query's own approval events make its next cursor unusable.

### 3.4 Verify sidepanel page read and element picker

1. Open the extension sidepanel on the top-frame fixture. Confirm its page
   summary/title belongs to `127.0.0.1:8765`, not another active window/Profile.
2. Start element picking from the sidepanel, hover `#trusted-button`, then select
   it. Expected: the page overlay follows the intended element and the
   sidepanel inspector reports that selector/tag/text from the exact fixture
   tab and current document.
3. Start picking again and cancel it. Expected: all picker overlays/listeners
   disappear and the prior selected-element result is not replaced.
4. Start picking, then switch or close the fixture tab before selection.
   Expected: the picker cancels or returns a stale/unavailable-target error; it
   must not select an element from the newly active tab.

Failure conditions:

- sidepanel page data follows another window/Profile;
- picker overlay remains after cancel/navigation/tab close;
- a stale picker completion is relabeled as the new active tab;
- picking itself triggers the selected element's business click action.

### 3.5 Verify sidepanel tool-result completeness and scrolling

1. In sidepanel Chat, run a read-only task that calls `browser_snapshot` and
   produces more than 8,000 serialized characters. This ordinary bounded read
   does not require an approval card.
2. Confirm the collapsed row says `完整` and reports a count above `8k chars`.
   It must not report only `8k chars` because of a display-side slice.
3. Expand the row. Confirm the toolbar repeats `完整结果`, the viewport scrolls
   vertically and horizontally, and `复制` returns the full loaded result.
4. For a result above 240 lines, scroll to the middle and bottom. Expected: the
   visible lines update without rendering the entire line set at once.
5. For a synthetic or naturally generated result above 256,000 characters,
   confirm the collapsed row says `已截断`, the expanded toolbar shows
   displayed/original counts, and the warning recommends pagination or cursor.
   A source payload's own `truncated` flag must be labeled separately as
   `数据源已截断` or `数据源完整`.

Failure conditions:

- a result between 8,001 and 256,000 characters is silently shortened;
- an expanded partial result is labeled complete;
- expanding a large result freezes the sidepanel or removes access to copy;
- UI truncation and source-level pagination are shown as the same state.

## 4. Verify trusted coordinate input and approval

Chrome validates every frame in a tab before allowing `chrome.debugger.attach`.
If an enabled extension injects a `chrome-extension://` iframe from a different
extension into the fixture, trusted CDP input is unavailable for that tab. The
tool must fail closed and identify the injected-extension-frame restriction.
Disable that injector for the disposable fixture (or use a clean Chrome
Profile), refresh, and create a new approval bound to the new document; never
fall back to synthetic DOM events.

1. Select frame 0 again.
2. Call `browser_mouse_click_xy` at approximately `x=114, y=99` (the center of
   the fixed-size `Trusted click target` button).
3. Deny the first approval request. Expected: the output remains `not clicked`.
4. Repeat and approve once. Expected: the output changes to `trusted`.
5. Retry the same mutation without a new approval. Expected: it pauses for a new
   one-time approval; the previous grant cannot be reused.
6. Call `browser_click` with selector `#trusted-button`, approve it, and confirm
   the result contains `inputMode: cdp` plus the resolved center coordinates.
   Click `Toggle target cover` in the fixture and retry. Expected:
   `TRUSTED_INPUT_TARGET_OCCLUDED`, with no click reaching the covered element.
7. On Chrome 125 or newer, select the cross-origin child frame and call
   `browser_click` with selector `#child-button`. Expected: the result reports
   `inputMode: cdp` and the child fixture reports `trusted`; the top-frame
   `#trusted-result` remains unchanged. A same-process child, duplicate sibling
   URL, stale `documentId`, or unavailable flat session must instead return
   `TRUSTED_INPUT_FRAME_UNSUPPORTED` or `STALE_CONTEXT` without sending input to
   frame 0. Select frame 0 again before continuing.
8. For an embedded Agent request, confirm the approval card shows the exact AI
   Provider origin without path, query, or API key. For a Codex/MCP request, it
   must say that downstream egress is managed by the MCP client instead of
   displaying the extension's Provider.
9. Confirm the execution approval strip is always visible and defaults to
   `请求批准`. Trigger an eligible page action, switch to `替我审批` while its card
   is waiting, and confirm the pending ordinary operation continues. A later
   same-origin `task_grant` request from either embedded AI or MCP must not show a
   card, while `decision_barrier` and `always` requests must still stop.
   Open the card's `操作参数`: the JSON viewport must have a usable height,
   support keyboard focus and independent scrolling, and disappear completely
   after `收起`. The approval strip itself is one full-width trigger with no
   nested secondary button.
10. Switch to `完全访问权限` and approve the explicit mode choice. Trigger one
    ordinary operation and one decision-barrier operation on the same origin.
    Neither should show a per-tool card; daemon audit must still record separate
    approvals and each executor dispatch must receive a fresh single-use grant.
11. Switch back to `请求批准`, then change saved chat, page origin, Chrome Profile,
    Provider, and Hub connection in separate runs. Expected: every change resets
    an automatic mode to `请求批准`. A path-only navigation stays in scope; an
    unbound target or non-HTTP(S) page can never enable an automatic mode.
12. In AI settings, set `单段工具轮数` to `1` and keep `自动压缩并续跑` on.
    Run a task that needs at least two distinct read-only tool rounds. Expected:
    the Agent reports that it is entering another execution segment, performs
    the second tool call without asking you to send `继续`, and still obeys the
    one-run safety budgets. Turn automatic continuation off and repeat;
    expected: exactly one tool batch followed by a tools-off stage summary.
13. With automatic continuation on, make the model request the same read-only
    tool with the same arguments against unchanged state at least three times.
    Expected: the first two calls may execute for comparison, but the third is
    blocked before execution with a visible no-progress notice and a tools-off
    summary. Capture timestamps alone must not count as semantic progress.

Coordinate and selector click paths must produce browser-trusted CDP input in
frame 0. The selector case above separately proves that a uniquely mapped OOPIF
uses its own flat child session rather than top-frame coordinates.

### 4.1 Verify one-dialog CDP handling

1. Click `Open confirm` in the fixture. While the confirm is open, call
   `browser_handle_dialog` with `action: dismiss` and approve once. Expected:
   the dialog closes, the tool returns `handled: true`, and the fixture reports
   `confirm dismissed`.
2. Click `Open prompt`. Call the tool with `action: accept` and
   `promptText: approved value`. Expected: `prompt accepted: approved value`.
3. Call the same tool again when no dialog is open. Expected:
   `NO_JAVASCRIPT_DIALOG`; it must not configure a future dialog.
4. Open a new confirm manually. Expected: it remains a native blocking dialog
   until another separately approved tool call handles it. Confirm that page
   functions are unchanged in DevTools:
   `window.confirm.toString()` must still contain `[native code]`.

Failure conditions:

- a call changes how later dialogs behave;
- the page contains `__AI_DEVTOOLS_DIALOG_HANDLER__` or replaced global dialog
  functions;
- a deny response closes the dialog or a prior approval handles another dialog.

### 4.2 Verify trusted typing and key presses

1. Call `browser_type` with selector `#trusted-text`, text `new value`, and
   `replace: true`; approve once. Expected: the tool returns `inputMode: cdp`
   and the fixture reports `trusted input: new value`.
2. Repeat with a short Unicode value and `slowly: true`. Expected: each inserted
   character updates the native input path. A slowly typed value over 500
   Unicode characters must fail schema validation before approval.
3. Focus `#trusted-text`, then call `browser_press_key` with `key: Enter` and no
   selector. Expected: `trusted submit: <current value>`.
4. Call `browser_press_key` with selector `#trusted-text` and `key: ArrowLeft`.
   Expected: the result reports `inputMode: cdp`; it must not click or submit the
   form while focusing the input.
5. Try `key: Control+A`. Expected: schema rejection. Key combinations are not
   parsed from strings; replacement uses its own bounded CDP selection command.
6. Try `browser_type` against a button, checkbox, disabled input, or readonly
   input. Expected: `TRUSTED_INPUT_NOT_EDITABLE`, with no text inserted and no
   click/business action.
7. On Chrome 125 or newer, select the cross-origin child frame and call
   `browser_type` for `#child-input` with `replace: true`. Expected: the result
   reports `inputMode: cdp` and the child fixture reports
   `trusted input: <value>`. If the frame cannot be uniquely mapped, expect
   `TRUSTED_INPUT_FRAME_UNSUPPORTED`; no input may reach the top frame.

Failure conditions:

- the fixture reports `synthetic input` or `synthetic submit`;
- focusing a selector triggers a click/business action;
- navigation during target focus allows text to reach the new document;
- non-editable targets report success;
- unsupported combinations or oversized slow text reach approval/execution.

### 4.3 Verify batch form preflight and scoped select behavior

Use the `Trusted form fixture` in the top frame.

1. Call `browser_fill_form` with two fields: first set `#form-name` to
   `must-not-apply`, then target `#missing-field`. Approve once. Expected: the
   tool fails during preflight and `#form-name` remains `old name`; no form event
   is recorded.
2. Call `browser_fill_form` with these fields and approve once:
   - `#form-name`, `type: text`, `value: approved name`
   - `#form-agree`, `type: checkbox`, `value: true`
   - `#form-choice-b`, `type: radio`, `value: true`
   - `#form-country`, `type: select`, `value: us`
   - `#form-tags`, `type: select`, `value: [alpha, gamma]`
3. Expected result: `filled: true`; text/checkbox/radio fields report
   `inputMode: cdp`; select fields report `inputMode: dom`. The returned fields
   must not contain any submitted `value` property.
4. Inspect `#form-event-log`. Text, checkbox, and radio input/change events must
   be `trusted`. Select input/change events are deliberately `synthetic`; CDP has
   no deterministic cross-platform select-by-value primitive.
5. Call `browser_select_option` for `#form-ambiguous` with
   `values: ["Same label"]`. Expected: `SELECT_OPTION_AMBIGUOUS` before any
   option changes. Calling it with the unique value `second` succeeds and reports
   `inputMode: dom`.
6. Try to set `#form-choice-b` to `false` after it is selected. Expected:
   `TRUSTED_RADIO_UNCHECK_UNSUPPORTED`; choose another radio instead. Try to fill
   `#form-readonly`; expected `TRUSTED_INPUT_NOT_EDITABLE`.
7. On Chrome 125 or newer, select the cross-origin child frame and call
   `browser_fill_form` for its `#child-input`. Expected: the field reports
   `inputMode: cdp` and `#child-input-result` reports trusted input. If the frame
   cannot be uniquely mapped, expect `TRUSTED_INPUT_FRAME_UNSUPPORTED`; no
   top-frame field may be modified.

Failure conditions:

- a deterministic preflight error changes an earlier field;
- missing/ambiguous/disabled options clear or alter the current selection;
- checkbox/radio events are synthetic, or select events are represented as CDP;
- a form result echoes submitted field values;
- execution continues after a stale element or post-preflight failure.

### 4.4 Verify stale approval, Stop, and unavailable UI

1. Request `browser_click` for `#trusted-button` but leave its approval pending.
   Reload the fixture before approving the old card, then approve it. Expected:
   `STALE_CONTEXT`; the reloaded page remains `not clicked`, and a new request
   requires a new approval.
2. In the embedded Agent with tools enabled, explicitly ask it to call
   `browser_wait_for` for text `manual-never-appears` with `timeoutMs: 60000`.
   As soon as the tool is active, click Sidepanel **Stop**. Expected: the run
   reaches a visible terminal `cancelled` state, the active browser request is
   cancelled, and no success appears after the original timeout.
3. Start an embedded-Agent click request and click **Stop** while the approval
   card is still pending. Expected: the card disappears or becomes terminally
   denied; it cannot later approve or execute that cancelled request.
4. Close every sidepanel for Profile A, then request `browser_click` from its
   MCP adapter. Expected: an actionable approval-UI-unavailable denial and no
   page change. Reopen the sidepanel before continuing.

Failure conditions:

- approving a pre-navigation card changes the new document;
- Stop only changes chat text while a browser operation later succeeds;
- a cancelled approval can still be accepted or reused;
- the daemon auto-approves when the owning Profile has no approval UI.

### 4.5 Verify sensitive values, redaction, and egress destination

Use only the fixed disposable markers supplied by the fixture. Start Network
recording and approve that reversible instrumentation action, then click
`Seed disposable markers`; wait for
`disposable markers seeded`.

1. Call `browser_storage_state` without `includeValues`. Expected: the storage
   keys may appear, but `manual-local-value`, `manual-session-value`, and
   `manual-cookie-value` do not. No raw value may be silently included.
2. Repeat with `includeValues: true`. Deny the first approval; expected: no
   values are returned. Repeat and approve. The card must identify MCP-managed
   downstream egress, and only then may the disposable values reach that MCP
   caller.
3. Repeat the same omit/deny/approve sequence with `browser_cookie_list` and
   `includeValues`. Then call `browser_cookie_set` for
   `manual_mutation_cookie=manual-mutation-value` and `browser_cookie_delete`
   for that name. Each mutation must pause for its own confirmation.
4. Stop Network recording and locate `sensitive-fixture.json` with
   `browser_network_requests`. Request metadata/details as supported.
   Expected: `Authorization` is redacted and the `access_token` query value is
   redacted in returned/audited URLs; neither marker appears in audit rows.
5. Deny the first `browser_network_get_response_body` request, then repeat and
   approve. Only the approved result may contain
   `manual-response-body-marker`; persisted audit/state must contain only
   redacted metadata and egress class/byte/destination fields.
6. Click `Clear disposable markers`. Verify the storage and cookie marker keys
   are gone before using the Profile for other work.

Failure conditions:

- any value appears when `includeValues` is omitted or false;
- denial returns a partial/raw value;
- a credential header or sensitive query value appears unredacted;
- raw markers appear in daemon state or audit history;
- cookie set/delete executes without a separate approval.

### 4.6 Verify screenshot artifact rendering

1. Call `browser_take_screenshot` for the fixture. Deny the first approval;
   expected: no image or artifact is created for that request.
2. Repeat and approve. Expected: Codex receives MCP image content that visibly
   renders this fixture, plus a bounded `ai-devtools://artifact/art_...`
   reference with MIME type, byte length, hash, creation, and expiry metadata.
   Base64 image bytes must not appear inside JSON text or audit rows.
3. With the same explicitly selected Profile, read the artifact resource and
   confirm it renders the same image. From another Profile-bound adapter, try
   the URI; expected: not found/forbidden rather than cross-Profile bytes.
4. Confirm the artifact index/object files are user-only and that automated
   `ArtifactStore` retention/TTL tests remain green. The production TTL is 24
   hours, so this manual check records `expiresAt` rather than waiting a day.

Failure conditions:

- denial creates or returns screenshot bytes;
- JSON/audit/state contains base64 screenshot data;
- another Profile can read the artifact;
- the returned artifact lacks bounded metadata or expiry.

### 4.7 Verify Network-rule mutation confirmation and cleanup

The extension intentionally exposes no Storage write tool. Storage is read-only
and value-gated; adding a future write tool requires a new destructive policy,
approval, execution grant, and regression coverage. This section validates the
currently exposed DNR mutation boundary.

1. Call `browser_list_network_rules` and record only the existing rule IDs so
   the disposable rule can be distinguished. Do not alter unrelated rules.
2. Call `browser_upsert_header_rule` with no `ruleId`,
   `urlFilter: "||127.0.0.1:8765/"`, and one request header operation that sets
   `X-AI-DevTools-Manual` to `manual-rule-marker`. Deny the first request.
   Expected: no new rule appears.
3. Repeat and approve once. Expected: one new rule and its allocated numeric ID
   are returned. Retrying the call must require another approval; a prior grant
   cannot authorize a replacement.
4. Call `browser_remove_network_rule` with the disposable ID. Deny first and
   confirm the rule remains; repeat, approve, and confirm it is removed.
5. If any step fails after creation, remove that exact disposable rule through
   the extension before ending the test. Never clear or overwrite unrelated
   rules as cleanup.

Failure conditions:

- upsert or removal occurs before/after denial;
- an approval/grant is reused for a later rule change;
- the preview omits the rule scope or header operation shape;
- cleanup modifies an unrelated pre-existing rule.

## 5. Verify AI credential storage and Provider confirmation

Use a disposable marker such as `manual-test-key-not-secret`, never a real API
key.

1. Save a profile using `http://localhost:11434/v1` and the marker key.
2. Inspect the sidepanel's localStorage entry
   `ai-devtools-assistant.ai-profiles-v1`. Expected: the marker is absent and
   `config.apiKey` is empty.
3. Inspect the extension's `chrome.storage.local`. Expected: the marker exists
   only under `aiDevtools.aiCredentialsV1` for the active profile ID.
4. Reload the extension and reopen settings. Expected: the key field is restored.
5. Change the URL to `http://localhost:1234/v1` and click save. Expected: a
   confirmation shows the old and new origins before any capability probe.
6. Cancel. Expected: the drawer remains open and the original Provider remains
   persisted. Confirming is allowed only when the new local test Provider is
   intentionally running.

Failure conditions:

- the marker remains anywhere in localStorage;
- copying a profile copies its API key;
- a scheme, host, or port change sends a probe before confirmation;
- cancelling the confirmation saves the new origin.

### 5.1 Verify adaptive fast-mode visual checkpoints

Use a disposable page with one client-side route change, one drawer or modal,
and controls whose final state can be read without copying sensitive content.

1. Enable fast Agent mode for a vision-capable test Provider and confirm its
   displayed origin. Start a new task. Expected: the first request contains one
   current-viewport image and bounded semantic page context.
2. Ask the Agent to open the drawer and then continue through the client-side
   route. Expected: after each successful visual stage, the status reports a
   DOM/visual refresh and the next model decision receives the new viewport,
   not the initial or previous screenshot.
3. On an unchanged stage, make the Agent need two DOM/snapshot observations.
   Expected: the second observation produces one coalesced checkpoint. A pure
   `browser_wait_for({time: ...})` does not create one.
4. Trigger a denied page mutation. Expected: denial does not capture a new
   image. Trigger a possibly partial visual failure. Expected: stale visual
   evidence is invalidated and the Agent refreshes current evidence before
   re-planning.
5. Confirm the final task state through a read-only DOM observation. Inspect
   only sanitized Provider request metadata if available; do not record image
   bytes or page content in this worksheet.

Failure conditions:

- an old screenshot remains after route, drawer, or modal state changes;
- one tool batch creates multiple automatic screenshots;
- a byte-identical viewport is sent as another checkpoint;
- a denied tool captures a new image;
- checkpoint refresh bypasses approval, target freshness, fail-fast, or the
  required read-only verification after mutation.

### 5.2 Verify Network action evidence and heartbeat collapse

Use a disposable page whose save/update action sends one known POST, PUT, or
PATCH request and whose background code also sends the same GET heartbeat at
least three times.

1. Ask the Agent to perform and verify the save/update task. Expected: before
   the relevant action it requests Network recording through the normal
   approval path; denial leaves the task on DOM/route evidence only.
2. Approve recording and the sensitive Network read. Expected: after the action
   barrier, `browser_network_requests({digestOnly: true})` returns an empty raw
   request array plus `activityDigest`; the business mutation or
   navigation/failure group is ahead of heartbeat traffic.
3. Confirm the heartbeat appears as one `heartbeatLike: true` group with a
   count, not many model-visible entries. Confirm digest URLs contain only
   origin/path and no query or fragment.
4. Confirm no request/response body, header, post data, Cookie, or Authorization
   value appears in the digest or worksheet.
5. With Network recording attached to tab A, select tab B and call
   `browser_debug_activity`. Expected: `STALE_CONTEXT` identifies the mismatched
   source tab. It must never return Network evidence from A beside Console
   evidence from B.

Failure conditions:

- recording or Network reads bypass approval;
- a heartbeat is treated as proof that the user action succeeded;
- query/fragment, headers, post data, or bodies appear in `activityDigest`;
- repeated heartbeat rows crowd out the action request;
- the Agent polls Network continuously instead of reading at decision barriers.
- `browser_debug_activity` merges evidence from different tabs or silently
  relabels an old recorder as the selected target.

### 5.3 Verify recoverable Agent budget checkpoints

Use a disposable task/build with a temporarily lowered test limit so the
boundary can be reached without 50 real page mutations. Do not lower production
defaults in a release build.

1. Reach the effectful-call boundary. Expected: the current task remains busy
   and a visible card offers “增加额度并继续” and “停止并总结”. Leave it untouched
   for at least one minute; it must not disappear or finalize the task.
2. Choose continue. Expected: only the exhausted limit increases, the pending
   not-yet-executed step resumes in the same task context, and its own page
   approval still appears when required.
3. Repeat and choose stop. Expected: no blocked mutation executes; the Agent
   generates a tools-off summary from current results and finalizes as blocked,
   not completed.

## 6. Protocol negotiation and reconnect

1. With the extension connected, stop the daemon.
2. Keep the sidepanel open for at least 10 seconds, then restart the daemon.
3. Expected: connection attempts spread out with capped exponential backoff,
   the extension reconnects after a valid version-3 welcome, and queued reads
   resume without duplicate mutation execution.
   Leave the connected sidepanel idle for more than 90 seconds first; its
   15-second heartbeats should keep the connection alive without reconnecting.
4. If testing a deliberately old build, expected: the daemon rejects its hello
   with `PROTOCOL_VERSION_UNSUPPORTED` instead of accepting a partial session.

## 7. Profile isolation

Repeat setup in a second Chrome Profile. Confirm each Profile shows a different
Installation ID. Start two MCP adapters. Bind the first with
`AI_DEVTOOLS_SESSION_ID`; on the second call `browser_list_sessions`, confirm
both IDs are present, and call `browser_set_session` for the other Profile.
Select a different fixture/tab in each Profile.

Expected:

- each adapter's tab/frame list comes only from its bound Profile;
- switching the second adapter does not change the first adapter's Profile;
- an unknown `sessionId` is rejected and recommends `browser_list_sessions`;
- closing one adapter does not stop the daemon or disconnect the other Profile;
- approvals appear only in the Profile that owns the selected target.

Record Chrome version, extension build time, pass/fail for each section, and any
sanitized console/service-worker errors in `docs/browser-validation-results.md`.
Do not record tokens, cookies, storage values, raw headers, response bodies, or
the disposable marker values themselves.

Run `npm run verify:browser-evidence` after each editing pass. When every row is
actually complete, run `npm run verify:browser-evidence:complete`; exit code 0
is required before this manual evidence can close the goal. Its sensitive-text
checks cover known fixture markers and common credential shapes only; they do
not make arbitrary notes safe to paste.
