# Pop Culture Bee quiz — brief for Codex

You are being asked for an **independent design take** on a new subsystem for
Trivia Nationals. Claude has produced a plan (`docs/POP-CULTURE-BEE-QUIZ.md`);
the owner wants a second, independently reasoned proposal before any code is
written.

This brief is self-contained. Read the requirements before the existing
proposal, and treat the proposal as one option rather than a baseline to
refine. **Disagreement is the point.** If the design below is wrong, say so
directly and say why.

No code exists yet. Nothing is committed to beyond the fixed requirements in
section 2.

---

## 1. Context

Trivia Nationals runs a live trivia convention. Its web presence is
`trivianationals.org` — WordPress/WooCommerce on HostGator/cPanel shared
hosting, extended by several first-party plugins (event schedule and signups,
passwordless electronic tickets, attendee email, announcements). A placeholder
subdomain `scores.trivianationals.org` serves a static page and will eventually
host a scoring dashboard.

The **Pop Culture Bee** is one of the convention's events. It needs a
preliminary online quiz that determines which invited players advance to the
LIVE Pop Culture Bee game on Saturday.

The owner works with AI coding agents rather than writing most code personally.
The repository is shared durable memory across Claude, Codex, and multiple
machines; see `AGENTS.md`.

Timeline pressure is real: the quiz closes Thursday at midnight Central and the
live game is Saturday.

---

## 2. Fixed requirements

These come from the owner and are settled. Do not redesign around them.

**Gameplay**

- 50 pre-loaded questions.
- Every player sees the same 50 in the same order.
- One question on screen at a time, with a free-text answer box and a submit
  button.
- 20-second limit per question. If the player has not submitted when the timer
  expires, whatever is in the answer field is submitted automatically.
- All questions are **text only** — no audio, image, or video.
- Players receive **no feedback whatsoever**: no right/wrong per question, no
  running score, and no final score. The thank-you screen after Q50 thanks the
  player and states that their score determines whether they advance to the
  LIVE game on Saturday. Results are announced by the owner separately.

**Eligibility and access**

- Players are invited by email. Only addresses on the list may play.
- Players are tracked by email address.
- One attempt per player.

**Timing**

- The quiz is open across a multi-day window; players start whenever they like.
- The window closes **Thursday 11:59pm Central**.
- That deadline is a **start cutoff, not a hard stop** — a player already in
  progress plays to completion.

**Abandonment policy (owner chose the lenient option)**

- If a player stops partway through, the question in flight expires and scores
  as whatever draft the server last received (blank if none) — they lose that
  one question.
- Remaining questions are not served until the player returns.
- Returning resumes at the next unserved question.
- So walking away costs exactly one question. This must be stated on the
  pre-start screen, and an admin "grant a restart" action is required for
  genuine technical failures.

**Scoring**

- Typed free-text answers must be gradable despite spelling and phrasing
  variation, and the owner requires a **human review queue** — exact match
  alone is not acceptable.
- The cut is the **top N players**. N is not yet fixed.

**Architecture**

- This is a **standalone application**, not a WordPress plugin. Confirmed by
  the owner. It needs nothing from WordPress; the eligibility list is a curated
  set of email addresses, not order data.
- A local version must run on the owner's Mac first; it goes online afterward
  and must then be reachable from anywhere.

---

## 3. Open decisions — your input is wanted

**Language and hosting.** The owner is explicitly *not* committed to PHP and
asked for whatever suits this kind of game and admin tool best.

Runtimes confirmed on the owner's Mac (2026-07-31): PHP 8.5.8, Node 24.14.0,
npm 11.9.0, Python 3.14.6, sqlite3 3.51.0. Go is not installed. Local
development is therefore not a differentiator.

Constraints any choice must satisfy:

- Persistent filesystem or database. Purely serverless hosting only works
  paired with hosted Postgres, which may not be worth the complexity at this
  scale.
- Low, predictable response latency. `remaining_ms` is computed server-side, so
  a slow first byte consumes the player's usable answer time even though it
  cannot make timing *unfair*. Cold starts are a player-experience problem.
- Verifiable deploys — "is the live version the reviewed version?" must be
  answerable during event week.

Relevant history: the existing FTPS deploy path to HostGator **truncated a live
file mid-upload** on 2026-07-28. A TLS 1.3 data-channel failure left a 55KB
plugin file empty in production after `curl` reported success. Tolerable for a
single-file plugin with a hash check; a poor fit for a multi-file app with a
hard deadline and no atomic swap.

Claude's provisional recommendation is Node/TypeScript + SQLite on a PaaS
(Fly.io or Render). **Argue for something else if you think something else is
better.** Staying on HostGator has a real counter-argument: no new vendor, no
new bill, no new credential during event week, and it matches the owner's
existing cPanel/FTPS habits.

**Unanswered questions the owner has not yet responded to:**

