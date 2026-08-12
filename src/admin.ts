import type { Request, Response, Router as RouterType } from "express";
import { Router } from "express";
import { config } from "./config.ts";
import { db, getAppSetting, logEvent, nowIso, setAppSetting } from "./db.ts";
import { decryptInvitationToken, encryptInvitationToken, sha256, randomToken } from "./crypto.ts";
import { normalize, applyReviewRuling } from "./grading.ts";
import { relayConfigured, remainingEmailQuota, sendInvitationEmail, sendReminderEmail } from "./mail.ts";
import { checkAdminPassword, isAdmin, requireAdmin, setAdminPassword, setAdminSession } from "./auth.ts";
import { adminLoginPage, adminPage, page, playerAnswersPage, questionPreviewPage, type AdminSection } from "./views.ts";
import { finalizeStaleSessions } from "./quiz.ts";
import { parseQuestionImport, questionsToCsv, visiblePromptText, type ImportedQuestion } from "./question-import.ts";
import { parsePlayerImport, playersToCsv } from "./player-import.ts";
import { getIntroCopy, setIntroCopy, type IntroCopy } from "./intro-copy.ts";
import { getInvitationTemplate, setInvitationTemplate } from "./invitation-template.ts";
import { getCompletionNotificationSettings, setCompletionNotificationSettings } from "./completion-notification.ts";
import { getReminderTemplate, setReminderTemplate } from "./reminder-template.ts";
import { activateGame, centralLocalToIso, createGame, games, selectGame, selectedGame } from "./games.ts";

export interface ResultRow {
  id: number;
  game_id: number;
  email: string;
  display_name: string;
  is_test: number;
  status: string | null;
  score: number;
  answer_time_ms: number;
  token_ciphertext: string | null;
  invite_sent_at: string | null;
  invite_last_error: string | null;
  invite_send_attempts: number;
  completion_notification_started_at: string | null;
  completion_notified_at: string | null;
  completion_notification_error: string | null;
}

export interface PlayerAnswerAttempt {
  id: number;
  generation: number;
  status: string;
  started_at: string;
  completed_at: string | null;
  restart_reason: string | null;
}

export interface PlayerAnswerRow {
  attempt_id: number;
  position: number;
  category: string;
  prompt: string;
  canonical_answer: string;
  aliases_json: string;
  included_in_score: number;
  submitted_text: string | null;
  submitted_at: string | null;
  verdict: string | null;
  elapsed_ms: number | null;
  finalized_reason: string | null;
}

export function playerAnswerHistory(playerId: number): { player: { id: number; email: string; display_name: string; is_test: number }; attempts: PlayerAnswerAttempt[]; answers: PlayerAnswerRow[] } | null {
  const player = db.prepare("SELECT id, email, display_name, is_test FROM players WHERE id = ? AND game_id = ?").get(playerId, selectedGame().id) as { id: number; email: string; display_name: string; is_test: number } | undefined;
  if (!player) return null;
  const attempts = db.prepare("SELECT id, generation, status, started_at, completed_at, restart_reason FROM attempts WHERE player_id = ? ORDER BY generation DESC").all(playerId) as unknown as PlayerAnswerAttempt[];
  const answers = db.prepare(`SELECT e.attempt_id, q.position, q.category, q.prompt, q.canonical_answer, q.aliases_json, q.included_in_score,
    e.submitted_text, e.submitted_at, e.verdict, e.elapsed_ms, e.finalized_reason
    FROM attempts a JOIN exposures e ON e.attempt_id = a.id JOIN questions q ON q.id = e.question_id
    WHERE a.player_id = ? ORDER BY a.generation DESC, q.position`).all(playerId) as unknown as PlayerAnswerRow[];
  return { player, attempts, answers };
}

export function results(): ResultRow[] {
  return db
    .prepare(
      `SELECT p.id, p.game_id, p.email, p.display_name, p.is_test, p.token_ciphertext, p.invite_sent_at, p.invite_last_error, p.invite_send_attempts, a.status,
        a.completion_notification_started_at, a.completion_notified_at, a.completion_notification_error,
        COALESCE(SUM(CASE WHEN q.included_in_score = 1 AND e.verdict = 'correct' THEN 1 ELSE 0 END), 0) AS score,
        COALESCE(SUM(CASE WHEN q.included_in_score = 1 AND e.submitted_at IS NOT NULL THEN e.elapsed_ms ELSE 0 END), 0) AS answer_time_ms
       FROM players p
       LEFT JOIN attempts a ON a.player_id = p.id AND a.status IN ('in_progress', 'completed')
       LEFT JOIN exposures e ON e.attempt_id = a.id
       LEFT JOIN questions q ON q.id = e.question_id
       WHERE p.game_id = ?
       GROUP BY p.id, a.id
       ORDER BY score DESC, answer_time_ms ASC, p.email ASC`,
    )
    .all(selectedGame().id) as unknown as ResultRow[];
}

/** One distinct submitted answer to one question, with everyone who gave it. */
export interface GradingVariant {
  question_id: number;
  normalized_answer: string;
  sample_text: string | null;
  players: number;
  real_players: number;
  test_players: number;
  verdict: "correct" | "incorrect" | "unresolved" | "mixed";
  ruling: "correct" | "incorrect" | null;
  note: string | null;
  who: string;
}

export interface GradingQuestion {
  question_id: number;
  position: number;
  category: string;
  canonical_answer: string;
  accepted: string[];
  answer_is_person: number;
  answered: number;
  correct: number;
  unresolved: number;
  variants: GradingVariant[];
}

/**
 * Every distinct answer given to every question, grouped by question and then
 * by normalized answer, with its current verdict and whether a human ruled on
 * it. Modelled on the CASS host Grading panel.
 *
 * Deliberately not filtered to unresolved answers: the review queue used to
 * show only those, which meant an answer the grader accepted on its own was
 * invisible to the reviewer. A wrong auto-`correct` is exactly as costly as an
 * unreviewed near-miss, and only shows up here.
 */
