# Current state

Last updated: 2026-08-01.

## Source and verification

- Extracted with path-specific Git history from the TriviaNationals repository
  into the standalone `ref1972/timedquiz` project.
- Launch hardening includes encrypted/rotatable invitations, quota-safe email
  batches, server-measured timing tiebreaks, post-cutoff authorized restarts,
  admin login throttling, preflight, backups, and deployment packaging.
- Automated verification passes 27 tests and TypeScript typechecking.
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
  the prompt hidden until the player deliberately starts the 20-second window.
- Each Review Queue row shows the canonical answer and all accepted aliases
  beside the grouped submitted answer for rapid grading comparison.
- Invitation email subject/body are editable in admin and stored in SQLite.
  Both test and real sends share the template; `{{name}}` and required
  `{{link}}` placeholders are safely substituted into plain-text and HTML mail.
- Test email sends resolve the recipient to that exact imported test player and
  refuse missing or already-completed accounts. They never reuse the first test
  player's personalized token.

## Production

- Selected URL: `https://bee.triviaworkshop.com`.
- Selected host: the existing CASS DigitalOcean droplet, isolated behind its
  own service, localhost port, nginx virtual host, data, and backups.
- Release candidate `timed-quiz-v0.1.0-rc17` is deployed on the selected droplet
  with a side-by-side Node 24 runtime, dedicated systemd service, rehearsal
  SQLite database, nginx, and HTTPS at `https://bee.triviaworkshop.com`.
- Verified in production: HTTPS health/release/database response, HTTP-to-HTTPS
  redirect, admin authentication, seeded invitation redirect, active service,
  and unchanged CASS availability.
- The daily systemd backup timer is enabled. A manually triggered rehearsal
  backup completed successfully and passed gzip plus SQLite integrity checks.
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
- The shared Workspace relay is configured. Its newly deployed quota endpoint
  reported 97 available recipients; one explicitly authorized test invitation
  was accepted and the relay reported 96 remaining. The owner confirmed inbox
  delivery and that the personalized production link worked. Header inspection
  remains pending. No batch or real-player invitation has been sent.
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
