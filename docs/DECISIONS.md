# Decisions

## 2026-08-01 — CSV is the primary question-bank interchange format

The admin supports downloading the current bank and uploading an edited CSV so
the owner can work in Excel or Google Sheets. The fixed columns are position,
category, question, answer, and aliases; aliases use `|` within their cell.
JSON remains accepted as a compatibility path.

## 2026-08-01 — Admin password changes live in the database and revoke sessions

The admin dashboard may replace the bootstrap environment password after
verifying it. Timed Quiz stores only a random-salted scrypt hash in SQLite and
increments an admin-session version on every change so all existing sessions
are invalidated immediately.

Reason: operators need safe self-service without editing server files, while a
plaintext database setting or continuing to accept the bootstrap password
would undermine the change.

The UI recommends a long, unique password but enforces no minimum length at the
owner's direction; it rejects only blank values and values over 256 characters.

## 2026-08-01 — Landing-page copy will be admin-editable

Add a dedicated **Player intro** admin panel for the player landing screen.
Staff may edit the eyebrow, title, introductory instructions, leave-warning
copy, no-feedback/advancement text, and Ready button label. These are display
settings only; the server remains authoritative for timing, abandonment,
cutoff, scoring, and attempt state.

Reason: the owner needs to refine player-facing event language close to launch
without a code deployment, but prose must not be able to change competitive
behavior.

## 2026-08-01 — Timed Quiz is a standalone project

The reusable timed-quiz application lives in `ref1972/timedquiz`; TriviaNationals
retains only shared integration source and a project pointer. “Timed Quiz” is
the platform/project name, while “Pop Culture Bee” remains the current game's
player-facing name.

Reason: the app has its own runtime, database, domain, deployment, and release
cycle. Separating it avoids deploying the broader TriviaNationals repository
and makes later games easier to support.

## 2026-08-01 — Use one Node/SQLite instance and Workspace-only email

Production uses one always-on Node 24 process and one persistent SQLite
database. Invitation email goes only through the existing authenticated Google
Workspace Apps Script relay, pauses on errors/quota exhaustion, and never uses
an unverified fallback.

## 2026-08-01 — Rank ties by correct-answer time

Rank by score descending, then total server-measured elapsed time for correct
answers ascending, with email only as a deterministic final ordering. Client
countdowns never determine the stored timing result.

## 2026-08-01 — Deploy beside CASS at `bee.triviaworkshop.com`

Use the existing CASS DigitalOcean droplet with a separate Node 24 runtime,
service, localhost port, nginx virtual host/certificate, data directory, and
backups. Leave CASS's Node 20/PM2 services untouched.
