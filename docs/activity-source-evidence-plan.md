# Activity, Source Mapping, and Evidence Integration Plan

Status: complete; automated validation and real Chrome integration gate passed  
Scope: local single-user Chrome extension, local daemon, and Codex MCP adapter

## 1. Outcomes

This work adds five connected capabilities:

1. Subscription-based incremental page, Network, and Console activity.
2. DOM element to React/Vue component and source-map location.
3. One-call issue evidence capture with actions, DOM delta, requests, errors,
   and screenshot comparison.
4. Bounded causal links from Network initiators to actions, elements,
   components, and source locations.
5. A real Chrome regression for same-process iframes using
   `frameRef + documentId + targetRef`.

The implementation reuses the existing exact-target binding, approval,
artifact, workflow, and WebSocket identity boundaries. It does not add a
second browser executor.

## 2. Non-goals

- No arbitrary JavaScript evaluation supplied by an MCP caller.
- No claim that temporal correlation proves causality.
- No automatic upload or external transmission of evidence bundles.
- No unbounded persistence of DOM, Network, Console, source, or screenshots.
- No automatic debugger attachment merely because an MCP client listed or
  subscribed to a resource.
- No production dependency solely for source-map decoding.

## 3. Data flow

```text
page mutation / CDP Network / CDP Console
                 |
                 v
Chrome extension executor
  - batches DOM mutation metadata
  - bounds and sanitizes CDP events
  - preserves exact target provenance
                 |
                 | BROWSER_ACTIVITY_EVENT
                 v
local daemon BrowserStateHub
  - per-session monotonic sequence
  - bounded event ring
  - no persistent raw activity history
                 |
                 | BROWSER_ACTIVITY_UPDATED
                 v
Codex stdio adapter
  - MCP resources/subscribe
  - notifications/resources/updated
                 |
                 v
ai-devtools://session/{sessionId}/activity-stream
```

Activity monitoring is explicit. `browser_activity_start` enables the
selected target's DOM mutation monitor and requested CDP domains.
`browser_activity_stop` disables the monitor and releases only the domains
owned by that activity session.

## 4. Activity event contract

Each event contains:

- `sequence`: monotonically increasing within the browser Profile session.
- `kind`: `dom`, `network`, `console`, or `navigation`.
- `observedAt`: ISO timestamp.
- `target`: exact tab/frame/document/navigation provenance when available.
- `summary`: bounded, sanitized kind-specific metadata.

The daemon keeps at most 200 events per session. DOM events contain mutation
counts and revision metadata, not DOM text. Network URLs omit fragments and
redact query values. Console text is redacted and length bounded.

The activity stream resource is session-scoped so its URI remains stable
while page revisions and document IDs change. A resource read returns the
current target, monitoring state, latest sequence, retained range, dropped
count, and retained events.

## 5. MCP subscription behavior

The stdio adapter advertises `resources.subscribe`.

- `resources/subscribe` accepts only the stable activity-stream URI for the
  adapter's selected session.
- The daemon sends unsolicited `BROWSER_ACTIVITY_UPDATED` messages only to
  MCP sockets bound to that session.
- The adapter sends `notifications/resources/updated` only for URIs the MCP
  client explicitly subscribed to.
- Unsubscribe and adapter disconnect remove local subscriptions.
- Reconnect does not replay browser writes. The next resource read returns
  the retained event window and sequence range.

## 6. DOM to framework and source mapping

`browser_locate_source` accepts exact target metadata and either a
`targetRef` or selector.

The extension runs a fixed, build-owned function in the page's MAIN world:

- React: inspect element-owned Fiber keys, walk bounded owners, and collect
  component names plus development `_debugSource` hints.
- Vue: inspect `__vueParentComponent`/`__vue__`, walk bounded parents, and
  collect component names plus `__file` hints.

No caller-supplied code is evaluated. Results are bounded and treated as
sensitive page data.

When a generated URL/line/column is available, the debugger adapter records
loaded script and `sourceMapURL` metadata. A bounded Source Map v3 resolver:

- supports flat maps and embedded indexed-map sections;
- caps downloaded/decoded bytes and mapping count;
- reads through a bounded selected-target CDP resource stream;
- does not send page credentials;
- rejects indexed sections that require another external map fetch;
- returns original source URL, line, column, and name;
- returns source excerpts only when explicitly requested and available in
  `sourcesContent`.

## 7. Network causal links

Network records add:

