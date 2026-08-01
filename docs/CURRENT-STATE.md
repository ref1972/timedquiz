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
- Nothing is deployed. DNS, TLS, Node 24, service configuration, production
  secrets, database, and email relay configuration remain pending.
- No real player invitation has been sent.

## Launch blockers

- Owner review of all 50 questions, categories, answers, and aliases.
- Owner decision on the advancement cut and exact closing time.
- Apps Script relay redeploy with the quota endpoint, followed by one real
  test invitation and header inspection.
- Real-phone/network rehearsal, clean production database, final player import,
  preflight, and backup.
