# Current state

Last updated: 2026-08-11.

## Source and verification

- Optional passwordless email accounts and per-game public scoreboards are
  implemented for the next release. Magic links are stored only as hashes,
  expire after 15 minutes, work once, and require verified email ownership
  before invitation histories are linked. Guest play remains available.
  Account dashboards show linked game status and expose scores only after all
  answers are graded. Scoreboards similarly exclude test players, superseded
  attempts, in-progress attempts, and any completed attempt with an unresolved
  answer. Local verification passes 49 tests, TypeScript, `git diff --check`,
  and browser checks of login, scoreboard, token consumption, and dashboard.
- At the owner's request, production Game 3 was renamed
  `ARCHIVED — Quick Workflow Test` and closed, removing it from the chooser.
  Its one completed attempt and two answers were retained rather than deleted,
  and audit event `test_game_archived` records the change.
- Configurable per-game question counts are deployed as rc38,
  while existing games retain the 50-question default. A game becomes playable
  only when its actual question count matches its configured requirement; this
  permits a deliberately short workflow-test game without allowing partially
  imported live games onto the chooser. Automated coverage completes and
  reveals results for a two-question public game. Production Game 3 is
  `TEST — Quick Workflow (2 Questions)`, is not the active email/admin game,
  has no cutoff, and appears on the public chooser. Its two deterministic
  answers are `4` (alias `four`) and `blue`. Pre-deploy backup
  `quiz-20260812T002640Z.sqlite.gz` passed integrity checks; production
  preflight, health, chooser, and CASS checks pass.
- Player completion copy and button labels are admin-editable in deployed
  release rc37. The completion screen always links back to the public game
  chooser and offers a player-only score/answer sheet only after every submitted
  answer has a final verdict. While any verdict is unresolved, the score and
  answers remain hidden and the results page shows an editable pending message.
  Verification passes 49 tests, TypeScript, and `git diff --check`; scratch
  browser checks covered both pending and fully graded attempts with no console
  errors. Pre-deploy backup `quiz-20260812T001916Z.sqlite.gz` passed gzip and
  SQLite integrity checks. Production health reports rc37, active-event
  preflight passes, both games remain public, all 104 archived attempts remain
  preserved, no public player or unresolved answer was introduced, and the
  239 historical email audit events are unchanged.
- Public-access and multi-game chooser support is deployed as rc36. Any
  complete game with no cutoff or a future cutoff appears on
  the home page. New players register with a display name only; invited players
  retain their personalized identity and can play either available game, with
  separate player/attempt history per game. Public and chooser-created records
  are excluded from invitation, reminder, player-list export, and completion
  email pipelines, while remaining visible in results and grading.
- The existing active-game flag remains the safety boundary for admin email
  operations, but no longer invalidates an otherwise playable game's existing
  invitation links.
- Verification passes 47 tests and TypeScript typechecking. A scratch two-game
  browser flow rendered both game cards, registered a public player into Game
  1, returned to the chooser, switched to Game 2, and reported no console
  errors.
- Before reopening, the previous rankings were exported into four local,
  untracked CSV archives: real and test standings for each game. Backup
  `quiz-20260812T000626Z.sqlite.gz` passed gzip and SQLite integrity checks
  before the archive/reset transaction. The transaction preserved all 104
  attempt generations and their answers as `superseded`, cleared both game
  cutoffs, and recorded one `scores_archived_for_public_reopening` audit event
  covering the 102 attempts that had been current.
- Release `timed-quiz-v0.1.0-rc36` is deployed after post-archive backup
  `quiz-20260812T001036Z.sqlite.gz`, which passed gzip and SQLite integrity
  checks. Production preflight passes with no cutoff; both games have 50
  questions and appear on the public chooser; health reports rc36; the service
  is active; the live database has zero public players immediately after
  verification; the mail-event count is unchanged; and CASS is HTTP 200.

- Multi-game support is deployed as rc34. The additive migration creates
  Game 1 and attaches every existing player and question to it without changing
  their primary keys, so attempts, exposures, grading rules, and audit history
  remain connected. Admin can create, select, and activate numbered games;
  every question/player/progress/grading query and export is scoped to the
  selected game. Only the active game's invitation links can open a quiz, and
  invitation/reminder sends are refused for inactive games.
- Automated verification passes 45 tests and TypeScript typechecking.

- Extracted with path-specific Git history from the TriviaNationals repository
  into the standalone `ref1972/timedquiz` project.
- Launch hardening includes encrypted/rotatable invitations, quota-safe email
  batches, server-measured timing tiebreaks, post-cutoff authorized restarts,
  admin login throttling, preflight, backups, and deployment packaging.
