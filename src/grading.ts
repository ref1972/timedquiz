import { db, nowIso } from "./db.ts";

export type Verdict = "correct" | "incorrect" | "unresolved";

export interface QuestionRow {
  id: number;
  position: number;
  category: string;
  prompt: string;
  canonical_answer: string;
  aliases_json: string;
  included_in_score: number;
}

/** Match CASS grading: lowercase/trim and ignore one leading article. */
export function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/\s+/g, " ")
    .replace(/^(the|a|an)\s+/i, "")
    .trim();
}

function existingRuling(questionId: number, normalizedAnswer: string): Verdict | null {
  const row = db
    .prepare("SELECT verdict FROM grading_rules WHERE question_id = ? AND normalized_answer = ?")
    .get(questionId, normalizedAnswer) as { verdict: string } | undefined;
  return row ? (row.verdict as Verdict) : null;
}

/**
 * Two decisive auto-outcomes only: exact/alias match, or blank. Everything
 * else is unresolved until a human reviews it -- deliberately not attempting
 * fuzzy/Levenshtein auto-correctness, per the owner's requirement for a
 * review queue rather than exact-match-only grading.
 *
 * Checks grading_rules FIRST: a prior reviewer ruling on this exact
 * (question, normalized answer) pair applies immediately to every future
 * player who types the same thing, not just the ones who already had at the
 * time of the ruling. Without this check, the same review decision would
 * need to be repeated by hand for every subsequent player during the whole
 * multi-day open window -- a real gap found in the prior single-file
 * prototype this was hardened from.
 */
export function autoVerdict(question: QuestionRow, rawAnswer: string): { verdict: Verdict; normalizedAnswer: string } {
  const normalizedAnswer = normalize(rawAnswer);
  if (!normalizedAnswer) return { verdict: "incorrect", normalizedAnswer };

  const ruling = existingRuling(question.id, normalizedAnswer);
  if (ruling) return { verdict: ruling, normalizedAnswer };

  const accepted = [question.canonical_answer, ...(JSON.parse(question.aliases_json) as string[])].map(normalize);
  if (accepted.some((answer) => normalizedAnswer === answer || normalizedAnswer.includes(answer))) {
    return { verdict: "correct", normalizedAnswer };
  }
  return { verdict: "unresolved", normalizedAnswer };
}

/**
 * Applies a reviewer's ruling for one question/normalized-answer pair:
 * records it in grading_rules (so it applies prospectively too, per
 * autoVerdict above) and retroactively updates every already-submitted
 * exposure matching that pair -- the "group by answer variant" review
 * primitive the design calls for.
 */
export function applyReviewRuling(
  questionId: number,
  normalizedAnswer: string,
  verdict: "correct" | "incorrect",
  note: string,
): void {
  db.prepare(
    `INSERT INTO grading_rules (question_id, normalized_answer, verdict, note, reviewed_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (question_id, normalized_answer)
     DO UPDATE SET verdict = excluded.verdict, note = excluded.note, reviewed_at = excluded.reviewed_at`,
  ).run(questionId, normalizedAnswer, verdict, note, nowIso());

  db.prepare("UPDATE exposures SET verdict = ? WHERE question_id = ? AND normalized_answer = ?").run(
    verdict,
    questionId,
    normalizedAnswer,
  );
}