export function gradingReview(): GradingQuestion[] {
  const questions = db
    .prepare(
      `SELECT q.id AS question_id, q.position, q.category, q.canonical_answer, q.aliases_json, q.answer_is_person,
        COUNT(e.id) AS answered,
        COALESCE(SUM(CASE WHEN e.verdict = 'correct' THEN 1 ELSE 0 END), 0) AS correct,
        COALESCE(SUM(CASE WHEN e.verdict = 'unresolved' THEN 1 ELSE 0 END), 0) AS unresolved
       FROM questions q
       LEFT JOIN exposures e ON e.question_id = q.id AND e.submitted_at IS NOT NULL
       WHERE q.game_id = ?
       GROUP BY q.id ORDER BY q.position`,
    )
    .all(selectedGame().id) as unknown as Array<Omit<GradingQuestion, "accepted" | "variants"> & { aliases_json: string }>;

  const variants = db
    .prepare(
      `SELECT e.question_id, e.normalized_answer,
        MIN(e.submitted_text) AS sample_text,
        COUNT(*) AS players,
        COALESCE(SUM(CASE WHEN p.is_test = 0 THEN 1 ELSE 0 END), 0) AS real_players,
        COALESCE(SUM(CASE WHEN p.is_test = 1 THEN 1 ELSE 0 END), 0) AS test_players,
        MIN(e.verdict) AS min_verdict, MAX(e.verdict) AS max_verdict,
        r.verdict AS ruling, r.note AS note,
        GROUP_CONCAT(COALESCE(NULLIF(p.display_name, ''), p.email), ', ') AS who
       FROM exposures e
       JOIN attempts a ON a.id = e.attempt_id
       JOIN players p ON p.id = a.player_id
       JOIN questions q ON q.id = e.question_id
       LEFT JOIN grading_rules r ON r.question_id = e.question_id AND r.normalized_answer = e.normalized_answer
       WHERE e.submitted_at IS NOT NULL AND q.game_id = ?
       GROUP BY e.question_id, e.normalized_answer
       ORDER BY players DESC, e.normalized_answer`,
    )
    .all(selectedGame().id) as unknown as Array<Omit<GradingVariant, "verdict"> & { min_verdict: string | null; max_verdict: string | null }>;

  const byQuestion = new Map<number, GradingVariant[]>();
  for (const row of variants) {
    const { min_verdict, max_verdict, ...rest } = row;
    // A single normalized answer can in principle hold two verdicts if the
    // question's aliases changed between two players submitting it. Surface
    // that rather than picking one silently; one ruling resolves it.
    const verdict = (min_verdict !== max_verdict ? "mixed" : (min_verdict ?? "unresolved")) as GradingVariant["verdict"];
    const list = byQuestion.get(row.question_id) ?? [];
    list.push({ ...rest, verdict });
    byQuestion.set(row.question_id, list);
  }

  return questions.map(({ aliases_json, ...question }) => ({
    ...question,
    accepted: [question.canonical_answer, ...(JSON.parse(aliases_json) as string[])],
    variants: byQuestion.get(question.question_id) ?? [],
  }));
}

export interface AdminQuestionRow {
  id: number;
  position: number;
  category: string;
  prompt: string;
  highlighted_text: string;
  canonical_answer: string;
  aliases_json: string;
  answer_is_person: number;
}

export interface InvitationStats {
  realPlayers: number;
  sent: number;
  ready: number;
  needsAttention: number;
}

export interface ReminderStats {
  eligible: number;
  sent: number;
  needsAttention: number;
}

export interface ReminderCandidate {
  id: number;
  email: string;
  display_name: string;
  token_ciphertext: string;
}

export function reminderCandidates(): ReminderCandidate[] {
  return db.prepare(`SELECT p.id, p.email, p.display_name, p.token_ciphertext FROM players p
    WHERE p.is_test = 0 AND p.is_public = 0 AND p.game_id = ?
      AND p.invite_sent_at IS NOT NULL
      AND p.token_ciphertext IS NOT NULL
      AND p.reminder_sent_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM attempts a WHERE a.player_id = p.id AND a.status = 'completed')
    ORDER BY p.id`).all(selectedGame().id) as unknown as ReminderCandidate[];
}

export function reminderStats(): ReminderStats {
  const eligible = reminderCandidates().length;
  const row = db.prepare(`SELECT
    SUM(CASE WHEN reminder_sent_at IS NOT NULL THEN 1 ELSE 0 END) AS sent,
    SUM(CASE WHEN reminder_last_error IS NOT NULL THEN 1 ELSE 0 END) AS needs_attention
    FROM players WHERE is_test = 0 AND is_public = 0 AND game_id = ?`).get(selectedGame().id) as { sent: number | null; needs_attention: number | null };
  return { eligible, sent: row.sent ?? 0, needsAttention: row.needs_attention ?? 0 };
}

export function invitationStats(): InvitationStats {
  const row = db.prepare(`SELECT
    COUNT(*) AS real_players,
    SUM(CASE WHEN invite_sent_at IS NOT NULL THEN 1 ELSE 0 END) AS sent,
    SUM(CASE WHEN invite_sent_at IS NULL AND token_ciphertext IS NOT NULL THEN 1 ELSE 0 END) AS ready,
    SUM(CASE WHEN invite_last_error IS NOT NULL OR token_ciphertext IS NULL THEN 1 ELSE 0 END) AS needs_attention
    FROM players WHERE is_test = 0 AND is_public = 0 AND game_id = ?`).get(selectedGame().id) as { real_players: number; sent: number | null; ready: number | null; needs_attention: number | null };
  return { realPlayers: row.real_players, sent: row.sent ?? 0, ready: row.ready ?? 0, needsAttention: row.needs_attention ?? 0 };
}