- Admin sign-in accepts only validated internal admin return destinations and
  preserves the current section hash. If the 12-hour session expires while an
  admin follows Players → Invitations, signing in returns to that exact panel
  instead of silently dropping the operator on Questions.
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
- The admin Grading screen (formerly Review Queue) lists **every** distinct
  answer given to every question, grouped by question, after the CASS host
  Grading panel. Each question header shows its accepted answers and an
  "N of M correct (P%)" statistic. Answers awaiting a decision appear first;
  answers already counted correct or incorrect are collapsed but always one
  click from reversal. Automatic verdicts are badged `auto` and human ones
  `ruled correct/incorrect`. Identical answers share one row and one decision,
  which continues to regrade every matching past submission and to apply
  prospectively.
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
- The Players screen has a confirmed reminder action for invited real players
  who have not completed their current quiz. It excludes test, completed,
  never-invited, unrecoverable-link, and already-reminded accounts; preflights
  enough relay capacity for the whole eligible group; includes each recipient’s
  encrypted-at-rest personalized link; records success/failure for safe retry;
  and states that the deadline is midnight Central time Thursday.
- Reminder email subject/body are editable on the Players screen and stored in
  SQLite. The current deployed wording remains the default; `{{name}}` and the
  required `{{link}}` placeholder are safely substituted in plain-text and HTML
  mail. Saving the template does not send anything.
- The admin Player intro panel controls all opening-card wording. Values are
  stored in SQLite and returned dynamically before an attempt starts; quiz
  mechanics remain code-enforced.
- Every question editor has an admin-authenticated Player preview. It uses the
  shared live prompt formatter and player styling with previous/next navigation,
  but creates no player, attempt, timer, answer, invitation, or email activity.
- Between questions, the Ready screen shows the upcoming category while keeping
  the prompt hidden until the player deliberately starts the 25-second window.
- Each Grading row shows the submitted answer, how many players gave it, how
  many of those are real rather than test accounts, and any reviewer note.
- Admin provides separate real-results and test-results CSV downloads so
  rehearsal accounts can be analyzed without entering real rankings.
- Every player row links to an authenticated answer sheet showing all attempt
  generations, questions, submissions, accepted answers, verdicts, per-question
  elapsed time, and finalization reason.
- Ranking uses score followed by Answer time: server-measured elapsed time for
  every finalized included question, regardless of verdict. Ready screens and
  breaks are excluded.
- The authoritative per-question window is 25 seconds. Ready, countdown, and
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
  blocked after any attempt because it deletes/recreates question records. The
  `answer_is_person` grading flag is exempt from the content lock and has its
  own route; the content editor never writes it, so saving a question cannot
  clear it.
- The frozen Questions screen has an explicit, persistent switch
  that unlocks only category and question wording. Answers, aliases,
  highlighted text, scoring, and full-bank import remain protected. Each
  toggle and saved text change is audit-logged.
- Progress uses responsive per-player cards instead of an 11-column
  horizontally scrolling table. The cards retain score/time, status, answer
  sheets, completion/invitation state, link rotation, and restart controls.
- Progress has a browser-persistent Show test players control, allowing the
  operator to hide rehearsal accounts without changing exports, rankings, or
  stored data.
- The Player list imported success page uses a distinct continuation URL, so
  Continue to invitation setup performs a GET of the Players admin screen
  before applying the Invitations anchor instead of silently changing the hash
  on the standalone POST response.

## Production

- Selected URL: `https://bee.triviaworkshop.com`.
- Selected host: the existing CASS DigitalOcean droplet, isolated behind its
  own service, localhost port, nginx virtual host, data, and backups.
- Both Game 1 and Game 2 are always open with `closes_at = NULL`. The public
  chooser allows a display-name-only registration into either game, and an
  invited player can use the same identity to play both independently.
- Game 2 question 1's canonical answer is corrected from `Stanley Tuchi` to
  `Stanley Tucci`. Existing Tucci grading and all 16 correct Tucci submissions
  were unchanged. Audit event `11573` records the edit; backup
  `quiz-20260809T220050Z.sqlite.gz` passed gzip and SQLite integrity checks.
- Dan Burgess's Game 2 question 15 answer was owner-corrected from
  `my weird addiction` to `my strange addiction`, with normalized answer and
  verdict updated to correct. His resulting score is 43. Audit event `11562`
  records the change; backup `quiz-20260809T215909Z.sqlite.gz` passed gzip and
  SQLite integrity checks beforehand.
- Active Game 2, `2026 Pop Culture Bee Finals`, closes at 4:00 PM Pacific /
  6:00 PM Central on Sunday, August 9, 2026
  (`2026-08-09T23:00:00.000Z`). The owner first extended it from 10:00 AM to
  2:00 PM, then reopened it at 2:55 PM to give one player roughly another hour.
  Backup `quiz-20260809T190014Z.sqlite.gz` passed gzip and SQLite integrity
  checks before the one-row update. Production preflight passes with 50
  questions, 17 players, and 12 attempts; no email was sent.
- Five reminders were intentionally resent to every unfinished real Game 2
  player after the extension. The saved template now states the 2:00 PM Pacific
  Sunday deadline. All five relay sends succeeded with five matching audit
  events and no reminder errors; backup `quiz-20260809T190506Z.sqlite.gz` passed
  gzip and SQLite integrity checks immediately beforehand.
