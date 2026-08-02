# Current handoff

## 2026-08-01 — Completion notification ready for release

- Added configurable admin email for every completed real or test attempt.
  It includes identity, test status, score, answer time, completion timestamp,
  and a direct authenticated answer-sheet link.
- Each attempt is claimed in SQLite before the asynchronous gateway call, so
  repeated completion requests and sweeps cannot duplicate the message. The
  results table shows sent, failed, or ambiguous state; failures are logged and
  never automatically retried because an ambiguous provider response could
  otherwise duplicate mail.
- All 32 tests, TypeScript, and diff checks pass. Source is local only at this
  point: not yet committed, pushed, deployed, or enabled in production, and no
  notification email was sent during verification.

## 2026-08-01 — First Gmail API gateway test accepted

- With explicit owner authorization, imported `friedewald@gmail.com` as test
  player 8 and attempted exactly one personalized invitation through the
  shared gateway. No retry or fallback occurred.
- Independent audits show one gateway attempt and one acceptance for
  `timed_quiz`; Gmail API returned HTTP 200 with a provider message ID, and
  Timed Quiz logged a successful `invitation_test_email`. The gateway reported
  999 remaining under its configured 24-hour safety ceiling.
- Fresh post-send backups are
  `/var/backups/trivia-mail-relay/audit-20260802T020009Z.sqlite.gz` and
  `/var/backups/timed-quiz/quiz-20260802T020009Z.sqlite.gz`.
- The owner confirmed inbox delivery. Do not repeat the send. Personalized-link
  operation and header / Workspace Email Log Search inspection remain pending
  before the WordPress cutover.

Last updated: 2026-08-01.

## 2026-08-01 — Timed Quiz switched to Gmail API gateway, no mail sent

- Deployed rc23 after backup `quiz-20260802T014933Z.sqlite.gz` and configured
  the app-specific `timed_quiz` client for
  `https://mail.triviaworkshop.com/v1/mail`.
- Verified the configured secret matches the relay's stored client credential,
  the no-send capacity response reports zero accepted and 1,000 remaining,
  public Timed Quiz health reports rc23, and CASS remains HTTP 200.
- No email was sent. The next action requires explicit owner authorization for
  one test invitation to an exact imported test player; verify inbox, link
  identity, headers, gateway audit, and Workspace Email Log Search before any
  WordPress cutover or real-player batch.

## 2026-08-01 — Shared droplet relay client prepared

- Timed Quiz source now supports the planned shared droplet mail gateway with
  `EMAIL_RELAY_CLIENT_ID=timed_quiz` plus bearer authentication. When no client
  ID is configured it retains compatibility with the currently deployed Apps
  Script request body, so deploying code alone cannot switch transports.
- Admin wording now describes relay capacity rather than claiming the value is
  necessarily Apps Script quota. The `.env.example` timer default was also
  corrected to match the already-live 30-second setting.
- All 31 tests and TypeScript pass. This source is not deployed; production
  environment and email behavior are unchanged, and no email was sent.
- Subsequent read-only infrastructure verification found DigitalOcean blocks
  all droplet SMTP ports. The shared gateway has been corrected to use the
  Gmail API over HTTPS with global three-second pacing and rolling hourly/day
  safety limits. Timed Quiz's HTTP client contract is unchanged by that pivot.

## 2026-08-01 — Workspace SMTP relay migration planned

- The owner chose direct Google Workspace SMTP relay as the intended
  replacement for Timed Quiz's Apps Script mail path.
- The complete staged plan is in `docs/WORKSPACE-SMTP-RELAY-PLAN.md`, including
  narrow IP-based Workspace configuration, explicit transport selection,
  TLS/readiness checks, a local safety ceiling, acceptance/audit semantics,
  tests, production rollout, real-batch procedure, ambiguity handling, and
  rollback.
- This is documentation only. No Workspace rule, production environment,
  database, mail transport, or recipient state was changed, and no email was
  sent.

## 2026-08-01 — Question timer increased to 30 seconds

- Changed the authoritative question window from 20 to 30 seconds. Ready,
  countdown, preview, intro defaults, email defaults, provisioning defaults,
  and active design documentation were updated.
- Player API states now carry the configured duration so displayed timer copy
  does not drift from server enforcement.
