import { config } from "./config.ts";
import { db, logEvent, nowIso } from "./db.ts";
import { autoVerdict, type QuestionRow } from "./grading.ts";
import { randomToken } from "./crypto.ts";

export interface Player {
  id: number;
  email: string;
  display_name: string;
  is_test: number;
}

export interface Attempt {
  id: number;
  player_id: number;
  generation: number;
  status: "in_progress" | "completed" | "superseded" | "disqualified";
  started_at: string;
}

export interface Exposure {
  id: number;
  attempt_id: number;
  question_id: number;
  nonce: string;
  served_at: string;
  deadline_at: string;
  displayed_at: string | null;
  draft_text: string;
  draft_sequence: number;
  submitted_text: string | null;
  finalized_reason: string | null;
  elapsed_ms: number | null;
}

export type QuizState =
  | { state: "prestart"; questionCount: number; closesAt: string | null }
  | { state: "closed" }
  | { state: "ready"; nextPosition: number }
  | { state: "question"; position: number; category: string; prompt: string; nonce: string; deadlineAt: string; draft: string }
  | { state: "complete" };

export function questionCount(): number {
  return Number((db.prepare("SELECT COUNT(*) AS n FROM questions").get() as { n: number }).n);
}

export function findPlayerById(id: number): Player | null {
  return (db.prepare("SELECT id, email, display_name, is_test FROM players WHERE id = ?").get(id) as unknown as Player | undefined) ?? null;
}

export function findPlayerByTokenHash(tokenHash: string): Player | null {
  return (
    (db.prepare("SELECT id, email, display_name, is_test FROM players WHERE token_hash = ?").get(tokenHash) as
      | Player
      | undefined) ?? null
  );
}

export function currentAttempt(playerId: number): Attempt | null {
  return (
    (db
      .prepare(
        "SELECT id, player_id, generation, status, started_at FROM attempts WHERE player_id = ? AND status IN ('in_progress','completed') ORDER BY generation DESC LIMIT 1",
      )
      .get(playerId) as unknown as Attempt | undefined) ?? null
  );
}

export function activeExposure(attemptId: number): Exposure | null {
  return (
    (db
      .prepare("SELECT * FROM exposures WHERE attempt_id = ? AND submitted_at IS NULL ORDER BY question_id DESC LIMIT 1")
      .get(attemptId) as unknown as Exposure | undefined) ?? null
  );
}

function questionByPosition(position: number): QuestionRow {
  return db.prepare("SELECT * FROM questions WHERE position = ?").get(position) as unknown as QuestionRow;
}

function questionById(id: number): QuestionRow {
  return db.prepare("SELECT * FROM questions WHERE id = ?").get(id) as unknown as QuestionRow;
}

export function finalizedCount(attemptId: number): number {
  return Number(
    (db.prepare("SELECT COUNT(*) AS n FROM exposures WHERE attempt_id = ? AND submitted_at IS NOT NULL").get(attemptId) as {
      n: number;
    }).n,
  );
}

function hasAuthorizedRestart(playerId: number): boolean {
  const latestPrior = db.prepare("SELECT status, restart_reason FROM attempts WHERE player_id = ? ORDER BY generation DESC LIMIT 1").get(playerId) as { status: string; restart_reason: string | null } | undefined;
  return latestPrior?.status === "superseded" && Boolean(latestPrior.restart_reason);
}

/**
 * Finalizes an exposure exactly once via an UPDATE guarded on
 * `submitted_at IS NULL` -- a page load racing an auto-submit, or two
 * near-simultaneous submit calls, can only ever have one of them actually
 * write the row.
 */
