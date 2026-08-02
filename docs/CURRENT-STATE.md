# Current state

Last updated: 2026-08-02.

## Source and verification

- Extracted with path-specific Git history from the TriviaNationals repository
  into the standalone `ref1972/timedquiz` project.
- Launch hardening includes encrypted/rotatable invitations, quota-safe email
  batches, server-measured timing tiebreaks, post-cutoff authorized restarts,
  admin login throttling, preflight, backups, and deployment packaging.
- Automated verification passes 36 tests and TypeScript typechecking.
- Questions carry `answer_is_person`, set by a checkbox in the question editor
  or a `person` column in the question CSV. It accepts the canonical answer's
  last word as a bare surname without needing an alias, and refuses that
  surname behind a different first name. A hand-written partial alias such as
  "Bush" on "Kate Bush" gets the same treatment with or without the flag.
  Refused submissions go to the review queue rather than being auto-marked
  incorrect.
- Automatic grading accepts an exact answer, or one contained in a longer
  submission only when the accepted answer matches on a whole-word boundary and
  is at least four characters unless it contains a space. Everything else is
  `unresolved` for the review queue. This closed a defect in which short
  answers auto-accepted wrong submissions and hid them from review, because the
  queue surfaces only unresolved answers.
- Served question states carry `serverNow` beside `deadlineAt`, and the player
  countdown measures from it using the device clock only as a stopwatch. A
  device with a wrong clock can no longer show an already-expired question and
  auto-submit blank answers.
- The application trusts one proxy hop, so the admin sign-in throttle applies
  per client address instead of grouping every request under nginx's localhost
  address. Expired throttle buckets are pruned.
- Admin can enable one completion email per attempt and set its recipient.
  Real and test players are included. The notification reports identity,
  test/real status, score, answer time, completion time, and an authenticated
  answer-sheet link. A database claim prevents refresh/race duplicates, and
  the Progress table surfaces sent, failed, or ambiguous outcomes. Failed or
  ambiguous sends are not automatically retried.
- The player intro no longer renders the abandonment warning box; testers
  found it confusing. Warning values remain harmlessly stored for rollback but
  are no longer exposed in the intro editor.
- The player question/Ready states use a reversible fixed-stage layout
  experiment: the category is a larger fitted badge, the prompt occupies a
  fixed 220px area and scales from 38px down to 18px to fit, and Show question
  and Submit Answer share the same measured screen position.
- Admin is split into four routed screens with persistent navigation:
  Questions & Answers, Players, Progress, and Review Queue. Player intro,
  invitation, and security tools live under Players; completion notification
  controls live under Progress.
- Review Queue also lists every prior manual correct/incorrect ruling with its
  question, normalized submitted answer, affected-player count, note, and
  controls to change the ruling. Changes continue to regrade every matching
  past submission and apply prospectively.
- Admin question preview now uses the same shared player stage and prompt-fit
  function. Browser checks across questions 1, 4, and 32 measured an identical
  Submit y-coordinate with no prompt overflow.
- The live admin can change its own password by supplying the current password
  and a nonblank replacement of at most 256 characters. Length is recommended,
  not enforced, at the owner's direction. Only a salted scrypt hash is stored in
  SQLite, and a successful change invalidates every existing admin session.
- Question-bank import supports a CSV download/edit/upload round trip with
  position, category, question, optional highlighted text, answer, and
  pipe-separated aliases. Questions support safe `*italic*` title formatting;
  the optional literal highlighted phrase renders in gold. JSON remains
  accepted for compatibility.
- Player management supports a CSV download/edit/upload round trip with email,
  name, and test status. The invitation interface presents counts and a safe
  check-quota/test-send/resumable-real-send sequence.
- The admin Player intro panel controls all opening-card wording. Values are
  stored in SQLite and returned dynamically before an attempt starts; quiz
  mechanics remain code-enforced.
- Every question editor has an admin-authenticated Player preview. It uses the
  shared live prompt formatter and player styling with previous/next navigation,
  but creates no player, attempt, timer, answer, invitation, or email activity.
- Between questions, the Ready screen shows the upcoming category while keeping
  the prompt hidden until the player deliberately starts the 30-second window.
- Each Review Queue row shows the canonical answer and all accepted aliases
  beside the grouped submitted answer for rapid grading comparison.
- Admin provides separate real-results and test-results CSV downloads so
  rehearsal accounts can be analyzed without entering real rankings.
