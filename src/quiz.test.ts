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
const auth = await import("./auth.ts");
const cryptoHelpers = await import("./crypto.ts");
const { config } = await import("./config.ts");
const mail = await import("./mail.ts");
const questionImport = await import("./question-import.ts");
const playerImport = await import("./player-import.ts");
const introCopy = await import("./intro-copy.ts");
const views = await import("./views.ts");
const invitationTemplate = await import("./invitation-template.ts");
const reminderTemplate = await import("./reminder-template.ts");
const completionNotification = await import("./completion-notification.ts");
const completionCopy = await import("./completion-copy.ts");
const gameStore = await import("./games.ts");
const publicAccess = await import("./public-access.ts");
const accounts = await import("./account.ts");

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let nextEmail = 0;
function freshPlayer(): Player {
  nextEmail += 1;
  const email = `player${nextEmail}@test.invalid`;
  const result = db
    .prepare("INSERT INTO players (game_id, email, display_name, token_hash, is_test, created_at) VALUES (?, ?, ?, ?, 1, ?)")
    .run(gameStore.activeGame().id, email, email, `hash-${nextEmail}`, new Date().toISOString());
  return quiz.findPlayerById(Number(result.lastInsertRowid))!;
}

before(() => {
  db.exec("DELETE FROM exposures");
  db.exec("DELETE FROM attempts");
  db.exec("DELETE FROM players");
  db.exec("DELETE FROM questions");
  db.exec("DELETE FROM grading_rules");
  db.exec("DELETE FROM app_settings");
  const insert = db.prepare("INSERT INTO questions (game_id, position, prompt, canonical_answer, aliases_json) VALUES (?, ?, ?, ?, ?)");
  for (let i = 1; i <= 50; i++) {
    insert.run(gameStore.activeGame().id, i, `Question ${i}?`, `answer${i}`, "[]");
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
  const state = quiz.getStatus(player);
  assert.equal(state.state, "prestart");
  if (state.state === "prestart") assert.equal(state.intro.title, introCopy.defaultIntroCopy.title);
});

test("Ready serves question 1 and returns the prompt in the same response (no second round-trip needed)", () => {
  const player = freshPlayer();
  const served = quiz.serveNext(player);
  assert.equal(served.state, "question");
  if (served.state !== "question") return;
  assert.equal(served.position, 1);
  assert.equal(served.durationSeconds, 0.4, "player state exposes the configured authoritative duration");
  assert.equal(served.prompt, "Question 1?");
  assert.ok(served.nonce);
  assert.ok(Date.parse(served.deadlineAt) > Date.now(), "deadline must be in the future at serve time");
});

test("a served question carries the server's own clock so a skewed device cannot break the timer", async () => {
  const player = freshPlayer();
  const served = quiz.serveNext(player);
  assert.equal(served.state, "question");
  if (served.state !== "question") return;
  assert.equal(
    Date.parse(served.deadlineAt) - Date.parse(served.serverNow),
    config.questionDurationMs,
    "a fresh serve must offer the whole window measured against the server's clock, not the device's",
  );

  await sleep(150);

  const resumed = quiz.getStatus(player);
  assert.equal(resumed.state, "question");
  if (resumed.state !== "question") return;
  const remaining = Date.parse(resumed.deadlineAt) - Date.parse(resumed.serverNow);
  assert.ok(remaining < config.questionDurationMs, "resuming must report the time actually left, not a fresh window");
  assert.ok(remaining > 0, "the window had not closed yet");
});

test("a duplicate Ready click is idempotent, not a second question", () => {
  const player = freshPlayer();
  const first = quiz.serveNext(player);
  const second = quiz.serveNext(player);
  // Everything that identifies the question in flight must be identical --
  // above all the nonce and the deadline. serverNow is deliberately excluded:
  // it is the current instant on every response, which is what lets a client
  // measure the real time left rather than trusting its own clock.
  assert.deepEqual({ ...first, serverNow: undefined }, { ...second, serverNow: undefined });
  assert.equal(first.state, "question");
  if (first.state !== "question" || second.state !== "question") return;
  assert.ok(Date.parse(second.serverNow) >= Date.parse(first.serverNow), "the second response carries its own later clock");
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
  if (next.state === "ready") {
    assert.equal(next.nextPosition, 2, "abandoning costs exactly one question");
    assert.equal(next.category, "Pop Culture", "Ready reveals the upcoming category but not the prompt");
  }

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
  const reviewQuestion = admin.gradingReview().find((row) => row.question_id === questionId);
  assert.equal(reviewQuestion?.canonical_answer, "answer5");
  assert.deepEqual(reviewQuestion?.accepted, ["answer5"]);
  assert.equal(reviewQuestion?.variants.find((v) => v.normalized_answer === grading.normalize("a near miss"))?.verdict, "unresolved");

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

test("grading review shows every answer, including the ones graded automatically", () => {
  const position = 7;
  const questionId = (db.prepare("SELECT id FROM questions WHERE position = ?").get(position) as any).id;
  // Earlier tests in this file have already answered every question, so
  // measure against a baseline rather than assuming a clean slate.
  const before = admin.gradingReview().find((q) => q.question_id === questionId)!;
  const autoBefore = before.variants.find((v) => v.normalized_answer === "answer7")?.players ?? 0;

  for (const submitted of ["answer7", "answer7", "answer seven", ""]) {
    const player = freshPlayer();
    for (let i = 1; i <= position; i++) {
      const served = quiz.serveNext(player);
      if (served.state !== "question") return assert.fail();
      quiz.submitAnswer(quiz.currentAttempt(player.id)!.id, served.nonce, i === position ? submitted : `answer${i}`);
    }
  }

  const question = admin.gradingReview().find((q) => q.question_id === questionId)!;
  assert.equal(question.answered, before.answered + 4);
  assert.equal(question.correct, before.correct + 2, "two players typed the canonical answer");
  assert.equal(question.unresolved, before.unresolved + 1);

  // The whole point: an answer the grader accepted by itself is present and
  // carries no manual ruling, so a reviewer can see and reverse it. The old
  // queue listed unresolved answers only, which hid exactly this row.
  const auto = question.variants.find((v) => v.normalized_answer === "answer7")!;
  assert.equal(auto.verdict, "correct");
  assert.equal(auto.ruling, null, "no human has ruled on it");
  assert.equal(auto.players, autoBefore + 2, "identical answers share one row and one decision");

  const blank = question.variants.find((v) => v.normalized_answer === "")!;
  assert.equal(blank.verdict, "incorrect");
  assert.equal(question.variants.find((v) => v.normalized_answer === "answer seven")!.verdict, "unresolved");

  // Reversing an automatic verdict works through the same ruling path, and
  // reports itself as a human decision afterwards.
  grading.applyReviewRuling(questionId, "answer7", "incorrect", "disallowed on appeal");
  const afterRuling = admin.gradingReview().find((q) => q.question_id === questionId)!;
  assert.equal(afterRuling.correct, question.correct - auto.players, "every matching answer was regraded, not just the one reviewed");
  const reversed = afterRuling.variants.find((v) => v.normalized_answer === "answer7")!;
  assert.equal(reversed.verdict, "incorrect");
  assert.equal(reversed.ruling, "incorrect");
  assert.equal(reversed.note, "disallowed on appeal");

  // The panel renders it, in the collapsed "counted incorrect" tier, with the
  // opposite action available.
  const html = views.adminPage(
    { questionCount: 50, closesAt: null, results: [], grading: admin.gradingReview(), unresolvedCount: admin.unresolvedVariantCount(), questions: admin.adminQuestions(), questionsLocked: false, questionTextEditingEnabled: false, emailRelayConfigured: false, invitationStats: { realPlayers: 0, sent: 0, ready: 0, needsAttention: 0 }, reminderStats: { eligible: 0, sent: 0, needsAttention: 0 }, introCopy: introCopy.defaultIntroCopy, invitationTemplate: invitationTemplate.defaultInvitationTemplate, reminderTemplate: reminderTemplate.defaultReminderTemplate, completionNotifications: { enabled: false, recipient: "" }, completionCopy: completionCopy.defaultCompletionCopy, games: gameStore.games(), selectedGame: gameStore.selectedGame() },
    "review",
  );
  assert.match(html, /counted incorrect/);
  assert.match(html, /ruled incorrect/);
  assert.match(html, />Accept</, "a rejected answer can be accepted back");
  assert.match(html, />Reject</, "an accepted answer can be rejected");
  assert.match(html, /grade-badge auto/, "automatic verdicts are labelled as such");
  assert.match(html, /\(blank\)/);

  db.prepare("DELETE FROM grading_rules WHERE question_id = ?").run(questionId);
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

test("containment never grades a wrong answer correct just for sharing letters", () => {
  const question = db.prepare("SELECT * FROM questions WHERE position = 1").get() as any;
  const withAnswer = (answer: string, aliases: string[] = []) => {
    db.prepare("UPDATE questions SET canonical_answer = ?, aliases_json = ? WHERE id = ?").run(answer, JSON.stringify(aliases), question.id);
    return db.prepare("SELECT * FROM questions WHERE id = ?").get(question.id) as any;
  };

  // Every one of these graded "correct" before the boundary/length guard, on
  // the real Pop Culture Bee bank: Q15 "T", Q2 "The Who", Q36 "You",
  // Q20 "The Body", Q41 "Krypto", and Q44's bare "Fry" alias.
  const esrb = withAnswer("T");
  assert.equal(grading.autoVerdict(esrb, "I don't know").verdict, "unresolved");
  assert.equal(grading.autoVerdict(esrb, "Mature").verdict, "unresolved");
  assert.equal(grading.autoVerdict(esrb, "T").verdict, "correct", "the exact answer still stands on its own");
  assert.equal(grading.autoVerdict(esrb, "t ").verdict, "correct", "normalization still applies to short answers");

  const theWho = withAnswer("The Who");
  assert.equal(grading.autoVerdict(theWho, "I have no idea who").verdict, "unresolved");
  assert.equal(grading.autoVerdict(theWho, "Whodunit").verdict, "unresolved");
  assert.equal(grading.autoVerdict(theWho, "the who").verdict, "correct");

  assert.equal(grading.autoVerdict(withAnswer("You"), "Youth").verdict, "unresolved");
  assert.equal(grading.autoVerdict(withAnswer("The Body"), "everybody loves raymond").verdict, "unresolved");

  // Four characters or longer may still be contained, but only as a whole
  // word -- "Kryptonite" is a different thing than "Krypto".
  const krypto = withAnswer("Krypto");
  assert.equal(grading.autoVerdict(krypto, "Kryptonite").verdict, "unresolved");
  assert.equal(grading.autoVerdict(krypto, "the dog Krypto").verdict, "correct");

  // A bare short alias no longer drags in unrelated answers, while the
  // multi-word canonical answer stays containable.
  const fry = withAnswer("Stephen Fry", ["Fry"]);
  assert.equal(grading.autoVerdict(fry, "french fry").verdict, "unresolved");
  assert.equal(grading.autoVerdict(fry, "Fry").verdict, "correct", "the alias still matches exactly");
  assert.equal(grading.autoVerdict(fry, "I think it was Stephen Fry").verdict, "correct");

  // A stray empty alias (a trailing "|" in an imported CSV) must not accept
  // every non-blank answer on that question.
  assert.equal(grading.autoVerdict(withAnswer("Labubu", [""]), "no idea").verdict, "unresolved");

  db.prepare("UPDATE questions SET canonical_answer = ?, aliases_json = ? WHERE id = ?").run("answer1", "[]", question.id);
});

test("a surname counts on its own, but not behind somebody else's first name", () => {
  const question = db.prepare("SELECT * FROM questions WHERE position = 1").get() as any;
  const withPerson = (answer: string, aliases: string[], isPerson: boolean) => {
    db.prepare("UPDATE questions SET canonical_answer = ?, aliases_json = ?, answer_is_person = ? WHERE id = ?").run(answer, JSON.stringify(aliases), isPerson ? 1 : 0, question.id);
    return db.prepare("SELECT * FROM questions WHERE id = ?").get(question.id) as any;
  };

  // The flag alone accepts the surname -- no hand-written alias needed. This
  // is Q29 "Jayne Mansfield", which has no surname alias in the bank.
  const flagged = withPerson("Jayne Mansfield", [], true);
  assert.equal(grading.autoVerdict(flagged, "Mansfield").verdict, "correct");
  assert.equal(grading.autoVerdict(flagged, "Jayne Mansfield").verdict, "correct");
  assert.equal(grading.autoVerdict(flagged, "it was jayne mansfield").verdict, "correct");
  assert.equal(grading.autoVerdict(flagged, "Mansfield!").verdict, "correct", "punctuation alone is not a different answer");
  assert.equal(grading.autoVerdict(flagged, "Marilyn Mansfield").verdict, "unresolved", "a different first name is not auto-correct");

  // The same guard applies to a hand-written partial alias, flag or not --
  // this is the Kate Bush / George Bush case from the real bank.
  for (const isPerson of [true, false]) {
    const bush = withPerson("Kate Bush", ["Bush"], isPerson);
    assert.equal(grading.autoVerdict(bush, "Bush").verdict, "correct");
    assert.equal(grading.autoVerdict(bush, "kate bush").verdict, "correct");
    assert.equal(grading.autoVerdict(bush, "George Bush").verdict, "unresolved", `wrong first name must not score (person flag: ${isPerson})`);
    assert.equal(grading.autoVerdict(bush, "George W. Bush").verdict, "unresolved");
  }

  // A reviewer still has the final say in both directions, and one ruling
  // covers everyone who typed the same thing.
  const bush = withPerson("Kate Bush", ["Bush"], true);
  grading.applyReviewRuling(question.id, grading.normalize("George Bush"), "incorrect", "different person");
  assert.equal(grading.autoVerdict(bush, "george bush").verdict, "incorrect");

  // An alias that is not a shorthand of the canonical answer is unaffected.
  const pilots = withPerson("Twenty-One Pilots", ["21 Pilots"], false);
  assert.equal(grading.autoVerdict(pilots, "21 pilots").verdict, "correct");

  db.prepare("UPDATE questions SET canonical_answer = ?, aliases_json = ?, answer_is_person = 0 WHERE id = ?").run("answer1", "[]", question.id);
  db.prepare("DELETE FROM grading_rules WHERE question_id = ?").run(question.id);
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
  assert.ok(tied[0]!.answer_time_ms < tied[1]!.answer_time_ms);
});

test("an administrator-authorized restart can begin after the general cutoff", () => {
  const game = gameStore.activeGame();
  const originalCutoff = game.closes_at;
  try {
    db.prepare("UPDATE games SET closes_at = NULL WHERE id = ?").run(game.id);
    const player = freshPlayer();
    const first = quiz.serveNext(player);
    if (first.state !== "question") return assert.fail();
    const firstAttempt = quiz.currentAttempt(player.id)!;
    db.prepare("UPDATE attempts SET status = 'superseded', superseded_at = ?, restart_reason = ? WHERE id = ?").run(
      new Date().toISOString(),
      "Verified technical failure",
      firstAttempt.id,
    );
    db.prepare("UPDATE games SET closes_at = ? WHERE id = ?").run(new Date(Date.now() - 1).toISOString(), game.id);
    assert.equal(quiz.getStatus(player).state, "prestart");
    const restarted = quiz.serveNext(player);
    assert.equal(restarted.state, "question");
    assert.equal(quiz.currentAttempt(player.id)!.generation, 2);

    const neverStarted = freshPlayer();
    assert.equal(quiz.getStatus(neverStarted).state, "closed");
    assert.equal(quiz.serveNext(neverStarted).state, "closed");
  } finally {
    db.prepare("UPDATE games SET closes_at = ? WHERE id = ?").run(originalCutoff, game.id);
  }
});

test("recoverable invitation tokens round-trip under authenticated encryption", () => {
  const token = cryptoHelpers.randomToken();
  const encrypted = cryptoHelpers.encryptInvitationToken(token);
  assert.notEqual(encrypted, token);
  assert.equal(cryptoHelpers.decryptInvitationToken(encrypted), token);
  const parts = encrypted.split(".");
  const ciphertext = parts[2];
  assert.ok(ciphertext);
  parts[2] = `${ciphertext[0] === "A" ? "B" : "A"}${ciphertext.slice(1)}`;
  assert.throws(() => cryptoHelpers.decryptInvitationToken(parts.join(".")));
});

test("a tampered signed cookie is rejected, never raised as an error", () => {
  const signed = cryptoHelpers.sign("42");
  assert.equal(cryptoHelpers.unsign(signed), "42");
  assert.equal(cryptoHelpers.unsign(undefined), null);
  assert.equal(cryptoHelpers.unsign("42"), null, "an unsigned value carries no signature to check");
  assert.equal(cryptoHelpers.unsign(`43.${signed.split(".")[1]}`), null, "another value's signature does not transfer");

  // Same character count as a real signature, but more bytes: comparing as
  // characters instead of bytes made this throw a RangeError, turning a
  // forged cookie into a 500 instead of a plain rejection.
  const multibyte = `42.${"é".repeat(signed.length - 3)}`;
  assert.equal(multibyte.length, signed.length);
  assert.equal(cryptoHelpers.unsign(multibyte), null);
});

test("signed session cookies are bound to their purpose", () => {
  const player = freshPlayer();
  const accountId = Number(db.prepare("INSERT INTO accounts(email,display_name,created_at) VALUES (?,?,?)").run("typed-cookie@example.com", "Typed Cookie", new Date().toISOString()).lastInsertRowid);
  const playerCookie = cryptoHelpers.sign(`pcb_player:${player.id}`);
  const accountCookie = cryptoHelpers.sign(`pcb_account:${accountId}`);
  assert.equal(auth.currentPlayer({ headers: { cookie: `pcb_player=${playerCookie}` } } as any)?.id, player.id);
  assert.equal(auth.currentAccount({ headers: { cookie: `pcb_account=${accountCookie}` } } as any)?.id, accountId);
  assert.equal(auth.currentPlayer({ headers: { cookie: `pcb_player=${accountCookie}` } } as any), null, "an account cookie cannot impersonate a player");
  assert.equal(auth.currentAccount({ headers: { cookie: `pcb_account=${playerCookie}` } } as any), null, "a player cookie cannot impersonate an account");
  db.prepare("DELETE FROM accounts WHERE id=?").run(accountId);
});

test("a magic link cannot capture an invited player whose email was not verified", () => {
  const invited = freshPlayer();
  const createdAt = new Date().toISOString();
  const accountId = Number(db.prepare("INSERT INTO accounts(email,display_name,created_at) VALUES (?,?,?)").run("attacker-controlled@example.com", "Account", createdAt).lastInsertRowid);
  const token = "unverified-invited-player-token";
  db.prepare("INSERT INTO account_login_tokens(account_id,token_hash,requested_player_id,expires_at,created_at) VALUES (?,?,?,?,?)").run(accountId, cryptoHelpers.sha256(token), invited.id, new Date(Date.now() + 60_000).toISOString(), createdAt);
  assert.equal(accounts.consumeAccountLogin(token)?.id, accountId);
  assert.equal(db.prepare("SELECT account_id FROM account_player_links WHERE player_id=?").get(invited.id), undefined);
  db.prepare("DELETE FROM account_login_tokens WHERE account_id=?").run(accountId);
  db.prepare("DELETE FROM accounts WHERE id=?").run(accountId);
  db.prepare("DELETE FROM players WHERE id=?").run(invited.id);
});

test("test invitation lookup never substitutes a different test player's link", () => {
  const first = freshPlayer();
  const second = freshPlayer();
  db.prepare("UPDATE players SET token_ciphertext = ? WHERE id = ?").run("first-token", first.id);
  db.prepare("UPDATE players SET token_ciphertext = ? WHERE id = ?").run("second-token", second.id);
  assert.equal(admin.testPlayerForRecipient(second.email)?.id, second.id);
  assert.equal(admin.testPlayerForRecipient("missing@test.invalid"), null);
});

test("test attempts do not lock individual question editing", () => {
  const testPlayer = freshPlayer();
  quiz.serveNext(testPlayer);
  assert.equal(admin.questionEditingLocked(), false);
  db.prepare("UPDATE players SET is_test = 0 WHERE id = ?").run(testPlayer.id);
  assert.equal(admin.questionEditingLocked(), true);
  db.prepare("UPDATE players SET is_test = 1 WHERE id = ?").run(testPlayer.id);
});

test("the person flag stays settable after a real attempt freezes the question bank", () => {
  const question = db.prepare("SELECT id, answer_is_person FROM questions WHERE position = 3").get() as any;
  const realPlayer = freshPlayer();
  quiz.serveNext(realPlayer);
  db.prepare("UPDATE players SET is_test = 0 WHERE id = ?").run(realPlayer.id);
  assert.equal(admin.questionEditingLocked(), true, "a real participant freezes question content");

  // Grading metadata is not question content: it changes no prompt, answer, or
  // stored verdict, and the Review Queue can already regrade globally.
  assert.equal(admin.setQuestionAnswerIsPerson(question.id, true), true);
  assert.equal((db.prepare("SELECT answer_is_person FROM questions WHERE id = ?").get(question.id) as any).answer_is_person, 1);
  assert.equal(admin.setQuestionAnswerIsPerson(question.id, false), true);
  assert.equal((db.prepare("SELECT answer_is_person FROM questions WHERE id = ?").get(question.id) as any).answer_is_person, 0);
  assert.equal(admin.setQuestionAnswerIsPerson(999999, true), false, "an unknown question is rejected");

  // The control must still be rendered and enabled on a frozen bank, and it
  // must post to its own route rather than the locked content editor.
  const html = views.adminPage(
    { questionCount: 50, closesAt: null, results: [], grading: [], unresolvedCount: 0, questions: admin.adminQuestions(), questionsLocked: true, questionTextEditingEnabled: false, emailRelayConfigured: false, invitationStats: { realPlayers: 1, sent: 0, ready: 0, needsAttention: 0 }, reminderStats: { eligible: 0, sent: 0, needsAttention: 0 }, introCopy: introCopy.defaultIntroCopy, invitationTemplate: invitationTemplate.defaultInvitationTemplate, reminderTemplate: reminderTemplate.defaultReminderTemplate, completionNotifications: { enabled: false, recipient: "" }, completionCopy: completionCopy.defaultCompletionCopy, games: gameStore.games(), selectedGame: gameStore.selectedGame() },
    "questions",
  );
  assert.match(html, new RegExp(`action="/admin/question/${question.id}/grading"`));
  assert.equal(/name="answerIsPerson"[^>]*disabled/.test(html), false, "the person checkbox must not be disabled by the content lock");
  assert.match(html, /Save grading/);
  assert.equal(html.includes("Save question"), false, "question content stays frozen");
  assert.match(html, /Turn editing on/, "the frozen bank offers an explicit text-editing switch");

  admin.setQuestionTextEditingEnabled(true);
  assert.equal(admin.questionTextEditingEnabled(), true);
  const unlockedHtml = views.adminPage(
    { questionCount: 50, closesAt: null, results: [], grading: [], unresolvedCount: 0, questions: admin.adminQuestions(), questionsLocked: true, questionTextEditingEnabled: true, emailRelayConfigured: false, invitationStats: { realPlayers: 1, sent: 0, ready: 0, needsAttention: 0 }, reminderStats: { eligible: 0, sent: 0, needsAttention: 0 }, introCopy: introCopy.defaultIntroCopy, invitationTemplate: invitationTemplate.defaultInvitationTemplate, reminderTemplate: reminderTemplate.defaultReminderTemplate, completionNotifications: { enabled: false, recipient: "" }, completionCopy: completionCopy.defaultCompletionCopy, games: gameStore.games(), selectedGame: gameStore.selectedGame() },
    "questions",
  );
  assert.match(unlockedHtml, /Turn editing off/);
  assert.match(unlockedHtml, /Save question/);
  assert.equal(/name="category"[^>]*disabled/.test(unlockedHtml), false);
  assert.match(unlockedHtml, /name="answer"[^>]*disabled/, "answers remain protected while text editing is on");
  admin.setQuestionTextEditingEnabled(false);

  // audit_events references attempts, so it has to go first.
  db.prepare("DELETE FROM audit_events WHERE attempt_id IN (SELECT id FROM attempts WHERE player_id = ?)").run(realPlayer.id);
  db.prepare("DELETE FROM exposures WHERE attempt_id IN (SELECT id FROM attempts WHERE player_id = ?)").run(realPlayer.id);
  db.prepare("DELETE FROM attempts WHERE player_id = ?").run(realPlayer.id);
  db.prepare("DELETE FROM players WHERE id = ?").run(realPlayer.id);
  assert.equal(admin.questionEditingLocked(), false, "the suite is left unlocked for later tests");
});

test("real and test result exports remain separated", () => {
  const testPlayer = freshPlayer();
  const realPlayer = freshPlayer();
  db.prepare("UPDATE players SET is_test = 0 WHERE id = ?").run(realPlayer.id);
  const testCsv = admin.resultsCsv(true);
  const realCsv = admin.resultsCsv(false);
  assert.match(testCsv, new RegExp(testPlayer.email));
  assert.equal(testCsv.includes(realPlayer.email), false);
  assert.match(realCsv, new RegExp(realPlayer.email));
  assert.equal(realCsv.includes(testPlayer.email), false);
});

test("player answer history includes submitted answer, verdict, and question timing", () => {
  const player = freshPlayer();
  const served = quiz.serveNext(player);
  if (served.state !== "question") return assert.fail();
  quiz.submitAnswer(quiz.currentAttempt(player.id)!.id, served.nonce, "answer1");
  const history = admin.playerAnswerHistory(player.id);
  assert.equal(history?.attempts.length, 1);
  assert.equal(history?.answers.length, 1);
  assert.equal(history?.answers[0]?.submitted_text, "answer1");
  assert.equal(history?.answers[0]?.verdict, "correct");
  assert.equal(history?.answers[0]?.included_in_score, 1);
  assert.equal(typeof history?.answers[0]?.elapsed_ms, "number");
});

test("answer time includes finalized incorrect answers", async () => {
  const player = freshPlayer();
  const served = quiz.serveNext(player);
  if (served.state !== "question") return assert.fail();
  await sleep(5);
  quiz.submitAnswer(quiz.currentAttempt(player.id)!.id, served.nonce, "");
  const row = admin.results().find((result) => result.id === player.id);
  assert.equal(row?.score, 0);
  assert.ok((row?.answer_time_ms ?? 0) > 0);
});

test("Workspace invitation mail preflights relay capacity and reports a hard pause without fallback", async () => {
  const originalUrl = config.emailRelayUrl;
  const originalSecret = config.emailRelaySecret;
  const originalClientId = config.emailRelayClientId;
  const originalFetch = globalThis.fetch;
  const actions: string[] = [];
  try {
    config.emailRelayUrl = "https://relay.test/exec";
    config.emailRelaySecret = "test-secret";
    config.emailRelayClientId = "timed_quiz";
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body ?? "{}")) as { action: string; secret?: string };
      actions.push(payload.action);
      assert.equal(payload.secret, undefined);
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("x-relay-client"), "timed_quiz");
      assert.equal(headers.get("authorization"), "Bearer test-secret");
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
    config.emailRelayClientId = originalClientId;
    globalThis.fetch = originalFetch;
  }
});

test("completion notifications include testers and claim each attempt before one relay send", async () => {
  const player = freshPlayer();
  const started = new Date().toISOString();
  const attemptResult = db.prepare("INSERT INTO attempts (player_id, generation, status, started_at, completed_at) VALUES (?, 1, 'completed', ?, ?)").run(player.id, started, started);
  const attemptId = Number(attemptResult.lastInsertRowid);
  const originalUrl = config.emailRelayUrl;
  const originalSecret = config.emailRelaySecret;
  const originalClientId = config.emailRelayClientId;
  const originalFetch = globalThis.fetch;
  const payloads: Array<Record<string, unknown>> = [];
  try {
    config.emailRelayUrl = "https://relay.test/v1/mail";
    config.emailRelaySecret = "test-secret";
    config.emailRelayClientId = "timed_quiz";
    completionNotification.setCompletionNotificationSettings({ enabled: true, recipient: "owner@example.com" });
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      payloads.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      return new Response(JSON.stringify({ ok: true, remaining: 998 }), { status: 200 });
    }) as typeof fetch;
    assert.equal(await completionNotification.sendCompletionNotification(attemptId), true);
    assert.equal(await completionNotification.sendCompletionNotification(attemptId), false);
    assert.equal(payloads.length, 1);
    assert.equal(payloads[0]?.to, "owner@example.com");
    assert.match(String(payloads[0]?.subject), /^\[TEST\] Bee Quiz completed:/);
    assert.match(String(payloads[0]?.plain_body), new RegExp(`/admin/player/${player.id}/answers`));
    const stored = db.prepare("SELECT completion_notification_started_at, completion_notified_at, completion_notification_error FROM attempts WHERE id = ?").get(attemptId) as { completion_notification_started_at: string | null; completion_notified_at: string | null; completion_notification_error: string | null };
    assert.ok(stored.completion_notification_started_at);
    assert.ok(stored.completion_notified_at);
    assert.equal(stored.completion_notification_error, null);
  } finally {
    completionNotification.setCompletionNotificationSettings({ enabled: false, recipient: "" });
    config.emailRelayUrl = originalUrl;
    config.emailRelaySecret = originalSecret;
    config.emailRelayClientId = originalClientId;
    globalThis.fetch = originalFetch;
  }
});

