import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.ts";

// node:sqlite is still flagged experimental in Node 24 -- meaning its API may
// shift across Node majors, not that it is unreliable. Every SQLite access in
// this app goes through this one file so swapping in better-sqlite3 later
// would be a one-file change.

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new DatabaseSync(config.dbPath);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");
db.exec("PRAGMA busy_timeout = 5000;");

db.exec(`
CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY,
  game_number INTEGER NOT NULL UNIQUE,
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
  expected_question_count INTEGER NOT NULL DEFAULT 50 CHECK (expected_question_count BETWEEN 1 AND 50),
  closes_at TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS one_active_game ON games (is_active) WHERE is_active = 1;

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS account_login_tokens (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  token_hash TEXT NOT NULL UNIQUE,
  requested_player_id INTEGER REFERENCES players(id),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS account_player_links (
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  player_id INTEGER NOT NULL REFERENCES players(id),
  linked_at TEXT NOT NULL,
  PRIMARY KEY (account_id, player_id),
  UNIQUE (player_id)
);

CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES games(id),
  email TEXT NOT NULL COLLATE NOCASE,
  display_name TEXT NOT NULL DEFAULT '',
  token_hash TEXT NOT NULL UNIQUE,
  token_ciphertext TEXT,
  invite_sent_at TEXT,
  invite_last_error TEXT,
  invite_send_attempts INTEGER NOT NULL DEFAULT 0,
  reminder_sent_at TEXT,
  reminder_last_error TEXT,
  reminder_send_attempts INTEGER NOT NULL DEFAULT 0,
  is_test INTEGER NOT NULL DEFAULT 0,
  is_public INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (game_id, email)
);

CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES games(id),
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 50),
  category TEXT NOT NULL DEFAULT 'Pop Culture',
  prompt TEXT NOT NULL,
  highlighted_text TEXT NOT NULL DEFAULT '',
  canonical_answer TEXT NOT NULL,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  -- Marks the answer as a person's name, which accepts the bare surname and
  -- refuses that surname behind a different first name. See grading.ts.
  answer_is_person INTEGER NOT NULL DEFAULT 0,
  included_in_score INTEGER NOT NULL DEFAULT 1,
  UNIQUE (game_id, position)
);

-- One row per playthrough. A restart supersedes the old row rather than
-- deleting or overwriting it, so disputes and audits have a full history.
CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id),
  generation INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed', 'superseded', 'disqualified')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  superseded_at TEXT,
  restart_reason TEXT,
  completion_notification_started_at TEXT,
  completion_notified_at TEXT,
  completion_notification_error TEXT,
  UNIQUE (player_id, generation)
);

-- Structurally enforces "one attempt per player" -- a player cannot have two
-- rows that are both in_progress/completed at once, closing the exact race
-- an admin restart and a resuming player could otherwise hit together.
CREATE UNIQUE INDEX IF NOT EXISTS one_current_attempt
  ON attempts (player_id) WHERE status IN ('in_progress', 'completed');

-- One row per question ever served to an attempt. served_at is the sole
-- authoritative start of that question's clock; deadline_at is derived from
-- it at creation time and never recomputed. A question is finalized exactly
-- once, enforced by the "WHERE submitted_at IS NULL" guard on every UPDATE
-- that finalizes a row (see quiz.ts), not by application-level locking.
CREATE TABLE IF NOT EXISTS exposures (
  id INTEGER PRIMARY KEY,
  attempt_id INTEGER NOT NULL REFERENCES attempts(id),
  question_id INTEGER NOT NULL REFERENCES questions(id),
  nonce TEXT NOT NULL UNIQUE,
  served_at TEXT NOT NULL,
  deadline_at TEXT NOT NULL,
  displayed_at TEXT,
  draft_text TEXT NOT NULL DEFAULT '',
  draft_sequence INTEGER NOT NULL DEFAULT 0,
  submitted_text TEXT,
  submitted_at TEXT,
  finalized_reason TEXT CHECK (finalized_reason IN ('manual', 'timeout')),
  normalized_answer TEXT,
  verdict TEXT CHECK (verdict IN ('correct', 'incorrect', 'unresolved')),
  elapsed_ms INTEGER,
  UNIQUE (attempt_id, question_id)
);

-- A ruling on one normalized answer for one question. Consulted both
-- retroactively (existing exposures are updated immediately) and
-- prospectively (autograde checks this table first -- see grading.ts) so a
-- reviewer's decision never has to be repeated for the next player who types
-- the same thing.
CREATE TABLE IF NOT EXISTS grading_rules (
  id INTEGER PRIMARY KEY,
  question_id INTEGER NOT NULL REFERENCES questions(id),
  normalized_answer TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('correct', 'incorrect')),
  note TEXT NOT NULL DEFAULT '',
  reviewed_at TEXT NOT NULL,
  UNIQUE (question_id, normalized_answer)
);

-- Append-only. The record to consult if a result is disputed.
CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY,
  attempt_id INTEGER REFERENCES attempts(id),
  kind TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`);

