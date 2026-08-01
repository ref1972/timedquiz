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
CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL DEFAULT '',
  token_hash TEXT NOT NULL UNIQUE,
  is_test INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY,
  position INTEGER NOT NULL UNIQUE CHECK (position BETWEEN 1 AND 50),
  category TEXT NOT NULL DEFAULT 'Pop Culture',
  prompt TEXT NOT NULL,
  canonical_answer TEXT NOT NULL,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  included_in_score INTEGER NOT NULL DEFAULT 1
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
`);

const questionColumns = db.prepare("PRAGMA table_info(questions)").all() as unknown as Array<{ name: string }>;
if (!questionColumns.some((column) => column.name === "category")) {
  db.exec("ALTER TABLE questions ADD COLUMN category TEXT NOT NULL DEFAULT 'Pop Culture'");
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