test("public completions never call the configured mail relay", async () => {
  const player = publicAccess.registerPublicPlayer(gameStore.activeGame().id, "No Mail Player");
  assert.ok(player);
  const started = new Date().toISOString();
  const attemptId = Number(db.prepare("INSERT INTO attempts (player_id, generation, status, started_at, completed_at) VALUES (?, 1, 'completed', ?, ?)").run(player.id, started, started).lastInsertRowid);
  const originalUrl = config.emailRelayUrl;
  const originalSecret = config.emailRelaySecret;
  const originalClientId = config.emailRelayClientId;
  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    config.emailRelayUrl = "https://relay.test/v1/mail";
    config.emailRelaySecret = "test-secret";
    config.emailRelayClientId = "timed_quiz";
    completionNotification.setCompletionNotificationSettings({ enabled: true, recipient: "owner@example.com" });
    globalThis.fetch = (async () => { calls++; return new Response(JSON.stringify({ ok: true }), { status: 200 }); }) as typeof fetch;
    assert.equal(await completionNotification.sendCompletionNotification(attemptId), false);
    assert.equal(calls, 0);
    const stored = db.prepare("SELECT completion_notification_started_at FROM attempts WHERE id = ?").get(attemptId) as { completion_notification_started_at: string | null };
    assert.equal(stored.completion_notification_started_at, null);
  } finally {
    completionNotification.setCompletionNotificationSettings({ enabled: false, recipient: "" });
    config.emailRelayUrl = originalUrl;
    config.emailRelaySecret = originalSecret;
    config.emailRelayClientId = originalClientId;
    globalThis.fetch = originalFetch;
  }
});

