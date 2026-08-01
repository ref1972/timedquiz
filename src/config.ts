import fs from "node:fs";
import path from "node:path";

function loadDotEnv(): void {
  const filename = path.resolve(".env");
  if (!fs.existsSync(filename)) return;
  for (const line of fs.readFileSync(filename, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && process.env[match[1]!] === undefined) process.env[match[1]!] = match[2]!;
  }
}

loadDotEnv();

function requiredSecret(name: string): string {
  const value = process.env[name];
  if (!value || value.length < 16) {
    throw new Error(`${name} must be set to at least 16 characters (see .env.example).`);
  }
  return value;
}

const isProduction = process.env.NODE_ENV === "production";

export const config = {
  port: Number(process.env.PORT ?? 8080),
  host: process.env.HOST ?? "127.0.0.1",
  appOrigin: process.env.APP_ORIGIN ?? `http://127.0.0.1:${Number(process.env.PORT ?? 8080)}`,
  dbPath: path.resolve(process.env.DB_PATH ?? "data/quiz.db"),
  // Falls back to a random per-boot secret outside production so local dev
  // never needs a .env file; production must set a stable one or every
  // restart invalidates every signed cookie.
  sessionSecret: isProduction
    ? requiredSecret("SESSION_SECRET")
    : (process.env.SESSION_SECRET ?? crypto.randomUUID() + crypto.randomUUID()),
  adminPassword: isProduction
    ? requiredSecret("ADMIN_PASSWORD")
    : (process.env.ADMIN_PASSWORD ?? "local-dev-only-password"),
  invitationEncryptionKey: isProduction
    ? requiredSecret("INVITATION_ENCRYPTION_KEY")
    : (process.env.INVITATION_ENCRYPTION_KEY ?? "local-dev-invitation-encryption-key"),
  emailRelayUrl: process.env.EMAIL_RELAY_URL?.trim() ?? "",
  emailRelaySecret: process.env.EMAIL_RELAY_SECRET?.trim() ?? "",
  // ISO-8601 UTC. Players already in progress at this instant always finish;
  // this only gates *starting* a fresh attempt. Unset locally so the app is
  // playable at any hour during development.
  closesAt: process.env.CLOSES_AT ? Date.parse(process.env.CLOSES_AT) : null,
  questionDurationMs: Number(process.env.QUESTION_DURATION_MS ?? 20_000),
  // Bounded transport allowance: covers normal request latency between the
  // visible deadline and the server receiving a final submit/expiry check.
  // Not advertised to the player and never applied to the *visible* countdown.
  submitGraceMs: Number(process.env.SUBMIT_GRACE_MS ?? 2_000),
  isProduction,
};

export type Config = typeof config;
