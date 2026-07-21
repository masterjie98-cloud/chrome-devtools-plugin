# Smart MCP kernel

## Goal

The default MCP surface is optimized for an AI that needs to complete browser
tasks with fewer model-visible schemas and fewer model round trips, while the
existing expert tools remain available for specialized debugging.

The preferred task protocol is:

1. `browser_status` — confirm the local daemon, Chrome Profile, target, and page
   sync state.
2. `browser_observe` — take one fresh bounded semantic observation. This does not
   capture a screenshot automatically.
3. `browser_act` — execute one bounded current-page action stage. Independent
   form controls are batched; ordered actions remain explicit dependencies or
   barriers.
4. `browser_verify` — evaluate URL, title, visible text, and semantic target
   expectations from one fresh page read.
5. `browser_debug_activity` — when approved, read a compact Network digest and
   sanitized console messages without raw response bodies. Both child reads are
   bound to the adapter-selected tab; mixed-tab or changed-target evidence is
   rejected with a freshness error.

Use `browser_take_screenshot` only when geometry, occlusion, rendering, or visual
acceptance cannot be established from semantic page evidence. MCP screenshots
return image content and an Artifact only; they never write Chrome Downloads.

Expert DOM inspection can batch up to 12 independent `browser_query_dom`
requests in one model tool round. Use `computedStyleProperties` to request the
exact bounded layout, typography, color, or decoration fields required by the
task instead of repeating an unchanged query. The cross-round no-progress guard
continues to stop genuinely identical query-and-result loops.

## Actionable target references

Each semantic node contains:

- `ref`: page-local pagination label such as `s1`
- `targetRef`: opaque actionable reference such as
  `sr1_1234abcd_s1`
- `selector`: compatibility fallback for expert workflows

Prefer `targetRef` in `browser_act` and primitive action tools. Before executing
it, the daemon:

1. checks the selected Profile/tab/frame/document/navigation binding;
2. takes a bounded live semantic read using the original observation settings;
3. rejects the reference if the semantic fingerprint changed;
4. resolves the stored selector only after those checks;
5. sends the resolved action through the existing approval and signed
   execution-grant path.

References never grant permission and never authorize a different page.

## Tool profiles

`AI_DEVTOOLS_MCP_TOOL_PROFILE` supports:

- `smart` (default): 10 task-oriented browser tools
- `inspect`: safe read-only expert tools
- `read`: safe and approval-gated sensitive read tools
- `full`: every expert tool

The adapter profile affects only what the model sees. Daemon policy,
sidepanel approval, target freshness, execution grants, and audit behavior are
unchanged.

Generate Codex, Claude Desktop, and Cursor configuration from the current local
Node.js and repository paths:

```bash
npm run client:config
```

Install the compiled daemon as a macOS user LaunchAgent:

```bash
npm run build
npm run daemon:install-service
npm run daemon:status
```

Preview the exact LaunchAgent without changing the machine:

```bash
npm run daemon:service-plan
```

## Evaluation

Run the deterministic 10-case kernel evaluation:

```bash
npm run evaluate:smart-mcp
```

It covers tool-surface size, status, live observation, target references,
bounded action stages, deterministic verification, compact debug activity,
schema rejection, approval classes, and audit timing metrics. Continue to use
`npm run regress:execution-core` for the real-page execution fixture and
`npm test`, `npm run build`, and `npm run verify:packaged` for broad regression.

## Verified baseline (2026-07-17)

The following results were measured against the local execution-core fixture;
they are a regression baseline, not a claim about every production page:

- smart profile: 10 runtime tools and 5,696 model-visible schema characters;
- full profile: 69 runtime tools and 39,169 schema characters;
- model-visible schema reduction: 85.5%;
- 10 read-only semantic observations: median 15.96 ms, P95 22.74 ms;
- one approved action stage: four controls filled/selected and one drawer click,
  all five actions completed;
- one real Fetch was observed as a grouped Network digest with status 200;
- DOM revision advanced from 1 to 4 and both drawer/network outcome checks
  passed;
- deterministic kernel evaluation: 10/10 passed;
- repository tests: 306/306 passed;
- production build and packaged two-adapter lifecycle verification passed.

The live regression intentionally kept aggregate Network evidence behind a
separate approval from ordinary page actions. Raw response bodies remain outside
the smart debug result.
