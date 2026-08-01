# Pop Culture Bee — preliminary quiz

A "best of both worlds" build combining two independent prototypes:
[`pop-culture-bee-quiz-claude/`](../pop-culture-bee-quiz-claude/) (rigorous
timing-engine tests, clean module separation) and the `agent/pop-culture-bee-quiz-codex`
branch (a far more complete feature set: invite tokens, admin imports, a
grading review queue, and restart-as-new-generation). See
[`../docs/POP-CULTURE-BEE-QUIZ.md`](../docs/POP-CULTURE-BEE-QUIZ.md) and
[`../docs/POP-CULTURE-BEE-QUIZ-CODEX-DESIGN.md`](../docs/POP-CULTURE-BEE-QUIZ-CODEX-DESIGN.md)
for the two design documents this reconciles.

## Running it

```bash
npm install
npm run seed     # 50 real questions from the Tangents quiz-bee export + a local test player
npm start        # http://127.0.0.1:8080
```

`npm run seed` prints an invite link for a local test player — open it to play.
Admin is at `/admin`, password from `ADMIN_PASSWORD` (defaults to
`local-dev-only-password` outside production).

Other scripts:

```bash
npm test         # fast unit tests: timing, grading, restart-as-new-generation
npm run dev      # auto-restart on file change
npm run typecheck
npm run preflight   # production configuration/database readiness check
```

## Player and admin experience

- The player interface follows the CASS visual language: CASS blue page,
  white card, purple actions, orange timer, readable system typography, and a
  persistent light/dark mode toggle.
- Every timed question includes an editable category header and a full-width
  Submit Answer button.
- Before any attempt begins, the admin dashboard can edit each question's
  category, wording, canonical answer, and aliases. The bank freezes after the
  first attempt to preserve competitive integrity.
- Automatic grading matches CASS: lowercase and trim, ignore one leading
  article (`the`, `a`, or `an`), then accept an exact match or a player answer
  containing the canonical answer or an alias. Nonmatches still enter this
  app's grouped human-review queue.
- **Bug found and fixed during live verification**: the theme toggle used
  `document.querySelector("button")` in `ready()` to disable the button that
  had just been clicked, but that unscoped query returns the *first* button
  in the whole page — the theme toggle itself, since it sits before `#app` in
  the DOM — not the "Ready"/"Show question" button actually clicked. After
  the very first Ready click of a session, the toggle became permanently
  disabled. Fixed by using `this` (the actual clicked element, since `ready`
  is assigned via `.onclick =`) instead of any selector. Verified live: the
  toggle now survives repeated Ready clicks and works mid-question without
  interrupting the timer.

## What was taken from which prototype, and why

- **Data model and admin feature set: from Codex.** `attempts` modeled
  explicitly with a `generation` column and a partial unique index enforcing
  one current attempt per player (a restart supersedes, never deletes or
  overwrites); `exposures` as one row per question ever served; a
  `grading_rules` table for the human review queue, grouped by distinct
  normalized answer per question rather than by player, matching the design
  requirement that one judgment must apply identically to everyone who typed
  that variant. Question-bank import is frozen the moment any attempt
  exists, so questions cannot change out from under players already
  mid-quiz.
- **Module structure and dependency hygiene: from Claude.** Split into
  `config` / `db` / `crypto` / `grading` / `quiz` (the state machine) /
  `auth` / `admin` routes / `player` routes / `views`, instead of one file
  mixing schema, HTTP routing, HTML templates, and business logic together —
  a structure this hard to audit is a real cost on a system where a top-N
  cut has to be defensible. Two static files served from named routes
  instead of a static-file middleware, avoiding an entire class of
  path-traversal advisory regardless of framework. No build step: Node 24
  strips TypeScript types natively.
- **A real bug fixed, found while comparing the two:** Codex's prototype
  split "Ready" into two sequential requests — one that fixed the question's
  server-side deadline, and a second, separate one that actually delivered
  the prompt — while its own design document argues (correctly) that the
  deadline must be anchored to the same moment the question reaches the
  player. Here, `serveNext()` (`src/quiz.ts`) creates the exposure and
  returns its prompt and deadline in the exact same call, so there is
  exactly one request's worth of latency for `SUBMIT_GRACE_MS` to absorb,
  not two chained ones.