export function adminQuestions(): AdminQuestionRow[] {
  return db.prepare("SELECT id, position, category, prompt, highlighted_text, canonical_answer, aliases_json, answer_is_person FROM questions WHERE game_id = ? ORDER BY position").all(selectedGame().id) as unknown as AdminQuestionRow[];
}

function questionImportLocked(): boolean {
  return Number((db.prepare("SELECT COUNT(*) AS n FROM attempts a JOIN players p ON p.id = a.player_id WHERE p.game_id = ?").get(selectedGame().id) as { n: number }).n) > 0;
}

export function questionEditingLocked(): boolean {
  return Number((db.prepare("SELECT COUNT(*) AS n FROM attempts a JOIN players p ON p.id = a.player_id WHERE p.is_test = 0 AND p.game_id = ?").get(selectedGame().id) as { n: number }).n) > 0;
}

export function questionTextEditingEnabled(): boolean {
  return getAppSetting("question_text_editing_enabled") === "1";
}

export function setQuestionTextEditingEnabled(enabled: boolean): void {
  setAppSetting("question_text_editing_enabled", enabled ? "1" : "0");
}

/**
 * Sets the person flag, deliberately *outside* the frozen-bank lock. The lock
 * protects question content -- prompt, answer, aliases -- because changing
 * those under a player who already answered would invalidate their answer.
 * This flag changes no content and no stored verdict; it only affects how the
 * next submission is auto-graded, which the Review Queue can already do
 * globally and retroactively at any point in the event.
 *
 * Existing answers are not regraded. A "Mansfield" already sitting in the
 * queue stays there until a reviewer rules on it.
 */
export function setQuestionAnswerIsPerson(questionId: number, answerIsPerson: boolean): boolean {
  if (!Number.isInteger(questionId)) return false;
  return (
    db.prepare("UPDATE questions SET answer_is_person = ? WHERE id = ? AND game_id = ?").run(answerIsPerson ? 1 : 0, questionId, selectedGame().id).changes > 0
  );
}

/** Count of distinct answers still awaiting a human decision, for the nav badge. */
export function unresolvedVariantCount(): number {
  return Number(
    (db
      .prepare(
        `SELECT COUNT(*) AS n FROM (SELECT 1 FROM exposures e JOIN questions q ON q.id = e.question_id
          WHERE e.verdict = 'unresolved' AND e.submitted_at IS NOT NULL AND q.game_id = ?
          GROUP BY e.question_id, e.normalized_answer)`,
      )
      .get(selectedGame().id) as { n: number }).n,
  );
}

export function questionCountRow(): number {
  return Number((db.prepare("SELECT COUNT(*) AS n FROM questions WHERE game_id = ?").get(selectedGame().id) as { n: number }).n);
}

export function testPlayerForRecipient(email: string): { id: number; email: string; display_name: string; token_ciphertext: string | null; attempt_status: string | null } | null {
  return (db.prepare(`SELECT p.id, p.email, p.display_name, p.token_ciphertext, a.status AS attempt_status
    FROM players p
    LEFT JOIN attempts a ON a.player_id = p.id AND a.status IN ('in_progress', 'completed')
    WHERE p.is_test = 1 AND p.game_id = ? AND lower(p.email) = lower(?)
    ORDER BY a.generation DESC LIMIT 1`).get(selectedGame().id, email) as { id: number; email: string; display_name: string; token_ciphertext: string | null; attempt_status: string | null } | undefined) ?? null;
}

