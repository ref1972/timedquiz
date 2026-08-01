#!/usr/bin/env bash
set -euo pipefail

quiz_db_path="${DB_PATH:-data/quiz.db}"
quiz_backup_dir="${QUIZ_BACKUP_DIR:-backups}"

if [[ ! -f "$quiz_db_path" ]]; then
  echo "Quiz database not found: $quiz_db_path" >&2
  exit 1
fi
if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "sqlite3 is required for a consistent online backup." >&2
  exit 1
fi

mkdir -p "$quiz_backup_dir"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
destination="$quiz_backup_dir/quiz-$timestamp.sqlite"
sqlite3 "$quiz_db_path" ".backup '$destination'"
gzip "$destination"
echo "$destination.gz"
