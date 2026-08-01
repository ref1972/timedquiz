/**
 * Fast unit tests for the timing/attempt state machine and grading, ported
 * from pop-culture-bee-quiz-claude's timing-test approach and adapted to
 * this app's attempt/exposure data model. Runs against a scratch database
 * with a short question window so the whole suite finishes in well under a
 * second.
 *
 *   npm test
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import type { Player } from "./quiz.ts";

process.env.DB_PATH = "data/test-quiz.db";
// Scaled down together, same reasoning as the original suite: a full 2s
// production grace period would swallow this whole test window and "late"
// would never actually read as late.
process.env.QUESTION_DURATION_MS = "400";
process.env.SUBMIT_GRACE_MS = "100";

const { db } = await import("./db.ts");
const quiz = await import("./quiz.ts");
const grading = await import("./grading.ts");
const admin = await import("./admin.ts");
const cryptoHelpers = await import("./crypto.ts");
const { config } = await import("./config.ts");
const mail = await import("./mail.ts");

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let nextEmail = 0;
function freshPlayer(): Player {
  nextEmail += 1;
  const email = `player${nextEmail}@test.invalid`;
  const result = db
    .prepare("INSERT INTO players (email, display_name, token_hash, is_test, created_at) VALUES (?, ?, ?, 1, ?)")
    .run(email, email, `hash-${nextEmail}`, new Date().toISOString());
  return quiz.findPlayerById(Number(result.lastInsertRowid))!;
}

before(() => {
  db.exec("DELETE FROM exposures");
  db.exec("DELETE FROM attempts");
  db.exec("DELETE FROM players");
  db.exec("DELETE FROM questions");
  db.exec("DELETE FROM grading_rules");
  const insert = db.prepare("INSERT INTO questions (position, prompt, canonical_answer, aliases_json) VALUES (?, ?, ?, ?)");
  for (let i = 1; i <= 50; i++) {
    insert.run(i, `Question ${i}?`, `answer${i}`, "[]");
  }
});

after(() => {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      rmSync(`data/test-quiz.db${suffix}`);
    } catch {
      /* already gone */
    }
  }
});

test("no attempt yet reads as prestart", () => {
  const player = freshPlayer();
  assert.equal(quiz.getStatus(player).state, "prestart");
});

test("Ready serves question 1 and returns the prompt in the same response (no second round-trip needed)", () => {
  const player = freshPlayer();
  const served = quiz.serveNext(player);
  assert.equal(served.state, "question");
  if (served.state !== "question") return;
  assert.equal(served.position, 1);
  assert.equal(served.prompt, "Question 1?");
  assert.ok(served.nonce);
  assert.ok(Date.parse(served.deadlineAt) > Date.now(), "deadline must be in the future at serve time");
});

test("a duplicate Ready click is idempotent, not a second question", () => {
  const player = freshPlayer();
  const first = quiz.serveNext(player);
  const second = quiz.serveNext(player);
  assert.deepEqual(first, second);
});

test("reloading (getStatus) returns the same question with less time, not a fresh window", async () => {
  const player = freshPlayer();
  const served = quiz.serveNext(player);
  assert.equal(served.state, "question");
  if (served.state !== "question") return;

  await sleep(150);

  const resumed = quiz.getStatus(player);
  assert.equal(resumed.state, "question");
  if (resumed.state !== "question") return;
  assert.equal(resumed.position, 1, "refresh must not advance the question");
  assert.equal(resumed.deadlineAt, served.deadlineAt, "the deadline itself must not move on refresh");
});

test("submitting advances to the next question", () => {
  const player = freshPlayer();
  const served = quiz.serveNext(player);
  assert.equal(served.state, "question");
  if (served.state !== "question") return;

  const attempt = quiz.currentAttempt(player.id)!;
  const outcome = quiz.submitAnswer(attempt.id, served.nonce, "my answer");
  assert.equal(outcome.ok, true);

  const next = quiz.serveNext(player);
  assert.equal(next.state, "question");
  if (next.state !== "question") return;
  assert.equal(next.position, 2);

  const stored = db.prepare("SELECT * FROM exposures WHERE attempt_id = ? AND question_id = 1").get(attempt.id) as any;
  assert.equal(stored.submitted_text, "my answer");
  assert.equal(stored.finalized_reason, "manual");
});

test("a question cannot be answered twice -- the first submission stands", () => {
  const player = freshPlayer();
  const served = quiz.serveNext(player);
  if (served.state !== "question") return assert.fail();
  const attempt = quiz.currentAttempt(player.id)!;

  quiz.submitAnswer(attempt.id, served.nonce, "first");
  quiz.submitAnswer(attempt.id, served.nonce, "second");

  const stored = db.prepare("SELECT submitted_text FROM exposures WHERE attempt_id = ? AND question_id = 1").get(attempt.id) as any;
  assert.equal(stored.submitted_text, "first");
});