function csvField(value: unknown): string {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export const adminRouter: RouterType = Router();
// The import success document is the response to POST /admin/players. A plain
// /admin/players#invitations link is therefore only a fragment change on that
// same document, so the browser never performs the GET that renders the admin
// screen. The harmless query forces a real navigation.
export const playerImportContinueUrl = "/admin/players?afterImport=1#invitations";
const loginAttempts = new Map<string, { count: number; resetsAt: number }>();

function loginRateLimited(ip: string): boolean {
  const now = Date.now();
  // Drop expired buckets so a long-running event cannot accumulate one entry
  // per address that ever attempted a sign-in.
  for (const [key, value] of loginAttempts) {
    if (value.resetsAt <= now) loginAttempts.delete(key);
  }
  const existing = loginAttempts.get(ip);
  if (!existing || existing.resetsAt <= now) {
    loginAttempts.set(ip, { count: 1, resetsAt: now + 15 * 60_000 });
    return false;
  }
  existing.count++;
  return existing.count > 10;
}

function renderAdmin(req: Request, res: Response, section: AdminSection): void {
  if (!isAdmin(req)) {
    res.send(adminLoginPage(false, `/admin/${section}`));
    return;
  }
  // Finalize anything that timed out while the player never came back to
  // check their own state -- otherwise an abandoned attempt could sit
  // forever as "in_progress" with an unscored question, invisible to the
  // admin, until that specific player happens to poll again.
  finalizeStaleSessions();
  const game = selectedGame();
  res.send(adminPage({ questionCount: questionCountRow(), closesAt: game.closes_at ? Date.parse(game.closes_at) : null, results: results(), grading: section === "review" ? gradingReview() : [], unresolvedCount: unresolvedVariantCount(), questions: adminQuestions(), questionsLocked: questionEditingLocked(), questionTextEditingEnabled: questionTextEditingEnabled(), emailRelayConfigured: relayConfigured(), invitationStats: invitationStats(), reminderStats: reminderStats(), introCopy: getIntroCopy(), invitationTemplate: getInvitationTemplate(), reminderTemplate: getReminderTemplate(), completionNotifications: getCompletionNotificationSettings(), games: games(), selectedGame: game }, section));
}

adminRouter.get("/admin", (req: Request, res: Response) => {
  if (!isAdmin(req)) return renderAdmin(req, res, "questions");
  res.redirect("/admin/questions");
});

for (const section of ["questions", "players", "progress", "review"] as const) {
  adminRouter.get(`/admin/${section}`, (req: Request, res: Response) => renderAdmin(req, res, section));
}

adminRouter.post("/admin/game/select", requireAdmin, (req: Request, res: Response) => {
  const id = Number(req.body.gameId);
  if (!Number.isInteger(id) || !selectGame(id)) return void res.status(404).send(page("Game not found", `<main class="card"><h1>Game not found</h1><a href="/admin/players">Return</a></main>`));
  res.redirect("/admin/players");
});

adminRouter.post("/admin/game/create", requireAdmin, (req: Request, res: Response) => {
  const name = String(req.body.name ?? "").trim();
  const local = String(req.body.closesAt ?? "").trim();
  const closesAt = centralLocalToIso(local);
  if (!name || name.length > 160 || !closesAt) return void res.status(400).send(page("Game not created", `<main class="card"><h1>Enter a valid game name and Central cutoff</h1><a href="/admin/players">Return</a></main>`));
  const game = createGame(name, closesAt);
  selectGame(game.id);
  logEvent(null, "game_created", { gameId: game.id, gameNumber: game.game_number });
  res.redirect("/admin/players");
});

adminRouter.post("/admin/game/activate", requireAdmin, (req: Request, res: Response) => {
  const id = Number(req.body.gameId);
  if (!Number.isInteger(id) || !activateGame(id)) return void res.status(404).send(page("Game not found", `<main class="card"><h1>Game not found</h1><a href="/admin/players">Return</a></main>`));
  logEvent(null, "game_activated", { gameId: id });
  res.redirect("/admin/players");
});

adminRouter.post("/admin/completion-notifications", requireAdmin, (req: Request, res: Response) => {
  const recipient = String(req.body.recipient ?? "").trim().toLowerCase();
  const enabled = req.body.enabled === "1";
  if (enabled && !/^\S+@\S+\.\S+$/.test(recipient)) {
    res.status(400).send(page("Notification settings not saved", `<main class="card"><h1>Enter a valid notification address</h1><a href="/admin/progress#completion-notifications">Return to settings</a></main>`));
    return;
  }
  setCompletionNotificationSettings({ enabled, recipient });
  logEvent(null, "completion_notification_settings_updated", { enabled });
  res.redirect("/admin/progress#completion-notifications");
});

adminRouter.post("/admin/login", (req: Request, res: Response) => {
  const requestedNext = String(req.body.next ?? "");
  const next = /^\/admin\/(questions|players|progress|review)(#[A-Za-z0-9_-]+)?$/.test(requestedNext)
    ? requestedNext
    : "/admin/questions";
  if (loginRateLimited(req.ip || req.socket.remoteAddress || "unknown")) {
    res.status(429).send(page("Too many attempts", `<main class="card"><h1>Try again later</h1><p>Too many administrator sign-in attempts came from this address.</p></main>`));
    return;
  }
  if (!checkAdminPassword(String(req.body.password ?? ""))) {
    res.status(403).send(adminLoginPage(true, next));
    return;
  }
  loginAttempts.delete(req.ip || req.socket.remoteAddress || "unknown");
  setAdminSession(res);
  res.redirect(next);
});

adminRouter.post("/admin/password", requireAdmin, (req: Request, res: Response) => {
  const currentPassword = String(req.body.currentPassword ?? "");
  const newPassword = String(req.body.newPassword ?? "");
  const confirmation = String(req.body.confirmPassword ?? "");
  if (!checkAdminPassword(currentPassword)) {
    res.status(403).send(page("Password not changed", `<main class="card"><h1>Current password was incorrect</h1><p>No change was made.</p><a href="/admin/players#security">Return to security</a></main>`));
    return;
  }
  if (!newPassword || newPassword.length > 256) {
    res.status(400).send(page("Password not changed", `<main class="card"><h1>Enter a new password</h1><p>The new administrator password cannot be blank or longer than 256 characters.</p><a href="/admin/players#security">Return to security</a></main>`));
    return;
  }
  if (newPassword !== confirmation) {
    res.status(400).send(page("Password not changed", `<main class="card"><h1>Passwords did not match</h1><p>No change was made.</p><a href="/admin/players#security">Return to security</a></main>`));
    return;
  }
  setAdminPassword(newPassword);
  logEvent(null, "admin_password_changed");
  res.send(page("Password changed", `<main class="card"><h1>Administrator password changed</h1><p>All existing administrator sessions have been invalidated. Sign in again with the new password.</p><a href="/admin">Return to sign in</a></main>`));
});

adminRouter.post("/admin/intro", requireAdmin, (req: Request, res: Response) => {
  const copy: IntroCopy = {
    eyebrow: String(req.body.eyebrow ?? "").trim(),
    title: String(req.body.title ?? "").trim(),
    instructions: String(req.body.instructions ?? "").trim(),
    warningHeading: getIntroCopy().warningHeading,
    warningBody: getIntroCopy().warningBody,
    advancement: String(req.body.advancement ?? "").trim(),
    buttonLabel: String(req.body.buttonLabel ?? "").trim(),
  };
  const values = Object.values(copy);
  if (values.some((value) => !value) || copy.eyebrow.length > 100 || copy.title.length > 160 || copy.instructions.length > 1000 || copy.warningHeading.length > 160 || copy.warningBody.length > 1500 || copy.advancement.length > 1500 || copy.buttonLabel.length > 100) {
    res.status(400).send(page("Intro not saved", `<main class="card"><h1>Player intro not saved</h1><p>Every field is required and must remain within its displayed character limit.</p><a href="/admin/players#player-intro">Return to Player intro</a></main>`));
    return;
  }
  setIntroCopy(copy);
  logEvent(null, "intro_copy_updated");
  res.redirect("/admin/players#player-intro");
});

adminRouter.post("/admin/invitation-template", requireAdmin, (req: Request, res: Response) => {
  const subject = String(req.body.subject ?? "").trim();
  const body = String(req.body.body ?? "").trim();
  if (!subject || subject.length > 200 || !body || body.length > 10_000 || !body.includes("{{link}}")) {
    res.status(400).send(page("Email template not saved", `<main class="card"><h1>Invitation email not saved</h1><p>Enter a subject and body within the displayed limits. The body must contain <code>{{link}}</code> so every player receives their personalized invitation.</p><a href="/admin/players#invitation-template">Return to invitation email</a></main>`));
    return;
  }
  setInvitationTemplate({ subject, body });
  logEvent(null, "invitation_email_template_updated");
  res.redirect("/admin/players#invitation-template");
});

adminRouter.post("/admin/reminder-template", requireAdmin, (req: Request, res: Response) => {
  const subject = String(req.body.subject ?? "").trim();
  const body = String(req.body.body ?? "").trim();
  if (!subject || subject.length > 200 || !body || body.length > 10_000 || !body.includes("{{link}}")) {
    res.status(400).send(page("Reminder template not saved", `<main class="card"><h1>Reminder email not saved</h1><p>Enter a subject and body within the displayed limits. The body must contain <code>{{link}}</code> so every player receives their personalized link.</p><a href="/admin/players#reminder-template">Return to reminder email</a></main>`));
    return;
  }
  setReminderTemplate({ subject, body });
  logEvent(null, "reminder_email_template_updated");
  res.redirect("/admin/players#reminder-template");
});

adminRouter.post("/admin/players", requireAdmin, (req: Request, res: Response) => {
  let players;
  try {
    players = parsePlayerImport(String(req.body.players ?? ""));
  } catch (error) {
    const message = error instanceof Error ? error.message : "The player data could not be read.";
    res.status(400).send(page("Invalid players", `<main class="card"><h1>Import rejected</h1><p>${escapeHtml(message)}</p><a href="/admin/players#players">Return to players</a></main>`));
    return;
  }
  const gameId = selectedGame().id;
  const insert = db.prepare(
    "INSERT OR IGNORE INTO players (game_id, email, display_name, token_hash, token_ciphertext, is_test, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const update = db.prepare("UPDATE players SET display_name = ?, is_test = ? WHERE game_id = ? AND email = ?");
  const links: string[] = [];
  const skipped: string[] = [];
  let updated = 0;
  const seen = new Set<string>();
  for (const player of players) {
    const { email, name, isTest } = player;
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      skipped.push(email || "blank email");
      continue;
    }
    if (seen.has(email)) {
      skipped.push(`${email} (duplicate row)`);
      continue;
    }
    seen.add(email);
    const token = randomToken();
    const result = insert.run(gameId, email, name, sha256(token), encryptInvitationToken(token), isTest ? 1 : 0, nowIso());
    if (result.changes) {
      links.push(`${email},${name},${config.appOrigin}/invite/${token}`);
    } else {
      update.run(name, isTest ? 1 : 0, gameId, email);
      updated++;
    }
  }
  logEvent(null, "players_imported", { added: links.length, updated, skipped: skipped.length });
  res.send(
    page(
      "Invitation links",
      `<main class="card wide"><h1>Player list imported</h1>
       <p><strong>${links.length} added</strong> &middot; <strong>${updated} updated</strong> &middot; <strong>${skipped.length} skipped</strong>. No email was sent.</p>
       ${links.length ? `<p>New personalized links are shown below. They also remain recoverable for controlled Workspace delivery.</p><textarea rows="12" readonly>${escapeHtml(links.join("\n"))}</textarea>` : ""}
       ${skipped.length ? `<p class="muted">Skipped ${skipped.length}: ${escapeHtml(skipped.join("; "))}</p>` : ""}
       <p><a href="${playerImportContinueUrl}">Continue to invitation setup</a></p></main>`,
    ),
  );
});

adminRouter.get("/admin/players.csv", requireAdmin, (_req: Request, res: Response) => {
  const players = db.prepare("SELECT email, display_name, is_test FROM players WHERE game_id = ? AND is_public = 0 ORDER BY email").all(selectedGame().id) as unknown as Array<{ email: string; display_name: string; is_test: number }>;
  res.type("text/csv");
  res.setHeader("Content-Disposition", 'attachment; filename="timed-quiz-players.csv"');
  res.send(playersToCsv(players.map((player) => ({ email: player.email, name: player.display_name, isTest: Boolean(player.is_test) }))));
});

adminRouter.post("/admin/player/:id/rotate-invitation", requireAdmin, (req: Request, res: Response) => {
  const playerId = Number(req.params.id);
  const player = db.prepare("SELECT id, email, display_name FROM players WHERE id = ? AND game_id = ?").get(playerId, selectedGame().id) as { id: number; email: string; display_name: string } | undefined;
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
    res.send(page("Workspace capacity", `<main class="card"><h1>${remaining} email recipient${remaining === 1 ? "" : "s"} available</h1><p>This is the capacity currently reported by the configured Workspace relay.</p><a href="/admin/players#invitations">Return to invitations</a></main>`));
  } catch (error) {
    res.status(502).send(page("Quota unavailable", `<main class="card"><h1>Could not read Workspace quota</h1><p>${escapeHtml(error instanceof Error ? error.message : "Unknown relay error")}</p><a href="/admin/players#invitations">Return to invitations</a></main>`));
  }
});

adminRouter.post("/admin/invitations/test", requireAdmin, async (req: Request, res: Response) => {
  if (!selectedGame().is_active) return void res.status(409).send(page("Game inactive", `<main class="card"><h1>Activate this game before sending invitations</h1><p>Email batches remain restricted to the active admin game.</p><a href="/admin/players#invitations">Return</a></main>`));
  const to = String(req.body.email ?? "").trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(to)) {
    res.status(400).send(page("Invalid email", `<main class="card"><h1>Enter a valid test address</h1><a href="/admin/players#invitations">Return to invitations</a></main>`));
    return;
  }
  const player = testPlayerForRecipient(to);
  if (!player) {
    res.status(409).send(page("No matching test player", `<main class="card"><h1>No matching test player</h1><p>Import ${escapeHtml(to)} as a test player first. Test sends never borrow another player's personalized link.</p><a href="/admin/players#players">Return to players</a></main>`));
    return;
  }
  if (!player.token_ciphertext) {
    res.status(409).send(page("Test link unavailable", `<main class="card"><h1>Rotate this test player's link</h1><p>${escapeHtml(to)} does not have a recoverable invitation link.</p><a href="/admin">Return to players</a></main>`));
    return;
  }
  if (player.attempt_status === "completed") {
    res.status(409).send(page("Test already completed", `<main class="card"><h1>This test player already completed the quiz</h1><p>Grant ${escapeHtml(to)} a restart in Progress and results before sending another test invitation.</p><a href="/admin">Return to players</a></main>`));
    return;
  }
  const link = `${config.appOrigin}/invite/${decryptInvitationToken(player.token_ciphertext)}`;
  const result = await sendInvitationEmail(to, player.display_name || "Test Player", link, true);
  logEvent(null, "invitation_test_email", { playerId: player.id, ok: result.ok, quotaExhausted: result.quotaExhausted });
  res.status(result.ok ? 200 : 502).send(page("Test invitation", `<main class="card"><h1>${result.ok ? "Test invitation sent" : "Test invitation failed"}</h1><p>${result.ok ? `Sent to ${escapeHtml(to)}.${result.remaining === null ? "" : ` Relay quota remaining: ${result.remaining}.`}` : escapeHtml(result.error)}</p><a href="/admin/players#invitations">Return to invitations</a></main>`));
});