- Every player row links to an authenticated answer sheet showing all attempt
  generations, questions, submissions, accepted answers, verdicts, per-question
  elapsed time, and finalization reason.
- Ranking uses score followed by Answer time: server-measured elapsed time for
  every finalized included question, regardless of verdict. Ready screens and
  breaks are excluded.
- The authoritative per-question window is 30 seconds. Ready, countdown, and
  preview displays read the configured duration dynamically.
- Invitation email subject/body are editable in admin and stored in SQLite.
  Both test and real sends share the template; `{{name}}` and required
  `{{link}}` placeholders are safely substituted into plain-text and HTML mail.
- Test email sends resolve the recipient to that exact imported test player and
  refuse missing or already-completed accounts. They never reuse the first test
  player's personalized token.
- Production uses app-specific bearer authentication to the shared droplet
  Workspace Gmail API gateway. Explicit Apps Script compatibility remains in
  the client as a rollback path, but there is no automatic fallback.
- Individual question editing remains available during test-player rehearsals
  and locks only after a real participant starts. Full-bank replacement remains
  blocked after any attempt because it deletes/recreates question records.

## Production

- Selected URL: `https://bee.triviaworkshop.com`.
- Selected host: the existing CASS DigitalOcean droplet, isolated behind its
  own service, localhost port, nginx virtual host, data, and backups.
- Release candidate `timed-quiz-v0.1.0-rc25` is deployed on the selected droplet
  with a side-by-side Node 24 runtime, dedicated systemd service, rehearsal
  SQLite database, nginx, and HTTPS at `https://bee.triviaworkshop.com`.
- Verified in production: HTTPS health/release/database response, HTTP-to-HTTPS
  redirect, admin authentication, seeded invitation redirect, active service,
  and unchanged CASS availability.
- The daily systemd backup timer is enabled. A manually triggered rehearsal
  backup completed successfully and passed gzip plus SQLite integrity checks.
- The rc22 deployment was preceded by successful backup
  `quiz-20260801T220626Z.sqlite.gz`; production health reports rc22, the
  authoritative environment setting is 30 seconds, stored intro/invitation
  copy contains the new duration and no old duration, and CASS remains HTTP
  200.
- The rc23 deployment was preceded by verified backup
  `quiz-20260802T014933Z.sqlite.gz`. Production now points to the isolated
  Gmail API gateway as client `timed_quiz`; app-specific credential matching,
  no-send capacity (0 accepted, 1,000 remaining), public health, and CASS HTTP
  200 were verified. No invitation or other email was sent.
- The rc7 deployment was preceded by verified backup
  `quiz-20260801T153007Z.sqlite.gz`; production health reports rc7 and CASS
  remains HTTP 200.
- The rc8 deployment was preceded by verified backup
  `quiz-20260801T153559Z.sqlite.gz`; production health reports rc8, the CSV
  controls and bottom-positioned password panel are present, and CASS remains
  HTTP 200.
- The rc9 deployment was preceded by verified backup
  `quiz-20260801T154019Z.sqlite.gz`; production health reports rc9, the player
  CSV and staged invitation controls are present, and CASS remains HTTP 200.
  Deployment did not import players or send email.
- The rc10 deployment was preceded by verified backup
  `quiz-20260801T154816Z.sqlite.gz`; production health reports rc10, the Player
  intro editor is present, and CASS remains HTTP 200. No intro overrides were
  written during deployment, so the existing live wording was unchanged.
- The rc11 deployment was preceded by verified backup
  `quiz-20260801T201101Z.sqlite.gz`; public health reports rc11, the live schema
  contains `highlighted_text`, the emphasis controls/rendering code are
  present, and CASS remains HTTP 200. Existing question content was unchanged.
- The rc12 deployment was preceded by verified backup
  `quiz-20260801T205055Z.sqlite.gz`; public health reports rc12, shared preview
  assets and admin markers are present, and CASS remains HTTP 200. No preview
  activity or template override was written, and no email was sent.
- The rc13 deployment was preceded by verified backup
  `quiz-20260801T210228Z.sqlite.gz`; public health reports rc13, the live
  highlight rule uses the timer's `--cass-orange`, and CASS remains HTTP 200.
- The rc14 deployment was preceded by verified backup
  `quiz-20260801T211418Z.sqlite.gz`; public health reports rc14, the clearer
  test-player invitation label is present, and CASS remains HTTP 200. This was
  display-only and changed no player or email records.
