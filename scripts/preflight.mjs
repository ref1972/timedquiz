import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const failures = [];
const warnings = [];
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

  // The active flag now scopes only legacy invitation/reminder email. What the
  // public can actually play is every game that is open and has a complete
  // bank, so that is what gets checked -- one game at a time, against its own
  // required question count rather than a hardcoded 50.
  const activeGame = database.prepare("SELECT id, game_number, name, closes_at FROM games WHERE is_active = 1").get();
  if (!activeGame) failures.push("Exactly one active game is required as the legacy invitation/reminder email boundary.");
  if (activeGame && activeGame.closes_at !== null && !Number.isFinite(Date.parse(activeGame.closes_at))) failures.push("The active game cutoff must be empty or a valid date.");

  const now = new Date().toISOString();
  const games = database.prepare("SELECT id, game_number, name, closes_at, expected_question_count FROM games ORDER BY game_number").all();
  const publicGames = [];
  for (const game of games) {
    if (game.closes_at !== null && !Number.isFinite(Date.parse(game.closes_at))) {
      failures.push(`Game ${game.game_number} has an unreadable cutoff: ${game.closes_at}`);
      continue;
    }
    const questions = database.prepare("SELECT COUNT(*) AS count, COUNT(DISTINCT position) AS positions FROM questions WHERE game_id = ?").get(game.id);
    const open = game.closes_at === null || game.closes_at > now;
    const complete = questions.count === game.expected_question_count && questions.positions === game.expected_question_count;
    if (open && !complete) {
      // Not a failure: an open game with an incomplete bank is simply held off
      // the chooser by playableGames(), which is the safeguard working.
      warnings.push(`Game ${game.game_number} is open but stays off the public chooser: ${questions.count} of ${game.expected_question_count} questions (${questions.positions} distinct positions).`);
    }
    if (open && complete) publicGames.push({ ...game, questions: questions.count });
  }
  if (!publicGames.length) warnings.push("No game is currently on the public chooser.");

  const players = database.prepare(`SELECT
    COALESCE(SUM(CASE WHEN is_public = 0 AND is_test = 0 THEN 1 ELSE 0 END), 0) AS invited,
    COALESCE(SUM(CASE WHEN is_public = 0 AND is_test = 0 AND token_ciphertext IS NOT NULL THEN 1 ELSE 0 END), 0) AS recoverable,
    COALESCE(SUM(CASE WHEN is_public = 1 THEN 1 ELSE 0 END), 0) AS public
    FROM players`).get();
  const accounts = database.prepare("SELECT COUNT(*) AS count FROM accounts").get();
  const attempts = activeGame ? database.prepare("SELECT COUNT(*) AS count FROM attempts a JOIN players p ON p.id = a.player_id WHERE p.game_id = ?").get(activeGame.id) : { count: 0 };
  // Invitations are a legacy path, so an unrotated link no longer blocks a
  // release -- it only matters if somebody deliberately runs a batch again.
  if (players.recoverable !== players.invited) warnings.push(`${players.invited - players.recoverable} invited player link(s) would need rotating before another legacy invitation batch.`);
  if (attempts.count > 0 && process.env.ALLOW_EXISTING_ATTEMPTS !== "1") failures.push(`Database already contains ${attempts.count} attempt(s) in the active game; set ALLOW_EXISTING_ATTEMPTS=1 only when intentionally checking an active event.`);

  console.log(`Database: ${databasePath}`);
  if (activeGame) console.log(`Legacy email game: ${activeGame.game_number} — ${activeGame.name}; cutoff: ${activeGame.closes_at ?? "always open"}`);
  console.log(`Public games: ${publicGames.length ? publicGames.map((game) => `${game.game_number} (${game.questions}q, ${game.closes_at ? `closes ${game.closes_at}` : "always open"})`).join("; ") : "none"}`);
  console.log(`Players: ${players.public} public; ${players.invited} invited; ${players.recoverable} recoverable invitations; ${accounts.count} accounts; attempts in the active game: ${attempts.count}`);
}

if (warnings.length) {
  console.warn("Preflight warnings:");
  for (const warning of warnings) console.warn(`- ${warning}`);
}

if (failures.length) {
  console.error("Preflight failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Preflight passed.");
}
