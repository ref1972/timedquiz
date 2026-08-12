# Timed Quiz

Timed Quiz is a standalone Node/Express/SQLite platform for personalized,
server-timed online quizzes. Its first production use is the Trivia Workshop
Pop Culture Bee preliminary quiz at `https://bee.triviaworkshop.com`.

The application supports multiple numbered games. Players, questions, attempts,
results, and grading stay attached to their game. Complete games with no cutoff
or a future cutoff are available through a public game chooser; a player may
play each available game independently. The single active-game flag now scopes
admin invitation and reminder email operations rather than player access.

## Current release

- 50 sequential questions with a server-authoritative 25-second window.
- Passwordless personalized invitation links.
- CASS-compatible automatic grading plus a grouped human-review queue. A
  contained answer counts only on a whole-word boundary and above a minimum
  length; anything else goes to review rather than being auto-accepted.
- Administrative question editing, player import, technical restarts, ranked
  results, and CSV export.
- Ranking by score, then total server-measured answer time across all finalized
  scored questions, regardless of verdict.
- Google Workspace relay delivery with quota checks and resumable batches;
  there is deliberately no unreliable mail fallback.
- One-time reminder batches for invited real players who have not completed,
  with an admin-editable subject/body, personalized link placeholder, and a
  default midnight Central time Thursday deadline.
- Configurable one-per-attempt admin email when any real or test player
  completes, with score, answer time, and an admin answer-sheet link.

## Production target

- Host: the existing CASS DigitalOcean droplet.
- URL: `https://bee.triviaworkshop.com`.
- Runtime: one Node 24 process, isolated from CASS's Node 20/PM2 services.
- Data: one persistent SQLite database; never run multiple app instances
  against it.

See `docs/CURRENT-STATE.md`, `docs/DEPLOYMENT.md`, and `docs/HANDOFF.md` before
making release or production changes.
