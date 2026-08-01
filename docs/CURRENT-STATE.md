# Current state

Last updated: 2026-08-01.

## Source and verification

- Extracted with path-specific Git history from the TriviaNationals repository
  into the standalone `ref1972/timedquiz` project.
- Launch hardening includes encrypted/rotatable invitations, quota-safe email
  batches, server-measured timing tiebreaks, post-cutoff authorized restarts,
  admin login throttling, preflight, backups, and deployment packaging.
- Automated verification passes 20 tests and TypeScript typechecking.

## Production

- Selected URL: `https://bee.triviaworkshop.com`.
- Selected host: the existing CASS DigitalOcean droplet, isolated behind its
  own service, localhost port, nginx virtual host, data, and backups.
- Release candidate `timed-quiz-v0.1.0-rc2` is deployed on the selected droplet
  with a side-by-side Node 24 runtime, dedicated systemd service, rehearsal
  SQLite database, nginx, and HTTPS at `https://bee.triviaworkshop.com`.
- Verified in production: HTTPS health/release/database response, HTTP-to-HTTPS
  redirect, admin authentication, seeded invitation redirect, active service,
  and unchanged CASS availability.
- Email relay configuration and the closing time remain unset. The deployed
  database contains only the seeded test player and unapproved starting bank;
  it is not the launch database.
- No real player invitation has been sent.

## Launch blockers

- Owner review of all 50 questions, categories, answers, and aliases.
- Owner decision on the advancement cut and exact closing time.
- Apps Script relay redeploy with the quota endpoint, followed by one real
  test invitation and header inspection.
- Real-phone/network rehearsal, clean production database, final player import,
  preflight, and backup.
