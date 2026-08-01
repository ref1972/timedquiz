# Current handoff

Last updated: 2026-08-01.

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
