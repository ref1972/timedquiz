# Current handoff

Last updated: 2026-08-01.

## 2026-08-01 — Player CSV and invitation workflow

- Added downloadable player CSV plus CSV selection/paste import. Existing
  emails update name/test status; new emails receive recoverable invitation
  links. Import never deletes players, resets attempts, or sends email.
- Reworked invitations into four visible steps with real-player, sent, ready,
  and attention-needed counts. Quota check, test send, and real batches remain
  separate deliberate actions; real batches retain the five-person limit and
  hard pause/no-fallback behavior.
- Deployed as rc9 after verified backup `quiz-20260801T154019Z.sqlite.gz`.
  Production health reports rc9, deployed workflow markers are present, and
  CASS remains HTTP 200. No player import or email send occurred during deploy.

## 2026-08-01 — Friendlier question import

- Moved the password-change panel to the bottom of the admin page.
- Added downloadable question-bank CSV plus CSV file selection/paste import.
  Columns are `position,category,question,answer,aliases`; multiple aliases use
  `|`. Quoted commas, quotes, and multiline cells are supported. JSON remains
  accepted for compatibility.
- Deployed as rc8 after verified backup `quiz-20260801T153559Z.sqlite.gz`.
  Production health reports rc8, deployed layout markers are present, and CASS
  remains HTTP 200.

## 2026-08-01 — Admin password management

- Added a **Change admin password** panel to the admin dashboard. It requires
  the current password plus a matching nonblank replacement of at most 256
  characters. The original 16-character minimum was removed at the owner's
  direction; the UI recommends length without enforcing it.
- The database stores only a random-salted scrypt hash. The environment value
  remains the bootstrap credential until the first database password is set;
  afterward it no longer authenticates.
- Every successful change increments the stored admin-session version, making
  all existing signed admin cookies invalid immediately. Automated coverage is
  now 21 tests plus TypeScript. The no-minimum policy was deployed as rc7 after
  verified pre-deploy backup `quiz-20260801T153007Z.sqlite.gz`; production
  health reports rc7, the deployed source contains the new policy and copy,
  and CASS remains HTTP 200.

## Repository extraction

- Standalone project name: **Timed Quiz**.
- GitHub: `https://github.com/ref1972/timedquiz`.
- Local checkout: `/Users/russellefriedewald/Documents/Projects/TimedQuiz`.
- The application was extracted with its path history from
  `pop-culture-bee-quiz/` in TriviaNationals. The shared Workspace Apps Script
  remains owned by TriviaNationals because other live systems use it.
- A flaky tamper test was corrected before extraction: it now mutates an
  authenticated ciphertext character rather than the final Base64URL character,
  whose unused bits could decode identically. Encryption behavior was not at
  fault.

## Next steps

1. Push and verify the standalone repository.
2. Replace the duplicate TriviaNationals app source with a pointer here.
3. Create the `bee.triviaworkshop.com` DNS record.
4. Merge/tag a release and provision the isolated service on the CASS droplet.
5. Finish editorial review, cutoff/cut decisions, email relay test, rehearsal,
   clean database creation, final import, and monitored invitation send.

## 2026-08-01 — Deployment provisioning started

- DNS now resolves `bee.triviaworkshop.com` to the CASS droplet.
- Added tracked systemd/nginx definitions and a repeatable provisioning script.
  The initial provision intentionally creates only a rehearsal database and
  leaves the email relay and cutoff unset.
- The first `rc1` provision installed the verified Node 24 runtime, then stopped
  before service/nginx changes because the private GitHub repository cannot be
  cloned anonymously. Provisioning now uploads a tagged Git archive instead,
  avoiding any GitHub credential on the server.
- The repository is now public, but archive deployment remains intentional: it
  installs the exact tag without maintaining a server-side checkout.
- `timed-quiz-v0.1.0-rc2` is deployed as the rehearsal instance. DNS and HTTPS
  are live; the dedicated service is healthy with the correct release ID.
  Admin authentication and the seeded invitation redirect work, HTTP redirects
  to HTTPS, and CASS remained online/HTTP 200 throughout.
- Email relay URL/secret and `CLOSES_AT` are deliberately unset, no real player
  is loaded, and no email was sent. The seeded starting bank is not approved
  for launch and the rehearsal database must not become the final database.
- Provisioning now waits up to 30 seconds for application health and preserves
  Certbot's live nginx edits on subsequent deployments.
- The first rc3 repeat-deploy check correctly preserved TLS/data but exposed
  that `systemctl enable --now` does not restart an already-running service and
  the persisted `RELEASE_ID` stayed at rc2. No partial upgrade or outage
  occurred: production remained healthy on rc2. Provisioning now updates the
  release ID and explicitly restarts the service on every deploy.
- rc4 confirmed the repeat-deploy fix end to end: the service restarted and
  `/health` reported rc4 while preserving the rehearsal database and TLS.
- rc5 added the missing SQLite CLI and enabled the daily backup timer. A manual
  service run produced `quiz-20260801T145925Z.sqlite.gz`; gzip validation and
  `PRAGMA integrity_check` both passed. Production health reports rc5 and CASS
  remains HTTP 200.
- The existing Workspace relay URL/secret were transferred from authenticated
  WordPress settings into the server environment without committing them. The
  Apps Script owner redeployed the existing matching Web App as Version 5;
  after propagation, the quota action returned 97. One owner-authorized test
  invitation was accepted and returned 96 remaining. The owner confirmed inbox
  delivery and that the personalized production link worked. Header inspection
  is still needed; no batch or real-player message was sent.
- Rotate the shared relay secret everywhere before the real send because it was
  surfaced during authenticated setup. This affects Apps Script Script
  Properties, WordPress Signup Settings, and `/etc/timed-quiz.env`.
- Owner requested an admin **Player intro** panel after reviewing the live
  invitation landing screen. Make the eyebrow (`TRIVIA NATIONALS`), main title,
  introductory sentence, leave-warning copy, no-feedback/advancement paragraph,
  and Ready button label editable. Preserve the actual timing, abandonment,
  cutoff, and grading rules in code regardless of the configured wording.
