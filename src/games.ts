import { db, getAppSetting, nowIso, setAppSetting } from "./db.ts";

export interface Game {
  id: number;
  game_number: number;
  name: string;
  is_active: number;
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
      AND (SELECT COUNT(*) FROM questions q WHERE q.game_id = g.id) = 50
    ORDER BY g.game_number`).all(now) as unknown as Game[];
}

export function gameIsPlayable(id: number): boolean {
  return playableGames().some((game) => game.id === id);
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

export function createGame(name: string, closesAt: string | null): Game {
  const number = Number((db.prepare("SELECT COALESCE(MAX(game_number), 0) + 1 AS n FROM games").get() as { n: number }).n);
  const result = db.prepare("INSERT INTO games (game_number, name, is_active, closes_at, created_at) VALUES (?, ?, 0, ?, ?)").run(number, name, closesAt, nowIso());
  return gameById(Number(result.lastInsertRowid))!;
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
