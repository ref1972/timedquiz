# Current handoff

## 2026-08-09 — Active Game 2 cutoff extended

- At the owner's direction, active Game 2 (`2026 Pop Culture Bee Finals`) now
  closes Sunday, August 9, 2026 at 2:00 PM Pacific / 4:00 PM Central
  (`2026-08-09T21:00:00.000Z`), extended from 10:00 AM Pacific.
- No question was in flight when checked. Backup
  `quiz-20260809T190014Z.sqlite.gz` passed gzip and SQLite integrity checks
  before the guarded one-row update.
- Production preflight passes with 50 questions, 17 players, 17 recoverable
  invitations, and 12 attempts. Timed Quiz is active and public health remains
  healthy on rc34. No email was sent and no service restart was required.

## 2026-08-08 — Multi-game architecture deployed as rc34

- Added numbered games with a single active-game constraint and a per-game
  Central cutoff. A new Games panel lets admin select an isolated game, create
  the next inactive game, and deliberately activate it.
- The rc33 one-off database migrates additively into active Game 1. Existing
  player and question IDs are preserved, retaining all attempt, exposure,
  grading, and audit relationships.
- Players, questions, progress, grading, CSV exports, invitation/reminder
  eligibility, restarts, previews, and imports are scoped to the selected game.
  The player routes accept only invitation/session records belonging to the
  active game. Email sends are refused while an inactive game is selected.
- The preflight checks the active game and its own cutoff/data rather than a
  single global quiz dataset. Seed behavior is likewise active-game scoped.
- Commit `a210e31` and tag `timed-quiz-v0.1.0-rc34` are pushed and deployed.
  Pre-deployment backup `quiz-20260808T181151Z.sqlite.gz` passed gzip and SQLite
  integrity checks, and there were no live question windows during restart.
- Production verification: public health reports rc34; the foreign-key check
  is clean; active Game 1 retains 85 players, 50 questions, 87 attempts, and
  4,336 exposures; preflight passes with `ALLOW_EXISTING_ATTEMPTS=1`; the Game
  UI source is present; Timed Quiz is active; both CASS PM2 services are online;
  and the CASS public site is HTTP 200.
- Verification: 45 tests pass, TypeScript typechecking passes, and
  `git diff --check` passes. No invitation, reminder, or other email was sent.

## 2026-08-05 — Editable reminder template implemented locally

- The Players screen now has a Reminder email editor directly above the send
  controls. Subject and body are stored in `app_settings`; the rc33 wording is
  retained as the default.
- `{{name}}` is optional and `{{link}}` is required. Substitution is shared by
  plain-text and safely escaped HTML output. Validation matches the invitation
  editor’s 200-character subject and 10,000-character body limits.
- Saving only updates the template and adds an audit event; it does not send a
  reminder. Existing reminder eligibility, capacity preflight, confirmation,
  one-time success tracking, and stop-on-failure behavior are unchanged.
- Verification: 44 tests pass, TypeScript typechecking passes, and
  `git diff --check` passes. No email was sent.
- Status: source is local only; it is not committed, pushed, deployed, or
  verified in production.

## 2026-08-05 — Incomplete-player reminders deployed as rc33

- The Players screen now shows the exact number of invited real players who
  are incomplete and have not already received this reminder, with a confirmed
  button to send the group.
- Reminder email subject/body are code-controlled and include the recipient’s
  own personalized invitation link plus the deadline: midnight (Central time)
  Thursday.
- Eligibility excludes test players, completed current attempts, players never
  sent an invitation, players without a recoverable encrypted token, and
  players already successfully reminded. A superseded attempt does not block a
  reminder for an authorized restarted attempt.
- The route preflights relay capacity for the complete eligible group before
  sending anything, stops at the first send/decryption failure, never marks a
  failed message sent, never uses a fallback mailer, and audit-logs each result.
- SQLite adds per-player reminder sent/error/attempt fields through the existing
  additive startup migration pattern.
- Verification: 43 tests pass, TypeScript typechecking passes, and
  `git diff --check` passes. No email was sent.