- The rc15 deployment was preceded by verified backup
  `quiz-20260801T211654Z.sqlite.gz`; public health reports rc15, the deployed
  Ready state and player renderer include the upcoming category, and CASS
  remains HTTP 200.
- The rc16 deployment was preceded by verified backup
  `quiz-20260801T212618Z.sqlite.gz`; public health reports rc16, the Review Queue
  accepted-answer query and display are present, and CASS remains HTTP 200.
  This presentation change made no grading rulings or result changes.
- The rc17 deployment was preceded by verified backup
  `quiz-20260801T213008Z.sqlite.gz`; public health reports rc17, the deployed
  test-send lookup requires an exact test-player email match, Marc's account
  remains not started, and CASS remains HTTP 200. No resend was triggered.
- The rc18 deployment was preceded by verified backup
  `quiz-20260801T213529Z.sqlite.gz`; public health reports rc18, the deployed
  individual-edit lock checks only real-player attempts, production has zero
  such attempts, and CASS remains HTTP 200.
- The rc19 deployment was preceded by verified backup
  `quiz-20260801T214416Z.sqlite.gz`; public health reports rc19, separate
  real/test result routes and buttons are present, player counts were unchanged,
  and CASS remains HTTP 200.
- The rc20 deployment was preceded by verified backup
  `quiz-20260801T215040Z.sqlite.gz`; public health reports rc20, the answer-sheet
  route/link/time explanation are present, and CASS remains HTTP 200. The
  read-only deployment changed no submissions, verdicts, or scores.
- The rc21 deployment was preceded by verified backup
  `quiz-20260801T215338Z.sqlite.gz`; public health reports rc21, Answer-time
  query/labels/export are present, rehearsal aggregates confirm incorrect-time
  inclusion, and CASS remains HTTP 200.
- The shared Workspace relay is configured. Its newly deployed quota endpoint
  reported 97 available recipients; one explicitly authorized test invitation
  was accepted and the relay reported 96 remaining. The owner confirmed inbox
  delivery and that the personalized production link worked. Header inspection
  remains pending. No batch or real-player invitation has been sent.
- Timed Quiz rc23 is now cut over from that Apps Script path to the shared
  Gmail API gateway at `mail.triviaworkshop.com`. On 2026-08-01, exactly one
  newly authorized test invitation to test player 8 was accepted by Gmail API
  (HTTP 200 with a provider message ID); the gateway and app audits agree and
  report 999 remaining under the configured 24-hour safety ceiling. The owner
  confirmed inbox delivery; link operation and header inspection remain
  pending. Do not repeat this send. No real-player invitation has been sent
  through the gateway.
- rc24 was deployed after verified backup
  `quiz-20260802T020906Z.sqlite.gz`. Production completion notifications are
  enabled for the owner address stored in SQLite. The live release, all three
  per-attempt notification columns, deployed UI/code markers, unchanged
  gateway audit count, active service, and CASS HTTP 200 were verified. A
  post-configuration backup passed integrity checks as
  `quiz-20260802T021010Z.sqlite.gz`. Configuration itself sent no email; the
  next genuine real or test completion is the pending functional verification.
- Completion notifications are now production-verified through normal tester
  activity: six completed attempts generated six successful notification audit
  events, with notification timestamps on all six and zero errors. Two older
  completed attempts predate the feature and were correctly not back-sent.
- rc25 was deployed after verified backup
  `quiz-20260802T145905Z.sqlite.gz`. Health reports rc25; all four new admin
  routes are present and authentication-gated; deployed markers confirm the
  navigation, reviewed-ruling history, shared preview fitting, fixed player
  stage, and removed warning. Completion settings remained enabled, CASS
  remained HTTP 200, and deployment itself sent no message.
- The closing time remains unset. The deployed database contains only the
  seeded test player and unapproved starting bank; it is not the launch
  database.
- Rotate the shared relay secret across Apps Script, WordPress, and Timed Quiz
  before the real send because it was surfaced during authenticated setup.

## Launch blockers

- Owner review of all 50 questions, categories, answers, and aliases.
- Owner decision on the advancement cut and exact closing time.
- Header inspection for the delivered test invitation, followed by shared
  relay-secret rotation before the real send.
- Real-phone/network rehearsal, clean production database, final player import,
  preflight, and backup.