test("a stale/mismatched nonce cannot answer a question that was never actually served", () => {
  const player = freshPlayer();
  quiz.serveNext(player);
  const attempt = quiz.currentAttempt(player.id)!;

  const outcome = quiz.submitAnswer(attempt.id, "not-the-real-nonce", "cheating ahead");
  assert.equal(outcome.ok, true, "a stale nonce is a silent no-op, not an error");

  const state = quiz.getStatus(player);
  assert.equal(state.state, "question");
  if (state.state === "question") assert.equal(state.position, 1, "still on question 1");
});

test("an expired question is finalized from the last draft, not lost, and abandoning costs exactly one question", async () => {
  const player = freshPlayer();
  const served = quiz.serveNext(player);
  if (served.state !== "question") return assert.fail();
  const attempt = quiz.currentAttempt(player.id)!;

  quiz.saveDraft(attempt.id, served.nonce, 1, "half-typed guess");
  await sleep(400 + 150);

  // The player returns; the window closed while away. getStatus() is
  // read-only -- it finalizes the abandoned question but does not itself
  // serve question 2. A Ready tap is required before every question
  // (including a resumed one), not just Q1, matching the design brief's
  // stated assumption of "a Ready action before Q1 and between questions."
  const next = quiz.getStatus(player);
  assert.equal(next.state, "ready");
  if (next.state === "ready") assert.equal(next.nextPosition, 2, "abandoning costs exactly one question");

  const resumedByReady = quiz.serveNext(player);
  assert.equal(resumedByReady.state, "question");
  if (resumedByReady.state === "question") assert.equal(resumedByReady.position, 2);

  const stored = db.prepare("SELECT * FROM exposures WHERE attempt_id = ? AND question_id = 1").get(attempt.id) as any;
  assert.equal(stored.submitted_text, "half-typed guess");
  assert.equal(stored.finalized_reason, "timeout");
});

test("an expired question with no draft is finalized blank", async () => {
  const player = freshPlayer();
  quiz.serveNext(player);
  const attempt = quiz.currentAttempt(player.id)!;

  await sleep(400 + 150);
  quiz.getStatus(player);

  const stored = db.prepare("SELECT * FROM exposures WHERE attempt_id = ? AND question_id = 1").get(attempt.id) as any;
  assert.equal(stored.submitted_text, "");
  assert.equal(stored.finalized_reason, "timeout");
});

test("drafts are refused once the window (plus grace) has closed", async () => {
  const player = freshPlayer();
  const served = quiz.serveNext(player);
  if (served.state !== "question") return assert.fail();
  const attempt = quiz.currentAttempt(player.id)!;

  await sleep(400 + 150);
  const result = quiz.saveDraft(attempt.id, served.nonce, 1, "typed after the buzzer");
  assert.equal(result.ok, false, "a post-deadline draft must not become the answer");
});

test("a very late submission falls back to the pre-deadline draft", async () => {
  const player = freshPlayer();
  const served = quiz.serveNext(player);
  if (served.state !== "question") return assert.fail();
  const attempt = quiz.currentAttempt(player.id)!;

  quiz.saveDraft(attempt.id, served.nonce, 1, "what I had at the buzzer");
  await sleep(400 + 150); // simulates a paused timer or altered clock

  quiz.submitAnswer(attempt.id, served.nonce, "looked it up afterwards");

  const stored = db.prepare("SELECT submitted_text FROM exposures WHERE attempt_id = ? AND question_id = 1").get(attempt.id) as any;
  assert.equal(stored.submitted_text, "what I had at the buzzer");
});

test("the quiz completes after the last question and stays completed", () => {
  const player = freshPlayer();
  for (let i = 1; i <= 50; i++) {
    const served = quiz.serveNext(player);
    assert.equal(served.state, "question");
    if (served.state !== "question") return;
    assert.equal(served.position, i);
    const attempt = quiz.currentAttempt(player.id)!;
    quiz.submitAnswer(attempt.id, served.nonce, `answer${i}`);
  }

  assert.equal(quiz.serveNext(player).state, "complete");
  assert.equal(quiz.getStatus(player).state, "complete", "completed is stable across reloads");

  const attempt = quiz.currentAttempt(player.id)!;
  assert.equal(attempt.status, "completed");
  assert.equal(quiz.finalizedCount(attempt.id), 50);
});

