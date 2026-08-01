# Timed Quiz

Timed Quiz is a standalone Node/Express/SQLite platform for personalized,
server-timed online quizzes. Its first production use is the Trivia Workshop
Pop Culture Bee preliminary quiz at `https://bee.triviaworkshop.com`.

## Current release

- 50 sequential questions with a server-authoritative 20-second window.
- Passwordless personalized invitation links.
- CASS-compatible automatic grading plus a grouped human-review queue.
- Administrative question editing, player import, technical restarts, ranked
  results, and CSV export.
- Ranking by score, then total server-measured answer time across all finalized
  scored questions, regardless of verdict.
- Google Workspace relay delivery with quota checks and resumable batches;
  there is deliberately no unreliable mail fallback.

## Production target

- Host: the existing CASS DigitalOcean droplet.
- URL: `https://bee.triviaworkshop.com`.
- Runtime: one Node 24 process, isolated from CASS's Node 20/PM2 services.
- Data: one persistent SQLite database; never run multiple app instances
  against it.

See `docs/CURRENT-STATE.md`, `docs/DEPLOYMENT.md`, and `docs/HANDOFF.md` before
making release or production changes.