function finalize(exposure: Exposure, reason: "manual" | "timeout", text: string): void {
  const question = questionById(exposure.question_id);
  const answer = text.slice(0, 500);
  const { verdict, normalizedAnswer } = autoVerdict(question, answer);
  const submittedAt = nowIso();
  const measuredMs = Math.max(0, Date.parse(submittedAt) - Date.parse(exposure.served_at));
  const questionWindowMs = Math.max(0, Date.parse(exposure.deadline_at) - Date.parse(exposure.served_at));
  const elapsedMs = Math.min(measuredMs, questionWindowMs);
  const changed = db
    .prepare(
      `UPDATE exposures SET submitted_text = ?, submitted_at = ?, finalized_reason = ?, normalized_answer = ?, verdict = ?, elapsed_ms = ?
       WHERE id = ? AND submitted_at IS NULL`,
    )
    .run(answer, submittedAt, reason, normalizedAnswer, verdict, elapsedMs, exposure.id).changes;

  if (changed) {
    logEvent(exposure.attempt_id, "answer_finalized", { questionId: exposure.question_id, reason, verdict });
  }

  if (finalizedCount(exposure.attempt_id) >= questionCount()) {
    db.prepare("UPDATE attempts SET status = 'completed', completed_at = ? WHERE id = ? AND status = 'in_progress'").run(
      nowIso(),
      exposure.attempt_id,
    );
  }
}

/**
 * If the active exposure's deadline (plus the bounded transport allowance)
 * has already passed, finalize it now using its last saved draft. Called
 * before every read/write of quiz state so a question abandoned mid-flight
 * closes out correctly whether or not the player ever comes back.
 */
export function expireIfNeeded(attemptId: number): void {
  const exposure = activeExposure(attemptId);
  if (!exposure) return;
  if (Date.now() > Date.parse(exposure.deadline_at) + config.submitGraceMs) {
    finalize(exposure, "timeout", exposure.draft_text);
  }
}

export function recordDisplayed(attemptId: number, nonce: string): void {
  db.prepare("UPDATE exposures SET displayed_at = COALESCE(displayed_at, ?) WHERE attempt_id = ? AND nonce = ?").run(
    nowIso(),
    attemptId,
    nonce,
  );
}

export function saveDraft(attemptId: number, nonce: string, sequence: number, text: string): { ok: boolean; error?: string } {
  const exposure = activeExposure(attemptId);
  if (!exposure || exposure.nonce !== nonce) return { ok: false, error: "Question changed." };
  // Refused once the deadline (plus allowance) has passed -- this is what
  // makes promoting draft_text to the final answer on expiry safe: a draft
  // can never be newer than the moment the window actually closed.
  if (Date.now() > Date.parse(exposure.deadline_at) + config.submitGraceMs) return { ok: false, error: "Question expired." };
  const safeSequence = Math.max(0, Math.floor(sequence) || 0);
  db.prepare("UPDATE exposures SET draft_text = ?, draft_sequence = ? WHERE id = ? AND submitted_at IS NULL AND draft_sequence < ?").run(
    text.slice(0, 500),
    safeSequence,
    exposure.id,
    safeSequence,
  );
  return { ok: true };
}

export function submitAnswer(attemptId: number, nonce: string, text: string): { ok: boolean; error?: string } {
  const exposure = activeExposure(attemptId);
  if (!exposure || exposure.nonce !== nonce) return { ok: true }; // already moved on; nothing to do
  const timely = Date.now() <= Date.parse(exposure.deadline_at) + config.submitGraceMs;
  finalize(exposure, timely ? "manual" : "timeout", timely ? text : exposure.draft_text);
  return { ok: true };
}

/** Read-only status check. Never creates an attempt or an exposure. */
export function getStatus(player: Player): QuizState {
  const attempt = currentAttempt(player.id);
  if (!attempt) {
    if (config.closesAt !== null && Date.now() > config.closesAt && !hasAuthorizedRestart(player.id)) return { state: "closed" };
    return { state: "prestart", questionCount: questionCount(), closesAt: config.closesAt ? new Date(config.closesAt).toISOString() : null };
  }
  expireIfNeeded(attempt.id);
  const refreshed = currentAttempt(player.id);
  if (!refreshed || refreshed.status === "completed") return { state: "complete" };
  const exposure = activeExposure(refreshed.id);
  if (exposure) {
    const question = questionById(exposure.question_id);
    return {
      state: "question",
      position: question.position,
      category: question.category,
      prompt: question.prompt,
      nonce: exposure.nonce,
      deadlineAt: exposure.deadline_at,
      draft: exposure.draft_text,
    };
  }
  return { state: "ready", nextPosition: finalizedCount(refreshed.id) + 1 };
}

