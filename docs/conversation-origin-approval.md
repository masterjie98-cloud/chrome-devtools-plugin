# Conversation-origin approval

- Status: implemented; automated validation and core real-Chrome interaction complete
- Scope: embedded sidepanel Agent only
- Lifetime: memory-only, current conversation and current page origin

## Product goal

Replace the narrow same-tool/current-reply shortcut with one explicit,
revocable permission for eligible browser operations in the current chat and
page origin. Keep approval visible even when the user is reading older messages.

## Scope contract

An active permission binds all of the following:

- current `conversationId`;
- normalized HTTP(S) origin: scheme, hostname, and port;
- authenticated browser Profile session;
- owning embedded sidepanel instance; every incoming request must match that
  instance's current authenticated daemon connection;
- current AI Provider egress destination.

It may remember `page_action`, `reversible_write`, and `sensitive_read` calls.
It never remembers `destructive_write`, `arbitrary_execution`, `open_world`, an
unknown policy class, an external MCP requester, or a request without a bound
HTTP(S) target and Profile session.

The permission is an approval-decision shortcut, not an execution grant. Every
actual request still passes daemon policy, schema, target/revision, idempotency,
deadline, and fresh single-use execution-grant validation.

## Invalidation

Revoke immediately when:

- the active conversation changes;
- the selected page changes to another normalized origin;
- an incoming request has another Profile session or Provider destination;
- the user turns the permission switch off.

A path, query, hash, document, or revision change inside the same origin does
not revoke the shortcut. Stale target/revision validation still fails closed at
the daemon and executor boundaries.

A transparent WebSocket reconnect changes the server-issued connection ID but
does not represent a new chat, origin, or sidepanel instance. The permission can
survive that reconnect only because each request is compared with the owning
panel's newly authenticated connection. A request from another sidepanel never
matches and does not consume the active permission.

## UI states

1. Pending approval is rendered in a fixed attention region directly above the
   composer, outside the scrollable message history.
2. The card exposes: deny, allow once, and allow this chat on the displayed
   origin when eligible.
3. While active, a persistent status strip displays the origin, the current-chat
   scope, exclusions, and an enabled switch that can revoke the permission.
4. Narrow layouts stack actions without hiding the primary decision or revoke
   control.

## Validation

- Pure tests: same chat/origin matches across tool names, revisions, and
  transparent connection replacements; chat, origin, Profile session,
  sidepanel ownership, Provider, and excluded policy changes fail.
- UI/build: pending card is outside the message scroller, active permission is
  visible and revocable, responsive layout does not clip actions.
- Real Chrome: enable on one approved action, execute another eligible tool
  without a second card, revoke and confirm the next tool prompts, then change
  origin and confirm automatic expiry.

Automated evidence on 2026-07-15:

- focused approval/Agent tests: 28/28 passed;
- full unit/integration suite: 235/235 passed;
- `npm run build`: TypeScript, Vite extension, content script, daemon, MCP
  adapter, and status builds passed;
- `git diff --check`: passed.

Real-Chrome evidence on 2026-07-15:

- the fixed attention card showed the tool, normalized origin, Provider
  destination, and all three decisions above the composer;
- enabling on `http://127.0.0.1:8765` let a later, different eligible typing
  tool execute without a second card, while the fixture confirmed trusted input;
- disabling the visible switch caused the next actual tool request to prompt;
- enabling again and navigating to `http://localhost:8765` removed the active
  strip, and the next actual tool request prompted for the new origin;
- a transient WebSocket reconnection initially exposed an over-strict
  connection-ID binding. The implementation was changed to sidepanel-instance
  ownership plus current authenticated-connection verification, then the
  cross-tool flow passed.

Remaining manual boundary: switch saved chats while a grant is active and
confirm the strip disappears. The pure invalidation test already covers this
branch, but it is not claimed as live evidence.