const gameColumns = db.prepare("PRAGMA table_info(games)").all() as unknown as Array<{ name: string }>;
if (!gameColumns.some((column) => column.name === "expected_question_count")) {
  db.exec("ALTER TABLE games ADD COLUMN expected_question_count INTEGER NOT NULL DEFAULT 50 CHECK (expected_question_count BETWEEN 1 AND 50)");
}

if (!(db.prepare("SELECT id FROM games LIMIT 1").get())) {
  db.prepare("INSERT INTO games (game_number, name, is_active, closes_at, created_at) VALUES (1, ?, 1, ?, ?)").run(
    "Pop Culture Bee Preliminary 2026",
    config.closesAt ? new Date(config.closesAt).toISOString() : null,
    new Date().toISOString(),
  );
}

const initialGameId = Number((db.prepare("SELECT id FROM games ORDER BY game_number LIMIT 1").get() as { id: number }).id);

// rc33 and earlier had one global player/question set. Rebuild only those two
// parent tables, preserving every primary key so attempts, exposures, grading
// rules, and audit history continue to reference the same historical records.
const legacyPlayerColumns = db.prepare("PRAGMA table_info(players)").all() as unknown as Array<{ name: string }>;
const legacyQuestionColumns = db.prepare("PRAGMA table_info(questions)").all() as unknown as Array<{ name: string }>;
if (!legacyPlayerColumns.some((column) => column.name === "game_id") || !legacyQuestionColumns.some((column) => column.name === "game_id")) {
  db.exec("PRAGMA foreign_keys = OFF");
  db.exec("BEGIN");
  try {
    if (!legacyPlayerColumns.some((column) => column.name === "game_id")) {
      db.exec(`CREATE TABLE players_new (
        id INTEGER PRIMARY KEY, game_id INTEGER NOT NULL REFERENCES games(id),
        email TEXT NOT NULL COLLATE NOCASE, display_name TEXT NOT NULL DEFAULT '',
        token_hash TEXT NOT NULL UNIQUE, token_ciphertext TEXT, invite_sent_at TEXT,
        invite_last_error TEXT, invite_send_attempts INTEGER NOT NULL DEFAULT 0,
        reminder_sent_at TEXT, reminder_last_error TEXT,
        reminder_send_attempts INTEGER NOT NULL DEFAULT 0, is_test INTEGER NOT NULL DEFAULT 0,
        is_public INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, UNIQUE (game_id, email));`);
      db.prepare(`INSERT INTO players_new SELECT id, ?, email, display_name, token_hash, token_ciphertext,
        invite_sent_at, invite_last_error, invite_send_attempts, reminder_sent_at,
        reminder_last_error, reminder_send_attempts, is_test, 0, created_at FROM players`).run(initialGameId);
      db.exec("DROP TABLE players; ALTER TABLE players_new RENAME TO players;");
    }
    if (!legacyQuestionColumns.some((column) => column.name === "game_id")) {
      db.exec(`CREATE TABLE questions_new (
        id INTEGER PRIMARY KEY, game_id INTEGER NOT NULL REFERENCES games(id),
        position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 50), category TEXT NOT NULL DEFAULT 'Pop Culture',
        prompt TEXT NOT NULL, highlighted_text TEXT NOT NULL DEFAULT '', canonical_answer TEXT NOT NULL,
        aliases_json TEXT NOT NULL DEFAULT '[]', answer_is_person INTEGER NOT NULL DEFAULT 0,
        included_in_score INTEGER NOT NULL DEFAULT 1, UNIQUE (game_id, position));`);
      db.prepare(`INSERT INTO questions_new SELECT id, ?, position, category, prompt, highlighted_text,
        canonical_answer, aliases_json, answer_is_person, included_in_score FROM questions`).run(initialGameId);
      db.exec("DROP TABLE questions; ALTER TABLE questions_new RENAME TO questions;");
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
  const integrity = db.prepare("PRAGMA foreign_key_check").all();
  if (integrity.length) throw new Error("Game migration failed foreign-key validation.");
}

const questionColumns = db.prepare("PRAGMA table_info(questions)").all() as unknown as Array<{ name: string }>;
if (!questionColumns.some((column) => column.name === "category")) {
  db.exec("ALTER TABLE questions ADD COLUMN category TEXT NOT NULL DEFAULT 'Pop Culture'");
}
if (!questionColumns.some((column) => column.name === "highlighted_text")) {
  db.exec("ALTER TABLE questions ADD COLUMN highlighted_text TEXT NOT NULL DEFAULT ''");
}
if (!questionColumns.some((column) => column.name === "answer_is_person")) {
  db.exec("ALTER TABLE questions ADD COLUMN answer_is_person INTEGER NOT NULL DEFAULT 0");
}

const playerColumns = db.prepare("PRAGMA table_info(players)").all() as unknown as Array<{ name: string }>;
if (!playerColumns.some((column) => column.name === "token_ciphertext")) {
  db.exec("ALTER TABLE players ADD COLUMN token_ciphertext TEXT");
}
if (!playerColumns.some((column) => column.name === "invite_sent_at")) {
  db.exec("ALTER TABLE players ADD COLUMN invite_sent_at TEXT");
}
if (!playerColumns.some((column) => column.name === "invite_last_error")) {
  db.exec("ALTER TABLE players ADD COLUMN invite_last_error TEXT");
}
if (!playerColumns.some((column) => column.name === "invite_send_attempts")) {
  db.exec("ALTER TABLE players ADD COLUMN invite_send_attempts INTEGER NOT NULL DEFAULT 0");
}
if (!playerColumns.some((column) => column.name === "reminder_sent_at")) {
  db.exec("ALTER TABLE players ADD COLUMN reminder_sent_at TEXT");
}
if (!playerColumns.some((column) => column.name === "reminder_last_error")) {
  db.exec("ALTER TABLE players ADD COLUMN reminder_last_error TEXT");
}
if (!playerColumns.some((column) => column.name === "reminder_send_attempts")) {
  db.exec("ALTER TABLE players ADD COLUMN reminder_send_attempts INTEGER NOT NULL DEFAULT 0");
}
if (!playerColumns.some((column) => column.name === "is_public")) {
  db.exec("ALTER TABLE players ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0");
}

const exposureColumns = db.prepare("PRAGMA table_info(exposures)").all() as unknown as Array<{ name: string }>;
if (!exposureColumns.some((column) => column.name === "elapsed_ms")) {
  db.exec("ALTER TABLE exposures ADD COLUMN elapsed_ms INTEGER");
  db.exec(`UPDATE exposures SET elapsed_ms = MIN(
    CAST((julianday(submitted_at) - julianday(served_at)) * 86400000 AS INTEGER),
    CAST((julianday(deadline_at) - julianday(served_at)) * 86400000 AS INTEGER)
  ) WHERE submitted_at IS NOT NULL`);
}

const attemptColumns = db.prepare("PRAGMA table_info(attempts)").all() as unknown as Array<{ name: string }>;
if (!attemptColumns.some((column) => column.name === "completion_notification_started_at")) {
  db.exec("ALTER TABLE attempts ADD COLUMN completion_notification_started_at TEXT");
}
if (!attemptColumns.some((column) => column.name === "completion_notified_at")) {
  db.exec("ALTER TABLE attempts ADD COLUMN completion_notified_at TEXT");
}
if (!attemptColumns.some((column) => column.name === "completion_notification_error")) {
  db.exec("ALTER TABLE attempts ADD COLUMN completion_notification_error TEXT");
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function logEvent(attemptId: number | null, kind: string, detail: unknown = {}): void {
  db.prepare("INSERT INTO audit_events (attempt_id, kind, detail_json, created_at) VALUES (?, ?, ?, ?)").run(
    attemptId,
    kind,
    JSON.stringify(detail),
    nowIso(),
  );
}

export function getAppSetting(key: string): string | null {
  const row = db.prepare("SELECT setting_value FROM app_settings WHERE setting_key = ?").get(key) as { setting_value: string } | undefined;
  return row?.setting_value ?? null;
}

export function setAppSetting(key: string, value: string): void {
  db.prepare(`INSERT INTO app_settings (setting_key, setting_value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = excluded.updated_at`).run(key, value, nowIso());
}
