import type { Request, Response, Router as RouterType } from "express";
import { Router } from "express";
import { config } from "./config.ts";
import { db, logEvent, nowIso } from "./db.ts";
import { decryptInvitationToken, encryptInvitationToken, sha256, randomToken } from "./crypto.ts";
import { normalize, applyReviewRuling } from "./grading.ts";
import { relayConfigured, remainingEmailQuota, sendInvitationEmail } from "./mail.ts";
import { checkAdminPassword, isAdmin, requireAdmin, setAdminSession } from "./auth.ts";
import { adminLoginPage, adminPage, page } from "./views.ts";
import { finalizeStaleSessions } from "./quiz.ts";

export interface ResultRow {
  id: number;
  email: string;
  display_name: string;
  is_test: number;
  status: string | null;
  score: number;
  correct_time_ms: number;
  token_ciphertext: string | null;
  invite_sent_at: string | null;
  invite_last_error: string | null;
  invite_send_attempts: number;
}

export function results(): ResultRow[] {
  return db
    .prepare(
      `SELECT p.id, p.email, p.display_name, p.is_test, p.token_ciphertext, p.invite_sent_at, p.invite_last_error, p.invite_send_attempts, a.status,
        COALESCE(SUM(CASE WHEN q.included_in_score = 1 AND e.verdict = 'correct' THEN 1 ELSE 0 END), 0) AS score,
        COALESCE(SUM(CASE WHEN q.included_in_score = 1 AND e.verdict = 'correct' THEN e.elapsed_ms ELSE 0 END), 0) AS correct_time_ms
       FROM players p
       LEFT JOIN attempts a ON a.player_id = p.id AND a.status IN ('in_progress', 'completed')
       LEFT JOIN exposures e ON e.attempt_id = a.id
       LEFT JOIN questions q ON q.id = e.question_id
       GROUP BY p.id, a.id
       ORDER BY score DESC, correct_time_ms ASC, p.email ASC`,
    )
    .all() as unknown as ResultRow[];
}

export interface UnresolvedRow {
  question_id: number;
  position: number;
  normalized_answer: string;
  n: number;
}

export interface AdminQuestionRow {
  id: number;
  position: number;
  category: string;
  prompt: string;
  canonical_answer: string;
  aliases_json: string;
}

export function adminQuestions(): AdminQuestionRow[] {
  return db.prepare("SELECT id, position, category, prompt, canonical_answer, aliases_json FROM questions ORDER BY position").all() as unknown as AdminQuestionRow[];
}

function questionBankLocked(): boolean {
  return Number((db.prepare("SELECT COUNT(*) AS n FROM attempts").get() as { n: number }).n) > 0;
}

export function unresolvedAnswers(): UnresolvedRow[] {
  return db
    .prepare(
      `SELECT q.id AS question_id, q.position, e.normalized_answer, COUNT(*) AS n
       FROM exposures e JOIN questions q ON q.id = e.question_id
       WHERE e.verdict = 'unresolved'
       GROUP BY q.id, q.position, e.normalized_answer
       ORDER BY q.position, n DESC`,
    )
    .all() as unknown as UnresolvedRow[];
}

export function questionCountRow(): number {
  return Number((db.prepare("SELECT COUNT(*) AS n FROM questions").get() as { n: number }).n);
}