- Deployed as rc22 after successful backup
  `quiz-20260801T220626Z.sqlite.gz`. Production health reports rc22, the server
  environment is `QUESTION_DURATION_MS=30000`, and the customized intro/email
  values contain the 30-second wording with no old timer phrase. All other
  authored wording was preserved; CASS remains HTTP 200.

## 2026-08-01 — Answer time includes incorrect answers

- Renamed **Correct time** to **Answer time** in admin, answer sheets, and CSV
  (`answer_time_ms`). It now sums per-question elapsed time for every finalized
  included question—correct, incorrect, or unresolved.
- Ready screens and breaks remain excluded; each question's contribution is
  still server-measured and capped at its timer window.
- Deployed as rc21 after verified backup `quiz-20260801T215338Z.sqlite.gz`.
  Public health/query/labels and rehearsal aggregates were verified; CASS
  remains HTTP 200.

## 2026-08-01 — Per-player answer sheets

- Added **View answers** for every player. The separate admin-only screen shows
  each attempt generation and every served question with submitted text,
  canonical/alias answers, verdict, elapsed question time, and manual/timeout
  finalization.
- The screen explains the current all-finalized-answer time calculation.
- Deployed as rc20 after verified backup `quiz-20260801T215040Z.sqlite.gz`;
  public health/route/link/explanation markers were verified and CASS remains
  HTTP 200. No answer or scoring data was modified.

## 2026-08-01 — Separate test-results export

- Added **Download test results CSV** beside the renamed **Download real
  results CSV** button. Both use the same columns and ranking calculation, but
  filter on opposite test flags so accounts never cross between files.
- Deployed as rc19 after verified backup `quiz-20260801T214416Z.sqlite.gz`;
  public health/routes/buttons and unchanged player counts were verified, and
  CASS remains HTTP 200.

## 2026-08-01 — Question editing lock corrected for rehearsals

- Production had two test attempts and zero real-player attempts, but the old
  any-attempt rule disabled every individual question editor.
- Individual edits now lock only after a non-test participant starts. Test
  attempts no longer disable the fields. Full 50-question replacement remains
  blocked after any attempt because replacing rows would conflict with retained
  exposure/audit history.
- Deployed as rc18 after verified backup `quiz-20260801T213529Z.sqlite.gz`.
  Public health/lock code and the zero-real-attempt condition were verified;
  CASS remains HTTP 200.

## 2026-08-01 — Test-link identity incident and fix

- Production evidence confirmed that test sends always selected the first test
  player. The placeholder account had completed generation 1, while Marc's
  separately imported test account had no attempt; Marc therefore received the
  completed placeholder identity and saw the Thank you screen.
- Test sends now require an exact email match to an imported test player. They
  refuse missing/unrecoverable accounts and refuse completed test accounts
  until an admin grants a restart. No other player's token is substituted.
- Do not automatically resend to Marc; the owner can deliberately send a new
  test after this fix is deployed.
- Deployed as rc17 after verified backup `quiz-20260801T213008Z.sqlite.gz`.
  Public health and exact-match code were verified; Marc's matching test player
  remains not started, CASS remains HTTP 200, and no resend occurred.

## 2026-08-01 — Accepted answers in Review Queue

- Each unresolved-answer row now shows **Counted correct** with the question's
  canonical answer followed by all accepted aliases, beside the submitted
  answer and player count. Grading behavior itself is unchanged.
- Deployed as rc16 after verified backup `quiz-20260801T212618Z.sqlite.gz`;
  public health/query/display markers were verified and CASS remains HTTP 200.

## 2026-08-01 — Upcoming category on Ready

- The between-question Ready state now includes and displays the next
  question's category. The prompt remains undisclosed until **Show question**
  starts that question's server-authoritative window.
- Deployed as rc15 after verified backup `quiz-20260801T211654Z.sqlite.gz`;
  public health/state/rendering markers were verified and CASS remains HTTP 200.

## 2026-08-01 — Clearer test-player invitation status

- Test-player rows now say **Test account — use Step 3** instead of the
  misleading **not sent**. Real-player sent, paused, and unsent statuses are
  unchanged; test sends still do not mark a real invitation delivered.
- Deployed as rc14 after verified backup `quiz-20260801T211418Z.sqlite.gz`;
  public health/label were verified and CASS remains HTTP 200.

## 2026-08-01 — Brighter question highlight

- Highlighted question text now uses the same `--cass-orange` color as the
  timer background in both light and dark modes.