- Commit `d0daa58` and tag `timed-quiz-v0.1.0-rc33` are pushed and deployed.
  There were zero active question windows before the change. Production
  preflight passes with 50 questions, 82 players, 82 recoverable links, and 64
  attempts. Backup `quiz-20260806T044622Z.sqlite.gz` passed gzip and SQLite
  integrity checks.
- The owner authorized a one-hour grace period: the enforced cutoff is Friday,
  August 7 at 1:00 AM Central Daylight Time (`2026-08-07T06:00:00Z`), while the
  public reminder continues to state midnight Thursday. The previous
  environment file is preserved as
  `/etc/timed-quiz.env.pre-rc33-20260806T0450Z`.
- Production verification: public health reports rc33; all three reminder
  columns and the reminder route/UI/template markers are live; counts remain 64
  attempts / 3,186 exposures / 50 questions / 82 players; reminder-send audit
  events remain zero; Timed Quiz is active; both CASS PM2 services are online;
  and the public CASS site reaches HTTP 200. No email was sent.
- This Mac’s existing Ed25519 public key is now authorized on the droplet, so
  future deployments can authenticate without entering or exposing the root
  password.

## 2026-08-02 — Progress test-player filter deployed as rc32

- Progress now has a Show test players checkbox with the number of test
  accounts. Turning it off hides only test-player cards and remembers the
  choice in that browser; exports, rankings, and stored player data are not
  changed.
- A regression test verifies the control, test-card marker, and persistent
  browser preference wiring.
- Deployed together with the player-import Continue link fix in rc32; see the
  verification below.

## 2026-08-02 — Player-import Continue link fixed and deployed as rc32

- Root cause: the import success page is the POST response at
  `/admin/players`. Its link to `/admin/players#invitations` was therefore
  treated as a same-document fragment change, and that standalone success page
  has no `invitations` target. The browser never issued the GET needed to render
  the Players admin screen.
- The continuation now includes a harmless, narrowly scoped query parameter,
  forcing a GET of the Players screen before applying `#invitations`.
- A regression test confirms that the destination retains the Players path and
  invitation anchor while being a distinct URL from the POST document.
- Commit `f28cd23` and tag `timed-quiz-v0.1.0-rc32` are pushed and deployed.
  There were zero active question windows before restart. Backup
  `quiz-20260803T045431Z.sqlite.gz` passed gzip and SQLite integrity checks.
  Public health and `RELEASE_ID` report rc32; the continuation URL, test-card
  markers, persistent filter script, and filter CSS are live; the timer remains
  25 seconds; counts remain 15 attempts / 736 exposures / 50 questions / 76
  players / 167 grading rules; and CASS is HTTP 200. No email was sent.

## 2026-08-02 — 25-second timer deployed as rc31

- The authoritative default, environment example, deployment bootstrap,
  preview/browser fallbacks, default intro/invitation copy, and current design
  documentation now use 25 seconds.
- Commit `0ed7cd6` and tag `timed-quiz-v0.1.0-rc31` are pushed and deployed.
  There were zero active question windows before the restart. Backup
  `quiz-20260803T042400Z.sqlite.gz` passed gzip and SQLite integrity checks.
  Public health and `RELEASE_ID` report rc31; the live environment is 25,000ms;
  deployed defaults and both stored player-facing messages say 25 seconds and
  contain no old 30-second wording; counts remain 13 attempts / 588 exposures /
  50 questions / 11 players / 152 grading rules; and CASS is HTTP 200. No email
  was sent.

## 2026-08-02 — Question-text switch and responsive Progress deployed as rc30

- The frozen Questions screen now offers a confirmed Turn editing on/off
  control. While on, category and question wording are editable and saveable;
  answers, aliases, highlighted text, scoring, and question import remain
  locked. The setting and every frozen-bank text save are audit-logged.
- Progress is now a responsive card list instead of an 11-column table, so the
  main Progress screen no longer depends on horizontal scrolling. All existing
  player status, score/time, answer-sheet, notification, invitation, rotation,
  and restart information/actions remain available.
