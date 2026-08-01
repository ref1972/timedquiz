# Google Workspace SMTP relay migration plan

Status: planned only. No Workspace, production, database, or mail-sending
change has been made from this plan.

## Goal

Send Timed Quiz invitations directly from the production droplet through
Google Workspace's SMTP relay, removing Google Apps Script and its separate
recipient quota from the Timed Quiz delivery path.

The migration must preserve these existing safeguards:

- nothing sends automatically;
- test and real sends remain separate deliberate actions;
- each player receives only that player's recoverable invitation URL;
- a real batch stops on the first failure;
- a failed recipient remains unsent and is first on the next retry;
- no fallback transport is attempted;
- a player is marked sent only after Google accepts that individual message;
- production secrets, recipient addresses, links, and mail logs stay out of Git.

## Proposed architecture

- Application transport: SMTP with STARTTLS to `smtp-relay.gmail.com:587`.
- Authentication: production droplet's fixed public IPv4 address, configured in
  the Google Admin console. Do not open the relay to arbitrary IPs.
- Sender: a real Google Workspace mailbox or approved address in the
  `triviaworkshop.com` Workspace domain, selected by the owner before setup.
- Envelope sender and visible From address: the same approved address unless a
  test proves a different configuration is required.
- Reply-To: an owner-monitored mailbox.
- Delivery unit: one SMTP transaction and one recipient per personalized
  invitation. Do not combine players into To, CC, or BCC lists.
- Application library: `nodemailer`, behind the existing mail module so admin
  routes and invitation rendering do not become SMTP-aware.
- Rollback: retain the Apps Script adapter temporarily behind an explicit
  `EMAIL_TRANSPORT` setting until SMTP has passed production tests. There is
  never automatic fallback between transports.

Google's documented 100-recipient SMTP relay restriction is per transaction,
not a 100-recipient daily ceiling. Sending one personalized recipient per
transaction remains well below it.

## Phase 1 — Confirm prerequisites

Owner decisions/input required:

1. Choose the visible sender mailbox and friendly name.
2. Choose the Reply-To mailbox.
3. Confirm access to Google Workspace Admin for `triviaworkshop.com`.
4. Confirm the production droplet remains at public IPv4 `137.184.62.161`.
5. Choose an app-side safety ceiling. Recommended for the first launch: 100
   accepted real invitations per UTC day, despite Workspace's higher relay
   allowance.

Read-only checks before configuration:

- confirm the droplet's observed outbound IPv4;
- confirm outbound TCP 587 reaches Google's relay;
- inspect the domain's current SPF, DKIM, and DMARC records;
- confirm the selected sender is permitted in Workspace;
- record the current Apps Script relay configuration locations without copying
  secret values into documentation.

## Phase 2 — Configure Google Workspace

In Google Admin Console, open Gmail routing and add an SMTP relay service for
Timed Quiz. Use the narrowest settings that work:

1. **Allowed senders:** only registered Workspace users, or only addresses in
   the Workspace domains if the chosen sender requires that broader option.
2. **Authentication:** only accept mail from the specified IP address.
3. Add only `137.184.62.161` after independently confirming it is the droplet's
   outbound address.
4. Require TLS encryption.
5. Do not enable unauthenticated access from arbitrary addresses or networks.
6. Save the rule and allow for Google configuration propagation.

No real invitation is sent during this phase. A raw SMTP connectivity probe may
open a connection and issue EHLO/STARTTLS, but must stop before MAIL/RCPT/DATA.

## Phase 3 — Implement the SMTP transport

### Configuration

Add explicit environment settings, with non-secret examples in `.env.example`:

```text
EMAIL_TRANSPORT=apps_script
SMTP_HOST=smtp-relay.gmail.com
SMTP_PORT=587
SMTP_REQUIRE_TLS=true
SMTP_FROM_EMAIL=
SMTP_FROM_NAME=
SMTP_REPLY_TO=
SMTP_HELO_NAME=bee.triviaworkshop.com
SMTP_DAILY_SAFETY_LIMIT=100
```

The production deployment initially stays on `apps_script`. Switching to
`smtp` requires an intentional environment edit and service restart. IP-based
relay should not require a stored SMTP password. If Google requires credentials
unexpectedly, stop and reassess rather than weakening the relay rule.

### Mail adapter behavior

Refactor `src/mail.ts` into an explicit transport boundary:

- `verifyEmailTransport()` performs SMTP DNS/connect/EHLO/STARTTLS readiness;
- `sendInvitationEmail()` renders the existing plain and HTML bodies and sends
  one recipient;
- return a normalized result containing success, retryability, SMTP response,
  enhanced status code when present, provider message ID, and safe admin error;
- use bounded connection, greeting, socket, and send timeouts;
- require a valid TLS certificate;
- never log invitation URLs or message bodies;
- never include raw server errors in player-facing pages;
- never retry automatically inside one web request.

Success means Google returned a 2xx SMTP acceptance response after DATA. It does
not mean inbox delivery. Only after that response may the database record the
invitation as sent.

Classify failures conservatively:

- connection, TLS, timeout, 4xx, or rate-limit response: pause the batch and
  leave the recipient unsent;
- 5xx recipient or policy rejection: pause the batch and leave the recipient
  unsent for admin review;
- malformed local address/template: reject before opening SMTP and leave the
  recipient unsent;
- unknown response: treat as failure and do not advance.

### Capacity and admin interface

SMTP relay has no reliable API for “remaining messages today.” Replace the
Apps Script quota UI with:

- **Check email connection**: verifies SMTP/TLS readiness without sending;
- display the configured sender, transport, and app-side daily ceiling;
- count this application's accepted real sends for the current UTC day from
  its own audit data;
- show `accepted today / safety limit` and remaining app-side capacity;
- preserve **Send a test player's link**;
- preserve the small real batch size of five for the first launch;
- disable real batches when the local safety ceiling is reached.

The app-side count is a safety control, not a claim about Google's complete
Workspace quota. Test sends should be logged separately and may count toward a
small separate test ceiling.

### Audit data

Record, without storing message contents or invitation links:

- player ID;
- test versus real;
- transport (`smtp_workspace`);
- attempt timestamp;
- accepted/failed outcome;
- sanitized SMTP status/enhanced status;
- provider message ID when supplied.

Continue using the existing player's sent marker for invitation workflow state.
Do not expose recipient addresses unnecessarily in application logs.

## Phase 4 — Automated verification

Add tests for:

1. SMTP is never contacted when configuration is incomplete.
2. readiness checks negotiate TLS without sending a message.
3. the intended envelope sender, From, Reply-To, one recipient, subject, plain
   body, and HTML body are passed correctly.
4. successful 2xx acceptance marks exactly that player sent.
5. connection/TLS/timeout/4xx/5xx failures leave the current player unsent.
6. a batch stops on the first failure and does not touch later players.
7. retry begins with the same failed player.
8. no automatic Apps Script or other fallback occurs.
9. the local daily ceiling prevents attempts beyond the configured limit.
10. test-player exact identity protections remain intact.
11. audit records omit personalized links and bodies.
12. Apps Script mode still works only when explicitly selected during the
    temporary rollback window.

Run `npm test`, `npm run typecheck`, `git diff --check`, and the project
preflight. Review all dependency changes and commit only source/config examples,
never the live environment file.

## Phase 5 — Staged production rollout

1. Commit, push, and tag the tested release.
2. Trigger and verify a fresh SQLite backup; retain an off-host copy before the
   real participant batch.
3. Deploy the code while production still has
   `EMAIL_TRANSPORT=apps_script`; verify health and CASS HTTP 200.
4. Configure the SMTP environment values in `/etc/timed-quiz.env` without
   printing unrelated secrets.
5. Set `EMAIL_TRANSPORT=smtp` and restart only `timed-quiz.service`.
6. Run **Check email connection**. This must send no message.
7. Send one explicitly authorized test invitation to the owner.
8. Confirm receipt, personalized link identity, subject/body, and reply
   behavior.
9. Inspect full headers for:
   - expected From and Return-Path;
   - SPF pass;
   - DKIM pass for the intended domain;
   - DMARC pass/alignment;
   - Google relay path.
10. Use Google Workspace Email Log Search to confirm Google accepted and
    delivered the test.
11. Send one explicitly authorized test to a non-Gmail mailbox and repeat the
    delivery/header check.
12. Verify database/audit state: only the intended test players changed; no real
    invitation is marked sent.
13. Re-run production health and confirm CASS remains HTTP 200.

Do not proceed to real participants unless every item above passes.

## Phase 6 — Real invitation runbook

This phase requires explicit owner authorization at the time of sending.

1. Freeze and verify the final question bank, intro text, invitation template,
   cutoff, and player list.
2. Confirm zero unintended real attempts and review sent/unsent counts.
3. Trigger and verify a new local backup and retain an off-host copy.
4. Run application preflight and SMTP readiness check.
5. Confirm Google's Email Log Search is available for monitoring.
6. Send the first batch of five.
7. Confirm five SMTP acceptances, five sent markers, correct next-unsent player,
   and evidence in Email Log Search.
8. Spot-check at least one delivered personalized link without opening another
   player's identity.
9. Continue in batches of five, reviewing success and remaining counts after
   every batch.
10. On any error, stop. Do not skip the failed player, resend the whole list, or
    switch transports automatically.
11. At completion, reconcile imported real players against unique accepted
    real sends and unsent/attention-needed rows.

## Failure and rollback plan

Before any real SMTP invitation is accepted, rollback is simple:

1. set `EMAIL_TRANSPORT=apps_script`;
2. restart only `timed-quiz.service`;
3. verify health; and
4. do not send until the original relay is deliberately re-tested.

After some real SMTP invitations are accepted:

- do not restore an older database merely to roll back code;
- retain all sent markers and audit history;
- fix the transport or intentionally switch the explicit transport setting;
- resume only from the first unsent player;
- reconcile Google Email Log Search before retrying any ambiguous acceptance.

An SMTP timeout after DATA can be ambiguous: Google may have accepted the
message even if the app did not receive the final response. Leave the player
unsent, inspect Email Log Search using timestamp/sender/recipient, and make a
manual resend decision. Never guess or automatically retry an ambiguous send.

## Cleanup after successful launch

Once SMTP has been verified through a complete real send and the rollback
window has passed:

1. remove the Apps Script adapter and old environment settings from Timed Quiz;
2. remove or rotate the Timed Quiz copy of the shared Apps Script secret;
3. decide separately whether Trivia Nationals/WordPress still needs that Apps
   Script deployment—Timed Quiz migration does not authorize changing it;
4. keep the Workspace SMTP relay rule restricted to the confirmed droplet IP;
5. retain operational documentation for connection testing, log search, quota
   errors, sender/DNS checks, and safe batch resumption.

## Completion criteria

The migration is complete only when source is committed and pushed, the tagged
release is deployed, production is explicitly set to SMTP, two authorized test
messages have passed link-identity and header verification, Google Email Log
Search corroborates delivery, no real-player state changed during testing, and
CASS remains healthy.