/**
 * Creates (or starts, on first call) an attempt and serves the next
 * question in the SAME response that fixes its deadline -- unlike a design
 * that fixes deadline_at on a "ready" click and only returns the prompt on a
 * later, separate request, which anchors the server clock to an earlier,
 * unrelated moment than when the player actually sees the question. Here
 * there is exactly one round-trip between "I'm ready" and a fixed deadline
 * that corresponds to content the player is looking at *in this same
 * response*, so the transport-grace allowance only ever has to absorb this
 * one request's latency, not two chained ones.
 */
export function serveNext(player: Player): QuizState {
  if (questionCount() !== 50) return { state: "prestart", questionCount: questionCount(), closesAt: null };

  let attempt = currentAttempt(player.id);
  if (!attempt) {
    if (config.closesAt !== null && Date.now() > config.closesAt && !hasAuthorizedRestart(player.id)) return { state: "closed" };
    const generation = Number(
      (db.prepare("SELECT COALESCE(MAX(generation), 0) + 1 AS n FROM attempts WHERE player_id = ?").get(player.id) as {
        n: number;
      }).n,
    );
    const result = db
      .prepare("INSERT INTO attempts (player_id, generation, status, started_at) VALUES (?, ?, 'in_progress', ?)")
      .run(player.id, generation, nowIso());
    attempt = db.prepare("SELECT id, player_id, generation, status, started_at FROM attempts WHERE id = ?").get(
      result.lastInsertRowid,
    ) as unknown as Attempt;
    logEvent(attempt.id, "attempt_started", { generation });
  }

  if (attempt.status === "completed") return { state: "complete" };

  expireIfNeeded(attempt.id);
  const refreshed = currentAttempt(player.id)!;
  if (refreshed.status === "completed") return { state: "complete" };

  const existing = activeExposure(refreshed.id);
  if (existing) {
    // Idempotent: a duplicate Ready click (double-tap, retry) returns the
    // question already in flight rather than creating a second exposure.
    const question = questionById(existing.question_id);
    return {
      state: "question",
      position: question.position,
      category: question.category,
      prompt: question.prompt,
      nonce: existing.nonce,
      deadlineAt: existing.deadline_at,
      draft: existing.draft_text,
    };
  }

  const position = finalizedCount(refreshed.id) + 1;
  if (position > 50) return { state: "complete" };

  const question = questionByPosition(position);
  const served = Date.now();
  const deadlineAt = new Date(served + config.questionDurationMs).toISOString();
  const nonce = randomToken(18);
  db.prepare("INSERT INTO exposures (attempt_id, question_id, nonce, served_at, deadline_at) VALUES (?, ?, ?, ?, ?)").run(
    refreshed.id,
    question.id,
    nonce,
    new Date(served).toISOString(),
    deadlineAt,
  );
  logEvent(refreshed.id, "question_served", { position });

  return { state: "question", position, category: question.category, prompt: question.prompt, nonce, deadlineAt, draft: "" };
}

/** Marks any exposure abandoned since the last check as finalized, across all in-progress attempts. Safe to run on an interval. */
export function finalizeStaleSessions(): number {
  const stale = db
    .prepare(
      `SELECT e.id, e.attempt_id, e.nonce, e.draft_text, e.deadline_at
       FROM exposures e JOIN attempts a ON a.id = e.attempt_id
       WHERE e.submitted_at IS NULL AND a.status = 'in_progress'`,
    )
    .all() as Array<{ id: number; attempt_id: number; nonce: string; draft_text: string; deadline_at: string }>;
  let finalized = 0;
  for (const row of stale) {
    if (Date.now() > Date.parse(row.deadline_at) + config.submitGraceMs) {
      const exposure = db.prepare("SELECT * FROM exposures WHERE id = ?").get(row.id) as unknown as Exposure;
      finalize(exposure, "timeout", exposure.draft_text);
      finalized++;
    }
  }
  return finalized;
}