test("player score and answers stay hidden until every submitted answer is graded", () => {
  const player = freshPlayer();
  const now = new Date().toISOString();
  const attemptId = Number(db.prepare("INSERT INTO attempts (player_id, generation, status, started_at, completed_at) VALUES (?, 1, 'completed', ?, ?)").run(player.id, now, now).lastInsertRowid);
  const questionId = Number((db.prepare("SELECT id FROM questions WHERE game_id = ? AND position = 1").get(player.game_id) as { id: number }).id);
  db.prepare(`INSERT INTO exposures
    (attempt_id,question_id,nonce,served_at,deadline_at,submitted_text,submitted_at,finalized_reason,normalized_answer,verdict,elapsed_ms)
    VALUES (?,?,?,?,?,?,?,?,?,'unresolved',?)`).run(attemptId, questionId, `results-${attemptId}`, now, now, "maybe", now, "manual", "maybe", 100);

  assert.deepEqual(publicAccess.playerResults(player), { ready: false });
  const pending = quiz.getStatus(player);
  assert.equal(pending.state, "complete");
  if (pending.state === "complete") assert.equal(pending.resultsAvailable, false);
  assert.equal(views.playerResultsPage(player, publicAccess.playerResults(player), completionCopy.defaultCompletionCopy).includes("100 correct"), false);

  db.prepare("UPDATE exposures SET verdict = 'incorrect' WHERE attempt_id = ?").run(attemptId);
  const graded = publicAccess.playerResults(player);
  assert.equal(graded?.ready, true);
  if (graded?.ready) {
    assert.equal(graded.score, 0);
    assert.equal(graded.answers[0]?.submitted_text, "maybe");
    assert.equal(graded.answers[0]?.verdict, "incorrect");
  }
  const available = quiz.getStatus(player);
  assert.equal(available.state, "complete");
  if (available.state === "complete") assert.equal(available.resultsAvailable, true);
});