function csvField(value: unknown): string {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export const adminRouter: RouterType = Router();
const loginAttempts = new Map<string, { count: number; resetsAt: number }>();

function loginRateLimited(ip: string): boolean {
  const now = Date.now();
  const existing = loginAttempts.get(ip);
  if (!existing || existing.resetsAt <= now) {
    loginAttempts.set(ip, { count: 1, resetsAt: now + 15 * 60_000 });
    return false;
  }
  existing.count++;
  return existing.count > 10;
}

adminRouter.get("/admin", (req: Request, res: Response) => {
  if (!isAdmin(req)) {
    res.send(adminLoginPage(false));
    return;
  }
  // Finalize anything that timed out while the player never came back to
  // check their own state -- otherwise an abandoned attempt could sit
  // forever as "in_progress" with an unscored question, invisible to the
  // admin, until that specific player happens to poll again.
  finalizeStaleSessions();
  res.send(adminPage({ questionCount: questionCountRow(), closesAt: config.closesAt, results: results(), unresolved: unresolvedAnswers(), questions: adminQuestions(), questionsLocked: questionBankLocked(), emailRelayConfigured: relayConfigured() }));
});

adminRouter.post("/admin/login", (req: Request, res: Response) => {
  if (loginRateLimited(req.ip || req.socket.remoteAddress || "unknown")) {
    res.status(429).send(page("Too many attempts", `<main class="card"><h1>Try again later</h1><p>Too many administrator sign-in attempts came from this address.</p></main>`));
    return;
  }
  if (!checkAdminPassword(String(req.body.password ?? ""))) {
    res.status(403).send(adminLoginPage(true));
    return;
  }
  loginAttempts.delete(req.ip || req.socket.remoteAddress || "unknown");
  setAdminSession(res);
  res.redirect("/admin");
});

adminRouter.post("/admin/players", requireAdmin, (req: Request, res: Response) => {
  const lines = String(req.body.players ?? "")
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
  const insert = db.prepare(
    "INSERT OR IGNORE INTO players (email, display_name, token_hash, token_ciphertext, is_test, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const links: string[] = [];
  const skipped: string[] = [];
  for (const line of lines) {
    const [emailRaw, name = "", test = ""] = line.split(",").map((x) => x.trim());
    const email = (emailRaw ?? "").toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      skipped.push(line);
      continue;
    }
    const token = randomToken();
    const result = insert.run(email, name, sha256(token), encryptInvitationToken(token), /^(1|yes|true|test)$/i.test(test) ? 1 : 0, nowIso());
    if (result.changes) {
      links.push(`${email},${name},${config.appOrigin}/invite/${token}`);
    } else {
      skipped.push(`${email} (already invited)`);
    }
  }
  logEvent(null, "players_imported", { added: links.length, skipped: skipped.length });
  res.send(
    page(
      "Invitation links",
      `<main class="card wide"><h1>New invitation links</h1>
       <p>Save these now. Tokens are hashed for sign-in and stored encrypted for controlled resend; rotating a link invalidates the old one.</p>
       <textarea rows="18" readonly>${escapeHtml(links.join("\n"))}</textarea>
       ${skipped.length ? `<p class="muted">Skipped ${skipped.length}: ${escapeHtml(skipped.join("; "))}</p>` : ""}
       <p><a href="/admin">Return to admin</a></p></main>`,
    ),
  );
});

adminRouter.post("/admin/player/:id/rotate-invitation", requireAdmin, (req: Request, res: Response) => {
  const playerId = Number(req.params.id);
  const player = db.prepare("SELECT id, email, display_name FROM players WHERE id = ?").get(playerId) as { id: number; email: string; display_name: string } | undefined;
  if (!player) {
    res.status(404).send(page("Player not found", `<main class="card"><h1>Player not found</h1><a href="/admin">Return to admin</a></main>`));
    return;
  }
  const token = randomToken();
  db.prepare("UPDATE players SET token_hash = ?, token_ciphertext = ?, invite_sent_at = NULL, invite_last_error = NULL, invite_send_attempts = 0 WHERE id = ?").run(
    sha256(token), encryptInvitationToken(token), playerId,
  );
  logEvent(null, "invitation_rotated", { playerId });
  const link = `${config.appOrigin}/invite/${token}`;
  res.send(page("Invitation rotated", `<main class="card wide"><h1>New invitation link</h1><p>The old link for ${escapeHtml(player.email)} is now invalid. Save or send this replacement:</p><textarea rows="4" readonly>${escapeHtml(link)}</textarea><p><a href="/admin">Return to admin</a></p></main>`));
});

adminRouter.post("/admin/invitations/quota", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const remaining = await remainingEmailQuota();
    res.send(page("Workspace quota", `<main class="card"><h1>${remaining} email recipient${remaining === 1 ? "" : "s"} remaining</h1><p>This is the Apps Script account's current daily email-service quota.</p><a href="/admin#invitations">Return to invitations</a></main>`));
  } catch (error) {
    res.status(502).send(page("Quota unavailable", `<main class="card"><h1>Could not read Workspace quota</h1><p>${escapeHtml(error instanceof Error ? error.message : "Unknown relay error")}</p><a href="/admin#invitations">Return to invitations</a></main>`));
  }
});

