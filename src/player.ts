import type { Request, Response, Router as RouterType } from "express";
import { Router } from "express";
import { db } from "./db.ts";
import { sha256 } from "./crypto.ts";
import { currentPlayer, requirePlayer, setPlayerSession } from "./auth.ts";
import { currentAttempt, getStatus, recordDisplayed, saveDraft, serveNext, submitAnswer, type Player } from "./quiz.ts";
import { page, playerPage } from "./views.ts";

export const playerRouter: RouterType = Router();

playerRouter.get("/health", (_req: Request, res: Response) => {
  const dbOk = db.prepare("SELECT 1 AS ok").get();
  res.json({ ok: true, database: dbOk, release: process.env.RELEASE_ID ?? "local" });
});

playerRouter.get("/", (_req: Request, res: Response) => {
  res.send(
    page(
      "Pop Culture Bee",
      `<main class="card"><p class="eyebrow">Trivia Nationals</p><h1>Pop Culture Bee Preliminary Quiz</h1><p>This quiz is available only through a personalized invitation link.</p></main>`,
    ),
  );
});

playerRouter.get("/invite/:token", (req: Request, res: Response) => {
  const tokenHash = sha256(String(req.params.token ?? ""));
  const player = db.prepare("SELECT id FROM players WHERE token_hash = ?").get(tokenHash) as { id: number } | undefined;
  if (!player) {
    res
      .status(404)
      .send(page("Invalid invitation", `<main class="card"><h1>That invitation link is not valid.</h1><p>Please contact Trivia Nationals for help.</p></main>`));
    return;
  }
  setPlayerSession(res, player.id);
  res.redirect("/quiz");
});

playerRouter.get("/quiz", (req: Request, res: Response) => {
  if (!currentPlayer(req)) {
    res.redirect("/");
    return;
  }
  res.send(playerPage());
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
