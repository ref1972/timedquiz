# Current state

Last updated: 2026-08-01.

## Source and verification

- Extracted with path-specific Git history from the TriviaNationals repository
  into the standalone `ref1972/timedquiz` project.
- Launch hardening includes encrypted/rotatable invitations, quota-safe email
  batches, server-measured timing tiebreaks, post-cutoff authorized restarts,
  admin login throttling, preflight, backups, and deployment packaging.
- Automated verification passes 21 tests and TypeScript typechecking.
- The live admin can change its own password by supplying the current password
  and a nonblank replacement of at most 256 characters. Length is recommended,
  not enforced, at the owner's direction. Only a salted scrypt hash is stored in
  SQLite, and a successful change invalidates every existing admin session.
- Question-bank import supports a CSV download/edit/upload round trip with
  position, category, question, answer, and pipe-separated aliases. JSON remains
  accepted for compatibility.

## Production

- Selected URL: `https://bee.triviaworkshop.com`.
- Selected host: the existing CASS DigitalOcean droplet, isolated behind its
  own service, localhost port, nginx virtual host, data, and backups.
- Release candidate `timed-quiz-v0.1.0-rc8` is deployed on the selected droplet
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

- Add a dedicated **Player intro** admin panel for editing the invitation
  landing screen's eyebrow, title, introductory instructions, leave-warning
  copy, no-feedback/advancement copy, and Ready button label. The underlying
  timing, abandonment, and scoring behavior remains code-enforced.
- Owner review of all 50 questions, categories, answers, and aliases.
- Owner decision on the advancement cut and exact closing time.
- Header inspection for the delivered test invitation, followed by shared
  relay-secret rotation before the real send.
- Real-phone/network rehearsal, clean production database, final player import,
  preflight, and backup.
