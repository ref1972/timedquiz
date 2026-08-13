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

Current deployed release: `timed-quiz-v0.1.0-rc42`. Certbot manages
the live nginx TLS additions, so provisioning only installs the base nginx
file when the site does not already exist.

Both game cutoffs are intentionally unset for always-open public play. Complete
games with no cutoff appear in the player chooser whether or not they carry the
single active-game flag. That flag now scopes admin invitation and reminder
email operations only. Public and chooser-created players do not enter email
batches or generate completion notification email.

The pre-public standings are retained in four local, untracked CSV exports and
all 104 attempt generations remain in the production database as historical
`superseded` attempts. Never commit the standings archives or a database
backup. Pre-archive backup `quiz-20260812T000626Z.sqlite.gz` and post-archive
backup `quiz-20260812T001036Z.sqlite.gz` both passed integrity checks.

Admin is organized as five screens as of rc42: Games, Questions & Answers,
Players, Progress, and Grading. Games is the public-availability control —
create with an optional cutoff, rename, set the required question count, open,
close, schedule a cutoff, and archive — and it reports chooser membership from
`playableGames()`, so it cannot disagree with the home page. Closing and
archiving change availability only; they delete no player, attempt, or answer.
The `is_active` flag is labeled as what it still controls: the legacy
invitation and reminder email boundary.

The invitation console is collapsed behind one `legacy` disclosure on Players,
rendered only for a game with an invited or test roster. Every invitation and
reminder route, template, and issued `/invite/:token` link is unchanged, so
Games 1 and 2 keep theirs and a private cohort remains possible. Completion
notification scope is now a setting: `invited` (the default, and what
production runs) or `all`. The admin password is stored as a salted scrypt hash
in SQLite once changed through the UI, so `ADMIN_PASSWORD` in
`/etc/timed-quiz.env` is no longer the live credential.

Player completion copy moved to the admin Players screen in rc42. A player can
return to the game chooser from completion and can open their private score and
submitted-answer sheet only after every submitted answer has a final grading
verdict. Backup `quiz-20260812T001916Z.sqlite.gz` passed integrity checks before
rc37 was deployed.

Game 3, `TEST — Quick Workflow (2 Questions)`, intentionally requires two
questions and is public with no cutoff. It remains inactive, so Game 1 retains
the admin invitation/reminder email boundary. Existing games defaulted to and
remain at 50 required questions. Backup `quiz-20260812T002640Z.sqlite.gz`
passed integrity checks before rc38.

Passwordless account sign-in uses the existing Workspace relay only in direct
response to a player's request. Tokens are hashed, single-use, and expire in
15 minutes. Public scoreboards disclose display name, fully graded score, and
answer time for completed non-test attempts only. Backup
`quiz-20260812T003747Z.sqlite.gz` passed integrity checks before rc39.

Admin UI and score exports never display internal `@players.invalid` guest
identifiers: unlinked guests read `Guest — no email`, and linked guests use the
verified account email. Backup `quiz-20260812T004410Z.sqlite.gz` passed
integrity checks before rc40; the active timed-question count was zero before
the service restart.

rc41 binds signed cookies to their purpose, so its deployment intentionally
invalidated all prior player, account, and admin sessions. Deployment waited
for both live players to complete all 50 questions and proceeded only after the
active-window count reached zero. Backup `quiz-20260812T015350Z.sqlite.gz`
passed integrity checks before restart.

Real players have completed attempts, so the active question bank is frozen:
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
