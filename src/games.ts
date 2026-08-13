import { db, getAppSetting, nowIso, setAppSetting } from "./db.ts";

export interface Game {
  id: number;
  game_number: number;
  name: string;
  is_active: number;
  expected_question_count: number;
  closes_at: string | null;
  created_at: string;
}

export function games(): Game[] {
  return db.prepare("SELECT * FROM games ORDER BY game_number DESC").all() as unknown as Game[];
}

export function playableGames(): Game[] {
  const now = new Date().toISOString();
  return db.prepare(`SELECT g.* FROM games g
    WHERE (g.closes_at IS NULL OR g.closes_at > ?)
      AND (SELECT COUNT(*) FROM questions q WHERE q.game_id = g.id) = g.expected_question_count
    ORDER BY g.game_number`).all(now) as unknown as Game[];
}

export function gameIsPlayable(id: number): boolean {
  return playableGames().some((game) => game.id === id);
}

export interface GameOverview extends Game {
  questionCount: number;
  playerCount: number;
  attemptCount: number;
  onChooser: boolean;
  chooserReason: string;
}

/**
 * Every game with the counts an administrator needs, and whether the public
 * chooser is currently offering it. Membership is taken from playableGames()
 * itself rather than re-derived, so the admin screen cannot disagree with what
 * `/` actually shows.
 */
export function gameOverviews(): GameOverview[] {
  const playable = new Set(playableGames().map((game) => game.id));
  return games().map((game) => {
    const counts = db.prepare(`SELECT
      (SELECT COUNT(*) FROM questions q WHERE q.game_id = g.id) AS questionCount,
      (SELECT COUNT(*) FROM players p WHERE p.game_id = g.id) AS playerCount,
      (SELECT COUNT(*) FROM attempts a JOIN players p ON p.id = a.player_id WHERE p.game_id = g.id) AS attemptCount
      FROM games g WHERE g.id = ?`).get(game.id) as { questionCount: number; playerCount: number; attemptCount: number };
    const onChooser = playable.has(game.id);
    const chooserReason = onChooser
      ? ""
      : counts.questionCount !== game.expected_question_count
        ? `question bank holds ${counts.questionCount} of ${game.expected_question_count}`
        : `closed ${game.closes_at ? new Date(game.closes_at).toLocaleString("en-US", { timeZone: "America/Chicago", timeZoneName: "short" }) : ""}`.trim();
    return { ...game, ...counts, onChooser, chooserReason };
  });
}

export function activeGame(): Game {
  const game = db.prepare("SELECT * FROM games WHERE is_active = 1").get() as unknown as Game | undefined;
  if (!game) throw new Error("No active game is configured.");
  return game;
}

export function gameById(id: number): Game | null {
  return (db.prepare("SELECT * FROM games WHERE id = ?").get(id) as unknown as Game | undefined) ?? null;
}

export function selectedGame(): Game {
  const selected = Number(getAppSetting("admin_selected_game_id"));
  return gameById(selected) ?? activeGame();
}

export function selectGame(id: number): boolean {
  if (!gameById(id)) return false;
  setAppSetting("admin_selected_game_id", String(id));
  return true;
}

export function createGame(name: string, closesAt: string | null, expectedQuestionCount = 50): Game {
  if (!Number.isInteger(expectedQuestionCount) || expectedQuestionCount < 1 || expectedQuestionCount > 50) throw new Error("Question count must be between 1 and 50.");
  const number = Number((db.prepare("SELECT COALESCE(MAX(game_number), 0) + 1 AS n FROM games").get() as { n: number }).n);
  const result = db.prepare("INSERT INTO games (game_number, name, is_active, expected_question_count, closes_at, created_at) VALUES (?, ?, 0, ?, ?, ?)").run(number, name, expectedQuestionCount, closesAt, nowIso());
  return gameById(Number(result.lastInsertRowid))!;
}

export const ARCHIVED_PREFIX = "ARCHIVED — ";

export function updateGame(id: number, name: string, expectedQuestionCount: number): boolean {
  if (!name.trim() || name.length > 160) throw new Error("Enter a game name of at most 160 characters.");
  if (!Number.isInteger(expectedQuestionCount) || expectedQuestionCount < 1 || expectedQuestionCount > 50) throw new Error("Question count must be between 1 and 50.");
  return db.prepare("UPDATE games SET name = ?, expected_question_count = ? WHERE id = ?").run(name.trim(), expectedQuestionCount, id).changes > 0;
}

/**
 * The cutoff is the public-access control: null means always open and any past
 * instant closes the game. Nothing is deleted either way -- a closed game keeps
 * every player, attempt, answer, and scoreboard row, it simply leaves the
 * chooser (see playableGames).
 */
export function setGameCutoff(id: number, closesAt: string | null): boolean {
  return db.prepare("UPDATE games SET closes_at = ? WHERE id = ?").run(closesAt, id).changes > 0;
}

/**
 * Retires a game from the public chooser by closing it and marking its name,
 * which is exactly what was done by hand for production Game 3. Deliberately
 * not a delete: the completed attempts and their answers stay queryable.
 */
export function archiveGame(id: number): boolean {
  const game = gameById(id);
  if (!game) return false;
  const name = game.name.startsWith(ARCHIVED_PREFIX) ? game.name : `${ARCHIVED_PREFIX}${game.name}`;
  return db.prepare("UPDATE games SET name = ?, closes_at = ? WHERE id = ?").run(name, nowIso(), id).changes > 0;
}

export function centralLocalToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const target = Date.parse(`${value}:00Z`);
  if (!Number.isFinite(target)) return null;
  let instant = target;
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  for (let i = 0; i < 2; i++) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    instant += target - represented;
  }
  return new Date(instant).toISOString();
}

export function activateGame(id: number): boolean {
  if (!gameById(id)) return false;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE games SET is_active = 0 WHERE is_active = 1").run();
    db.prepare("UPDATE games SET is_active = 1 WHERE id = ?").run(id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  selectGame(id);
  return true;
}
