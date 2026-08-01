import fs from "node:fs";
import path from "node:path";
import express, { type Request, type Response, type NextFunction } from "express";
import { config } from "./config.ts";
import { page } from "./views.ts";
import { playerRouter } from "./player.ts";
import { adminRouter } from "./admin.ts";
import { finalizeStaleSessions } from "./quiz.ts";

const app = express();
app.disable("x-powered-by");
app.use(express.urlencoded({ extended: false, limit: "1mb" }));
app.use(express.json({ limit: "64kb" }));

app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
  next();
});

// Exactly two static files, served from named routes reading a known
// absolute path rather than a static-file middleware -- avoids pulling in a
// dependency purely to serve two files (see pop-culture-bee-quiz-claude's
// README for the specific path-traversal advisories that motivated this).
const publicDir = path.resolve(import.meta.dirname, "..", "public");
app.get("/app.css", (_req: Request, res: Response) => {
  res.type("text/css").send(fs.readFileSync(path.join(publicDir, "app.css"), "utf8"));
});
app.get("/quiz.js", (_req: Request, res: Response) => {
  res.type("application/javascript").send(fs.readFileSync(path.join(publicDir, "quiz.js"), "utf8"));
});

app.use(playerRouter);
app.use(adminRouter);

app.use((req: Request, res: Response) => {
  res.status(404).send(page("Not found", `<main class="card"><h1>Page not found</h1><a href="/">Home</a></main>`));
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(error);
  res
    .status(500)
    .send(page("Unexpected error", `<main class="card"><h1>Something went wrong.</h1><p>Your saved progress has not been intentionally cleared. Please try again.</p></main>`));
});

// Belt-and-suspenders sweep; correctness never depends on this running --
// every read path also calls expireIfNeeded/finalizeStaleSessions lazily.
// This just keeps admin-visible status fresh between page loads.
setInterval(() => {
  try {
    finalizeStaleSessions();
  } catch (error) {
    console.error("finalizeStaleSessions sweep failed", error);
  }
}, 60_000);

const server = app.listen(config.port, config.host, () => {
  console.log(`Pop Culture Bee quiz listening on ${config.appOrigin} (db: ${config.dbPath})`);
});
server.ref();