- Verification: 39 tests pass, TypeScript typechecking passes, and
  `git diff --check` passes. The production-style local server starts normally.
  Automated browser verification could not run because `agent-browser` is not
  installed in this environment; watch-mode also hit the host's open-file
  limit, so the server was checked using the non-watch production runtime.
- Commit `b58d7ba` and tag `timed-quiz-v0.1.0-rc30` are pushed and deployed.
  Pre-deployment had zero active question windows. Backup
  `quiz-20260803T040541Z.sqlite.gz` passed gzip and SQLite integrity checks.
  Public health and `RELEASE_ID` report rc30, both admin routes gate to sign-in,
  deployed source/CSS markers are present, the text override defaults off,
  counts remain 12 attempts / 586 exposures / 50 questions / 11 players / 152
  grading rules, and CASS is HTTP 200. Deployment sent no email.

## 2026-08-02 — Player import navigation/session issue diagnosed

- Owner imported two players at 21:15:10 UTC; production audit confirms
  `added=2`, `updated=0`, `skipped=0`, and the database now has 11 players.
  No import data was lost.
- The open admin document was still rc5 and its 12-hour admin session had
  expired. Following the current Continue link therefore displayed sign-in at
  `/admin/players#invitations`, while the old visible page made this look like
  an inert anchor.
- Sign-in now carries a validated return destination and preserves the current
  hash at submit time, so an expired session returns directly to Players →
  Invitations after authentication.
- Commit `7910d01` and tag `timed-quiz-v0.1.0-rc29` are pushed and deployed
  after verified backup `quiz-20260802T212542Z.sqlite.gz`, with no live question
  window during restart. Health reports rc29; deployed return validation and
  hash preservation are present; the live sign-in page carries the Players
  destination; counts remain 11 / 3 real / 8 test; CASS is HTTP 200; and no
  email was sent. The owner's existing tab is left at the sign-in screen for
  `/admin/players#invitations`.

## 2026-08-02 — Review Queue rebuilt as a CASS-style Grading panel

Commit `4ad6de7` and tag `timed-quiz-v0.1.0-rc28` are pushed and deployed after
verified backup `quiz-20260802T204831Z.sqlite.gz`, with no question in flight.
Deployment sent no email.

Verified in production: public health and `RELEASE_ID` report rc28; the
deployed source carries `gradingReview` and the panel markup and styling, and
no longer contains `unresolvedAnswers` or `reviewedRules`; `/admin/review`
gates to sign-in; data is unchanged at 9 attempts / 436 exposures / 103 rules /
10 person-flagged questions / 324 correct answers; and CASS remains HTTP 200.

The Review Queue is now a **Grading** screen modelled on the CASS host Grading
panel, at the owner's request. The reasoning and the two deliberate departures
from CASS are in `docs/DECISIONS.md`. The substance: it shows every distinct
answer to every question rather than only unresolved ones, so an answer the
grader accepted by itself is finally visible and reversible.

`unresolvedAnswers()` and `reviewedRules()` are replaced by `gradingReview()`
and `unresolvedVariantCount()`. The `POST /admin/review` ruling path is
unchanged, so the retroactive/prospective semantics are exactly as before.

Verified against a `sqlite3 .backup` copy of the live database (436 answers,
all previously ruled, which the old screen rendered as an empty queue):

- Every question renders its accepted answers, an "N of M correct (P%)"
  statistic, and collapsed correct/incorrect tiers; the person questions carry
  a `person` badge.
- Rejecting "Brooks" on Q3 through the UI regraded all three players who typed
  it in one click, moved the row to the incorrect tier, flipped its badge from
  `auto` to `ruled incorrect`, flipped the button to Accept, and moved the
  question statistic from 8 of 9 (89%) to 5 of 9 (56%).
- Forcing two answers to unresolved showed them uncollapsed at the top of their
  question in the awaiting-review tier with Correct/Incorrect buttons, the
  header reading "2 awaiting review", the jump nav highlighting that question,
  and the nav badge reading "Grading (2)".