adminRouter.post("/admin/invitations/send-batch", requireAdmin, async (_req: Request, res: Response) => {
  if (!selectedGame().is_active) return void res.status(409).send(page("Game inactive", `<main class="card"><h1>Activate this game before sending invitations</h1><p>Email batches remain restricted to the active admin game.</p><a href="/admin/players#invitations">Return</a></main>`));
  const gameId = selectedGame().id;
  const candidates = db.prepare(`SELECT id, email, display_name, token_ciphertext FROM players
    WHERE game_id = ? AND is_test = 0 AND is_public = 0 AND invite_sent_at IS NULL AND token_ciphertext IS NOT NULL ORDER BY id LIMIT 5`).all(gameId) as unknown as Array<{ id: number; email: string; display_name: string; token_ciphertext: string }>;
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
    res.status(429).send(page("Capacity exhausted", `<main class="card"><h1>Invitation send paused</h1><p>The Workspace relay reports zero available recipient capacity. No invitation was advanced or sent through a fallback.</p><a href="/admin#invitations">Return to invitations</a></main>`));
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
  const remaining = Number((db.prepare("SELECT COUNT(*) AS n FROM players WHERE game_id = ? AND is_test = 0 AND is_public = 0 AND invite_sent_at IS NULL AND token_ciphertext IS NOT NULL").get(gameId) as { n: number }).n);
  res.status(failure ? 502 : 200).send(page("Invitation batch", `<main class="card"><h1>${failure ? "Send paused" : `Sent ${sent} invitation${sent === 1 ? "" : "s"}`}</h1><p>${failure ? `Stopped safely after ${sent} successful message${sent === 1 ? "" : "s"}: ${escapeHtml(failure)}` : `${remaining} recoverable invitation${remaining === 1 ? " remains" : "s remain"}.`}</p><p>No failed message was marked sent and no fallback mailer was used.</p><a href="/admin#invitations">Return to invitations</a></main>`));
});

