import { db, nowIso } from "./db.ts";

export type Verdict = "correct" | "incorrect" | "unresolved";

export interface QuestionRow {
  id: number;
  position: number;
  category: string;
  prompt: string;
  highlighted_text: string;
  canonical_answer: string;
  aliases_json: string;
  answer_is_person: number;
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

/**
 * A single-word accepted answer shorter than this is never matched as a
 * substring -- only exactly, or by a reviewer's ruling. Without this floor a
 * one-letter answer like the ESRB "T" rating graded *any* submission
 * containing a "t" as correct, and "The Who" accepted "I have no idea who".
 * Multi-word answers are exempt: "stephen fry" is specific enough to contain
 * safely even though "fry" alone is not.
 */
const MIN_CONTAINED_ANSWER_LENGTH = 4;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * True when the submitted answer contains the accepted answer as a whole
 * word or phrase -- the "I think it is The Electric Company" case. The
 * boundary check is what separates that from "Kryptonite" being accepted for
 * "Krypto" or "everybody" for "The Body"; anything it rejects falls through
 * to `unresolved` and a human, which is the point of the review queue.
 */
function containsAcceptedAnswer(normalizedAnswer: string, accepted: string): boolean {
  if (!accepted) return false;
  if (!accepted.includes(" ") && accepted.length < MIN_CONTAINED_ANSWER_LENGTH) return false;
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(accepted)}(?![\\p{L}\\p{N}])`, "u").test(normalizedAnswer);
}

function answerWords(value: string): string[] {
  return value.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
}

/**
 * True when this accepted answer is a shorthand built only from words of the
 * canonical answer -- the "Bush" alias on "Kate Bush", or "DiCaprio" on
 * "Leonardo DiCaprio". Editors write these to accept a bare surname, not to
 * accept the surname attached to somebody else.
 */
function isShorthandForCanonical(accepted: string, canonical: string): boolean {
  if (!canonical || accepted === canonical) return false;
  const canonicalWords = new Set(answerWords(canonical));
  const acceptedWords = answerWords(accepted);
  return acceptedWords.length > 0 && acceptedWords.length < canonicalWords.size && acceptedWords.every((word) => canonicalWords.has(word));
}

/** True when the submission introduces no word the canonical answer does not have. */
function staysWithinCanonical(normalizedAnswer: string, canonical: string): boolean {
  const canonicalWords = new Set(answerWords(canonical));
  return answerWords(normalizedAnswer).every((word) => canonicalWords.has(word));
}

function existingRuling(questionId: number, normalizedAnswer: string): Verdict | null {
  const row = db
    .prepare("SELECT verdict FROM grading_rules WHERE question_id = ? AND normalized_answer = ?")
    .get(questionId, normalizedAnswer) as { verdict: string } | undefined;
  return row ? (row.verdict as Verdict) : null;
}

/**
 * Two decisive auto-outcomes only: exact/alias match (or a guarded
 * whole-word containment of one, see containsAcceptedAnswer), or blank.
 * Everything else is unresolved until a human reviews it -- deliberately not
 * attempting fuzzy/Levenshtein auto-correctness, per the owner's requirement
 * for a review queue rather than exact-match-only grading.
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

  const canonical = normalize(question.canonical_answer);
  const accepted = [canonical, ...(JSON.parse(question.aliases_json) as string[]).map(normalize)].filter(Boolean);

  // When the answer is a person, the surname alone is accepted without the
  // editor having to write it out as an alias. It is added as a shorthand, so
  // it inherits exactly the same guard as a hand-written "Bush" alias below.
  if (question.answer_is_person) {
    const words = answerWords(canonical);
    const surname = words[words.length - 1];
    if (words.length > 1 && surname && !accepted.includes(surname)) accepted.push(surname);
  }

  // An exact match always stands, including a bare surname.
  if (accepted.includes(normalizedAnswer)) return { verdict: "correct", normalizedAnswer };

  for (const answer of accepted) {
    if (!containsAcceptedAnswer(normalizedAnswer, answer)) continue;
    // A shorthand ("Bush" for "Kate Bush") may only be *contained* in a
    // submission that adds no word of its own. This is what separates a bare
    // or padded surname from a confidently wrong different person: "bush" and
    // "kate bush" count, "george bush" does not. It goes to the review queue
    // rather than being auto-marked incorrect, because the code cannot tell a
    // wrong person from a misspelled right one ("Katie Bush") and a silent
    // wrong verdict is exactly as unreviewable as a silent correct one.
    if (isShorthandForCanonical(answer, canonical) && !staysWithinCanonical(normalizedAnswer, canonical)) continue;
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