test("completion screen copy is editable and safely rendered", () => {
  const custom = {
    title: "All done <great>",
    message: "Your entry is saved.",
    pendingMessage: "Check back after grading.",
    resultsButtonLabel: "See results",
    chooserButtonLabel: "Pick another quiz",
  };
  completionCopy.setCompletionCopy(custom);
  assert.deepEqual(completionCopy.getCompletionCopy(), custom);
  const player = freshPlayer();
  const html = views.playerResultsPage(player, { ready: false }, custom);
  assert.equal(html.includes("<great>"), false);
  assert.match(html, /Pick another quiz/);
  completionCopy.setCompletionCopy(completionCopy.defaultCompletionCopy);
});

test("administrator password changes are salted, hashed, and immediately replace the bootstrap password", () => {
  assert.equal(auth.checkAdminPassword(config.adminPassword), true);
  const replacement = "short";
  auth.setAdminPassword(replacement);
  const stored = db.prepare("SELECT setting_value FROM app_settings WHERE setting_key = 'admin_password_scrypt'").get() as { setting_value: string };
  assert.match(stored.setting_value, /^scrypt\$/);
  assert.equal(stored.setting_value.includes(replacement), false);
  assert.equal(auth.checkAdminPassword(config.adminPassword), false);
  assert.equal(auth.checkAdminPassword(replacement), true);
});