- request wall-clock start time;
- bounded initiator type and call frames;
- optional resolved original source location;
- optional workflow action and element/component correlation.

Correlation confidence is explicit:

- `stack`: the initiator stack maps to a component/source associated with the
  action target;
- `action-window`: request wall time falls within the action window plus a
  bounded grace period;
- `navigation`: request belongs to a navigation triggered in the action
  window.

The result is a ranked diagnostic link, not a proof statement.

## 8. Issue evidence bundle

`browser_capture_issue_evidence` performs:

1. exact-target observation;
2. before screenshot capture;
3. optional bounded workflow actions;
4. after observation and screenshot;
5. DOM/URL/Network/Console evidence collection;
6. screenshot comparison;
7. causal-link generation;
8. JSON manifest storage in the daemon artifact store.

The returned MCP payload is a compact summary plus artifact URIs. Raw image
bytes never appear inside the JSON manifest. Existing artifact quotas,
session binding, TTL, and approval rules apply.

The manifest includes:

- runtime `buildId`, `schemaHash`, and protocol version;
- exact target provenance;
- action timings and post-action state;
- DOM delta and verification values;
- Network summaries and causal links;
- Console errors;
- before/after image artifact references and screenshot-diff metrics;
- capture warnings and truncation markers.

## 9. Trust and retention boundaries

- Activity start/stop is a reversible browser-side effect and follows the
  existing approval mode.
- Source/component inspection, raw Network/Console, screenshots, and evidence
  bundles are sensitive reads.
- Cross-origin source-map fetches are not automatic. Only source maps
  referenced by scripts already loaded in the selected target are eligible,
  with no credentials.
- Activity events are kept in memory only. Evidence manifests and screenshots
  use the existing bounded artifact store.
- Navigation/document changes invalidate exact element references.
- Unknown write outcomes are never replayed.

## 10. Implementation sequence

1. Extend WebSocket protocol, daemon activity state, unsolicited update
   routing, and MCP resource subscription support.
2. Add content mutation batching and debugger Network/Console/navigation
   activity emission.
3. Add fixed MAIN-world React/Vue inspection and bounded source-map resolver.
4. Extend workflow action timing and Network initiator records; add causal
   correlation.
5. Add evidence-bundle runtime and artifact manifest output.
6. Add unit/integration tests, typecheck, build, and protocol identity tests.
7. Run a real Chrome same-process iframe regression and record the observed
   target, frame, action, value, event, and coordinate evidence.

## 11. Validation record

On 2026-07-27:

- targeted MCP registry and Smart Profile evaluation: 26 passed, 0 failed;
- full test suite: 338 passed, 0 failed;
- Smart MCP evaluation: 18 passed, 0 failed;
- `npm run typecheck`: passed;
- `npm run build`: passed;
- `git diff --check`: passed;
- packaged daemon advertised 79 MCP tools after service reinstall;
- the real Chrome gate reported matching adapter/daemon/browser identity
  (`0.1.0+ws8`, schema `3fd82d5a`);
- one observation returned two actionable child frames;
- the bounded workflow completed four actions and four post-state reads, passed
  deterministic verification, and returned DOM/URL/Network/Console evidence;
- direct cross-process and same-process frame operations both used
  `frameRef + documentId`, producing verified values `direct-frame-value` and
  `same-process-after`;
- the subscribed activity resource delivered `console`, `dom`, `navigation`,
  and `network` events without polling;
- the fixture request received a high-confidence initiator/action link because
  it started inside the bounded post-action window and CDP supplied a stack;
- source lookup matched the plain-HTML fixture and correctly reported
  `framework: unknown` rather than inventing React/Vue metadata;
- issue evidence returned a session artifact URI with separate screenshots and
  no inline image data in the JSON manifest.

## 12. Acceptance criteria

- A subscribed client receives resource-updated notifications without polling,
  and an unsubscribed client receives none.
- DOM mutation storms are batched and bounded.
- Heartbeat requests do not create unbounded activity.
- Source location returns a supported React/Vue chain or an explicit
  `framework-not-detected`/`source-map-unavailable` reason.
- Evidence capture returns a readable artifact manifest and separate image
  artifacts without embedded data URLs.
- Network causal links always include a confidence reason.
- Exact document changes fail stale target references closed.
- The same-process iframe real Chrome test fills inside the frame using
  `frameRef + documentId + targetRef` and verifies the resulting value and
  trusted input event.