adminRouter.post("/admin/invitations/test", requireAdmin, async (req: Request, res: Response) => {
  const to = String(req.body.email ?? "").trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(to)) {
    res.status(400).send(page("Invalid email", `<main class="card"><h1>Enter a valid test address</h1><a href="/admin#invitations">Return to invitations</a></main>`));
    return;
  }
  const player = db.prepare("SELECT id, display_name, token_ciphertext FROM players WHERE is_test = 1 AND token_ciphertext IS NOT NULL ORDER BY id LIMIT 1").get() as { id: number; display_name: string; token_ciphertext: string } | undefined;
  if (!player) {
    res.status(409).send(page("No test player", `<main class="card"><h1>No recoverable test invitation exists</h1><p>Import or rotate a test player's invitation first.</p><a href="/admin#invitations">Return to invitations</a></main>`));
    return;
  }
  const link = `${config.appOrigin}/invite/${decryptInvitationToken(player.token_ciphertext)}`;
  const result = await sendInvitationEmail(to, player.display_name || "Test Player", link, true);
  logEvent(null, "invitation_test_email", { playerId: player.id, ok: result.ok, quotaExhausted: result.quotaExhausted });
  res.status(result.ok ? 200 : 502).send(page("Test invitation", `<main class="card"><h1>${result.ok ? "Test invitation sent" : "Test invitation failed"}</h1><p>${result.ok ? `Sent to ${escapeHtml(to)}.${result.remaining === null ? "" : ` Relay quota remaining: ${result.remaining}.`}` : escapeHtml(result.error)}</p><a href="/admin#invitations">Return to invitations</a></main>`));
});

adminRouter.post("/admin/invitations/send-batch", requireAdmin, async (_req: Request, res: Response) => {
  const candidates = db.prepare(`SELECT id, email, display_name, token_ciphertext FROM players
    WHERE is_test = 0 AND invite_sent_at IS NULL AND token_ciphertext IS NOT NULL ORDER BY id LIMIT 5`).all() as unknown as Array<{ id: number; email: string; display_name: string; token_ciphertext: string }>;
  if (!candidates.length) {
    res.send(page("Invitations complete", `<main class="card"><h1>No unsent recoverable invitations</h1><p>Everyone eligible is sent, or their link must first be rotated.</p><a href="/admin#invitations">Return to invitations</a></main>`));
    return;
  }
  let quota: number;
  try {
    quota = await remainingEmailQuota();
  } catch (error) {
    res.status(502).send(page("Send paused", `<main class="card"><h1>Invitation send paused</h1><p>The quota preflight failed, so no messages were attempted: ${escapeHtml(error instanceof Error ? error.message : "Unknown relay error")}</p><a href="/admin#invitations">Return to invitations</a></main>`));
    return;
  }
  if (quota < 1) {
    res.status(429).send(page("Quota exhausted", `<main class="card"><h1>Invitation send paused</h1><p>The Workspace relay reports zero remaining recipients today. No invitation was advanced or sent through a fallback.</p><a href="/admin#invitations">Return to invitations</a></main>`));
    return;
  }
  let sent = 0;
  let failure = "";
  for (const player of candidates.slice(0, Math.min(candidates.length, quota))) {
    db.prepare("UPDATE players SET invite_send_attempts = invite_send_attempts + 1 WHERE id = ?").run(player.id);
    let link: string;
    try {
      link = `${config.appOrigin}/invite/${decryptInvitationToken(player.token_ciphertext)}`;
    } catch (error) {
      failure = error instanceof Error ? error.message : "Invitation token could not be decrypted.";
      db.prepare("UPDATE players SET invite_last_error = ? WHERE id = ?").run(failure, player.id);
      break;
    }
    const result = await sendInvitationEmail(player.email, player.display_name, link);
    if (!result.ok) {
      failure = result.error;
      db.prepare("UPDATE players SET invite_last_error = ? WHERE id = ?").run(failure, player.id);
      logEvent(null, "invitation_email_failed", { playerId: player.id, quotaExhausted: result.quotaExhausted });
      break;
    }
    db.prepare("UPDATE players SET invite_sent_at = ?, invite_last_error = NULL WHERE id = ?").run(nowIso(), player.id);
    logEvent(null, "invitation_email_sent", { playerId: player.id });
    sent++;
  }
  const remaining = Number((db.prepare("SELECT COUNT(*) AS n FROM players WHERE is_test = 0 AND invite_sent_at IS NULL AND token_ciphertext IS NOT NULL").get() as { n: number }).n);
  res.status(failure ? 502 : 200).send(page("Invitation batch", `<main class="card"><h1>${failure ? "Send paused" : `Sent ${sent} invitation${sent === 1 ? "" : "s"}`}</h1><p>${failure ? `Stopped safely after ${sent} successful message${sent === 1 ? "" : "s"}: ${escapeHtml(failure)}` : `${remaining} recoverable invitation${remaining === 1 ? " remains" : "s remain"}.`}</p><p>No failed message was marked sent and no fallback mailer was used.</p><a href="/admin#invitations">Return to invitations</a></main>`));
});