adminRouter.post("/admin/reminders/send", requireAdmin, async (_req: Request, res: Response) => {
  if (!selectedGame().is_active) return void res.status(409).send(page("Game inactive", `<main class="card"><h1>Reminders are available only for the active game</h1><a href="/admin/players#reminders">Return</a></main>`));
  const candidates = reminderCandidates();
  if (!candidates.length) {
    res.send(page("Reminders complete", `<main class="card"><h1>No players need a reminder</h1><p>Every invited real player has completed, has already received this reminder, or needs a recoverable invitation link.</p><a href="/admin/players#reminders">Return to reminders</a></main>`));
    return;
  }
  let quota: number;
  try {
    quota = await remainingEmailQuota();
  } catch (error) {
    res.status(502).send(page("Reminder send paused", `<main class="card"><h1>Reminder send paused</h1><p>The quota preflight failed, so no messages were attempted: ${escapeHtml(error instanceof Error ? error.message : "Unknown relay error")}</p><a href="/admin/players#reminders">Return to reminders</a></main>`));
    return;
  }
  if (quota < candidates.length) {
    res.status(429).send(page("Insufficient capacity", `<main class="card"><h1>Reminder send paused</h1><p>The relay reports capacity for ${quota} recipient${quota === 1 ? "" : "s"}, but ${candidates.length} players need reminders. No messages were attempted, so the group is not split unexpectedly.</p><a href="/admin/players#reminders">Return to reminders</a></main>`));
    return;
  }
  let sent = 0;
  let failure = "";
  for (const player of candidates) {
    db.prepare("UPDATE players SET reminder_send_attempts = reminder_send_attempts + 1 WHERE id = ?").run(player.id);
    let link: string;
    try {
      link = `${config.appOrigin}/invite/${decryptInvitationToken(player.token_ciphertext)}`;
    } catch (error) {
      failure = error instanceof Error ? error.message : "Invitation token could not be decrypted.";
      db.prepare("UPDATE players SET reminder_last_error = ? WHERE id = ?").run(failure, player.id);
      break;
    }
    const result = await sendReminderEmail(player.email, player.display_name, link);
    if (!result.ok) {
      failure = result.error;
      db.prepare("UPDATE players SET reminder_last_error = ? WHERE id = ?").run(failure, player.id);
      logEvent(null, "reminder_email_failed", { playerId: player.id, quotaExhausted: result.quotaExhausted });
      break;
    }
    db.prepare("UPDATE players SET reminder_sent_at = ?, reminder_last_error = NULL WHERE id = ?").run(nowIso(), player.id);
    logEvent(null, "reminder_email_sent", { playerId: player.id });
    sent++;
  }
  const remaining = reminderCandidates().length;
  res.status(failure ? 502 : 200).send(page("Reminder send", `<main class="card"><h1>${failure ? "Reminder send paused" : `Sent ${sent} reminder${sent === 1 ? "" : "s"}`}</h1><p>${failure ? `Stopped safely after ${sent} successful message${sent === 1 ? "" : "s"}: ${escapeHtml(failure)}` : "Every eligible player was sent a reminder with their personalized link."}</p><p>${remaining} eligible reminder${remaining === 1 ? " remains" : "s remain"}. No failed message was marked sent and no fallback mailer was used.</p><a href="/admin/players#reminders">Return to reminders</a></main>`));
});