test("finalizeStaleSessions closes windows abandoned by players who never return", async () => {
  const player = freshPlayer();
  quiz.serveNext(player);
  const attempt = quiz.currentAttempt(player.id)!;

  await sleep(400 + 150);

  const before = db.prepare("SELECT * FROM exposures WHERE attempt_id = ? AND submitted_at IS NULL").all(attempt.id);
  assert.equal(before.length, 1, "the abandoned question is still in flight");

  const closed = quiz.finalizeStaleSessions();
  assert.ok(closed >= 1);

  const after = db.prepare("SELECT * FROM exposures WHERE attempt_id = ? AND submitted_at IS NULL").all(attempt.id);
  assert.equal(after.length, 0, "nothing may remain unfinalized at scoring time");
});

test("a reviewer's ruling applies immediately to a later player's identical answer, not just past ones", () => {
  const questionId = (db.prepare("SELECT id FROM questions WHERE position = 5").get() as any).id;

  const earlyPlayer = freshPlayer();
  const laterPlayer = freshPlayer();

  // Both submit the same near-miss before any ruling exists.
  for (const p of [earlyPlayer, laterPlayer]) {
    for (let i = 1; i < 5; i++) {
      const served = quiz.serveNext(p);
      if (served.state !== "question") return assert.fail();
      const attempt = quiz.currentAttempt(p.id)!;
      quiz.submitAnswer(attempt.id, served.nonce, `answer${i}`);
    }
  }
  const earlyServed = quiz.serveNext(earlyPlayer);
  if (earlyServed.state !== "question") return assert.fail();
  quiz.submitAnswer(quiz.currentAttempt(earlyPlayer.id)!.id, earlyServed.nonce, "a near miss");

  const earlyStored = db.prepare("SELECT verdict FROM exposures WHERE attempt_id = ? AND question_id = ?").get(
    quiz.currentAttempt(earlyPlayer.id)!.id,
    questionId,
  ) as any;
  assert.equal(earlyStored.verdict, "unresolved", "unreviewed near-miss starts unresolved");

  grading.applyReviewRuling(questionId, grading.normalize("a near miss"), "correct", "accept this phrasing");

  // Retroactive: the early player's already-submitted exposure is updated.
  const earlyAfterReview = db.prepare("SELECT verdict FROM exposures WHERE attempt_id = ? AND question_id = ?").get(
    quiz.currentAttempt(earlyPlayer.id)!.id,
    questionId,
  ) as any;
  assert.equal(earlyAfterReview.verdict, "correct", "the ruling must retroactively update the already-submitted answer");

  // Prospective: a later player typing the identical normalized answer is
  // auto-graded correct immediately, without needing a second review.
  const laterServed = quiz.serveNext(laterPlayer);
  if (laterServed.state !== "question") return assert.fail();
  quiz.submitAnswer(quiz.currentAttempt(laterPlayer.id)!.id, laterServed.nonce, "A Near Miss");

  const laterStored = db.prepare("SELECT verdict FROM exposures WHERE attempt_id = ? AND question_id = ?").get(
    quiz.currentAttempt(laterPlayer.id)!.id,
    questionId,
  ) as any;
  assert.equal(laterStored.verdict, "correct", "a later identical answer must not need a second manual review");
});

test("automatic grading matches CASS leading-article and contained-answer behavior", () => {
  const question = db.prepare("SELECT * FROM questions WHERE position = 1").get() as any;
  db.prepare("UPDATE questions SET canonical_answer = ?, aliases_json = ? WHERE id = ?").run(
    "The Electric Company",
    JSON.stringify(["Electric Co"]),
    question.id,
  );
  const updated = db.prepare("SELECT * FROM questions WHERE id = ?").get(question.id) as any;
  assert.equal(grading.autoVerdict(updated, "Electric Company").verdict, "correct");
  assert.equal(grading.autoVerdict(updated, "I think it is The Electric Company").verdict, "correct");
  assert.equal(grading.autoVerdict(updated, "the Electric Co").verdict, "correct");
  assert.equal(grading.autoVerdict(updated, "Electricity").verdict, "unresolved");
  db.prepare("UPDATE questions SET canonical_answer = ?, aliases_json = ? WHERE id = ?").run("answer1", "[]", question.id);
});