test("admin sign-in preserves a safe destination and invitation anchor", () => {
  const html = views.adminLoginPage(false, "/admin/players#invitations");
  assert.match(html, /name="next" value="\/admin\/players#invitations"/);
  assert.match(html, /location\.hash/);
});

test("player import continuation forces a GET instead of a same-document hash change", () => {
  const postDocument = new URL("https://bee.test/admin/players");
  const continuation = new URL(admin.playerImportContinueUrl, postDocument);
  assert.equal(continuation.pathname, "/admin/players");
  assert.equal(continuation.hash, "#invitations");
  assert.notEqual(continuation.search, "", "a distinct URL makes the browser request the admin page");
});

test("Progress renders a persistent test-player visibility control", () => {
  const testPlayer = freshPlayer();
  const html = views.adminPage(
    { questionCount: 50, closesAt: null, results: admin.results(), grading: [], unresolvedCount: 0, questions: admin.adminQuestions(), questionsLocked: false, questionTextEditingEnabled: false, emailRelayConfigured: false, invitationStats: { realPlayers: 0, sent: 0, ready: 0, needsAttention: 0 }, reminderStats: { eligible: 0, sent: 0, needsAttention: 0 }, introCopy: introCopy.defaultIntroCopy, invitationTemplate: invitationTemplate.defaultInvitationTemplate, reminderTemplate: reminderTemplate.defaultReminderTemplate, completionNotifications: { enabled: false, recipient: "" }, completionCopy: completionCopy.defaultCompletionCopy, games: gameStore.games(), selectedGame: gameStore.selectedGame() },
    "progress",
  );
  assert.match(html, /id="showTestPlayers"/);
  assert.match(html, /data-test-player="1"/);
  assert.match(html, /pcb-show-test-players/);
  db.prepare("DELETE FROM players WHERE id = ?").run(testPlayer.id);
});

