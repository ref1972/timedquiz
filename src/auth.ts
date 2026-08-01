import type { Request, Response, NextFunction } from "express";
import crypto from "node:crypto";
import { config } from "./config.ts";
import { sign, unsign, timingSafeStringEqual } from "./crypto.ts";
import { getAppSetting, setAppSetting } from "./db.ts";
import { findPlayerById, type Player } from "./quiz.ts";

const PLAYER_COOKIE = "pcb_player";
const ADMIN_COOKIE = "pcb_admin";
const WEEK_SECONDS = 7 * 24 * 60 * 60;
const TWELVE_HOURS_SECONDS = 12 * 60 * 60;

function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie ?? "";
  const out: Record<string, string> = {};
  for (const part of header.split(/;\s*/).filter(Boolean)) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[decodeURIComponent(part.slice(0, i))] = decodeURIComponent(part.slice(i + 1));
  }
  return out;
}

function setSignedCookie(res: Response, name: string, value: string, maxAgeSeconds: number): void {
  res.cookie(name, sign(value), {
    httpOnly: true,
    secure: config.appOrigin.startsWith("https:"),
    sameSite: "lax",
    maxAge: maxAgeSeconds * 1000,
    path: "/",
  });
}

export function setPlayerSession(res: Response, playerId: number): void {
  setSignedCookie(res, PLAYER_COOKIE, String(playerId), WEEK_SECONDS);
}

export function setAdminSession(res: Response): void {
  setSignedCookie(res, ADMIN_COOKIE, `admin:${adminSessionVersion()}`, TWELVE_HOURS_SECONDS);
}

export function currentPlayer(req: Request): Player | null {
  const raw = unsign(parseCookies(req)[PLAYER_COOKIE]);
  const id = Number(raw);
  if (!raw || !Number.isSafeInteger(id)) return null;
  return findPlayerById(id);
}

export function isAdmin(req: Request): boolean {
  return unsign(parseCookies(req)[ADMIN_COOKIE]) === `admin:${adminSessionVersion()}`;
}

export function checkAdminPassword(supplied: string): boolean {
  const stored = getAppSetting("admin_password_scrypt");
  if (stored) {
    try {
      const [scheme, saltText, hashText] = stored.split("$");
      if (scheme !== "scrypt" || !saltText || !hashText) return false;
      const expected = Buffer.from(hashText, "base64url");
      const actual = crypto.scryptSync(supplied, Buffer.from(saltText, "base64url"), expected.length);
      return crypto.timingSafeEqual(actual, expected);
    } catch {
      return false;
    }
  }
  return timingSafeStringEqual(supplied, config.adminPassword);
}

export function setAdminPassword(password: string): void {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32);
  setAppSetting("admin_password_scrypt", `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`);
  setAppSetting("admin_session_version", String(adminSessionVersion() + 1));
}

function adminSessionVersion(): number {
  const value = Number(getAppSetting("admin_session_version") ?? "1");
  return Number.isSafeInteger(value) && value > 0 ? value : 1;
}

export function requirePlayer(req: Request, res: Response, next: NextFunction): void {
  const player = currentPlayer(req);
  if (!player) {
    res.status(401).json({ error: "Your invitation session has expired. Reopen your invitation link." });
    return;
  }
  res.locals.player = player;
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!isAdmin(req)) {
    res.redirect("/admin");
    return;
  }
  next();
}
