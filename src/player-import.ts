import { csvCell, parseCsvRows } from "./question-import.ts";

export interface ImportedPlayer {
  email: string;
  name: string;
  isTest: boolean;
}

export function parsePlayerImport(input: string): ImportedPlayer[] {
  const text = input.replace(/^\uFEFF/, "").trim();
  if (!text) throw new Error("Choose a CSV file or paste player data.");
  const rows = parseCsvRows(text);
  const first = (rows[0] ?? []).map((value) => value.trim().toLowerCase());
  const hasHeader = first.includes("email");
  const headers = hasHeader ? rows.shift()!.map((value) => value.trim().toLowerCase()) : ["email", "name", "test"];
  const emailColumn = headers.indexOf("email");
  const nameColumn = headers.findIndex((value) => ["name", "display_name", "display name"].includes(value));
  const testColumn = headers.findIndex((value) => ["test", "is_test", "is test"].includes(value));
  if (emailColumn < 0) throw new Error("CSV headers must include email. Name and test are optional.");

  return rows.map((row) => ({
    email: (row[emailColumn] ?? "").trim().toLowerCase(),
    name: nameColumn >= 0 ? (row[nameColumn] ?? "").trim() : "",
    isTest: testColumn >= 0 && /^(1|yes|true|test)$/i.test((row[testColumn] ?? "").trim()),
  }));
}

export function playersToCsv(players: ImportedPlayer[]): string {
  const rows = players.map((player) => [player.email, player.name, player.isTest ? "yes" : "no"].map(csvCell).join(","));
  return ["email,name,test", ...rows].join("\r\n") + "\r\n";
}
