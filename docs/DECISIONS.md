# Decisions

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