38 tests, TypeScript, and `git diff --check` pass. The local copy of production
data was deleted after the check.

Next: the `questions.included_in_score` column is respected by every ranking
and scoring query but no interface ever sets it. A per-question "drop from
scoring" control on the Grading screen would make it usable if a question
turns out to be flawed after players have answered it.

## 2026-08-02 — rc27: person flag editable while the question bank stays frozen

The person checkbox moved out of the frozen content editor into its own form
and route, `POST /admin/question/:id/grading`, which the content lock does not
gate. `POST /admin/question/:id` no longer writes `answer_is_person`, so saving
question content cannot silently clear it. Content — category, prompt,
highlighted text, canonical answer, aliases — stays frozen exactly as before.

Browser-verified against a scratch database seeded to match production (a real
completed attempt freezing the bank): every content field rendered disabled
with no Save question button, while all 50 grading checkboxes rendered enabled;
ticking one and saving persisted `answer_is_person = 1` and logged
`question_grading_updated`; unticking round-tripped back to 0. 37 tests,
TypeScript, and `git diff --check` pass.

Setting the flag does not regrade existing answers, by design.

Deployed after verified backup `quiz-20260802T202931Z.sqlite.gz` with no
question in flight. Production health and `RELEASE_ID` report rc27, the
grading route and view/CSS markers are present, counts are unchanged at 9
attempts / 436 exposures / 50 questions / 9 players / 103 grading rules, CASS
remains HTTP 200, and no email was sent.

The owner then set the flag on all ten person questions through the admin
screen — Q3, Q10, Q12, Q17, Q22, Q23, Q29, Q32, Q44, Q48 — between 20:30:06 and
20:31:19 UTC, each recorded as a `question_grading_updated` audit event. That
is the feature working end to end in production on a frozen bank.

Grading verified against the live database afterwards: Q29 "Mansfield" and
"Jayne Mansfield" both correct with "Marilyn Mansfield" unresolved; Q10 "Bush"
and "Kate Bush" correct with "George Bush" unresolved; Q3 "Mel Brooks" and Q44
"french fry" unresolved; Q15 "I don't know" and Q41 "Kryptonite" unresolved.

## 2026-08-02 — rc26 deployed and verified; person flag blocked by the edit lock

Commit `0805278` and tag `timed-quiz-v0.1.0-rc26` are pushed and deployed after
verified backup `quiz-20260802T201145Z.sqlite.gz` (gzip and
`PRAGMA integrity_check` both pass; 9 attempts and 436 exposures, matching
live). Deployment sent no email.

Verified in production: public health reports rc26; `RELEASE_ID` is rc26; the
live `questions` schema carries `answer_is_person`; attempts, exposures,
questions, players, and grading rules are unchanged at 9 / 436 / 50 / 9 / 103;
all four admin routes return the sign-in screen unauthenticated; the deployed
source carries the grading, shorthand, `serverNow`, `trust proxy`, and person
checkbox markers; and CASS remains HTTP 200. The service was restarted while
no question was in flight — the single in-progress attempt is an abandoned
test-player rehearsal whose last answer was eight hours earlier.

Stored verdicts were not regraded, by design; the new rules apply at submit
time. Re-grading all 324 stored `correct` answers against the deployed code
found four that would now go to review, **all belonging to test players**:
"Juicy Coutore" and "juicy couroee" (Q31), "Krypton" for "Krypto" (Q41), and
"stephen frye" (Q44). The one real player's answers are unaffected.

An earlier run of this check reported 305 answers and three drifts. It was
wrong: it read a `cp` of the live WAL-mode database taken without its `-wal`
file, which is an inconsistent snapshot. Copy a live database with
`sqlite3 … ".backup"`, never `cp`.

### Resolved in rc27: the person flag is editable on a frozen bank

The owner chose to unlock the checkbox. rc27 gives it its own route that is not
gated by the content lock; see `docs/DECISIONS.md`. The situation that prompted
the decision is recorded below.

### The situation: a real attempt froze the bank