adminRouter.post("/admin/questions", requireAdmin, (req: Request, res: Response) => {
  if (questionBankLocked()) {
    res
      .status(409)
      .send(page("Import blocked", `<main class="card"><h1>Question import blocked</h1><p>An attempt already exists, so the active question bank is frozen. This is deliberate: changing questions mid-event would invalidate already-answered questions.</p><a href="/admin">Return</a></main>`));
    return;
  }

  let parsed: Array<{ position: number; category?: string; prompt: string; answer: string; aliases?: string[] }>;
  try {
    parsed = JSON.parse(String(req.body.questions ?? "[]"));
  } catch {
    res.status(400).send(page("Invalid questions", `<main class="card"><h1>Import rejected</h1><p>That was not valid JSON.</p><a href="/admin">Return</a></main>`));
    return;
  }

  const positions = new Set(parsed.map((q) => q.position));
  const valid =
    parsed.length === 50 &&
    positions.size === 50 &&
    parsed.every((q) => q.position >= 1 && q.position <= 50 && q.prompt?.trim() && q.answer?.trim());
  if (!valid) {
    res
      .status(400)
      .send(page("Invalid questions", `<main class="card"><h1>Import rejected</h1><p>Provide exactly 50 unique positions from 1 through 50, each with a non-blank prompt and answer.</p><a href="/admin">Return</a></main>`));
    return;
  }

  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM questions");
    const insert = db.prepare("INSERT INTO questions (position, category, prompt, canonical_answer, aliases_json) VALUES (?, ?, ?, ?, ?)");
    for (const q of [...parsed].sort((a, b) => a.position - b.position)) {
      insert.run(q.position, q.category?.trim() || "Pop Culture", q.prompt.trim(), q.answer.trim(), JSON.stringify(q.aliases ?? []));
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  logEvent(null, "questions_imported", { count: parsed.length });
  res.redirect("/admin");
});

adminRouter.post("/admin/question/:id", requireAdmin, (req: Request, res: Response) => {
  if (questionBankLocked()) {
    res.status(409).send(page("Edit blocked", `<main class="card"><h1>Question edit blocked</h1><p>An attempt already exists, so the active question bank is frozen.</p><a href="/admin#questions">Return to questions</a></main>`));
    return;
  }
  const id = Number(req.params.id);
  const category = String(req.body.category ?? "").trim();
  const prompt = String(req.body.prompt ?? "").trim();
  const answer = String(req.body.answer ?? "").trim();
  const aliases = String(req.body.aliases ?? "").split(/\r?\n|,/).map((alias) => alias.trim()).filter(Boolean);
  if (!Number.isInteger(id) || !category || !prompt || !answer) {
    res.status(400).send(page("Invalid question", `<main class="card"><h1>Question not saved</h1><p>Category, question, and answer are required.</p><a href="/admin#questions">Return to questions</a></main>`));
    return;
  }
  const result = db.prepare("UPDATE questions SET category = ?, prompt = ?, canonical_answer = ?, aliases_json = ? WHERE id = ?").run(category, prompt, answer, JSON.stringify(aliases), id);
  if (!result.changes) {
    res.status(404).send(page("Question not found", `<main class="card"><h1>Question not found</h1><a href="/admin#questions">Return to questions</a></main>`));
    return;
  }
  logEvent(null, "question_edited", { questionId: id });
  res.redirect(`/admin#question-${id}`);
});

adminRouter.post("/admin/review", requireAdmin, (req: Request, res: Response) => {
  const questionId = Number(req.body.questionId);
  const answer = String(req.body.answer ?? "");
  const verdict = req.body.verdict === "correct" ? "correct" : "incorrect";
  const note = String(req.body.note ?? "").slice(0, 500);
  applyReviewRuling(questionId, normalize(answer), verdict, note);
  logEvent(null, "answer_reviewed", { questionId, answer, verdict });
  res.redirect("/admin#review");
});

adminRouter.post("/admin/restart", requireAdmin, (req: Request, res: Response) => {
  const playerId = Number(req.body.playerId);
  const reason = String(req.body.reason ?? "Technical failure").slice(0, 500);
  db.prepare(
    "UPDATE attempts SET status = 'superseded', superseded_at = ?, restart_reason = ? WHERE player_id = ? AND status IN ('in_progress', 'completed')",
  ).run(nowIso(), reason, playerId);
  logEvent(null, "restart_granted", { playerId, reason });
  res.redirect("/admin");
});

adminRouter.get("/admin/results.csv", requireAdmin, (_req: Request, res: Response) => {
  finalizeStaleSessions();
  const rows = results().filter((row) => !row.is_test);
  const body =
    "rank,email,name,score,correct_time_ms,status\n" +
    rows.map((r, i) => `${i + 1},${csvField(r.email)},${csvField(r.display_name)},${r.score},${r.correct_time_ms},${r.status ?? "not_started"}`).join("\n");
  res.type("text/csv").attachment("pop-culture-bee-results.csv").send(body);
});

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