adminRouter.post("/admin/questions", requireAdmin, (req: Request, res: Response) => {
  if (questionImportLocked()) {
    res
      .status(409)
      .send(page("Import blocked", `<main class="card"><h1>Question import blocked</h1><p>An attempt already exists, so the active question bank is frozen. This is deliberate: changing questions mid-event would invalidate already-answered questions.</p><a href="/admin">Return</a></main>`));
    return;
  }

  let parsed: ImportedQuestion[];
  try {
    parsed = parseQuestionImport(String(req.body.questions ?? ""));
  } catch (error) {
    const message = error instanceof Error ? error.message : "The question data could not be read.";
    res.status(400).send(page("Invalid questions", `<main class="card"><h1>Import rejected</h1><p>${escapeHtml(message)}</p><a href="/admin">Return</a></main>`));
    return;
  }

  const positions = new Set(parsed.map((q) => q.position));
  const valid =
    parsed.length === 50 &&
    positions.size === 50 &&
    parsed.every((q) => q.position >= 1 && q.position <= 50 && q.prompt?.trim() && q.answer?.trim() && (!q.highlightedText?.trim() || visiblePromptText(q.prompt).toLocaleLowerCase("en-US").includes(q.highlightedText.trim().toLocaleLowerCase("en-US"))));
  if (!valid) {
    res
      .status(400)
      .send(page("Invalid questions", `<main class="card"><h1>Import rejected</h1><p>Provide exactly 50 unique positions from 1 through 50, each with a non-blank question and answer. Any highlighted text must occur in that question.</p><a href="/admin">Return</a></main>`));
    return;
  }

  db.exec("BEGIN");
  try {
    const gameId = selectedGame().id;
    db.prepare("DELETE FROM questions WHERE game_id = ?").run(gameId);
    const insert = db.prepare("INSERT INTO questions (game_id, position, category, prompt, highlighted_text, canonical_answer, aliases_json, answer_is_person) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    for (const q of [...parsed].sort((a, b) => a.position - b.position)) {
      insert.run(gameId, q.position, q.category?.trim() || "Pop Culture", q.prompt.trim(), q.highlightedText?.trim() || "", q.answer.trim(), JSON.stringify(q.aliases ?? []), q.answerIsPerson ? 1 : 0);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  logEvent(null, "questions_imported", { count: parsed.length });
  res.redirect("/admin/questions");
});

adminRouter.get("/admin/questions.csv", requireAdmin, (_req: Request, res: Response) => {
  const questions = adminQuestions().map((q) => ({
    position: q.position,
    category: q.category,
    prompt: q.prompt,
    highlightedText: q.highlighted_text,
    answer: q.canonical_answer,
    aliases: JSON.parse(q.aliases_json) as string[],
    answerIsPerson: Boolean(q.answer_is_person),
  }));
  res.type("text/csv");
  res.setHeader("Content-Disposition", 'attachment; filename="timed-quiz-questions.csv"');
  res.send(questionsToCsv(questions));
});

adminRouter.get("/admin/preview/:position", requireAdmin, (req: Request, res: Response) => {
  const position = Number(req.params.position);
  const question = db.prepare("SELECT id, position, category, prompt, highlighted_text, canonical_answer, aliases_json, answer_is_person FROM questions WHERE game_id = ? AND position = ?").get(selectedGame().id, position) as unknown as AdminQuestionRow | undefined;
  if (!question) {
    res.status(404).send(page("Question not found", `<main class="card"><h1>Question not found</h1><a href="/admin/questions#questions">Return to questions</a></main>`));
    return;
  }
  res.send(questionPreviewPage(question, questionCountRow(), config.questionDurationMs / 1000));
});

adminRouter.post("/admin/question/:id", requireAdmin, (req: Request, res: Response) => {
  const locked = questionEditingLocked();
  if (locked && !questionTextEditingEnabled()) {
    res.status(409).send(page("Edit blocked", `<main class="card"><h1>Question edit blocked</h1><p>A real participant has started, so the active question bank is frozen. Test-player attempts alone do not trigger this lock.</p><a href="/admin/questions#questions">Return to questions</a></main>`));
    return;
  }
  const id = Number(req.params.id);
  const category = String(req.body.category ?? "").trim();
  const prompt = String(req.body.prompt ?? "").trim();
  if (!Number.isInteger(id) || !category || !prompt) {
    res.status(400).send(page("Invalid question", `<main class="card"><h1>Question not saved</h1><p>Category, question, and answer are required.</p><a href="/admin#questions">Return to questions</a></main>`));
    return;
  }
  if (locked) {
    const result = db.prepare("UPDATE questions SET category = ?, prompt = ? WHERE id = ? AND game_id = ?").run(category, prompt, id, selectedGame().id);
    if (!result.changes) {
      res.status(404).send(page("Question not found", `<main class="card"><h1>Question not found</h1><a href="/admin#questions">Return to questions</a></main>`));
      return;
    }
    logEvent(null, "question_text_edited", { questionId: id });
    res.redirect(`/admin/questions#question-${id}`);
    return;
  }
  const highlightedText = String(req.body.highlightedText ?? "").trim();
  const answer = String(req.body.answer ?? "").trim();
  const aliases = String(req.body.aliases ?? "").split(/\r?\n|,/).map((alias) => alias.trim()).filter(Boolean);
  if (!answer) {
    res.status(400).send(page("Invalid question", `<main class="card"><h1>Question not saved</h1><p>Category, question, and answer are required.</p><a href="/admin#questions">Return to questions</a></main>`));
    return;
  }
  if (highlightedText && !visiblePromptText(prompt).toLocaleLowerCase("en-US").includes(highlightedText.toLocaleLowerCase("en-US"))) {
    res.status(400).send(page("Invalid highlight", `<main class="card"><h1>Question not saved</h1><p>The highlighted text must appear exactly in the question (capitalization may differ).</p><a href="/admin#question-${id}">Return to question</a></main>`));
    return;
  }
  // answer_is_person is deliberately absent here: it has its own route that
  // survives the frozen-bank lock, and including it would silently clear the
  // flag every time somebody saved question content.
  const result = db.prepare("UPDATE questions SET category = ?, prompt = ?, highlighted_text = ?, canonical_answer = ?, aliases_json = ? WHERE id = ? AND game_id = ?").run(category, prompt, highlightedText, answer, JSON.stringify(aliases), id, selectedGame().id);
  if (!result.changes) {
    res.status(404).send(page("Question not found", `<main class="card"><h1>Question not found</h1><a href="/admin#questions">Return to questions</a></main>`));
    return;
  }
  logEvent(null, "question_edited", { questionId: id });
  res.redirect(`/admin/questions#question-${id}`);
});

adminRouter.post("/admin/question-text-editing", requireAdmin, (req: Request, res: Response) => {
  const enabled = req.body.enabled === "1";
  setQuestionTextEditingEnabled(enabled);
  logEvent(null, "question_text_editing_toggled", { enabled });
  res.redirect("/admin/questions#questions");
});

adminRouter.post("/admin/question/:id/grading", requireAdmin, (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const answerIsPerson = req.body.answerIsPerson === "1";
  if (!setQuestionAnswerIsPerson(id, answerIsPerson)) {
    res.status(404).send(page("Question not found", `<main class="card"><h1>Question not found</h1><a href="/admin/questions#questions">Return to questions</a></main>`));
    return;
  }
  logEvent(null, "question_grading_updated", { questionId: id, answerIsPerson });
  res.redirect(`/admin/questions#question-${id}`);
});

adminRouter.post("/admin/review", requireAdmin, (req: Request, res: Response) => {
  const questionId = Number(req.body.questionId);
  const answer = normalize(String(req.body.answer ?? ""));
  const verdict = req.body.verdict === "correct" ? "correct" : "incorrect";
  const note = String(req.body.note ?? "").slice(0, 500);
  const questionExists =
    Number.isInteger(questionId) && Boolean(db.prepare("SELECT 1 AS ok FROM questions WHERE id = ? AND game_id = ?").get(questionId, selectedGame().id));
  if (!questionExists || !answer) {
    res.status(400).send(page("Ruling not saved", `<main class="card"><h1>Ruling not saved</h1><p>A ruling needs an existing question and a non-blank submitted answer.</p><a href="/admin/review">Return to the review queue</a></main>`));
    return;
  }
  applyReviewRuling(questionId, answer, verdict, note);
  logEvent(null, "answer_reviewed", { questionId, answer, verdict });
  res.redirect("/admin/review");
});

adminRouter.post("/admin/restart", requireAdmin, (req: Request, res: Response) => {
  const playerId = Number(req.body.playerId);
  const reason = String(req.body.reason ?? "Technical failure").slice(0, 500);
  db.prepare(`UPDATE attempts SET status = 'superseded', superseded_at = ?, restart_reason = ?
    WHERE player_id = ? AND status IN ('in_progress', 'completed')
      AND EXISTS (SELECT 1 FROM players p WHERE p.id = attempts.player_id AND p.game_id = ?)`
  ).run(nowIso(), reason, playerId, selectedGame().id);
  logEvent(null, "restart_granted", { playerId, reason });
  res.redirect("/admin/progress");
});

adminRouter.get("/admin/player/:id/answers", requireAdmin, (req: Request, res: Response) => {
  finalizeStaleSessions();
  const history = playerAnswerHistory(Number(req.params.id));
  if (!history) {
    res.status(404).send(page("Player not found", `<main class="card"><h1>Player not found</h1><a href="/admin">Return to admin</a></main>`));
    return;
  }
  res.send(playerAnswersPage(history.player, history.attempts, history.answers));
});

adminRouter.get("/admin/results.csv", requireAdmin, (_req: Request, res: Response) => {
  finalizeStaleSessions();
  res.type("text/csv").attachment("pop-culture-bee-results.csv").send(resultsCsv(false));
});

adminRouter.get("/admin/test-results.csv", requireAdmin, (_req: Request, res: Response) => {
  finalizeStaleSessions();
  res.type("text/csv").attachment("pop-culture-bee-test-results.csv").send(resultsCsv(true));
});

export function resultsCsv(testAccounts: boolean): string {
  const rows = results().filter((row) => Boolean(row.is_test) === testAccounts);
  return "rank,email,name,score,answer_time_ms,status\n" +
    rows.map((r, i) => `${i + 1},${csvField(r.email)},${csvField(r.display_name)},${r.score},${r.answer_time_ms},${r.status ?? "not_started"}`).join("\n");
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
