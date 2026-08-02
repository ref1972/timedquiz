# Decisions

## 2026-08-02 — A surname counts alone, but not behind a different first name

Questions carry an `answer_is_person` flag, set with a checkbox in the question
editor or a `person` column in the CSV. When set, the last word of the
canonical answer is accepted as a surname without the editor writing it out as
an alias.

A surname — whether flagged or written as an alias like "Bush" on "Kate Bush" —
is treated as shorthand for the canonical answer. It may only be *contained* in
a submission that introduces no word of its own: "Bush" and "Kate Bush" count,
"George Bush" and "Barbara Bush" do not. The same guard covers non-person
shorthand such as "Juicy" on "Juicy Couture".

A surname behind a different first name goes to the **review queue as
unresolved rather than being auto-marked incorrect**. The code cannot
distinguish a wrong person from a misspelled right one ("Katie Bush"), and a
silent incorrect verdict is exactly as unreviewable as the silent correct
verdict this release fixed — the queue surfaces only unresolved answers. One
reviewer ruling then applies to every matching submission, retroactively and
prospectively.

## 2026-08-02 — Contained-answer grading requires a word boundary and length

Automatic grading still accepts an answer that contains an accepted answer, so
"I think it is The Electric Company" counts. Containment now additionally
requires the accepted answer to match on a whole-word boundary, and to be at
least four characters unless it contains a space. Anything else falls to
`unresolved` for the review queue rather than being auto-accepted.

The previous unguarded `includes` check graded a wrong answer correct and hid
it from review, because the queue only ever surfaces `unresolved`. On the real
bank this accepted any answer containing the letter "t" for Q15 (canonical
answer "T"), "Kryptonite" for Q41 "Krypto", "everybody loves raymond" for Q20
"The Body", and "french fry" for Q44's bare "Fry" alias.

The deliberate cost: seven questions with answers under four characters
("T", "The Who", "You", "TLC", "NPC", "PBR", "Fry") now require an exact match,
so a player who writes "it's the who" needs one reviewer ruling — which then
applies to every other player who typed the same thing, retroactively and
prospectively.

## 2026-08-02 — The player countdown measures against the server's clock

Every served question state carries `serverNow` beside `deadlineAt`. The
browser derives the remaining time from the difference and uses the device
clock only as a stopwatch from that point. A device whose clock is wrong is no
longer able to display an expired question (auto-submitting all fifty answers
blank) or an overlong one. Server enforcement was already correct and is
unchanged; this fixes only what the player sees.

## 2026-08-01 — Per-question timer is 30 seconds

At the owner's direction, each question receives a server-authoritative
30-second window. The configured duration is included in player states and used
by Ready/countdown displays; refresh never grants a new window.

## 2026-08-01 — Tiebreak time includes every finalized answer

At the owner's direction, ranking uses score and then the sum of per-question
elapsed milliseconds for every finalized included question, regardless of
correct, incorrect, or unresolved verdict. Ready screens and breaks remain
excluded, and each elapsed value is capped at that question's timer window.

## 2026-08-01 — Player answer history preserves restart generations

Answer sheets display all attempt generations rather than only the current one,
preserving audit context after an authorized restart. The summary uses the same
all-finalized-answer tiebreak calculation as the main results.

## 2026-08-01 — Test attempts do not freeze individual question edits

Individual question edits remain available while all attempts belong to test
players. The first real-player attempt freezes them. Whole-bank replacement is
stricter and remains blocked after any attempt because it deletes/recreates
question identities referenced by exposure and grading history.

## 2026-08-01 — Test email recipient and player identity must match

A test email may only use the personalized token belonging to an imported test
player with the exact recipient email. There is no fallback to another test
account. Completed test accounts require an explicit admin restart before a
new test email, preventing delivery of a link that opens directly to completion.

## 2026-08-01 — Test and real invitations share one editable template

Invitation subject/body live in SQLite and support only `{{name}}` and
`{{link}}` substitution. The link placeholder is required on save. HTML is
generated through escaping rather than accepting arbitrary authored HTML, and
test mail uses the identical content with an automatic subject prefix.

## 2026-08-01 — Question preview is authenticated and inert

Editors can inspect any question in player styling without an invitation. The
preview requires an admin session, shares the production prompt formatter, and
does not run quiz state transitions or write activity to the database.

## 2026-08-01 — Question emphasis uses constrained text markup

Questions allow only `*italic*` markup and one optional literal highlighted
phrase, rendered gold wherever it occurs ignoring capitalization. Arbitrary
HTML is not accepted. This keeps CSV portable and prevents question authors
from introducing executable or unsafe markup.

## 2026-08-01 — Intro wording is data; quiz rules remain code

Opening-screen copy is editable in admin and stored in SQLite. It is rendered
as escaped text, not HTML. The editor cannot change the authoritative timer,
question count requirement, abandonment behavior, cutoff, or grading rules.

## 2026-08-01 — Player CSV import is additive and non-destructive

The primary player-list workflow is download/edit/upload CSV using email, name,
and test columns. Matching email addresses update only name and test status;
missing rows are not deleted, and import never resets attempts, rotates links,
or sends mail. Sending remains a separate staged workflow.

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