Production has one **real** completed attempt — `birving1983@gmail.com`,
invited in the single real batch at 02:19 UTC and completed 02:29–02:37 UTC on
2026-08-02. `questionEditingLocked()` therefore returns true, so every question
editor field including the new person checkbox renders disabled and
`POST /admin/question/:id` returns 409. All 50 questions currently have
`answer_is_person = 0`.

Practical impact is small: the nine person questions that already carry a
surname alias (Q3, Q10, Q12, Q17, Q22, Q23, Q32, Q44, Q48) get the
wrong-first-name protection from the shorthand guard with or without the flag.
Only Q29 "Jayne Mansfield", which has no alias, loses bare-surname acceptance —
a submitted "Mansfield" goes to review, where one ruling covers every player.
The real player answered all ten with the full name and scored correct on each,
so no result depends on this either way.

The owner chose to make the checkbox editable rather than accept the gap or
authorize a direct database write. That is rc27.

## 2026-08-02 — Code review fixes: grading, timer clock, admin throttle

**Status: source deployed as rc26; see the entry above for production
verification.** The findings and reasoning below are retained as the record of
what changed and why.

A read-only review of the whole source found five defects. All five are fixed
with tests, and the owner then asked for person-name grading (item 6). The
suite is now 36 tests, and TypeScript, `git diff --check`, and
`node --check public/quiz.js` all pass.

1. **Automatic grading accepted wrong answers and hid them from review.**
   `autoVerdict` accepted any submission *containing* an accepted answer, with
   no length or word-boundary guard. Verified against the real Pop Culture Bee
   bank: Q15 (canonical answer "T") graded any submission containing the letter
   t as correct, including "I don't know" and "Mature"; Q2 "The Who" accepted
   "I have no idea who" and "Whodunit"; Q20 "The Body" accepted "everybody
   loves raymond"; Q41 "Krypto" accepted "Kryptonite"; Q44's bare "Fry" alias
   accepted "french fry" and "Philip J. Fry". Because the review queue lists
   only `unresolved` answers, none of these was visible to a reviewer.
   Containment now requires a whole-word boundary and a minimum length; see
   `docs/DECISIONS.md`. An empty alias from a trailing `|` in an imported CSV
   also no longer accepts every non-blank answer.
2. **The player countdown trusted the device clock.** The browser compared the
   absolute `deadlineAt` against `Date.now()`, so a phone running minutes fast
   would show 0.0 the instant each question appeared and auto-submit all fifty
   answers blank. States now carry `serverNow`; the device clock is used only
   as a stopwatch. Server-side enforcement was already correct and is unchanged.
3. **Admin sign-in throttling was global, not per-address.** `req.ip` read as
   127.0.0.1 for every request because the app never trusted nginx's
   `X-Forwarded-For`, so ten failed attempts from any stranger locked the owner
   out for fifteen minutes — worst case during a live event. `trust proxy` is
   now set to one hop, and expired throttle buckets are pruned.
4. **A tampered session cookie could return 500 instead of 401.** `unsign`
   compared character length, then called `timingSafeEqual` on buffers; a
   forged cookie with multibyte characters threw a RangeError. It now compares
   byte lengths.
5. **`POST /admin/review` accepted a nonexistent question id or blank answer**,
   reaching a foreign-key error. It now validates and returns 400.
6. **Person-name grading**, at the owner's request. Questions gained
   `answer_is_person` (checkbox in the editor, `person` column in the CSV,
   backward-compatible migration and import). A surname now counts on its own
   and is refused behind a different first name; see `docs/DECISIONS.md` for
   why the refusal is `unresolved` rather than auto-incorrect.

Verification performed locally:

- All 13 previously-confirmed false-positive gradings now return `unresolved`.
- Regression sweep over all 50 questions: every canonical answer and alias,
  including uppercase and padded variants, still grades correct.
- Seven questions with answers under four characters ("T", "The Who", "You",
  "TLC", "NPC", "PBR", "Fry") now need an exact match, so filler phrasing like
  "it's the who" requires one reviewer ruling that then applies to every
  matching submission retroactively and prospectively. This is a deliberate
  trade and should be expected in the Review Queue during the event.

