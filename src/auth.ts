import type { Request, Response, NextFunction } from "express";
import { config } from "./config.ts";
import { sign, unsign, timingSafeStringEqual } from "./crypto.ts";
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
  setSignedCookie(res, ADMIN_COOKIE, "admin", TWELVE_HOURS_SECONDS);
}

export function currentPlayer(req: Request): Player | null {
  const raw = unsign(parseCookies(req)[PLAYER_COOKIE]);
  const id = Number(raw);
  if (!raw || !Number.isSafeInteger(id)) return null;
  return findPlayerById(id);
}

export function isAdmin(req: Request): boolean {
  return unsign(parseCookies(req)[ADMIN_COOKIE]) === "admin";
}

export function checkAdminPassword(supplied: string): boolean {
  // Pad-free timing-safe compare: both sides must already be plain strings
  // of attacker-uninfluenced length comparison, which timingSafeStringEqual
  // handles by bailing out (safely, non-signaling) on length mismatch.
  return timingSafeStringEqual(supplied, config.adminPassword);
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
