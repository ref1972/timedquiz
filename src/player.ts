import type { Request, Response, Router as RouterType } from "express";
import { Router } from "express";
import { db } from "./db.ts";
import { sha256 } from "./crypto.ts";
import { currentPlayer, requirePlayer, setPlayerSession } from "./auth.ts";
import { currentAttempt, findPlayerByTokenHash, getStatus, recordDisplayed, saveDraft, serveNext, submitAnswer, type Player } from "./quiz.ts";
import { playableGames } from "./games.ts";
import { playerForGame, playerGameOptions, playerResults, registerPublicPlayer } from "./public-access.ts";
import { getCompletionCopy } from "./completion-copy.ts";
import { page, playerPage, playerResultsPage, publicAccessPage } from "./views.ts";

export const playerRouter: RouterType = Router();
const publicRegistrations = new Map<string, { count: number; resetsAt: number }>();

function registrationRateLimited(ip: string): boolean {
  const now = Date.now();
  for (const [key, value] of publicRegistrations) if (value.resetsAt <= now) publicRegistrations.delete(key);
  const existing = publicRegistrations.get(ip);
  if (!existing) {
    publicRegistrations.set(ip, { count: 1, resetsAt: now + 60 * 60_000 });
    return false;
  }
  existing.count++;
  return existing.count > 10;
}

playerRouter.get("/health", (_req: Request, res: Response) => {
  const dbOk = db.prepare("SELECT 1 AS ok").get();
  res.json({ ok: true, database: dbOk, release: process.env.RELEASE_ID ?? "local" });
});

playerRouter.get("/", (req: Request, res: Response) => {
  const player = currentPlayer(req);
  res.send(publicAccessPage(playableGames(), player, player ? playerGameOptions(player) : []));
});

playerRouter.post("/play/register", (req: Request, res: Response) => {
  if (registrationRateLimited(req.ip ?? "unknown")) return void res.status(429).send(page("Try again later", '<main class="card"><h1>Too many registrations</h1><p>Please try again later.</p></main>'));
  const player = registerPublicPlayer(Number(req.body.gameId), String(req.body.name ?? ""));
  if (!player) return void res.status(400).send(page("Could not register", '<main class="card"><h1>Choose an open game and enter your name.</h1><a class="button" href="/">Return</a></main>'));
  setPlayerSession(res, player.id);
  res.redirect("/quiz");
});

playerRouter.post("/play/game", (req: Request, res: Response) => {
  const current = currentPlayer(req);
  if (!current) return void res.redirect("/");
  const player = playerForGame(current, Number(req.body.gameId));
  if (!player) return void res.status(400).send(page("Game unavailable", '<main class="card"><h1>That game is not open.</h1><a class="button" href="/">Choose another game</a></main>'));
  setPlayerSession(res, player.id);
  res.redirect("/quiz");
});

playerRouter.get("/invite/:token", (req: Request, res: Response) => {
  const tokenHash = sha256(String(req.params.token ?? ""));
  const player = findPlayerByTokenHash(tokenHash);
  if (!player) {
    res
      .status(404)
      .send(page("Invalid invitation", `<main class="card"><h1>That invitation link is not valid.</h1><p>Please contact Trivia Nationals for help.</p></main>`));
    return;
  }
  setPlayerSession(res, player.id);
  res.redirect("/");
});

playerRouter.get("/quiz", (req: Request, res: Response) => {
  if (!currentPlayer(req)) {
    res.redirect("/");
    return;
  }
  res.send(playerPage());
});

playerRouter.get("/results", (req: Request, res: Response) => {
  const player = currentPlayer(req);
  if (!player) return void res.redirect("/");
  res.send(playerResultsPage(player, playerResults(player), getCompletionCopy()));
});

playerRouter.get("/api/state", requirePlayer, (req: Request, res: Response) => {
  const player = res.locals.player as Player;
  res.json(getStatus(player));
});

playerRouter.post("/api/ready", requirePlayer, (req: Request, res: Response) => {
  const player = res.locals.player as Player;
  res.json(serveNext(player));
});

playerRouter.post("/api/displayed", requirePlayer, (req: Request, res: Response) => {
  const player = res.locals.player as Player;
  const attempt = currentAttempt(player.id);
  if (attempt) recordDisplayed(attempt.id, String(req.body.nonce ?? ""));
  res.json({ ok: true });
});

playerRouter.post("/api/draft", requirePlayer, (req: Request, res: Response) => {
  const player = res.locals.player as Player;
  const attempt = currentAttempt(player.id);
  if (!attempt || attempt.status !== "in_progress") {
    res.status(409).json({ error: "No active attempt." });
    return;
  }
  const result = saveDraft(attempt.id, String(req.body.nonce ?? ""), Number(req.body.sequence) || 0, String(req.body.text ?? ""));
  if (!result.ok) {
    res.status(409).json({ error: result.error });
    return;
  }
  res.json({ ok: true });
});

playerRouter.post("/api/submit", requirePlayer, (req: Request, res: Response) => {
  const player = res.locals.player as Player;
  const attempt = currentAttempt(player.id);
  if (!attempt || attempt.status !== "in_progress") {
    res.status(409).json({ error: "No active attempt." });
    return;
  }
  res.json(submitAnswer(attempt.id, String(req.body.nonce ?? ""), String(req.body.text ?? "")));
});
