# Pop Culture Bee — preliminary online quiz

Status: **consolidated implementation and launch hardening committed.** The
active application is the root of this standalone Timed Quiz repository; the
earlier independent prototypes are retained only in historical Git context.

Owner decisions recorded 2026-07-31. Where this document states an assumption
rather than a decision, it says so explicitly.

## Purpose

A web-based qualifying quiz that determines which invited players advance to
the LIVE Pop Culture Bee game on Saturday. Players are invited by email, play
once at their own convenience, and are ranked by score.

This is a new subsystem. It is not part of any existing plugin.

## Confirmed requirements

- **50 pre-loaded questions**, the same 50 in the same order for every player.
- **One question on screen at a time**, with a free-text answer box and a
  submit button.
- **20-second limit per question.** If the player has not submitted when the
  timer expires, whatever is in the answer field is submitted automatically.
- **After question 50**, the player is thanked and told their score determines
  whether they advance to the LIVE game on Saturday.
- **Eligibility is an email allowlist.** Players are invited by email and
  tracked by email address. Nobody outside the list can play.
- **Open window, player-paced**, closing **Thursday 11:59pm Central**.
- **Scoring includes a human review queue** — typed answers are not graded by
  exact match alone.
- **All 50 questions are text only.** No audio, image, or video prompts. No
  asset hosting is required.
- **Players receive no feedback of any kind** until the owner announces
  results: no right/wrong after a question, no running score, no final score on
  the thank-you screen. This is deliberate — with a fixed question order and a
  multi-day window, any feedback hands early players a verified answer key.
- **The cut is the top N players.** Ranking is therefore load-bearing and every
  dispute will land exactly at the cut line. See Scoring.
- **The deadline is a start cutoff, not a hard stop.** A player already in
  progress at Thursday 11:59pm Central plays to completion. The per-question
  timer bounds the overrun to roughly ten minutes.

### Abandonment policy (decided)

The lenient option. If a player starts and then stops partway through:

- The question currently in flight expires and is scored as whatever draft the
  server last received (blank if none). They lose that one question.
- The remaining questions are **not** served until the player returns.
- Returning resumes at the next unserved question.

So walking away costs exactly one question. This must be stated plainly on the
pre-start screen. An admin "grant a restart" action is required for genuine
technical failures.

## Architecture

### Standalone application — decided

**Confirmed by the owner, 2026-07-31.** This is a standalone application, not a
WordPress plugin.

Rationale:

- The quiz needs nothing from WordPress. The eligibility list is a curated set
  of email addresses, not WooCommerce order data.
- Isolation. A defect in a plugin on `trivianationals.org` can affect the live
  site during registration season. A quiz with a hard deadline should not share
  a failure domain with the main site.
- Backup during the event is a single database file copy.

### Language and hosting — open

The owner is **not committed to PHP** and asked for whatever suits this kind of
game and admin tool best.

Local runtimes confirmed present on the owner's Mac, 2026-07-31:

| Runtime | Version |
|---|---|
| PHP | 8.5.8 (Homebrew) |
| Node | 24.14.0 |
| npm | 11.9.0 |
| Python | 3.14.6 |
| sqlite3 | 3.51.0 |
| Go | not installed |

So local development is not a differentiator — PHP and Node are both ready.

**Provisional recommendation: Node/TypeScript with SQLite, deployed to a PaaS
(Fly.io or Render) rather than by FTPS to HostGator shared hosting.** Not yet
ratified; a second opinion is being sought.

The deployment argument is the strongest one. The existing FTPS path to
HostGator has already truncated a live file mid-upload — a TLS 1.3 data-channel
failure on 2026-07-28 left a 55KB plugin file empty in production after `curl`
reported success (see `docs/DEPLOYMENT.md`). That risk is tolerable for a
single-file plugin with a reviewed hash check. It is a poor fit for a
multi-file application with a hard Thursday deadline and no atomic swap.

Counter-argument on record: staying on HostGator adds no new vendor, no new
bill, and no new credential to manage during event week, and the owner's
operational habits are cPanel and FTPS. If the PaaS route is rejected, PHP +
SQLite on a cPanel subdomain remains workable — but the deploy step needs
atomicity (rsync over SSH if the plan offers it, or upload-to-temp-then-rename),
not a bare multi-file FTPS push.

