import { randomToken, sha256 } from "./crypto.ts";
import { db, nowIso } from "./db.ts";
import { gameIsPlayable, playableGames, type Game } from "./games.ts";
import type { Player } from "./quiz.ts";

export interface PlayerGameOption {
  game: Game;
  playerId: number | null;
  status: "not started" | "in progress" | "completed";
}

export function playerGameOptions(player: Player): PlayerGameOption[] {
  return playableGames().map((game) => {
    const row = db.prepare(`SELECT p.id,
      (SELECT a.status FROM attempts a WHERE a.player_id = p.id AND a.status IN ('in_progress','completed') ORDER BY a.generation DESC LIMIT 1) AS status
      FROM players p WHERE p.game_id = ? AND p.email = ?`).get(game.id, player.email) as { id: number; status: string | null } | undefined;
    return {
      game,
      playerId: row?.id ?? null,
      status: row?.status === "completed" ? "completed" : row?.status === "in_progress" ? "in progress" : "not started",
    };
  });
}

export function registerPublicPlayer(gameId: number, displayName: string): Player | null {
  const name = displayName.trim().replace(/\s+/g, " ").slice(0, 100);
  if (!name || !gameIsPlayable(gameId)) return null;
  const identity = randomToken(18);
  const token = randomToken();
  const result = db.prepare(`INSERT INTO players
    (game_id, email, display_name, token_hash, token_ciphertext, is_test, is_public, created_at)
    VALUES (?, ?, ?, ?, NULL, 0, 1, ?)`).run(gameId, `public-${identity}@players.invalid`, name, sha256(token), nowIso());
  return db.prepare("SELECT id, game_id, email, display_name, is_test FROM players WHERE id = ?").get(result.lastInsertRowid) as unknown as Player;
}

export function playerForGame(player: Player, gameId: number): Player | null {
  if (!gameIsPlayable(gameId)) return null;
  const existing = db.prepare("SELECT id, game_id, email, display_name, is_test FROM players WHERE game_id = ? AND email = ?").get(gameId, player.email) as unknown as Player | undefined;
  if (existing) return existing;
  const token = randomToken();
  db.prepare(`INSERT OR IGNORE INTO players
    (game_id, email, display_name, token_hash, token_ciphertext, is_test, is_public, created_at)
    VALUES (?, ?, ?, ?, NULL, ?, 1, ?)`).run(gameId, player.email, player.display_name, sha256(token), player.is_test, nowIso());
  return (db.prepare("SELECT id, game_id, email, display_name, is_test FROM players WHERE game_id = ? AND email = ?").get(gameId, player.email) as unknown as Player | undefined) ?? null;
}
