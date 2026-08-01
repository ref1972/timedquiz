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
const closesAt = Date.parse(process.env.CLOSES_AT ?? "");
if (!Number.isFinite(closesAt)) failures.push("CLOSES_AT must be a valid ISO-8601 timestamp.");

const databasePath = path.resolve(process.env.DB_PATH ?? "data/quiz.db");
if (!fs.existsSync(databasePath)) {
  failures.push(`Database does not exist: ${databasePath}`);
} else {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  const questions = database.prepare("SELECT COUNT(*) AS count, COUNT(DISTINCT position) AS positions FROM questions").get();
  const players = database.prepare("SELECT COUNT(*) AS count, SUM(CASE WHEN token_ciphertext IS NOT NULL THEN 1 ELSE 0 END) AS recoverable FROM players").get();
  const attempts = database.prepare("SELECT COUNT(*) AS count FROM attempts").get();
  if (questions.count !== 50 || questions.positions !== 50) failures.push(`Question bank must contain positions 1-50 exactly; found ${questions.count} rows and ${questions.positions} positions.`);
  if (players.count < 1) failures.push("No invited players are loaded.");
  if (players.recoverable !== players.count) failures.push(`${players.count - players.recoverable} player invitation(s) cannot be emailed until their links are rotated.`);
  if (attempts.count > 0 && process.env.ALLOW_EXISTING_ATTEMPTS !== "1") failures.push(`Database already contains ${attempts.count} attempt(s); set ALLOW_EXISTING_ATTEMPTS=1 only when intentionally checking an active event.`);
  console.log(`Database: ${databasePath}`);
  console.log(`Questions: ${questions.count}; players: ${players.count}; recoverable invitations: ${players.recoverable}; attempts: ${attempts.count}`);
}

if (failures.length) {
  console.error("Preflight failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Preflight passed.");
}