test("question CSV round-trips quoted punctuation, newlines, aliases, and the person flag", () => {
  const questions = [
    { position: 1, category: "Movies, TV & More", prompt: "Who said *\"Hello\"*?\nName the character.", highlightedText: "Name the character", answer: "A, B", aliases: ["A", "B"], answerIsPerson: false },
    { position: 2, category: "Music", prompt: "Who sang it?", highlightedText: "", answer: "Kate Bush", aliases: [], answerIsPerson: true },
  ];
  const csv = questionImport.questionsToCsv(questions);
  assert.deepEqual(questionImport.parseQuestionImport(csv), questions);
  assert.equal(questionImport.visiblePromptText(questions[0]!.prompt), "Who said \"Hello\"?\nName the character.");

  // A bank exported before the column existed must still import, defaulting
  // to "not a person" rather than failing.
  const legacy = "position,category,question,highlighted_text,answer,aliases\r\n1,Music,Who sang it?,,Kate Bush,Bush\r\n";
  assert.deepEqual(questionImport.parseQuestionImport(legacy), [
    { position: 1, category: "Music", prompt: "Who sang it?", highlightedText: "", answer: "Kate Bush", aliases: ["Bush"], answerIsPerson: undefined },
  ]);
});

test("player CSV round-trips names with commas and test flags", () => {
  const players = [{ email: "person@example.com", name: "Friedewald, Russell", isTest: false }, { email: "test@example.com", name: "Test Player", isTest: true }];
  assert.deepEqual(playerImport.parsePlayerImport(playerImport.playersToCsv(players)), players);
});