- Deployed as rc13 after verified backup `quiz-20260801T210228Z.sqlite.gz`;
  public health/CSS were verified and CASS remains HTTP 200.

## 2026-08-01 — Editable invitation email

- Added an Invitation email admin panel for subject and body. `{{name}}` inserts
  the display name and required `{{link}}` inserts the personalized URL.
- Test and real sends use the same SQLite-backed template. Test subjects still
  receive the automatic `[TEST]` prefix. Plain and HTML bodies are generated
  together, with all author/player content HTML-escaped.
- Production retained the default template after rc12 deployment; no saved
  override was created and no email was sent.

## 2026-08-01 — Invitation-free question preview

- Added Preview beside every question editor. The admin-only preview uses the
  player card, category, gold highlighting, italics, answer field, and submit
  styling, with previous/next navigation.
- Preview is deliberately inert: the displayed 30.0 clock does not run and the
  answer/button record nothing. It creates no player, attempt, exposure,
  invitation, or email activity.
- Extracted prompt rendering into one shared browser formatter so live play and
  admin preview cannot drift on escaping, italics, or gold highlighting.
- Deployed with the email editor as rc12 after verified backup
  `quiz-20260801T205055Z.sqlite.gz`. Public health/assets and deployed markers
  were verified; CASS remains HTTP 200 and no activity was written.

## 2026-08-01 — Question emphasis

- Added optional Highlighted text to the question editor and CSV. Every
  case-insensitive literal match in the visible question renders in gold; saves
  reject a phrase that does not occur in the question.
- Added safe italic formatting for titles. Selecting question text and clicking
  **Italicize selection** wraps it in portable `*asterisk*` markup, which is
  supported in CSV and rendered as `<em>` after escaping all question text.
- Added `questions.highlighted_text` through a backward-compatible migration.
- Deployed as rc11 after verified backup `quiz-20260801T201101Z.sqlite.gz`.
  Public health reports rc11, the live migration and UI/rendering markers were
  verified, and CASS remains HTTP 200. Existing questions were not modified.

## 2026-08-01 — Editable player intro

- Added a Player intro panel near the top of admin for the opening eyebrow,
  title, instructions, warning heading/body, advancement copy, and Ready button
  label. Copy is stored in SQLite and supplied through the prestart API state.
- The player renders configured values as escaped text. Timing, required
  question count, abandonment behavior, cutoff, and grading remain code rules.
- Deployed as rc10 after verified backup `quiz-20260801T154816Z.sqlite.gz`.
  Production health reports rc10, the editor is present, and CASS remains HTTP
  200. Deployment wrote no intro overrides and did not change live wording.

## 2026-08-01 — Player CSV and invitation workflow

- Added downloadable player CSV plus CSV selection/paste import. Existing
  emails update name/test status; new emails receive recoverable invitation
  links. Import never deletes players, resets attempts, or sends email.
- Reworked invitations into four visible steps with real-player, sent, ready,
  and attention-needed counts. Quota check, test send, and real batches remain
  separate deliberate actions; real batches retain the five-person limit and
  hard pause/no-fallback behavior.
- Deployed as rc9 after verified backup `quiz-20260801T154019Z.sqlite.gz`.
  Production health reports rc9, deployed workflow markers are present, and
  CASS remains HTTP 200. No player import or email send occurred during deploy.

## 2026-08-01 — Friendlier question import

- Moved the password-change panel to the bottom of the admin page.
- Added downloadable question-bank CSV plus CSV file selection/paste import.
  Columns are `position,category,question,answer,aliases`; multiple aliases use
  `|`. Quoted commas, quotes, and multiline cells are supported. JSON remains
  accepted for compatibility.
- Deployed as rc8 after verified backup `quiz-20260801T153559Z.sqlite.gz`.
  Production health reports rc8, deployed layout markers are present, and CASS
  remains HTTP 200.

## 2026-08-01 — Admin password management

- Added a **Change admin password** panel to the admin dashboard. It requires
  the current password plus a matching nonblank replacement of at most 256
  characters. The original 16-character minimum was removed at the owner's
  direction; the UI recommends length without enforcing it.
- The database stores only a random-salted scrypt hash. The environment value
  remains the bootstrap credential until the first database password is set;
  afterward it no longer authenticates.