test("a restarted attempt starts a new generation and the old one is superseded, not deleted", () => {
  const player = freshPlayer();
  const served = quiz.serveNext(player);
  if (served.state !== "question") return assert.fail();
  const firstAttempt = quiz.currentAttempt(player.id)!;
  assert.equal(firstAttempt.generation, 1);

  db.prepare("UPDATE attempts SET status = 'superseded', superseded_at = ? WHERE id = ?").run(new Date().toISOString(), firstAttempt.id);

  assert.equal(quiz.getStatus(player).state, "prestart", "a superseded attempt reads as a fresh start");

  const restarted = quiz.serveNext(player);
  assert.equal(restarted.state, "question");
  if (restarted.state !== "question") return;
  assert.equal(restarted.position, 1, "a restart begins again at question 1");

  const secondAttempt = quiz.currentAttempt(player.id)!;
  assert.equal(secondAttempt.generation, 2);
  assert.notEqual(secondAttempt.id, firstAttempt.id);

  const oldRow = db.prepare("SELECT status FROM attempts WHERE id = ?").get(firstAttempt.id) as any;
  assert.equal(oldRow.status, "superseded", "the old attempt's row is preserved, not deleted");
});

test("score ties rank by lower total server-measured time", async () => {
  const fastPlayer = freshPlayer();
  const slowPlayer = freshPlayer();
  const fastQuestion = quiz.serveNext(fastPlayer);
  if (fastQuestion.state !== "question") return assert.fail();
  await sleep(5);
  quiz.submitAnswer(quiz.currentAttempt(fastPlayer.id)!.id, fastQuestion.nonce, "answer1");

  const slowQuestion = quiz.serveNext(slowPlayer);
  if (slowQuestion.state !== "question") return assert.fail();
  await sleep(30);
  quiz.submitAnswer(quiz.currentAttempt(slowPlayer.id)!.id, slowQuestion.nonce, "answer1");

  const tied = admin.results().filter((row) => row.id === fastPlayer.id || row.id === slowPlayer.id);
  assert.equal(tied.length, 2);
  assert.equal(tied[0]!.id, fastPlayer.id);
  assert.equal(tied[0]!.score, tied[1]!.score);
  assert.ok(tied[0]!.correct_time_ms < tied[1]!.correct_time_ms);
});

test("an administrator-authorized restart can begin after the general cutoff", () => {
  const originalCutoff = config.closesAt;
  try {
    config.closesAt = null;
    const player = freshPlayer();
    const first = quiz.serveNext(player);
    if (first.state !== "question") return assert.fail();
    const firstAttempt = quiz.currentAttempt(player.id)!;
    db.prepare("UPDATE attempts SET status = 'superseded', superseded_at = ?, restart_reason = ? WHERE id = ?").run(
      new Date().toISOString(),
      "Verified technical failure",
      firstAttempt.id,
    );
    config.closesAt = Date.now() - 1;
    assert.equal(quiz.getStatus(player).state, "prestart");
    const restarted = quiz.serveNext(player);
    assert.equal(restarted.state, "question");
    assert.equal(quiz.currentAttempt(player.id)!.generation, 2);

    const neverStarted = freshPlayer();
    assert.equal(quiz.getStatus(neverStarted).state, "closed");
    assert.equal(quiz.serveNext(neverStarted).state, "closed");
  } finally {
    config.closesAt = originalCutoff;
  }
});

test("recoverable invitation tokens round-trip under authenticated encryption", () => {
  const token = cryptoHelpers.randomToken();
  const encrypted = cryptoHelpers.encryptInvitationToken(token);
  assert.notEqual(encrypted, token);
  assert.equal(cryptoHelpers.decryptInvitationToken(encrypted), token);
  assert.throws(() => cryptoHelpers.decryptInvitationToken(encrypted.slice(0, -1) + "x"));
});

test("Workspace invitation mail preflights quota and reports a hard quota pause without fallback", async () => {
  const originalUrl = config.emailRelayUrl;
  const originalSecret = config.emailRelaySecret;
  const originalFetch = globalThis.fetch;
  const actions: string[] = [];
  try {
    config.emailRelayUrl = "https://relay.test/exec";
    config.emailRelaySecret = "test-secret";
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body ?? "{}")) as { action: string; secret: string };
      actions.push(payload.action);
      assert.equal(payload.secret, "test-secret");
      if (payload.action === "email_quota") return new Response(JSON.stringify({ ok: true, remaining: 70 }), { status: 200 });
      return new Response(JSON.stringify({ ok: false, error: "Apps Script email quota exhausted", quota_exhausted: true, remaining: 0 }), { status: 200 });
    }) as typeof fetch;
    assert.equal(await mail.remainingEmailQuota(), 70);
    const result = await mail.sendInvitationEmail("player@example.com", "Player", "https://quiz.test/invite/token");
    assert.equal(result.ok, false);
    assert.equal(result.quotaExhausted, true);
    assert.deepEqual(actions, ["email_quota", "send_email"]);
  } finally {
    config.emailRelayUrl = originalUrl;
    config.emailRelaySecret = originalSecret;
    globalThis.fetch = originalFetch;
  }
});
