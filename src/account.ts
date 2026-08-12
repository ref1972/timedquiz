import { config } from "./config.ts";
import { randomToken, sha256 } from "./crypto.ts";
import { db, nowIso } from "./db.ts";
import { sendRelayEmail, type MailResult } from "./mail.ts";
import type { Player } from "./quiz.ts";

export interface Account { id: number; email: string; display_name: string; created_at: string; last_login_at: string | null }
export interface AccountHistoryRow { playerId: number; gameName: string; gameNumber: number; status: string; score: number | null; completedAt: string | null; unresolved: number }

export async function requestAccountLogin(emailInput: string, player: Player | null): Promise<MailResult | null> {
  const email = emailInput.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) return null;
  let account = db.prepare("SELECT * FROM accounts WHERE email = ?").get(email) as unknown as Account | undefined;
  if (!account) {
    const id = db.prepare("INSERT INTO accounts (email, display_name, created_at) VALUES (?, ?, ?)").run(email, player?.display_name ?? "", nowIso()).lastInsertRowid;
    account = db.prepare("SELECT * FROM accounts WHERE id = ?").get(id) as unknown as Account;
  }
  const token = randomToken();
  const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
  db.prepare("INSERT INTO account_login_tokens (account_id, token_hash, requested_player_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)").run(account.id, sha256(token), player?.id ?? null, expiresAt, nowIso());
  const url = `${config.appOrigin}/account/verify/${token}`;
  const result = await sendRelayEmail(email, "Sign in to Pop Culture Bee", `<p>Use this secure link to sign in to your Pop Culture Bee account:</p><p><a href="${url}">Sign in to my account</a></p><p>This link expires in 15 minutes and can be used once.</p>`, `Sign in to your Pop Culture Bee account:\n\n${url}\n\nThis link expires in 15 minutes and can be used once.`);
  if (!result.ok) db.prepare("DELETE FROM account_login_tokens WHERE token_hash = ?").run(sha256(token));
  return result;
}

export function consumeAccountLogin(token: string): Account | null {
  const row = db.prepare(`SELECT t.id,t.account_id,t.requested_player_id,a.email FROM account_login_tokens t JOIN accounts a ON a.id=t.account_id
    WHERE t.token_hash=? AND t.used_at IS NULL AND t.expires_at>?`).get(sha256(token), nowIso()) as { id: number; account_id: number; requested_player_id: number | null; email: string } | undefined;
  if (!row) return null;
  db.exec("BEGIN IMMEDIATE");
  try {
    const changed = db.prepare("UPDATE account_login_tokens SET used_at=? WHERE id=? AND used_at IS NULL").run(nowIso(), row.id).changes;
    if (!changed) { db.exec("ROLLBACK"); return null; }
    for (const player of db.prepare("SELECT id FROM players WHERE lower(email)=?").all(row.email) as Array<{ id: number }>) linkPlayer(row.account_id, player.id);
    if (row.requested_player_id) {
      const requested = db.prepare("SELECT id,is_public FROM players WHERE id=?").get(row.requested_player_id) as { id: number; is_public: number } | undefined;
      if (requested?.is_public) linkPlayer(row.account_id, requested.id);
    }
    db.prepare("UPDATE accounts SET last_login_at=? WHERE id=?").run(nowIso(), row.account_id);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return db.prepare("SELECT * FROM accounts WHERE id=?").get(row.account_id) as unknown as Account;
}

export function accountById(id: number): Account | null {
  return (db.prepare("SELECT * FROM accounts WHERE id=?").get(id) as unknown as Account | undefined) ?? null;
}

export function linkPlayer(accountId: number, playerId: number): void {
  const owner = db.prepare("SELECT account_id FROM account_player_links WHERE player_id=?").get(playerId) as { account_id: number } | undefined;
  if (owner && owner.account_id !== accountId) throw new Error("This player history is already linked to another account.");
  db.prepare("INSERT OR IGNORE INTO account_player_links (account_id,player_id,linked_at) VALUES (?,?,?)").run(accountId, playerId, nowIso());
}

export function accountHistory(accountId: number): AccountHistoryRow[] {
  return db.prepare(`SELECT p.id playerId,g.name gameName,g.game_number gameNumber,COALESCE(a.status,'not started') status,
    CASE WHEN a.status='completed' AND NOT EXISTS (SELECT 1 FROM exposures eu WHERE eu.attempt_id=a.id AND eu.verdict='unresolved')
      THEN (SELECT COUNT(*) FROM exposures e JOIN questions q ON q.id=e.question_id WHERE e.attempt_id=a.id AND e.verdict='correct' AND q.included_in_score=1) ELSE NULL END score,
    a.completed_at completedAt,
    CASE WHEN a.id IS NULL THEN 0 ELSE (SELECT COUNT(*) FROM exposures eu WHERE eu.attempt_id=a.id AND eu.verdict='unresolved') END unresolved
    FROM account_player_links l JOIN players p ON p.id=l.player_id JOIN games g ON g.id=p.game_id
    LEFT JOIN attempts a ON a.id=(SELECT id FROM attempts WHERE player_id=p.id AND status IN ('in_progress','completed') ORDER BY generation DESC LIMIT 1)
    WHERE l.account_id=? ORDER BY g.game_number,p.id`).all(accountId) as unknown as AccountHistoryRow[];
}