Requirements the choice must satisfy either way:

- A **persistent filesystem or database**. Rules out purely serverless hosting
  unless paired with hosted Postgres, which is complexity this scale does not
  justify.
- **Low, predictable response latency.** `remaining_ms` is computed from the
  server's `served_at`, so a slow first byte eats into the player's usable
  answer time even though it cannot make the timing unfair. Cold starts are
  therefore a player-experience problem.
- **Verifiable deploys**, so "is the live version the reviewed version?" is
  answerable during event week.

### Hosting target

The selected subdomain is `bee.triviaworkshop.com`, pointed at the existing
CASS DigitalOcean droplet and served through a separate nginx virtual host.

The database must not be reachable from the web document root.

## Server-authoritative timing

This is the central design constraint. A client-side countdown is advisory
only: it can be paused with developer tools, and a page refresh would otherwise
grant a fresh 20 seconds.

The rules:

1. When the server delivers question N, it records `served_at` and derives a
   deadline from it.
2. The client receives `remaining_ms`, never a flat 20000. A refresh therefore
   returns the *same* question with the time actually left on it.
3. On submit, the server judges lateness using its own clock. The client's
   clock is never trusted.
4. If the deadline passes with no submission — tab closed, laptop shut, network
   dropped — the answer is whatever draft the server last received, or blank.

**Draft autosave** posts the contents of the answer box roughly every 2 seconds.
Without it, "whatever is in the answer field auto-submits" only holds when the
browser is still alive at T+20. With it, the stated behavior is true even if the
tab dies mid-question.

## Data model

| Table | Contents |
|---|---|
| `players` | email (unique, lowercased), display name, token hash, invited/started/finished timestamps, status, current position, current `served_at` |
| `questions` | position 1–50, prompt, canonical answer, accepted aliases (JSON) |
| `answers` | player, question, raw text, `served_at`, `submitted_at`, elapsed ms, auto-submitted flag, auto verdict, final verdict, reviewer, reviewed timestamp |
| `events` | append-only log: served, drafted, submitted, resumed, tab-hidden — the record to consult if a result is disputed |

Session state lives on the `players` row, which structurally enforces one
in-flight session per player.

All timestamps are stored in UTC.

## Grading

Auto-grading runs in tiers:

1. **Normalize** — lowercase, trim, collapse internal whitespace, strip
   punctuation and diacritics, drop a leading "the", "a", or "an".
2. **Exact or alias match** → correct, with no human involvement.
3. **Near miss** — Levenshtein distance within a band scaled to answer length
   → routed to the review queue.
4. **Everything else** → incorrect, but still visible in the queue so a valid
   answer nobody anticipated can be rescued.

Blank answers are scored incorrect and never enter the queue.

### Review queue

The queue **groups by distinct normalized answer, not by player.** A judgment
on one variant applies to every player who submitted it.

This matters twice over: it collapses 50 questions across a few hundred players
into a manageable number of decisions, and it makes identical answers provably
graded identically — which is what makes a contested cut defensible.

### Scoring

One point per correct answer. Ties break on total server-measured answer time
across correct answers.

Because the cut is **top N**, the tiebreak is not a nicety — a 50-question
field will produce ties precisely at the cut line, and the tiebreak is what
decides who plays Saturday. It must be recorded from the first commit, since it
cannot be reconstructed after the fact.

The player is never shown their score. Results are the owner's to announce.

## Admin surfaces

- **Question import** — CSV/JSON: position, prompt, canonical answer, aliases.
- **Player import** — paste or upload email addresses; generate per-player
  tokens.
- **Invites** — one magic link per player, single attempt each.
- **Progress dashboard** — invited / started / finished / not started, so
  non-starters can be nudged before the deadline.
- **Review queue** — as described above.
- **Results** — ranked leaderboard, CSV export, deadline lock.
- **Grant restart** — per-player escape hatch for technical failures.

## Email

Preferred: reuse the existing Apps Script relay that sends as
`info@trivianationals.org`, so invites carry the same sending identity as all
other site email. **Verify first** whether that project exposes a send path
callable from a non-WordPress application with the shared secret; it was built
for the event-signups integration and may not be general enough.