- **A second gap fixed:** the prototype's review queue updated only
  *already-submitted* answers matching a ruling, so the same normalized
  answer typed by a later player would land back in the queue for review a
  second time. `autoVerdict()` (`src/grading.ts`) now checks `grading_rules`
  first, so a ruling applies to every subsequent matching answer
  immediately — directly serving the design doc's own concern about review
  queue throughput during the tight Thursday-midnight-to-Saturday window.
- **Fast, targeted unit tests: from Claude**, adapted to this data model
  (`src/quiz.test.ts`) — reload-returns-same-question, no-double-answer,
  expired-question-finalizes-from-draft, drafts-refused-after-deadline,
  late-submission-falls-back-to-draft, `finalizeStaleSessions` — plus new
  tests for the two fixes above and for restart-as-new-generation. These run
  in well under a second against a scratch database, instead of the
  prototype's single slow end-to-end smoke script (which included a real
  22-second sleep to exercise the timeout path).

## Timing model

The one rule everything else rests on: **the server decides what question a
player is on and how much time is left, and it decides that at the exact
moment it hands the player the question — not before.**

1. `POST /api/ready` creates the exposure (if one doesn't already exist for
   the next position) and returns the prompt, nonce, and `deadlineAt` in that
   same response.
2. The client renders a visible countdown from `deadlineAt`. A page
   reload's `GET /api/state` returns that same, unmoved deadline, so a
   refresh shows less time remaining, never a fresh 20 seconds.
3. Drafts autosave roughly every 350ms of idle typing and are refused once
   `deadlineAt + SUBMIT_GRACE_MS` has passed.
4. A submission is judged against the server's own clock. Late (but within
   the grace allowance) falls back to the last accepted draft rather than
   using whatever text is still sitting in the request body — a stalled
   client can't smuggle extra thinking time this way.
5. If the deadline (plus grace) passes with no request at all — tab closed,
   phone locked — `expireIfNeeded()` finalizes the question from its last
   draft the next time *anything* touches that attempt (the player
   returning, or the admin page's background sweep — see below). Per the
   owner's chosen abandonment policy, this costs the player exactly that one
   question; the remaining ones are not served until they come back.

## Known gaps — not yet built

- **Hosting is packaged but not provisioned.** `Dockerfile` and
  `compose.example.yaml` run exactly one Node/SQLite instance with a persistent
  `/data` volume. The selected target is the existing CASS droplet at
  `https://bee.triviaworkshop.com`; DNS, TLS, service, and secrets still need
  to be configured.
- **Workspace invitation delivery is implemented but not yet configured or
  live-tested.** The admin can check Apps Script quota, send a test, and send
  resumable five-recipient batches. It never falls back to `wp_mail()`. The
  Apps Script `email_quota` action in
  `../google-apps-script/event-signups/Code.gs` must be redeployed before use.
- **The 50 questions are a real Tangents-derived starting set, but include
  both previously used and unused source material and are not owner-reviewed
  for this event.** Re-import a vetted set via `/admin/questions`
  before opening real play; import is frozen the moment any attempt exists,
  so do this first.
- **N (the cut line) remains an owner decision.** Ranking and CSV export now
  use score descending, then total server-measured time across correct answers
  ascending, then email only as a deterministic final ordering.
- Mobile rehearsal on real phones over real (possibly slow) connections
  has not happened. `SUBMIT_GRACE_MS` is a provisional 2000ms; both design
  docs say to measure and ratify this during rehearsal, not assume it.

## Deployment shape

Build and run one container only; SQLite is intentionally not horizontally
scalable in this release. Mount a persistent volume at `/data`, put the app
behind HTTPS, and keep `.env` outside Git. Before importing real players:

1. Seed or import the final 50-question bank.
2. Set all variables in `.env.example`, including the relay and invitation
   encryption secrets.
3. Run `npm run preflight` against the production database.
4. Create a consistent backup with `scripts/backup-db.sh`.
5. Send a test invitation, check Workspace's live quota, then send real
   invitations in five-recipient batches from `/admin`.
