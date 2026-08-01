export interface ImportedQuestion {
  position: number;
  category?: string;
  prompt: string;
  answer: string;
  aliases?: string[];
}

export function parseCsvRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell.replace(/\r$/, ""));
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (quoted) throw new Error("A quoted CSV cell was not closed.");
  row.push(cell.replace(/\r$/, ""));
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

export function parseQuestionImport(input: string): ImportedQuestion[] {
  const text = input.replace(/^\uFEFF/, "").trim();
  if (!text) throw new Error("Choose a CSV file or paste question data.");
  if (text.startsWith("[")) return JSON.parse(text) as ImportedQuestion[];

  const rows = parseCsvRows(text);
  const headers = (rows.shift() ?? []).map((value) => value.trim().toLowerCase());
  const column = (names: string[]) => headers.findIndex((header) => names.includes(header));
  const position = column(["position", "number", "#"]);
  const category = column(["category"]);
  const prompt = column(["question", "prompt"]);
  const answer = column(["answer", "canonical_answer", "canonical answer"]);
  const aliases = column(["aliases", "accepted answers", "accepted_answers"]);
  if (position < 0 || prompt < 0 || answer < 0) {
    throw new Error("CSV headers must include position, question, and answer. Category and aliases are optional.");
  }

  return rows.map((row) => ({
    position: Number(row[position]?.trim()),
    category: category >= 0 ? row[category]?.trim() : undefined,
    prompt: row[prompt]?.trim() ?? "",
    answer: row[answer]?.trim() ?? "",
    aliases: aliases >= 0 ? (row[aliases] ?? "").split("|").map((value) => value.trim()).filter(Boolean) : [],
  }));
}

export function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function questionsToCsv(questions: ImportedQuestion[]): string {
  const rows = questions.map((q) => [q.position, q.category ?? "", q.prompt, q.answer, (q.aliases ?? []).join("|")].map(csvCell).join(","));
  return ["position,category,question,answer,aliases", ...rows].join("\r\n") + "\r\n";
}