If it is not, export a CSV and mail-merge. At this volume either approach works.

Watch the Gmail Workspace daily quota — quota exhaustion has already affected
the announcements digest (see `docs/HANDOFF.md`).

## Phases

| Phase | Deliverable |
|---|---|
| 0 | Author the 50 questions with their alias lists. Longest-lead item; everything else is a shell without it. |
| 1 | Local playable core: full 50-question flow, server-side timer, auto-submit, thank-you screen. Playable end to end on the laptop. |
| 2 | Identity: allowlist, magic links, one attempt per email, resume after refresh. |
| 3 | Admin: imports, dashboard, review queue, results. |
| 4 | Invites, deadline enforcement, mobile polish, branding. |
| 5 | Deploy to the subdomain; rehearse with staff on real phones. |
| 6 | Run week: monitor, work the review queue, produce the cut list. |

Phase 1 is the local demo. Phases 2–4 are what make it survivable in production.

## Known risks

- **Mobile autocorrect will corrupt answers.** iOS will rewrite proper nouns
  mid-typing. Set `autocorrect="off"`, `autocapitalize="off"`, and
  `spellcheck="false"` on the answer input from the first commit. Most players
  will be on phones.
- **Timezone.** The deadline is Central; the server clock will not be. Store
  UTC, display "Thursday 11:59pm Central" explicitly on every surface.
- **The questions will leak.** A fixed order across a multi-day window
  guarantees it. The 20-second clock is the actual defense — a player who has
  been told the questions still needs the answers ready. Log tab-switch and
  visibility-change events and surface them as an admin flag rather than an
  automatic penalty. Nothing prevents a friend sitting beside the player; for a
  preliminary round that is acceptable, but it should be a known limitation
  rather than an assumed-away one.
- **Load concentrates on Thursday evening.** The volume is small, but the
  deadline hour should be rehearsed rather than assumed.
- **Shared-hosting PHP version and extensions** are unverified for this
  subdomain. Check in Phase 1.

## Proposed features — not yet decided

Raised 2026-07-31; awaiting the owner.

- **Void a question after the fact.** If a question proves broken or ambiguous,
  drop it and rescale every score to the remaining 49. With a top-N cut and no
  possibility of a do-over, this is the most valuable safety valve in the
  system. Cheap to design in now; effectively impossible to retrofit at 1am on
  Friday.
- **Practice round** — two or three unscored questions before Q1, so no player
  burns a real question discovering that 20 seconds is fast.
- **Per-question analytics** — percent correct across the field. This is the
  mechanism by which a broken question is *discovered*, and it is nearly free
  once the answer data exists.
- **Player "flag this question" link** — one click, logged, non-interrupting.
  Converts vague post-hoc complaints into specific evidence.
- **Self-service resume link** for players who lose the invitation email.
- **Per-player answer sheets**, exportable, with timestamps, so a contested cut
  has a printable record.
- **Staff test accounts** excluded from live results, so rehearsal does not
  require deleting rows afterwards.

## Open questions for the owner

Asked 2026-07-31, not yet answered:

1. How many players are invited, and how many seats does the LIVE game have
   (the value of N)?
2. Who works the review queue, and when? The Thursday-midnight-to-Saturday
   window is tight. Does grading need to support two people at once?
3. Where do the 50 questions live today? This sets the import format and
   determines whether answer aliases are authored in the app or upstream.
4. Does the 20-second clock start when the question renders, or after a
   per-question "Ready" tap? Asynchronous play means a player may open the link
   somewhere inconvenient with Q1 already running.
5. Does the player see progress ("Question 12 of 50") and a visible countdown,
   or a bare question?
6. Should the application send reminder emails to players who never start?
7. Does the preliminary round feed Saturday beyond producing the cut list —
   seeding, bracket position — or is a list of names sufficient?
8. Will staff test-play it? (Bears on the test-account item above.)

## Other open items

1. Ratify the language and hosting choice (see Architecture).
2. Provision the selected `bee.triviaworkshop.com` DNS record and TLS.
3. Confirm whether the Apps Script relay can send for a non-WordPress caller.
4. Verify the datastore and runtime available on whichever host is chosen.
