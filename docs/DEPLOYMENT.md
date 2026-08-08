# Deployment

## Target

- URL: `https://bee.triviaworkshop.com`
- Host: `root@137.184.62.161` (existing CASS DigitalOcean droplet)
- Code: `/var/www/timed-quiz`
- Data: `/var/lib/timed-quiz/quiz.db`
- Backups: `/var/backups/timed-quiz/`
- Listener: `127.0.0.1:8080`

The droplet runs CASS on Node 20/PM2 ports 3000 and 3001. Install Node 24 side
by side for Timed Quiz; do not replace CASS's runtime or processes. Use a
dedicated system user and systemd service plus a separate nginx virtual host
and Certbot certificate.

Current deployed release: `timed-quiz-v0.1.0-rc34`. Certbot manages
the live nginx TLS additions, so provisioning only installs the base nginx
file when the site does not already exist.

The live cutoff is `2026-08-07T06:00:00Z`, which is 1:00 AM Central Daylight
Time on Friday, August 7. The one-hour operational grace is deliberate; public
reminder copy continues to state that the deadline is midnight Thursday.

One real player has completed an attempt, so the question bank is frozen:
individual question edits and full-bank import both return 409. The
`answer_is_person` grading flag is deliberately exempt and stays editable at
`POST /admin/question/:id/grading` — see `docs/DECISIONS.md`.

Production uses `https://mail.triviaworkshop.com/v1/mail` with client ID
`timed_quiz` and its app-specific secret in `/etc/timed-quiz.env`. A no-send
capacity check succeeds with zero gateway acceptances. The older Apps Script
transport remains an explicit rollback option, but there is no automatic
fallback. One owner-authorized gateway test plus header/log inspection are
still required before a real player send.

Completion notifications are configured in the admin screen and stored in
SQLite, not environment variables. They are enabled in production for the
owner address as of rc24; each future completed real or test attempt consumes
one gateway message. Configuration alone does not send a message.

The fixed player-stage layout introduced after rc24 is explicitly an owner
evaluation experiment and can be reverted independently of quiz timing/data.
Before release, verify Ready/question button coordinates and prompt overflow at
desktop and phone widths.

`timed-quiz-backup.timer` creates a consistent compressed SQLite backup in
`/var/backups/timed-quiz` daily around 04:15 UTC. Before a real invitation
send, also trigger it manually and retain a verified off-host copy.

The tracked `scripts/provision-droplet.sh` installs the pinned Node runtime
under `/opt`, uploads a local Git archive of a tagged release (so deployment is
independent of repository visibility and server credentials), creates the isolated user/data
layout, generates initial secrets, seeds a rehearsal database only when none
exists, installs the systemd/nginx definitions, and verifies local health. It
does not configure email, a cutoff, or TLS and does not send anything.

## Release gates

1. Run `npm ci`, `npm test`, and `npm run typecheck`.
2. Freeze and import the owner-approved question bank before any attempt.
3. Configure every value in `.env.example` outside Git.
4. Run `npm run preflight` against the intended production database.
5. Run `scripts/backup-db.sh` and retain an off-host copy.
6. Verify `/health`, release identifier, admin login, invitation redirect,
   timing, review, restart, ranking, and CSV export.
7. Check live Workspace quota and send exactly one test invitation before any
   real batch.

Run exactly one application process against the SQLite database.

Admin sessions last 12 hours. Login return paths are restricted to the four
known `/admin/...` screens and an optional simple section hash; never broaden
this validation to arbitrary URLs because that would create an open redirect.

## Rollback

- Code-only fault: restore the prior tagged code and restart the service while
  retaining the current database.
- Before real play: restoring a clean database backup is safe when deliberate.
- After attempts begin: preserve the current database before any repair and do
  not restore an older copy casually because it would erase player activity.
- Email fault: stop the batch. Never advance the failed recipient or fall back
  to another mail transport automatically.
