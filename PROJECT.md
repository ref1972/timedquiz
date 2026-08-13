# Timed Quiz

Timed Quiz is a standalone Node/Express/SQLite platform for public,
server-timed online quizzes. Its first production use is the Trivia Workshop
Pop Culture Bee at `https://bee.triviaworkshop.com`.

The application supports multiple numbered games with an explicit required
question count (50 by default). Players, questions, attempts,
results, and grading stay attached to their game. Complete games with no cutoff
or a future cutoff are available through a public game chooser; a player may
play each available game independently. The single active-game flag now scopes
admin invitation and reminder email operations rather than player access.

## Current release

- 50 sequential questions with a server-authoritative 25-second window.
- Admin is organized around games: a Games screen creates, renames, opens,
  closes, and archives them, and states for each whether the public chooser is
  currently offering it and why not. A game may be created with no cutoff.
  Closing or archiving changes availability only and deletes nothing.
- Invitation and reminder email is a retired path, collapsed behind one
  "legacy" disclosure and shown only for a game that actually has an invited
  or test roster. Every route, template, and issued `/invite/:token` link keeps
  working, so a private cohort remains possible.
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
- Configurable one-per-attempt admin email on completion, with score, answer
  time, and an admin answer-sheet link. Its scope is a setting: invited and
  test players only, which is the default, or everyone including the public.
- Admin-editable player completion copy, with a return-to-game-chooser action
  and an optional player answer sheet. A player's score and submitted answers
  remain hidden until every answer in that attempt has a final grading verdict.
- Optional passwordless player accounts use single-use, 15-minute email links
  and can link verified invitation or guest histories across games. Public
  scoreboards include only completed, fully graded, non-test attempts, and
  public registration rejects email-shaped display names. The sign-in email is
  admin-editable, and accounts are visible read-only on the Players screen.

## Production target

- Host: the existing CASS DigitalOcean droplet.
- URL: `https://bee.triviaworkshop.com`.
- Runtime: one Node 24 process, isolated from CASS's Node 20/PM2 services.
- Data: one persistent SQLite database; never run multiple app instances
  against it.

See `docs/CURRENT-STATE.md`, `docs/DEPLOYMENT.md`, and `docs/HANDOFF.md` before
making release or production changes.
