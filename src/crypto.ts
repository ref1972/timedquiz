import crypto from "node:crypto";
import { config } from "./config.ts";

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

function invitationKey(): Buffer {
  return crypto.createHash("sha256").update(config.invitationEncryptionKey).digest();
}

export function encryptInvitationToken(token: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", invitationKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}

export function decryptInvitationToken(value: string): string {
  const [ivText, tagText, encryptedText] = value.split(".");
  if (!ivText || !tagText || !encryptedText) throw new Error("Invitation token is not recoverable; rotate it first.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", invitationKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedText, "base64url")), decipher.final()]).toString("utf8");
}

export function sign(value: string): string {
  const mac = crypto.createHmac("sha256", config.sessionSecret).update(value).digest("base64url");
  return `${value}.${mac}`;
}

/** Returns the original value if the signature is valid, otherwise null. */
export function unsign(value: string | undefined): string | null {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot < 1) return null;
  const raw = value.slice(0, dot);
  const expected = sign(raw);
  if (expected.length !== value.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(value))) return null;
  return raw;
}

export function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