- Person grading checked against the bank with the flag set on the ten
  person-name questions (Q3, Q10, Q12, Q17, Q22, Q23, Q29, Q32, Q44, Q48): the
  bare surname and the full name grade correct in every case, and the surname
  behind a different first name is unresolved in every case. "Mel Brooks" for
  Garth Brooks and "George Bush" / "Barbara Bush" for Kate Bush no longer
  score. Q29 "Jayne Mansfield" gains bare-surname acceptance, which it never
  had because it carries no surname alias.

Next steps:

1. Owner review of the grading trade-off above, particularly the seven
   short-answer questions.
2. Resolve the person-flag decision recorded in the rc26 entry above.
3. Two structural items from the same review remain open and were **not**
   changed: the admin screens are split by hiding sections rather than
   rendering per route (every route still runs all queries and ships the full
   player table), and the Review Queue still cannot surface auto-`correct`
   answers for spot-checking.

## 2026-08-02 — Tester-feedback layout and split admin deployed as rc25

- Removed the confusing abandonment warning from the player intro and hid its
  now-unused admin controls without deleting stored copy, making rollback easy.
- Enlarged the category badge. Ready and question states now share a fixed
  play stage and action zone; prompt text starts at 38px and shrinks only as
  needed, down to 18px, within a fixed 220px prompt area.
- Automated Chrome checks at 1280x900 and 390x844 measured a 0px button-position
  difference between Show question and Submit Answer. Tested prompts had no
  overflow (38px desktop and 24px mobile); the warning was absent, content was
  present, and no error overlay appeared. The sole console error was a harmless
  missing favicon request.
- All 32 tests, TypeScript, JavaScript syntax, and diff checks pass. Commit
  `45eafd7` and tag `timed-quiz-v0.1.0-rc25` are pushed and deployed after
  verified backup `quiz-20260802T145905Z.sqlite.gz`.
- Split the formerly single long admin page into real routed screens at
  `/admin/questions`, `/admin/players`, `/admin/progress`, and `/admin/review`
  with persistent active navigation. Browser verification confirmed only the
  intended panels are visible on each route.
- Review Queue now includes all existing manual rulings and Correct/Incorrect
  controls for correcting mistakes; changing one uses the same global
  retrospective/prospective regrading path.
- Question preview now shares the exact fixed stage and prompt-fitting helper
  with player mode. Questions 1, 4, and 32 all placed Submit at y=655 (0px
  range), with fitted fonts of 37px, 34px, and 28px and no overflow. The final
  admin/preview browser run reported no errors.
- Production health reports rc25. All four admin routes return authenticated
  login gating, deployed source markers match the features, completion settings
  remain enabled, and CASS remains HTTP 200. Deployment sent no email.
- Natural tester activity separately verifies completion mail end to end: six
  completion audit events succeeded, all six attempts have notification
  timestamps, and none has an error. Two completed attempts predate the feature
  and were not back-sent, as intended.

## 2026-08-01 — Completion notification deployed and enabled

- Added configurable admin email for every completed real or test attempt.
  It includes identity, test status, score, answer time, completion timestamp,
  and a direct authenticated answer-sheet link.
- Each attempt is claimed in SQLite before the asynchronous gateway call, so
  repeated completion requests and sweeps cannot duplicate the message. The
  results table shows sent, failed, or ambiguous state; failures are logged and
  never automatically retried because an ambiguous provider response could
  otherwise duplicate mail.
- All 32 tests, TypeScript, and diff checks pass. Commit `27fd65e` and tag
  `timed-quiz-v0.1.0-rc24` are pushed and rc24 is deployed after verified
  backup `quiz-20260802T020906Z.sqlite.gz`.
- Notifications are enabled for the owner address stored in SQLite. Verified
  live release/schema/UI markers, active service, unchanged gateway audit
  count, and CASS HTTP 200; configuration sent no email. Post-configuration
  backup `quiz-20260802T021010Z.sqlite.gz` passes integrity checks. Functional
  production verification awaits the next genuine real or test completion.

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
