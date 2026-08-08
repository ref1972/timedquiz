import fs from "node:fs";
import path from "node:path";
import { config } from "./config.ts";
import { db, nowIso } from "./db.ts";
import { encryptInvitationToken, sha256, randomToken } from "./crypto.ts";
import { activeGame } from "./games.ts";

interface SeedQuestion {
  position: number;
  category?: string;
  prompt: string;
  highlightedText?: string;
  answer: string;
  aliases: string[];
}

const questionsPath = path.resolve(import.meta.dirname, "questions.json");
const questions: SeedQuestion[] = JSON.parse(fs.readFileSync(questionsPath, "utf8"));

if (questions.length !== 50) {
  throw new Error(`Expected exactly 50 questions in questions.json, found ${questions.length}.`);
}

const gameId = activeGame().id;
db.exec("BEGIN");
try {
  db.prepare("DELETE FROM questions WHERE game_id = ?").run(gameId);
  const insert = db.prepare("INSERT INTO questions (game_id, position, category, prompt, highlighted_text, canonical_answer, aliases_json) VALUES (?, ?, ?, ?, ?, ?, ?)");
  for (const q of questions) {
    insert.run(gameId, q.position, q.category?.trim() || "Pop Culture", q.prompt, q.highlightedText?.trim() || "", q.answer, JSON.stringify(q.aliases ?? []));
  }
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
}
console.log(`Seeded ${questions.length} questions.`);
console.log(
  "These 50 were pulled from the Tangents quiz-bee export as a starting set for local development -- review and replace with vetted, cleared questions before any real invitation goes out.",
);

const testEmail = "test-player@example.com";
const existing = db.prepare("SELECT id FROM players WHERE game_id = ? AND email = ?").get(gameId, testEmail) as { id: number } | undefined;
if (!existing) {
  const token = randomToken();
  db.prepare("INSERT INTO players (game_id, email, display_name, token_hash, token_ciphertext, is_test, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)").run(
    gameId,
    testEmail,
    "Test Player",
    sha256(token),
    encryptInvitationToken(token),
    nowIso(),
  );
  console.log(`Seeded a local test player. Invite link: ${config.appOrigin}/invite/${token}`);
} else {
  console.log("Local test player already exists; run once is enough. Delete data/quiz.db to start fully fresh.");
}
