import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const failures = [];
const requiredSecrets = ["ADMIN_PASSWORD", "SESSION_SECRET", "INVITATION_ENCRYPTION_KEY", "EMAIL_RELAY_SECRET"];
for (const name of requiredSecrets) {
  if (!process.env[name] || process.env[name].length < 32) failures.push(`${name} must contain at least 32 characters.`);
}
if (!process.env.EMAIL_RELAY_URL?.startsWith("https://")) failures.push("EMAIL_RELAY_URL must be an HTTPS URL.");
if (!process.env.APP_ORIGIN?.startsWith("https://")) failures.push("APP_ORIGIN must be the public HTTPS origin.");

const databasePath = path.resolve(process.env.DB_PATH ?? "data/quiz.db");
if (!fs.existsSync(databasePath)) {
  failures.push(`Database does not exist: ${databasePath}`);
} else {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  const activeGame = database.prepare("SELECT id, game_number, name, closes_at FROM games WHERE is_active = 1").get();
  if (!activeGame) failures.push("Exactly one active game is required.");
  if (activeGame?.closes_at !== null && !Number.isFinite(Date.parse(activeGame.closes_at))) failures.push("The active game cutoff must be empty or a valid date.");
  const questions = activeGame ? database.prepare("SELECT COUNT(*) AS count, COUNT(DISTINCT position) AS positions FROM questions WHERE game_id = ?").get(activeGame.id) : { count: 0, positions: 0 };
  const players = activeGame ? database.prepare(`SELECT
    COALESCE(SUM(CASE WHEN is_public = 0 THEN 1 ELSE 0 END), 0) AS invited,
    COALESCE(SUM(CASE WHEN is_public = 0 AND token_ciphertext IS NOT NULL THEN 1 ELSE 0 END), 0) AS recoverable,
    COALESCE(SUM(CASE WHEN is_public = 1 THEN 1 ELSE 0 END), 0) AS public
    FROM players WHERE game_id = ?`).get(activeGame.id) : { invited: 0, recoverable: 0, public: 0 };
  const attempts = activeGame ? database.prepare("SELECT COUNT(*) AS count FROM attempts a JOIN players p ON p.id = a.player_id WHERE p.game_id = ?").get(activeGame.id) : { count: 0 };
  if (questions.count !== 50 || questions.positions !== 50) failures.push(`Question bank must contain positions 1-50 exactly; found ${questions.count} rows and ${questions.positions} positions.`);
  if (players.recoverable !== players.invited) failures.push(`${players.invited - players.recoverable} invited player link(s) cannot be emailed until rotated.`);
  if (attempts.count > 0 && process.env.ALLOW_EXISTING_ATTEMPTS !== "1") failures.push(`Database already contains ${attempts.count} attempt(s); set ALLOW_EXISTING_ATTEMPTS=1 only when intentionally checking an active event.`);
  console.log(`Database: ${databasePath}`);
  if (activeGame) console.log(`Active game: ${activeGame.game_number} — ${activeGame.name}; cutoff: ${activeGame.closes_at ?? "not set"}`);
  console.log(`Questions: ${questions.count}; invited players: ${players.invited}; recoverable invitations: ${players.recoverable}; public players: ${players.public}; attempts: ${attempts.count}`);
}

if (failures.length) {
  console.error("Preflight failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Preflight passed.");
}