- Every successful change increments the stored admin-session version, making
  all existing signed admin cookies invalid immediately. Automated coverage is
  now 21 tests plus TypeScript. The no-minimum policy was deployed as rc7 after
  verified pre-deploy backup `quiz-20260801T153007Z.sqlite.gz`; production
  health reports rc7, the deployed source contains the new policy and copy,
  and CASS remains HTTP 200.

## Repository extraction

- Standalone project name: **Timed Quiz**.
- GitHub: `https://github.com/ref1972/timedquiz`.
- Local checkout: `/Users/russellefriedewald/Documents/Projects/TimedQuiz`.
- The application was extracted with its path history from
  `pop-culture-bee-quiz/` in TriviaNationals. The shared Workspace Apps Script
  remains owned by TriviaNationals because other live systems use it.
- A flaky tamper test was corrected before extraction: it now mutates an
  authenticated ciphertext character rather than the final Base64URL character,
  whose unused bits could decode identically. Encryption behavior was not at
  fault.

## Next steps

1. Push and verify the standalone repository.
2. Replace the duplicate TriviaNationals app source with a pointer here.
3. Create the `bee.triviaworkshop.com` DNS record.
4. Merge/tag a release and provision the isolated service on the CASS droplet.
5. Finish editorial review, cutoff/cut decisions, email relay test, rehearsal,
   clean database creation, final import, and monitored invitation send.

## 2026-08-01 — Deployment provisioning started

- DNS now resolves `bee.triviaworkshop.com` to the CASS droplet.
- Added tracked systemd/nginx definitions and a repeatable provisioning script.
  The initial provision intentionally creates only a rehearsal database and
  leaves the email relay and cutoff unset.
- The first `rc1` provision installed the verified Node 24 runtime, then stopped
  before service/nginx changes because the private GitHub repository cannot be
  cloned anonymously. Provisioning now uploads a tagged Git archive instead,
  avoiding any GitHub credential on the server.
- The repository is now public, but archive deployment remains intentional: it
  installs the exact tag without maintaining a server-side checkout.
- `timed-quiz-v0.1.0-rc2` is deployed as the rehearsal instance. DNS and HTTPS
  are live; the dedicated service is healthy with the correct release ID.
  Admin authentication and the seeded invitation redirect work, HTTP redirects
  to HTTPS, and CASS remained online/HTTP 200 throughout.
- Email relay URL/secret and `CLOSES_AT` are deliberately unset, no real player
  is loaded, and no email was sent. The seeded starting bank is not approved
  for launch and the rehearsal database must not become the final database.
- Provisioning now waits up to 30 seconds for application health and preserves
  Certbot's live nginx edits on subsequent deployments.
- The first rc3 repeat-deploy check correctly preserved TLS/data but exposed
  that `systemctl enable --now` does not restart an already-running service and
  the persisted `RELEASE_ID` stayed at rc2. No partial upgrade or outage
  occurred: production remained healthy on rc2. Provisioning now updates the
  release ID and explicitly restarts the service on every deploy.
- rc4 confirmed the repeat-deploy fix end to end: the service restarted and
  `/health` reported rc4 while preserving the rehearsal database and TLS.
- rc5 added the missing SQLite CLI and enabled the daily backup timer. A manual
  service run produced `quiz-20260801T145925Z.sqlite.gz`; gzip validation and
  `PRAGMA integrity_check` both passed. Production health reports rc5 and CASS
  remains HTTP 200.
- The existing Workspace relay URL/secret were transferred from authenticated
  WordPress settings into the server environment without committing them. The
  Apps Script owner redeployed the existing matching Web App as Version 5;
  after propagation, the quota action returned 97. One owner-authorized test
  invitation was accepted and returned 96 remaining. The owner confirmed inbox
  delivery and that the personalized production link worked. Header inspection
  is still needed; no batch or real-player message was sent.
- Rotate the shared relay secret everywhere before the real send because it was
  surfaced during authenticated setup. This affects Apps Script Script
  Properties, WordPress Signup Settings, and `/etc/timed-quiz.env`.
- Owner requested an admin **Player intro** panel after reviewing the live
  invitation landing screen. Make the eyebrow (`TRIVIA NATIONALS`), main title,
  introductory sentence, leave-warning copy, no-feedback/advancement paragraph,
  and Ready button label editable. Preserve the actual timing, abandonment,
  cutoff, and grading rules in code regardless of the configured wording.
