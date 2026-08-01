# Timed Quiz agent instructions

Before substantive work:

1. Read `PROJECT.md`.
2. Read `docs/CURRENT-STATE.md`, `docs/DEPLOYMENT.md`, and `docs/HANDOFF.md`.
3. Run `git status --short` and preserve unrelated user changes.
4. Fetch or pull before editing when safe; never overwrite a dirty tree merely
   to synchronize it.

After a meaningful release, production change, architectural decision, or
investigation:

1. Update the relevant shared documents.
2. Put durable facts in `PROJECT.md` or the appropriate topic document.
3. Update `docs/HANDOFF.md` with verification and next steps.
4. Run `npm test`, `npm run typecheck`, and `git diff --check`.
5. Never commit secrets, player lists, invitation links, production databases,
   backups, email logs, or local environment files.

Deployment status must distinguish source present locally, committed/pushed,
deployed, and behavior verified in production. Never send real invitation
email or replace a live database without explicit owner authorization.
