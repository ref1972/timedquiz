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

Current deployed rehearsal release: `timed-quiz-v0.1.0-rc16`. Certbot manages
the live nginx TLS additions, so provisioning only installs the base nginx
file when the site does not already exist.

The Workspace Apps Script quota endpoint is deployed and the existing relay
URL/secret are configured in `/etc/timed-quiz.env`. A test send was accepted on
2026-08-01 with quota moving 97 → 96; the owner confirmed delivery and a
working personalized link. Header inspection remains pending. Rotate the shared
secret across Apps Script, WordPress, and Timed Quiz before the real player
send.

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

## Rollback

- Code-only fault: restore the prior tagged code and restart the service while
  retaining the current database.
- Before real play: restoring a clean database backup is safe when deliberate.
- After attempts begin: preserve the current database before any repair and do
  not restore an older copy casually because it would erase player activity.
- Email fault: stop the batch. Never advance the failed recipient or fall back
  to another mail transport automatically.