- Kelsey Barcomb received a subsequent individual reminder with the 4:00 PM
  cutoff and her personalized link. The relay accepted the message, its audit
  record has no error, and the exact link returned the expected quiz redirect.
  Backup `quiz-20260809T215515Z.sqlite.gz` passed gzip and SQLite integrity
  checks before the extension.
- Release `timed-quiz-v0.1.0-rc34` is deployed and verified after backup
  `quiz-20260808T181151Z.sqlite.gz`, which passed gzip and SQLite integrity
  checks. The migration retained 85 players, 50 questions, 87 attempts, and
  4,336 exposures in active Game 1 with no foreign-key violations. Production
  preflight passes with the intentional existing-attempt override; public
  health reports rc34; Timed Quiz is active; both CASS PM2 services are online;
  and the CASS public site is HTTP 200. No invitation, reminder, or other email
  was sent during deployment.
- Release `timed-quiz-v0.1.0-rc33` is deployed and verified after backup
  `quiz-20260806T044622Z.sqlite.gz`, which passed gzip and SQLite integrity
  checks. Public health reports rc33; the reminder route, Players UI, template,
  and additive reminder schema are live; the enforced cutoff is 1:00 AM Central
  Friday (`2026-08-07T06:00:00Z`) while public reminder copy says midnight
  Thursday; counts remain 64 attempts / 3,186 exposures / 50 questions / 82
  players; both CASS PM2 services are online and its public site is HTTP 200.
  No reminder or other email was sent during deployment.
- Release `timed-quiz-v0.1.0-rc32` is deployed and verified after backup
  `quiz-20260803T045431Z.sqlite.gz`: public health and `RELEASE_ID` report
  rc32, the import-continuation and persistent test-filter source/CSS markers
  are live, the timer remains 25 seconds, counts remain 15 attempts / 736
  exposures / 50 questions / 76 players / 167 grading rules, and CASS is HTTP
  200. No email was sent.
- Release `timed-quiz-v0.1.0-rc31` is deployed and verified after backup
  `quiz-20260803T042400Z.sqlite.gz`: public health and `RELEASE_ID` report
  rc31, `QUESTION_DURATION_MS=25000`, deployed defaults and both stored
  player-facing messages say 25 seconds with no remaining 30-second wording,
  counts remain 13 attempts / 588 exposures / 50 questions / 11 players / 152
  grading rules, and CASS is HTTP 200. No email was sent.
- Release `timed-quiz-v0.1.0-rc30` is deployed and verified after backup
  `quiz-20260803T040541Z.sqlite.gz`: public health and `RELEASE_ID` report
  rc30, the question-text override is present and defaults off, responsive
  Progress CSS/source markers are live, counts remain 12 attempts / 586
  exposures / 50 questions / 11 players / 152 grading rules, and CASS is HTTP
  200. Deployment sent no email.
- Release `timed-quiz-v0.1.0-rc26` is deployed and verified: public health and
  `RELEASE_ID` report rc26, the live schema carries `answer_is_person`, counts
  are unchanged at 9 attempts / 436 exposures / 50 questions / 9 players / 103
  grading rules, all four admin routes gate to sign-in, and CASS remains HTTP
  200. Preceded by verified backup `quiz-20260802T201145Z.sqlite.gz`; no email
  was sent.
- Release `timed-quiz-v0.1.0-rc27` was deployed and verified after backup
  `quiz-20260802T202931Z.sqlite.gz`: health and `RELEASE_ID` reported rc27, the
  grading route was present, counts were unchanged, CASS remained HTTP 200, and
  no email was sent.
- Release `timed-quiz-v0.1.0-rc28` is deployed and verified after backup
  `quiz-20260802T204831Z.sqlite.gz`: health and `RELEASE_ID` report rc28, the
  Grading panel markup and query are present and the old unresolved-only
  queries are gone, data is unchanged at 9 attempts / 436 exposures / 103 rules
  / 324 correct answers, CASS remains HTTP 200, and no email was sent.
- Release `timed-quiz-v0.1.0-rc29` is deployed and verified after backup
  `quiz-20260802T212542Z.sqlite.gz`: health reports rc29, validated return-path
  and hash-preservation markers are live, the sign-in page at
  `/admin/players#invitations` carries the Players return destination, player
  counts remain 11 total / 3 real / 8 test, and CASS remains HTTP 200. No
  email was sent.
- The question bank is frozen by a real completed attempt, so question content
  cannot be edited. The `answer_is_person` grading flag is deliberately exempt
  and has its own admin route; it changes no content and no stored verdict.
- All ten person questions (Q3, Q10, Q12, Q17, Q22, Q23, Q29, Q32, Q44, Q48)
  are flagged in production, set by the owner through the admin screen while
  the bank was frozen.
- Release candidate `timed-quiz-v0.1.0-rc25` was previously deployed on the droplet
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