test("saved player intro copy is returned before an attempt starts", () => {
  const player = freshPlayer();
  const customized = { ...introCopy.defaultIntroCopy, title: "A Custom Preliminary", buttonLabel: "Begin now" };
  introCopy.setIntroCopy(customized);
  const state = quiz.getStatus(player);
  assert.equal(state.state, "prestart");
  if (state.state === "prestart") assert.deepEqual(state.intro, customized);
});

test("admin question preview safely embeds prompt data without creating executable markup", () => {
  const html = views.questionPreviewPage({ id: 7, position: 2, category: "TV", prompt: "*Title* </script><script>alert(1)</script>", highlighted_text: "Title", canonical_answer: "Answer", aliases_json: "[]", answer_is_person: 0 }, 50);
  assert.equal(html.includes("</script><script>alert(1)</script>"), false);
  assert.match(html, /Admin preview/);
  assert.match(html, /\/admin\/preview\/1/);
  assert.match(html, /\/admin\/preview\/3/);
  assert.match(html, />25\.0</);
});

test("invitation email template substitutes required fields and escapes HTML", () => {
  invitationTemplate.setInvitationTemplate({ subject: "Quiz for {{name}}", body: "Hello {{name}} <script>bad</script>\n\nOpen {{link}}" });
  const rendered = invitationTemplate.renderInvitationTemplate("A&B", "https://quiz.test/invite/a?x=1&y=2", true);
  assert.equal(rendered.subject, "[TEST] Quiz for A&B");
  assert.match(rendered.plain, /Hello A&B/);
  assert.match(rendered.plain, /https:\/\/quiz\.test\/invite/);
  assert.equal(rendered.html.includes("<script>bad</script>"), false);
  assert.match(rendered.html, /A&amp;B/);
  assert.match(rendered.html, /href="https:\/\/quiz\.test\/invite\/a\?x=1&amp;y=2"/);
});

test("reminder email states the Central Thursday deadline and carries only the personalized link", () => {
  const rendered = reminderTemplate.renderReminderEmail("A&B", "https://quiz.test/invite/a?x=1&y=2");
  assert.match(rendered.subject, /Reminder/);
  assert.match(rendered.plain, /midnight \(Central time\) Thursday/);
  assert.match(rendered.plain, /https:\/\/quiz\.test\/invite\/a\?x=1&y=2/);
  assert.match(rendered.html, /A&amp;B/);
  assert.match(rendered.html, /href="https:\/\/quiz\.test\/invite\/a\?x=1&amp;y=2"/);
});

test("saved reminder templates substitute placeholders and escape HTML", () => {
  reminderTemplate.setReminderTemplate({ subject: "Reminder for {{name}}", body: "Hello {{name}} <script>bad</script>\n\nFinish here: {{link}}" });
  assert.deepEqual(reminderTemplate.getReminderTemplate(), { subject: "Reminder for {{name}}", body: "Hello {{name}} <script>bad</script>\n\nFinish here: {{link}}" });
  const rendered = reminderTemplate.renderReminderEmail("A&B", "https://quiz.test/invite/a?x=1&y=2");
  assert.equal(rendered.subject, "Reminder for A&B");
  assert.match(rendered.plain, /Finish here: https:\/\/quiz\.test\/invite/);
  assert.equal(rendered.html.includes("<script>bad</script>"), false);
  assert.match(rendered.html, /A&amp;B/);
  assert.match(rendered.html, /href="https:\/\/quiz\.test\/invite\/a\?x=1&amp;y=2"/);
  reminderTemplate.setReminderTemplate(reminderTemplate.defaultReminderTemplate);
});