1. Number of invited players, and the value of N.
2. Who works the review queue and when — does grading need to support two
   concurrent people?
3. Where the 50 questions live today (sets the import format).
4. Whether the 20-second clock starts on render or after a per-question "Ready"
   tap.
5. Whether the player sees progress ("Question 12 of 50") and a countdown.
6. Whether the app sends reminder emails to players who never start.
7. Whether the prelim feeds Saturday beyond producing a cut list.
8. Whether staff will test-play (bears on excluding test accounts from results).

Where an answer would change your design, state the assumption you are making
rather than waiting.

---

## 4. Claude's proposal, for you to critique

**Server-authoritative timing.** Treated as the central constraint. A
client-side countdown is advisory — it can be paused with developer tools, and
a refresh would otherwise grant a fresh 20 seconds. Proposed rules:

1. On delivering question N, the server records `served_at` and derives a
   deadline.
2. The client receives `remaining_ms`, never a flat 20000, so a refresh returns
   the same question with the time actually left.
3. On submit, the server judges lateness by its own clock.
4. If the deadline passes with no submission, the answer is the last draft the
   server received, or blank.

Plus **draft autosave** roughly every 2 seconds, so "whatever is in the field
auto-submits" holds even if the tab dies mid-question.

**Data model.** `players` (email, token hash, timestamps, status, current
position, current `served_at`); `questions` (position, prompt, canonical
answer, aliases); `answers` (raw text, `served_at`, `submitted_at`, elapsed ms,
auto-submitted flag, auto verdict, final verdict, reviewer); `events` as an
append-only log for dispute forensics. All timestamps UTC. Session state on the
`players` row structurally enforces one session per player.

**Grading tiers.** Normalize (lowercase, trim, collapse whitespace, strip
punctuation and diacritics, drop leading articles) → exact or alias match is
auto-correct → near miss by length-scaled Levenshtein goes to the review queue
→ everything else is incorrect but still visible in the queue, so an
unanticipated valid answer can be rescued. Blanks never enter the queue.

**The review queue groups by distinct normalized answer, not by player.** One
judgment applies to everyone who submitted that variant. This collapses the
work and makes identical answers provably graded identically — which is what
makes a top-N cut defensible when someone contests it.

**Scoring.** One point per correct answer; ties break on total server-measured
answer time across correct answers. With a top-N cut, ties will occur exactly
at the cut line, so the tiebreak decides who plays Saturday and must be
recorded from the first commit.

**Admin surfaces.** Question import; player import and token generation;
invites; progress dashboard (invited/started/finished/not started); review
queue; ranked results with CSV export and a deadline lock; per-player "grant
restart".

**Email.** Prefer reusing the existing Google Apps Script relay that sends as
`info@trivianationals.org`, if it can be called from a non-WordPress client
with the shared secret — unverified. Otherwise CSV export and mail merge. The
Gmail Workspace daily quota has already caused problems for the announcements
digest.

**Phases.** 0: author the 50 questions and their alias lists (longest lead
item). 1: local playable core — full flow, server timer, auto-submit,
thank-you screen. 2: identity — allowlist, magic links, one attempt, resume.
3: admin — imports, dashboard, review queue, results. 4: invites, deadline
enforcement, mobile polish. 5: deploy and rehearse on real phones. 6: run week.

**Known risks.** Mobile autocorrect corrupting answers — set `autocorrect`,
`autocapitalize`, and `spellcheck` off on the input from the first commit, as
most players will be on phones. Timezone: store UTC, display Central
explicitly. Question leakage is guaranteed by a fixed order over a multi-day
window; the 20-second clock is the actual defense, with tab-switch logging
surfaced as an admin flag rather than an automatic penalty. Nothing prevents a
friend sitting beside the player, which is acceptable for a prelim but should
be acknowledged rather than assumed away. Load concentrates on Thursday
evening.

**Proposed but undecided features.** Void-a-question-after-the-fact with score
rescaling (argued as the highest-value safety valve given a top-N cut with no
do-overs); a short unscored practice round; per-question analytics to
*discover* a broken question; a player "flag this question" link; self-service
resume link; exportable per-player answer sheets; staff test accounts excluded
from results.

---

## 5. What to produce

1. Your own recommended stack and hosting, with reasoning — especially if it
   differs from Node/SQLite/PaaS.
2. Your own take on the timing and anti-cheat model. Is server-authoritative
   timing plus draft autosave right, over-engineered, or insufficient?
3. Your own grading design. Is answer-variant grouping the right primitive for
   the review queue?
4. Anything material the proposal above **misses** — this is the most valuable
   thing you can contribute.
5. Anything in it you would **cut** as unnecessary for a one-night preliminary
   quiz with a few hundred players. Over-building is a live risk given the
   timeline.
6. Your own phasing, with a realistic estimate of what can be ready before
   Thursday.

Do not begin implementation. This is a design response.
