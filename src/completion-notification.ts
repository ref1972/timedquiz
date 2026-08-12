import { config } from "./config.ts";
import { db, getAppSetting, logEvent, nowIso, setAppSetting } from "./db.ts";
import { relayConfigured, sendRelayEmail } from "./mail.ts";

export interface CompletionNotificationSettings {
  enabled: boolean;
  recipient: string;
}

export function getCompletionNotificationSettings(): CompletionNotificationSettings {
  return {
    enabled: getAppSetting("completion_notification_enabled") === "1",
    recipient: getAppSetting("completion_notification_recipient") ?? "",
  };
}

export function setCompletionNotificationSettings(settings: CompletionNotificationSettings): void {
  setAppSetting("completion_notification_enabled", settings.enabled ? "1" : "0");
  setAppSetting("completion_notification_recipient", settings.recipient.trim().toLowerCase());
}

function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export async function sendCompletionNotification(attemptId: number): Promise<boolean> {
  const settings = getCompletionNotificationSettings();
  if (!settings.enabled || !settings.recipient || !relayConfigured()) return false;
  const player = db.prepare("SELECT p.is_public FROM attempts a JOIN players p ON p.id = a.player_id WHERE a.id = ?").get(attemptId) as { is_public: number } | undefined;
  if (!player || player.is_public) return false;

  const claimed = db.prepare(`UPDATE attempts SET completion_notification_started_at = ?, completion_notification_error = NULL
    WHERE id = ? AND status = 'completed' AND completion_notification_started_at IS NULL`).run(nowIso(), attemptId).changes;
  if (!claimed) return false;

  const row = db.prepare(`SELECT a.id AS attempt_id, a.generation, a.completed_at, p.id AS player_id, p.email, p.display_name, p.is_test,
    COALESCE(SUM(CASE WHEN q.included_in_score = 1 AND e.verdict = 'correct' THEN 1 ELSE 0 END), 0) AS score,
    COALESCE(SUM(CASE WHEN q.included_in_score = 1 AND e.submitted_at IS NOT NULL THEN e.elapsed_ms ELSE 0 END), 0) AS answer_time_ms
    FROM attempts a JOIN players p ON p.id = a.player_id
    LEFT JOIN exposures e ON e.attempt_id = a.id LEFT JOIN questions q ON q.id = e.question_id
    WHERE a.id = ? GROUP BY a.id, p.id`).get(attemptId) as { attempt_id: number; generation: number; completed_at: string; player_id: number; email: string; display_name: string; is_test: number; score: number; answer_time_ms: number };
  const label = row.display_name || row.email;
  const subject = `${row.is_test ? "[TEST] " : ""}Bee Quiz completed: ${label}`;
  const answersUrl = `${config.appOrigin}/admin/player/${row.player_id}/answers`;
  const lines = [
    `${label} has completed the Pop Culture Bee Quiz.`,
    `Email: ${row.email}`,
    `Account: ${row.is_test ? "Test player" : "Real player"}`,
    `Attempt: ${row.generation}`,
    `Score: ${row.score}`,
    `Answer time: ${(row.answer_time_ms / 1000).toFixed(1)} seconds`,
    `Completed: ${row.completed_at}`,
    `View answers: ${answersUrl}`,
  ];
  const html = `<h1>Bee Quiz completed</h1><p><strong>${esc(label)}</strong> has submitted all answers.</p><ul><li>Email: ${esc(row.email)}</li><li>Account: ${row.is_test ? "Test player" : "Real player"}</li><li>Attempt: ${row.generation}</li><li>Score: ${row.score}</li><li>Answer time: ${(row.answer_time_ms / 1000).toFixed(1)} seconds</li><li>Completed: ${esc(row.completed_at)}</li></ul><p><a href="${esc(answersUrl)}">View this player’s answers</a></p>`;
  const result = await sendRelayEmail(settings.recipient, subject, html, lines.join("\n"));
  if (result.ok) {
    db.prepare("UPDATE attempts SET completion_notified_at = ?, completion_notification_error = NULL WHERE id = ?").run(nowIso(), attemptId);
  } else {
    db.prepare("UPDATE attempts SET completion_notification_error = ? WHERE id = ?").run(result.error.slice(0, 1000), attemptId);
  }
  logEvent(attemptId, "completion_notification", { ok: result.ok, quotaExhausted: result.quotaExhausted });
  return result.ok;
}