test("reminders select only invited, incomplete, unreminded real players", () => {
  const createdAt = new Date().toISOString();
  const insert = db.prepare(`INSERT INTO players
    (game_id, email, display_name, token_hash, token_ciphertext, invite_sent_at, reminder_sent_at, is_test, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const gameId = gameStore.selectedGame().id;
  const eligible = Number(insert.run(gameId, "eligible@example.com", "Eligible", "reminder-eligible", cryptoHelpers.encryptInvitationToken("eligible-token"), createdAt, null, 0, createdAt).lastInsertRowid);
  const completed = Number(insert.run(gameId, "completed@example.com", "Completed", "reminder-completed", cryptoHelpers.encryptInvitationToken("completed-token"), createdAt, null, 0, createdAt).lastInsertRowid);
  const testPlayer = Number(insert.run(gameId, "reminder-test@example.com", "Test", "reminder-test", cryptoHelpers.encryptInvitationToken("test-token"), createdAt, null, 1, createdAt).lastInsertRowid);
  const reminded = Number(insert.run(gameId, "reminded@example.com", "Reminded", "reminder-reminded", cryptoHelpers.encryptInvitationToken("reminded-token"), createdAt, createdAt, 0, createdAt).lastInsertRowid);
  const notInvited = Number(insert.run(gameId, "not-invited@example.com", "Not invited", "reminder-not-invited", cryptoHelpers.encryptInvitationToken("not-invited-token"), null, null, 0, createdAt).lastInsertRowid);
  db.prepare("INSERT INTO attempts (player_id, generation, status, started_at, completed_at) VALUES (?, 1, 'completed', ?, ?)").run(completed, createdAt, createdAt);
  const ids = admin.reminderCandidates().map((player) => player.id);
  assert.ok(ids.includes(eligible));
  assert.equal(ids.includes(completed), false);
  assert.equal(ids.includes(testPlayer), false);
  assert.equal(ids.includes(reminded), false);
  assert.equal(ids.includes(notInvited), false);
  db.prepare("DELETE FROM attempts WHERE player_id = ?").run(completed);
  for (const id of [eligible, completed, testPlayer, reminded, notInvited]) db.prepare("DELETE FROM players WHERE id = ?").run(id);
});

test("games isolate players and questions while playable inactive-game links still open", () => {
  const firstGame = gameStore.activeGame();
  const secondGame = gameStore.createGame("Second Bee", "2026-12-01T06:00:00.000Z");
  const createdAt = new Date().toISOString();
  const token = "second-game-token";
  const secondPlayerId = Number(db.prepare(`INSERT INTO players
    (game_id, email, display_name, token_hash, token_ciphertext, is_test, created_at)
    VALUES (?, ?, ?, ?, ?, 0, ?)`).run(secondGame.id, "player1@test.invalid", "Second Game Player", cryptoHelpers.sha256(token), cryptoHelpers.encryptInvitationToken(token), createdAt).lastInsertRowid);
  db.prepare("INSERT INTO questions (game_id, position, prompt, canonical_answer, aliases_json) VALUES (?, 1, ?, ?, '[]')").run(secondGame.id, "Second game question?", "second");

  assert.equal(quiz.findPlayerByTokenHash(cryptoHelpers.sha256(token))?.id, secondPlayerId, "a valid link is independent of the admin email-selection flag");
  gameStore.selectGame(secondGame.id);
  assert.equal(admin.adminQuestions().length, 1);
  assert.equal(admin.results().some((row) => row.id === secondPlayerId), true);
  assert.equal(admin.results().some((row) => row.game_id === firstGame.id), false);

  gameStore.activateGame(secondGame.id);
  assert.equal(quiz.findPlayerByTokenHash(cryptoHelpers.sha256(token))?.id, secondPlayerId);
  assert.equal(gameStore.games().filter((game) => game.is_active).length, 1);

  gameStore.activateGame(firstGame.id);
  gameStore.selectGame(firstGame.id);
  db.prepare("DELETE FROM questions WHERE game_id = ?").run(secondGame.id);
  db.prepare("DELETE FROM players WHERE id = ?").run(secondPlayerId);
  db.prepare("DELETE FROM games WHERE id = ?").run(secondGame.id);
});

test("public players can choose and play each open game without entering invitation batches", () => {
  const firstGame = gameStore.activeGame();
  const createdAt = new Date().toISOString();
  const secondGame = gameStore.createGame("Public Two-question Test", null, 2);
  const insertQuestion = db.prepare("INSERT INTO questions (game_id, position, prompt, canonical_answer, aliases_json) VALUES (?, ?, ?, ?, '[]')");
  for (let i = 1; i <= 2; i++) insertQuestion.run(secondGame.id, i, `Second question ${i}?`, `second${i}`);

  const invitationCountBefore = admin.invitationStats().realPlayers;
  const player = publicAccess.registerPublicPlayer(firstGame.id, "  Public   Player  ");
  assert.ok(player);
  assert.equal(publicAccess.registerPublicPlayer(firstGame.id, "person@example.com"), null, "an email address cannot become a public scoreboard display name");
  assert.equal(player.display_name, "Public Player");
  assert.equal(admin.results().find((row) => row.id === player.id)?.email, "Guest — no email", "admin never exposes the internal guest identity as an email address");
  assert.equal(publicAccess.playerGameOptions(player).length, 2);

  const secondPlayer = publicAccess.playerForGame(player, secondGame.id);
  assert.ok(secondPlayer);
  assert.equal(secondPlayer.email, player.email, "the chooser keeps one private public identity across games");
  assert.notEqual(secondPlayer.id, player.id, "each game retains its own player and attempt history");
  assert.equal(admin.invitationStats().realPlayers, invitationCountBefore, "public registrations do not enter email batches");

  let state = quiz.serveNext(secondPlayer);
  assert.equal(state.state, "question");
  if (state.state === "question") quiz.submitAnswer(quiz.currentAttempt(secondPlayer.id)!.id, state.nonce, "second1");
  state = quiz.serveNext(secondPlayer);
  assert.equal(state.state, "question");
  if (state.state === "question") quiz.submitAnswer(quiz.currentAttempt(secondPlayer.id)!.id, state.nonce, "second2");
  assert.equal(quiz.getStatus(secondPlayer).state, "complete", "a game completes at its configured two-question length");
  const testResults = publicAccess.playerResults(secondPlayer);
  assert.equal(testResults?.ready, true);
  if (testResults?.ready) {
    assert.equal(testResults.gameName, "Public Two-question Test");
    assert.equal(testResults.score, 2);
    assert.deepEqual(testResults.answers.map((answer) => [answer.position, answer.submitted_text, answer.verdict]), [[1, "second1", "correct"], [2, "second2", "correct"]]);
  }
  const board = publicAccess.gameScoreboard(secondGame.id);
  assert.equal(board?.rows.length, 1);
  assert.deepEqual(board?.rows.map((row) => [row.rank, row.displayName, row.score]), [[1, "Public Player", 2]]);

  const accountId = Number(db.prepare("INSERT INTO accounts (email,display_name,created_at) VALUES ('public@example.com','Public Player',?)").run(createdAt).lastInsertRowid);
  const loginToken = "one-time-account-token";
  db.prepare("INSERT INTO account_login_tokens (account_id,token_hash,requested_player_id,expires_at,created_at) VALUES (?,?,?,?,?)").run(accountId, cryptoHelpers.sha256(loginToken), secondPlayer.id, new Date(Date.now() + 60_000).toISOString(), createdAt);
  assert.equal(accounts.consumeAccountLogin(loginToken)?.id, accountId);
  assert.equal(accounts.consumeAccountLogin(loginToken), null, "a magic link is single use");
  assert.equal(accounts.accountHistory(accountId).find((row) => row.playerId === secondPlayer.id)?.score, 2);
  gameStore.selectGame(secondGame.id);
  assert.equal(admin.results().find((row) => row.id === secondPlayer.id)?.email, "public@example.com", "a linked guest displays the verified account email");
  const invited = freshPlayer();
  db.prepare("INSERT INTO account_player_links(account_id,player_id,linked_at) VALUES (?,?,?)").run(accountId, invited.id, createdAt);
  gameStore.selectGame(firstGame.id);
  assert.equal(admin.results().find((row) => row.id === invited.id)?.email, invited.email, "a linked invited player retains the invitation email in admin and exports");
  db.prepare("DELETE FROM account_player_links WHERE player_id=?").run(invited.id);
  db.prepare("DELETE FROM players WHERE id=?").run(invited.id);

  db.prepare("DELETE FROM account_player_links WHERE account_id=?").run(accountId);
  db.prepare("DELETE FROM account_login_tokens WHERE account_id=?").run(accountId);
  db.prepare("DELETE FROM accounts WHERE id=?").run(accountId);
  db.prepare("DELETE FROM exposures WHERE attempt_id IN (SELECT id FROM attempts WHERE player_id = ?)").run(secondPlayer.id);
  db.prepare("DELETE FROM audit_events WHERE attempt_id IN (SELECT id FROM attempts WHERE player_id = ?)").run(secondPlayer.id);
  db.prepare("DELETE FROM attempts WHERE player_id = ?").run(secondPlayer.id);
  db.prepare("DELETE FROM players WHERE email = ?").run(player.email);
  db.prepare("DELETE FROM questions WHERE game_id = ?").run(secondGame.id);
  db.prepare("DELETE FROM games WHERE id = ?").run(secondGame.id);
});
