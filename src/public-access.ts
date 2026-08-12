import { randomToken, sha256 } from "./crypto.ts";
import { db, nowIso } from "./db.ts";
import { gameIsPlayable, playableGames, type Game } from "./games.ts";
import type { Player } from "./quiz.ts";

export interface PlayerGameOption {
  game: Game;
  playerId: number | null;
  status: "not started" | "in progress" | "completed";
}

export interface PlayerResultAnswer {
  position: number;
  category: string;
  prompt: string;
  submitted_text: string;
  verdict: "correct" | "incorrect";
  included_in_score: number;
}

export type PlayerResults =
  | { ready: false }
  | { ready: true; gameName: string; score: number; answers: PlayerResultAnswer[] };

export interface ScoreboardRow { rank: number; displayName: string; score: number; answerTimeMs: number }
export function gameScoreboard(gameId: number): { game: Game; rows: ScoreboardRow[] } | null {
  const game = playableGames().find((candidate) => candidate.id === gameId);
  if (!game) return null;
  const raw = db.prepare(`SELECT p.display_name displayName,
    SUM(CASE WHEN q.included_in_score=1 AND e.verdict='correct' THEN 1 ELSE 0 END) score,
    SUM(CASE WHEN q.included_in_score=1 THEN COALESCE(e.elapsed_ms,0) ELSE 0 END) answerTimeMs
    FROM players p JOIN attempts a ON a.player_id=p.id AND a.status='completed'
    JOIN exposures e ON e.attempt_id=a.id JOIN questions q ON q.id=e.question_id
    WHERE p.game_id=? AND p.is_test=0 AND NOT EXISTS (SELECT 1 FROM exposures u WHERE u.attempt_id=a.id AND u.verdict='unresolved')
    GROUP BY p.id,a.id ORDER BY score DESC,answerTimeMs ASC,p.display_name COLLATE NOCASE`).all(gameId) as Array<Omit<ScoreboardRow,"rank">>;
  return { game, rows: raw.map((row, index) => ({ ...row, rank: index + 1 })) };
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

export function playerResults(player: Player): PlayerResults | null {
  const attempt = db.prepare("SELECT id FROM attempts WHERE player_id = ? AND status = 'completed' ORDER BY generation DESC LIMIT 1").get(player.id) as { id: number } | undefined;
  if (!attempt) return null;
  const unresolved = Number((db.prepare("SELECT COUNT(*) AS n FROM exposures WHERE attempt_id = ? AND verdict = 'unresolved'").get(attempt.id) as { n: number }).n);
  if (unresolved) return { ready: false };
  const game = db.prepare("SELECT name FROM games WHERE id = ?").get(player.game_id) as { name: string };
  const answers = db.prepare(`SELECT q.position,q.category,q.prompt,COALESCE(e.submitted_text,'') AS submitted_text,e.verdict,q.included_in_score
    FROM exposures e JOIN questions q ON q.id=e.question_id
    WHERE e.attempt_id=? AND e.submitted_at IS NOT NULL ORDER BY q.position`).all(attempt.id) as unknown as PlayerResultAnswer[];
  const score = answers.filter((answer) => answer.included_in_score && answer.verdict === "correct").length;
  return { ready: true, gameName: game.name, score, answers };
}
