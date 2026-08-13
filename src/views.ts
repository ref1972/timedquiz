import type { AdminAccountRow, AdminQuestionRow, GradingQuestion, GradingVariant, InvitationStats, ReminderStats, PlayerAnswerAttempt, PlayerAnswerRow, ResultRow, RosterStats } from "./admin.ts";
import type { IntroCopy } from "./intro-copy.ts";
import type { InvitationTemplate } from "./invitation-template.ts";
import type { CompletionNotificationSettings } from "./completion-notification.ts";
import type { ReminderTemplate } from "./reminder-template.ts";
import type { SigninTemplate } from "./signin-template.ts";
import type { Game, GameOverview } from "./games.ts";
import type { PlayerGameOption } from "./public-access.ts";
import type { PlayerResults } from "./public-access.ts";
import type { Player } from "./quiz.ts";
import type { CompletionCopy } from "./completion-copy.ts";
import type { Account, AccountHistoryRow } from "./account.ts";
import type { ScoreboardRow } from "./public-access.ts";
import { visiblePromptText } from "./question-import.ts";

function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<script>try{var t=localStorage.getItem('pcb-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}</script>
<link rel="stylesheet" href="/app.css">
</head>
<body>${body}</body>
</html>`;
}

export function adminLoginPage(failed: boolean, next = "/admin/questions"): string {
  return page(
    "Admin sign in",
    `<main class="card narrow">
      <p class="eyebrow">Quiz administration</p>
      <h1>Sign in</h1>
      ${failed ? '<p class="notice">Sign-in failed. Try again.</p>' : ""}
      <form id="adminLoginForm" method="post" action="/admin/login">
        <input id="adminLoginNext" type="hidden" name="next" value="${esc(next)}">
        <label>Password<input name="password" type="password" required autofocus></label>
        <button>Sign in</button>
      </form>
      <script>document.querySelector('#adminLoginForm').addEventListener('submit',function(){var n=document.querySelector('#adminLoginNext');if(location.hash)n.value=n.value.split('#')[0]+location.hash;});</script>
    </main>`,
  );
}

export function playerPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pop Culture Bee Quiz</title>
<script>try{var t=localStorage.getItem('pcb-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}</script>
<link rel="stylesheet" href="/app.css">
</head>
<body>
<button type="button" id="themeToggle" class="theme-toggle" aria-label="Toggle light and dark mode">Dark mode</button>
<main id="app" class="card quiz" aria-live="polite"><p>Loading your quiz…</p></main>
<script src="/prompt-format.js"></script>
<script src="/quiz.js"></script>
</body>
</html>`;
}

export function publicAccessPage(games: Game[], player: Player | null, options: PlayerGameOption[] = [], account: Account | null = null): string {
  const gameForms = player
    ? options.map((option) => `<article class="game-card">
        <p class="eyebrow">Game ${option.game.game_number}</p><h2>${esc(option.game.name)}</h2>
        <p>Status: <strong>${esc(option.status)}</strong></p>
        <form method="post" action="/play/game"><input type="hidden" name="gameId" value="${option.game.id}"><button>${option.status === "completed" ? "View completed game" : option.status === "in progress" ? "Continue game" : "Play this game"}</button></form><p><a href="/scoreboard/${option.game.id}">Scoreboard</a></p>
      </article>`).join("")
    : games.map((game) => `<article class="game-card">
        <p class="eyebrow">Game ${game.game_number}</p><h2>${esc(game.name)}</h2>
        <form method="post" action="/play/register"><input type="hidden" name="gameId" value="${game.id}"><label>Your display name<input name="name" maxlength="100" required autocomplete="name"></label><button>Play this game</button></form><p><a href="/scoreboard/${game.id}">Scoreboard</a></p>
      </article>`).join("");
  return page("Play the Pop Culture Bee", `<main class="card wide public-home">
    <p class="eyebrow">Trivia Nationals</p><h1>Play the Pop Culture Bee</h1>
    <p>${player ? `Welcome, <strong>${esc(player.display_name || "player")}</strong>. Choose a game below; each game keeps its own progress and score.` : "Choose a game and enter the name you want shown with your score. No email address is required."}</p>
    <p>${account ? `<a class="button secondary" href="/account">My account</a>` : `<a class="button secondary" href="/account/login">Email sign in</a>`}</p>
    <div class="game-grid">${gameForms || '<p class="notice">No games are open right now.</p>'}</div>
  </main>`);
}

export function accountLoginPage(sent = false, error = ""): string {
  return page("Email sign in", `<main class="card narrow"><p class="eyebrow">Player account</p><h1>${sent ? "Check your email" : "Sign in without a password"}</h1>${sent ? '<p>If that address can receive mail, a one-time sign-in link is on its way. It expires in 15 minutes.</p>' : `<p>We will email you a secure, one-time sign-in link.</p>${error ? `<p class="notice">${esc(error)}</p>` : ""}<form method="post" action="/account/login"><label>Email<input type="email" name="email" maxlength="254" autocomplete="email" required autofocus></label><button>Email me a sign-in link</button></form>`}<p><a href="/">Back to games</a></p></main>`);
}

export function accountPage(account: Account, history: AccountHistoryRow[]): string {
  const rows = history.map((row) => `<tr><td>${row.gameNumber}</td><td>${esc(row.gameName)}</td><td>${esc(row.status)}</td><td>${row.score === null ? (row.unresolved ? "grading" : "—") : row.score}</td><td>${row.status === "completed" ? `<a href="/account/results/${row.playerId}">Answers</a>` : "—"}</td></tr>`).join("");
  return page("My account", `<main class="card wide"><p class="eyebrow">Player account</p><h1>${esc(account.display_name || account.email)}</h1><p>${esc(account.email)}</p><p><a class="button" href="/">Choose a game</a></p><section class="panel"><h2>Game history</h2><div class="table"><table><thead><tr><th>Game</th><th>Name</th><th>Status</th><th>Score</th><th>Details</th></tr></thead><tbody>${rows || '<tr><td colspan="5">No linked games yet.</td></tr>'}</tbody></table></div></section><form method="post" action="/account/logout"><button class="secondary">Sign out</button></form></main>`);
}

export function scoreboardPage(game: Game, rows: ScoreboardRow[]): string {
  const body = rows.map((row) => `<tr><td>${row.rank}</td><td>${esc(row.displayName)}</td><td>${row.score}</td><td>${(row.answerTimeMs / 1000).toFixed(1)}s</td></tr>`).join("");
  return page(`${game.name} scoreboard`, `<main class="card wide"><p class="eyebrow">Game ${game.game_number}</p><h1>${esc(game.name)} scoreboard</h1><p>Only completed, fully graded entries appear.</p><div class="table"><table><thead><tr><th>Rank</th><th>Player</th><th>Score</th><th>Time</th></tr></thead><tbody>${body || '<tr><td colspan="4">No fully graded scores yet.</td></tr>'}</tbody></table></div><p><a class="button secondary" href="/">Back to games</a></p></main>`);
}

export function playerResultsPage(player: Player, results: PlayerResults | null, copy: CompletionCopy): string {
  if (!results?.ready) return page("Results pending", `<main class="card wide"><p class="eyebrow">Grading in progress</p><h1>${esc(copy.title)}</h1><p class="notice">${esc(copy.pendingMessage)}</p><p><a class="button" href="/results">Check again</a> <a class="button secondary" href="/">${esc(copy.chooserButtonLabel)}</a></p></main>`);
  const rows = results.answers.map((answer) => `<tr><td>${answer.position}</td><td>${esc(answer.category)}</td><td>${esc(visiblePromptText(answer.prompt))}</td><td>${answer.submitted_text ? esc(answer.submitted_text) : '<span class="muted">blank</span>'}</td><td>${answer.included_in_score ? esc(answer.verdict) : "not scored"}</td></tr>`).join("");
  return page("My quiz results", `<main class="admin answer-sheet player-results"><header><p class="eyebrow">${esc(results.gameName)}</p><h1>${esc(player.display_name || "Your results")}</h1><p class="result-score"><strong>${results.score}</strong> correct</p><a class="button secondary" href="/">${esc(copy.chooserButtonLabel)}</a></header><section class="panel"><h2>Your answers</h2><div class="table"><table><thead><tr><th>Q</th><th>Category</th><th>Question</th><th>Your answer</th><th>Result</th></tr></thead><tbody>${rows}</tbody></table></div></section></main>`);
}

export interface AdminPageData {
  questionCount: number;
  closesAt: number | null;
  results: ResultRow[];
  grading: GradingQuestion[];
  unresolvedCount: number;
  questions: AdminQuestionRow[];
  questionsLocked: boolean;
  questionTextEditingEnabled: boolean;
  emailRelayConfigured: boolean;
  invitationStats: InvitationStats;
  reminderStats: ReminderStats;
  rosterStats: RosterStats;
  accounts: AdminAccountRow[];
  showLegacyInvitations: boolean;
  reminderTemplate: ReminderTemplate;
  introCopy: IntroCopy;
  invitationTemplate: InvitationTemplate;
  signinTemplate: SigninTemplate;
  completionNotifications: CompletionNotificationSettings;
  completionCopy: CompletionCopy;
  games: GameOverview[];
  selectedGame: Game;
}

export function questionPreviewPage(question: AdminQuestionRow, total: number, durationSeconds = 25): string {
  const previewData = JSON.stringify({ prompt: question.prompt, highlightedText: question.highlighted_text }).replaceAll("<", "\\u003c");
  const previous = question.position > 1 ? `<a class="button secondary small" href="/admin/preview/${question.position - 1}">Previous</a>` : "";
  const next = question.position < total ? `<a class="button small" href="/admin/preview/${question.position + 1}">Next</a>` : "";
  return page("Preview question " + question.position, `
    <button type="button" id="themeToggle" class="theme-toggle" aria-label="Toggle light and dark mode">Dark mode</button>
    <nav class="preview-nav"><a href="/admin/questions#question-${question.id}">Back to admin editor</a><strong>Admin preview &middot; timer not running</strong><span>${previous}${next}</span></nav>
    <main class="card quiz">
      <div class="play-stage">
        <div class="quizhead"><span>Question ${question.position} of ${total}</span><strong>${durationSeconds.toFixed(1)}</strong></div>
        <p class="category">${esc(question.category)}</p>
        <div class="prompt-stage"><h1 class="prompt" id="previewPrompt"></h1></div>
        <form class="answer-zone" onsubmit="return false"><label for="previewAnswer">Your answer</label><input id="previewAnswer" autocomplete="off"><button type="button" class="submit-answer">Submit Answer</button></form>
        <p class="muted save-status">Preview only &middot; no answer will be saved.</p>
      </div>
    </main>
    <script type="application/json" id="previewData">${previewData}</script>
    <script src="/prompt-format.js"></script>
    <script src="/question-preview.js"></script>`);
}

export function playerAnswersPage(player: { id: number; email: string; display_name: string; is_test: number }, attempts: PlayerAnswerAttempt[], answers: PlayerAnswerRow[]): string {
  const attemptSections = attempts.length ? attempts.map((attempt) => {
    const rows = answers.filter((answer) => answer.attempt_id === attempt.id);
    const score = rows.filter((answer) => answer.included_in_score && answer.verdict === "correct").length;
    const answerTime = rows.reduce((sum, answer) => sum + (answer.included_in_score && answer.submitted_at ? answer.elapsed_ms ?? 0 : 0), 0);
    const answerRows = rows.length ? rows.map((answer) => {
      const accepted = [answer.canonical_answer, ...(JSON.parse(answer.aliases_json) as string[])];
      return `<tr>
        <td>${answer.position}</td><td>${esc(answer.category)}</td><td>${esc(visiblePromptText(answer.prompt))}</td>
        <td>${answer.submitted_at ? (answer.submitted_text ? esc(answer.submitted_text) : '<span class="muted">blank</span>') : '<span class="muted">in progress</span>'}</td>
        <td>${accepted.map((item) => esc(item)).join(" · ")}</td><td>${esc(answer.verdict ?? "pending")}</td>
        <td>${answer.elapsed_ms === null ? "—" : (answer.elapsed_ms / 1000).toFixed(1) + "s"}</td><td>${esc(answer.finalized_reason ?? "—")}</td>
      </tr>`;
    }).join("") : '<tr><td colspan="8">No questions have been served for this attempt.</td></tr>';
    return `<section class="panel answer-attempt"><h2>Attempt ${attempt.generation} <span class="status-pill">${esc(attempt.status)}</span></h2>
      <p>${score} correct &middot; ${(answerTime / 1000).toFixed(1)}s answer time &middot; started ${esc(new Date(attempt.started_at).toLocaleString())}${attempt.restart_reason ? ` &middot; restart reason: ${esc(attempt.restart_reason)}` : ""}</p>
      <div class="table"><table><thead><tr><th>Q</th><th>Category</th><th>Question</th><th>Submitted</th><th>Counted correct</th><th>Verdict</th><th>Time</th><th>Finalized</th></tr></thead><tbody>${answerRows}</tbody></table></div></section>`;
  }).join("") : '<section class="panel"><p>This player has not started an attempt.</p></section>';
  return page("Answers for " + (player.display_name || player.email), `<main class="admin answer-sheet"><header><p class="eyebrow">Player answer sheet</p><h1>${esc(player.display_name || player.email)}</h1><p>${esc(player.email)}${player.is_test ? " &middot; test account" : ""}</p><a class="button secondary" href="/admin/progress">Back to Progress</a></header><div class="notice"><strong>Answer time:</strong> sum of elapsed question time for every finalized scored question, regardless of verdict. Ready screens and breaks are excluded.</div>${attemptSections}</main>`);
}

export type AdminSection = "games" | "questions" | "players" | "progress" | "review";

/**
 * One answer variant. Every player who typed the same thing shares one row and
 * one decision, because a ruling is stored per (question, normalized answer)
 * and applies to all of them -- retroactively and to anyone who types it
 * later.
 */
function gradingVariantRow(question: GradingQuestion, variant: GradingVariant): string {
  const label = variant.normalized_answer ? esc(variant.sample_text || variant.normalized_answer) : '<span class="muted">(blank)</span>';
  const counts = [
    `${variant.players} player${variant.players === 1 ? "" : "s"}`,
    variant.test_players && variant.real_players ? `${variant.real_players} real` : variant.test_players ? "test only" : "",
  ].filter(Boolean).join(" · ");
  const badge = variant.ruling
    ? `<span class="grade-badge manual">ruled ${esc(variant.ruling)}</span>`
    : variant.verdict === "mixed"
      ? '<span class="grade-badge mixed">mixed verdicts</span>'
      : '<span class="grade-badge auto">auto</span>';
  const button = (verdict: "correct" | "incorrect", text: string, className: string) =>
    `<form method="post" action="/admin/review">
      <input type="hidden" name="questionId" value="${question.question_id}">
      <input type="hidden" name="answer" value="${esc(variant.normalized_answer)}">
      <input type="hidden" name="note" value="${esc(variant.note ?? "")}">
      <button class="small ${className}" name="verdict" value="${verdict}">${text}</button>
    </form>`;
  // Whichever way this answer currently counts, the opposite action is always
  // one click away -- including on answers the grader decided by itself.
  const actions =
    variant.verdict === "correct"
      ? button("incorrect", "Reject", "reject")
      : variant.verdict === "incorrect"
        ? button("correct", "Accept", "accept")
        : `${button("correct", "Correct", "accept")}${button("incorrect", "Incorrect", "reject")}`;
  return `<div class="grade-row ${esc(variant.verdict)}">
    <div class="grade-answer"><strong>${label}</strong>${badge}</div>
    <div class="grade-meta"><span title="${esc(variant.who)}">${esc(counts)}</span>${variant.note ? `<span class="muted">${esc(variant.note)}</span>` : ""}</div>
    <div class="grade-actions">${actions}</div>
  </div>`;
}

function gradingQuestionSection(question: GradingQuestion): string {
  const tier = (verdicts: GradingVariant["verdict"][]) => question.variants.filter((v) => verdicts.includes(v.verdict));
  const needsReview = tier(["unresolved", "mixed"]);
  const incorrect = tier(["incorrect"]);
  const correct = tier(["correct"]);
  const rows = (list: GradingVariant[]) => list.map((variant) => gradingVariantRow(question, variant)).join("");
  const percent = question.answered ? Math.round((question.correct / question.answered) * 100) : 0;

  const disclosure = (list: GradingVariant[], summary: string, className: string) =>
    list.length
      ? `<details class="grade-tier ${className}"><summary>${list.length} ${summary}</summary><div class="grade-rows">${rows(list)}</div></details>`
      : "";

  return `<section class="grade-question" id="grade-q${question.position}">
    <header>
      <h3>Question ${question.position} <span class="muted">${esc(question.category)}</span></h3>
      <p class="grade-accepted">Counted correct: ${question.accepted.map((answer) => `<strong>${esc(answer)}</strong>`).join('<span aria-hidden="true"> · </span>')}${question.answer_is_person ? '<span class="grade-badge person">person</span>' : ""}</p>
      <p class="grade-stat">${question.correct} of ${question.answered} correct${question.answered ? ` (${percent}%)` : ""}${question.unresolved ? ` &middot; <strong>${question.unresolved} awaiting review</strong>` : ""}</p>
    </header>
    ${needsReview.length ? `<div class="grade-rows">${rows(needsReview)}</div>` : ""}
    ${disclosure(incorrect, `counted incorrect`, "incorrect")}
    ${disclosure(correct, `counted correct`, "correct")}
    ${question.answered ? "" : '<p class="muted">No answers submitted yet.</p>'}
  </section>`;
}

export function adminPage(data: AdminPageData, section: AdminSection): string {
  const closesLabel = data.closesAt
    ? `cutoff ${new Date(data.closesAt).toLocaleString("en-US", { timeZone: "America/Chicago", timeZoneName: "short" })}`
    : "always open";
  const gameRows = data.games.map((game) => `<tr${game.id === data.selectedGame.id ? ' class="selected-game"' : ""}>
      <td>${game.game_number}</td>
      <td>${esc(game.name)}${game.is_active ? ' <span class="status-pill">email game</span>' : ""}</td>
      <td>${game.onChooser ? '<strong class="on-chooser">Public</strong>' : `<span class="muted">Off chooser</span><br><span class="muted">${esc(game.chooserReason)}</span>`}</td>
      <td>${game.questionCount}/${game.expected_question_count}</td>
      <td>${game.closes_at ? esc(new Date(game.closes_at).toLocaleString("en-US", { timeZone: "America/Chicago", timeZoneName: "short" })) : "always open"}</td>
      <td>${game.playerCount} players<br>${game.attemptCount} attempts</td>
      <td class="game-row-actions">
        ${game.id === data.selectedGame.id ? '<span class="muted">Selected</span>' : `<form method="post" action="/admin/game/select"><input type="hidden" name="gameId" value="${game.id}"><button class="small secondary">Select</button></form>`}
        <a class="button small secondary" href="/scoreboard/${game.id}" target="_blank" rel="noopener">Scoreboard</a>
      </td>
    </tr>`).join("");
  const selected = data.games.find((game) => game.id === data.selectedGame.id);
  const progressCards = data.results
    .map((p) => {
      // A public player has no invitation to report and nothing to rotate --
      // their session is the whole identity -- so that column becomes how they
      // joined and whether an account now vouches for them.
      const origin = p.is_public
        ? `<p><strong>Joined</strong><br>${p.account_id ? "Public player · signed in" : "Public player · guest"}</p>`
        : `<p><strong>Invitation</strong><br>${p.is_test ? "Test account — use the legacy test send" : p.invite_sent_at ? `sent ${esc(new Date(p.invite_sent_at).toLocaleString())}` : p.token_ciphertext ? (p.invite_last_error ? `paused: ${esc(p.invite_last_error)}` : "not sent") : "rotate required"}</p>`;
      const rotate = p.is_public ? "" : `<form method="post" action="/admin/player/${p.id}/rotate-invitation"><button class="small secondary">Rotate link</button></form>`;
      return `<article class="progress-card" data-test-player="${p.is_test ? "1" : "0"}">
        <header><div><h3>${esc(p.display_name || p.email)}</h3><p>${esc(p.email)}</p></div><span class="status-pill">${esc(p.status ?? "not started")}${p.is_test ? " · test" : p.is_public ? " · public" : ""}</span></header>
        <dl class="progress-stats"><div><dt>Score</dt><dd>${p.score}</dd></div><div><dt>Answer time</dt><dd>${(p.answer_time_ms / 1000).toFixed(1)}s</dd></div></dl>
        <div class="progress-details"><p><strong>Completion email</strong><br>${p.completion_notified_at ? `sent ${esc(new Date(p.completion_notified_at).toLocaleString())}` : p.completion_notification_error ? `failed: ${esc(p.completion_notification_error)}` : p.status === "completed" && p.completion_notification_started_at ? "send outcome unknown" : "—"}</p>${origin}</div>
        <div class="progress-actions"><a class="button small secondary" href="/admin/player/${p.id}/answers">View answers</a>${rotate}<form class="restart-form" method="post" action="/admin/restart"><input type="hidden" name="playerId" value="${p.id}"><input name="reason" aria-label="Restart reason for ${esc(p.display_name || p.email)}" placeholder="Restart reason" required><button class="small">Grant restart</button></form></div>
      </article>`;
    })
    .join("");
  const answeredQuestions = data.grading.filter((question) => question.answered > 0);
  const gradingSections = answeredQuestions.length
    ? answeredQuestions.map(gradingQuestionSection).join("")
    : "<p>No answers have been submitted yet.</p>";
  const gradingJump = answeredQuestions.length
    ? `<nav class="grade-jump" aria-label="Jump to question">${answeredQuestions
        .map((question) => `<a href="#grade-q${question.position}" class="${question.unresolved ? "has-unresolved" : ""}">${question.position}</a>`)
        .join("")}</nav>`
    : "";
  const questionForms = data.questions.map((q) => {
    const aliases = (JSON.parse(q.aliases_json) as string[]).join(", ");
    const textEditable = !data.questionsLocked || data.questionTextEditingEnabled;
    return `<div class="question-block" id="question-${q.id}">
    <form class="question-editor" method="post" action="/admin/question/${q.id}">
      <div class="question-number">${q.position}</div>
      <label>Category<input name="category" value="${esc(q.category)}" required ${textEditable ? "" : "disabled"}></label>
      <label>Question <span class="muted">(*italics*)</span><textarea class="question-prompt" name="prompt" rows="3" required ${textEditable ? "" : "disabled"}>${esc(q.prompt)}</textarea>${textEditable ? '<button class="small secondary italic-button" type="button">Italicize selection</button>' : ""}</label>
      <label>Highlighted text <span class="muted">(optional)</span><input name="highlightedText" value="${esc(q.highlighted_text)}" ${data.questionsLocked ? "disabled" : ""}></label>
      <label>Answer<input name="answer" value="${esc(q.canonical_answer)}" required ${data.questionsLocked ? "disabled" : ""}></label>
      <label>Aliases <span class="muted">(comma or line separated)</span><input name="aliases" value="${esc(aliases)}" ${data.questionsLocked ? "disabled" : ""}></label>
      <div class="question-actions">${textEditable ? '<button class="small">Save question</button>' : ""}<a class="button small secondary" href="/admin/preview/${q.position}" target="_blank" rel="noopener">Preview</a></div>
    </form>
    <form class="question-grading" method="post" action="/admin/question/${q.id}/grading">
      <label class="checkbox"><input type="checkbox" name="answerIsPerson" value="1" ${q.answer_is_person ? "checked" : ""}> Answer is a person’s name <span class="muted">(accepts the surname alone; sends that surname behind a different first name to review)</span></label>
      <button class="small secondary">Save grading</button>
    </form>
    </div>`;
  }).join("");

  return page(
    "Quiz admin",
    `<main class="admin">
      <header>
        <p class="eyebrow">Trivia Nationals</p>
        <h1>Game ${data.selectedGame.game_number}: ${esc(data.selectedGame.name)}</h1>
        <p>${data.questionCount}/${data.selectedGame.expected_question_count} questions &middot; ${selected?.onChooser ? "public" : "not public"} &middot; ${esc(closesLabel)} &middot; release ${esc(process.env.RELEASE_ID ?? "local")}</p>
      </header>
      <nav class="admin-nav" aria-label="Quiz administration">
        <a href="/admin/games" ${section === "games" ? 'aria-current="page"' : ""}>Games</a>
        <a href="/admin/questions" ${section === "questions" ? 'aria-current="page"' : ""}>Questions &amp; Answers</a>
        <a href="/admin/players" ${section === "players" ? 'aria-current="page"' : ""}>Players</a>
        <a href="/admin/progress" ${section === "progress" ? 'aria-current="page"' : ""}>Progress</a>
        <a href="/admin/review" ${section === "review" ? 'aria-current="page"' : ""}>Grading${data.unresolvedCount ? ` (${data.unresolvedCount})` : ""}</a>
      </nav>

      <section class="panel game-selector" id="games" ${section === "games" ? "" : "hidden"}>
        <h2>Games</h2>
        <p>Anyone can play a game shown as <strong>Public</strong>: it appears on the home page chooser at <a href="/" target="_blank" rel="noopener">the public site</a>. A game is public when it is open — no cutoff, or a cutoff still in the future — and its question bank is complete. Questions, players, progress, grading, and exports on the other screens belong only to the <em>selected</em> game.</p>
        <div class="table"><table>
          <thead><tr><th>#</th><th>Name</th><th>Public</th><th>Questions</th><th>Cutoff</th><th>Activity</th><th></th></tr></thead>
          <tbody>${gameRows}</tbody>
        </table></div>
      </section>

      <section class="panel" id="game-settings" ${section === "games" ? "" : "hidden"}>
        <h2>Game ${data.selectedGame.game_number}: ${esc(data.selectedGame.name)}</h2>
        <p>${selected?.onChooser ? "This game is <strong>open to the public</strong> right now." : `This game is <strong>not on the public chooser</strong>${selected?.chooserReason ? ` — ${esc(selected.chooserReason)}` : ""}.`}</p>
        <form method="post" action="/admin/game/${data.selectedGame.id}/settings" class="form-grid">
          <label>Game name<input name="name" value="${esc(data.selectedGame.name)}" maxlength="160" required></label>
          <label>Questions required<input type="number" name="expectedQuestionCount" min="1" max="50" value="${data.selectedGame.expected_question_count}" required></label>
          <button>Save game details</button>
        </form>
        <p class="muted">A game reaches the public chooser only when its bank holds exactly this many questions, which is what keeps a half-imported game private.</p>

        <h3>Public availability</h3>
        <div class="game-availability">
          <form method="post" action="/admin/game/${data.selectedGame.id}/cutoff" onsubmit="return confirm('Open Game ${data.selectedGame.game_number} to the public with no cutoff?')"><input type="hidden" name="action" value="open"><button ${data.selectedGame.closes_at ? "" : "disabled"}>Open with no cutoff</button></form>
          <form method="post" action="/admin/game/${data.selectedGame.id}/cutoff" onsubmit="return confirm('Close Game ${data.selectedGame.game_number} now? It leaves the public chooser immediately; players already answering a question still finish.')"><input type="hidden" name="action" value="close"><button class="secondary" ${selected?.onChooser ? "" : "disabled"}>Close now</button></form>
          <form method="post" action="/admin/game/${data.selectedGame.id}/cutoff"><input type="hidden" name="action" value="schedule"><label>Scheduled cutoff (Central time)<input type="datetime-local" name="closesAt" required></label><button class="secondary">Save cutoff</button></form>
        </div>
        <p class="muted">Closing changes nothing but availability: every player, attempt, answer, and scoreboard row is kept, and an attempt already in progress is allowed to finish.</p>

        <h3>Retire this game</h3>
        <form method="post" action="/admin/game/${data.selectedGame.id}/archive" onsubmit="return confirm('Archive Game ${data.selectedGame.game_number}? It is renamed and closed, leaving the public chooser. Nothing is deleted.')"><button class="secondary">Archive game</button></form>
        <p class="muted">Archiving marks the name and closes the game. It never deletes an attempt or an answer.</p>

        <h3>Legacy email game</h3>
        <p>${data.selectedGame.is_active ? "This is the active game for legacy invitation and reminder email." : "Invitation and reminder batches are restricted to the active email game, which this is not."} This flag does <strong>not</strong> affect who can play — public access is the cutoff and question count above.</p>
        ${data.selectedGame.is_active ? "" : `<form method="post" action="/admin/game/activate" onsubmit="return confirm('Make Game ${data.selectedGame.game_number} the active game for legacy invitation and reminder email? This does not change public access.')"><input type="hidden" name="gameId" value="${data.selectedGame.id}"><button class="secondary">Make this the legacy email game</button></form>`}
      </section>

      <section class="panel" id="new-game" ${section === "games" ? "" : "hidden"}>
        <h2>Create a game</h2>
        <form method="post" action="/admin/game/create" class="form-grid">
          <label>Game name<input name="name" maxlength="160" required></label>
          <label>Questions required<input type="number" name="expectedQuestionCount" min="1" max="50" value="50" required></label>
          <label>Cutoff (Central time) <span class="muted">(optional)</span><input type="datetime-local" name="closesAt"></label>
          <button>Create game</button>
        </form>
        <p class="muted">Leave the cutoff empty for a game that stays open until you close it. A new game is selected immediately but reaches the public chooser only once its question bank is complete.</p>
      </section>

      <section class="panel" id="roster" ${section === "players" ? "" : "hidden"}>
        <h2>Who is playing</h2>
        <p>Players in <strong>Game ${data.selectedGame.game_number}</strong>. Anyone can join a public game with a display name alone; an email account is optional and only links a person's history across games.</p>
        <div class="invite-summary" aria-label="Player roster">
          <div><strong>${data.rosterStats.guests}</strong><span>public players</span></div>
          <div><strong>${data.rosterStats.linkedAccounts}</strong><span>linked to an account</span></div>
          <div><strong>${data.rosterStats.invited}</strong><span>invited (legacy)</span></div>
          <div><strong>${data.rosterStats.test}</strong><span>test</span></div>
        </div>
        <p><a class="button secondary" href="/admin/progress">See every player and score in Progress</a></p>
      </section>

      <section class="panel" id="accounts" ${section === "players" ? "" : "hidden"}>
        <h2>Player accounts</h2>
        <p>Passwordless accounts across every game. An account exists only because somebody proved they can read that mailbox, so this view is read-only — there is nothing here for an administrator to create or reset.</p>
        <div class="table"><table>
          <thead><tr><th>Email</th><th>Created</th><th>Last sign-in</th><th>Linked games</th></tr></thead>
          <tbody>${data.accounts.map((account) => `<tr><td>${esc(account.email)}</td><td>${esc(new Date(account.created_at).toLocaleDateString())}</td><td>${account.last_login_at ? esc(new Date(account.last_login_at).toLocaleString()) : '<span class="muted">never</span>'}</td><td>${account.linked_players ? esc(account.linked_games ?? "") : '<span class="muted">none</span>'}</td></tr>`).join("") || '<tr><td colspan="4">No player has created an account yet.</td></tr>'}</tbody>
        </table></div>
      </section>

      <section class="panel" id="signin-template" ${section === "players" ? "" : "hidden"}>
        <h2>Sign-in email</h2>
        <p>The message sent when a player asks for a sign-in link. Use <code>{{link}}</code> for their one-time link, which expires in 15 minutes and works once.</p>
        <form method="post" action="/admin/signin-template">
          <label>Subject<input name="subject" value="${esc(data.signinTemplate.subject)}" maxlength="200" required></label>
          <label>Message body<textarea name="body" rows="8" maxlength="10000" required>${esc(data.signinTemplate.body)}</textarea></label>
          <button>Save sign-in email</button>
        </form>
        <p class="muted"><code>{{link}}</code> is required. Saving this template does not send anything. There is deliberately no name placeholder: the person requesting a link has not proved who they are yet.</p>
      </section>

      <section class="panel" id="player-intro" ${section === "players" ? "" : "hidden"}>
        <h2>Player intro</h2>
        <p>Edit the wording players see before they begin. Timing, question count, abandonment behavior, and scoring are still enforced by the application regardless of this copy.</p>
        <form method="post" action="/admin/intro">
          <label>Eyebrow<input name="eyebrow" value="${esc(data.introCopy.eyebrow)}" maxlength="100" required></label>
          <label>Main title<input name="title" value="${esc(data.introCopy.title)}" maxlength="160" required></label>
          <label>Introductory instructions<textarea name="instructions" rows="3" maxlength="1000" required>${esc(data.introCopy.instructions)}</textarea></label>
          <label>Ready button label<input name="buttonLabel" value="${esc(data.introCopy.buttonLabel)}" maxlength="100" required></label>
          <label>Score / advancement text<textarea name="advancement" rows="4" maxlength="1500" required>${esc(data.introCopy.advancement)}</textarea></label>
          <button>Save player intro</button>
          <a class="button secondary" href="/quiz" target="_blank" rel="noopener">Preview player screen</a>
        </form>
      </section>

      <section class="panel" ${section === "questions" ? "" : "hidden"}>
        <h2>Import questions</h2>
        <p>Download the current question bank, edit it in Excel or Google Sheets, and upload the CSV. Keep the header row; wrap titles in <code>*asterisks*</code> for italics, use <code>highlighted_text</code> for an optional gold phrase, and separate multiple accepted aliases with <code>|</code>. Set <code>person</code> to <code>yes</code> when the answer is someone’s name, which accepts the surname on its own and sends that surname behind a different first name to review. Import locks after the first attempt starts.</p>
        <p><a class="button secondary" href="/admin/questions.csv">Download current questions CSV</a></p>
        <form method="post" action="/admin/questions">
          <label>Question CSV<input id="questionCsvFile" type="file" accept=".csv,text/csv"></label>
          <label>CSV preview or pasted CSV<textarea id="questionImportData" name="questions" rows="7" required placeholder="position,category,question,highlighted_text,answer,aliases,person"></textarea></label>
          <button>Validate and import ${data.selectedGame.expected_question_count} questions</button>
        </form>
        <p class="muted">JSON imports are still accepted for compatibility.</p>
      </section>

      <section class="panel" id="questions" ${section === "questions" ? "" : "hidden"}>
        <h2>Edit questions</h2>
        ${data.questionsLocked ? `<div class="notice edit-unlock"><p><strong>Question content is frozen because a real participant has started.</strong> You can temporarily unlock category and question wording. Answers, aliases, highlighted text, and scoring remain locked.</p><form method="post" action="/admin/question-text-editing" onsubmit="return ${data.questionTextEditingEnabled ? "true" : "confirm('Unlock category and question wording for editing? Changes will affect what future players see.')"}"><input type="hidden" name="enabled" value="${data.questionTextEditingEnabled ? "0" : "1"}"><button class="small ${data.questionTextEditingEnabled ? "secondary" : ""}">${data.questionTextEditingEnabled ? "Turn editing off" : "Turn editing on"}</button></form></div>` : "<p>Edit the category, question, optional gold-highlighted phrase, canonical answer, or accepted aliases. Test-player activity does not lock individual edits.</p>"}
        <div class="question-list">${questionForms}</div>
      </section>

      ${data.showLegacyInvitations ? `<section class="panel legacy-invitations" ${section === "players" ? "" : "hidden"}>
      <details>
      <summary><h2>Invitations and reminders <span class="status-pill">legacy</span></h2></summary>
      <p>Personalized invitation links predate public access and are no longer how players reach a game — anyone can now join an open game from the home page. These tools still work in full for a private cohort, and every invitation link ever issued still opens its game.</p>

      <section class="panel" id="players">
        <p class="step-label">Step 1</p>
        <h2>Prepare the player list</h2>
        <p>Download the current list, edit it in Excel or Google Sheets, then upload the CSV. Required column: <code>email</code>. Optional columns: <code>name</code> and <code>test</code> (<code>yes</code> or <code>no</code>).</p>
        <p><a class="button secondary" href="/admin/players.csv">Download current players CSV</a></p>
        <form method="post" action="/admin/players">
          <label>Player CSV<input id="playerCsvFile" type="file" accept=".csv,text/csv"></label>
          <label>CSV preview or pasted CSV<textarea id="playerImportData" name="players" rows="7" required placeholder="email,name,test"></textarea></label>
          <button>Validate and import players</button>
        </form>
        <p class="muted">Importing adds new players and updates the name/test flag for matching email addresses. It never deletes players, resets attempts, or sends email.</p>
      </section>

      <section class="panel" id="invitation-template">
        <h2>Invitation email</h2>
        <p>Edit the subject and message used by both test sends and real invitation batches. Use <code>{{name}}</code> for the player’s name and <code>{{link}}</code> for their personalized link.</p>
        <form method="post" action="/admin/invitation-template">
          <label>Subject<input name="subject" value="${esc(data.invitationTemplate.subject)}" maxlength="200" required></label>
          <label>Message body<textarea name="body" rows="12" maxlength="10000" required>${esc(data.invitationTemplate.body)}</textarea></label>
          <button>Save invitation email</button>
        </form>
        <p class="muted"><code>{{link}}</code> is required. Test messages automatically add <code>[TEST]</code> to the subject. Always use Step 3 below after editing.</p>
      </section>

      <section class="panel" id="invitations">
        <h2>Send player invitations</h2>
        <div class="invite-summary" aria-label="Invitation status">
          <div><strong>${data.invitationStats.realPlayers}</strong><span>real players</span></div>
          <div><strong>${data.invitationStats.sent}</strong><span>sent</span></div>
          <div><strong>${data.invitationStats.ready}</strong><span>ready to send</span></div>
          <div><strong>${data.invitationStats.needsAttention}</strong><span>need attention</span></div>
        </div>
        <p class="notice">${data.emailRelayConfigured ? "Workspace is connected. Nothing sends automatically: check quota, send yourself a test, then deliberately send each batch." : "Workspace is not connected. Configure the relay before attempting email."}</p>
        <div class="invitation-steps">
          <div class="action-card"><p class="step-label">Step 2</p><h3>Check capacity</h3><p>Check the configured Workspace relay’s available sending capacity before sending.</p><form method="post" action="/admin/invitations/quota"><button ${data.emailRelayConfigured ? "" : "disabled"}>Check email capacity</button></form></div>
          <div class="action-card"><p class="step-label">Step 3</p><h3>Send a test player’s link</h3><p>Enter the exact email of an imported test player. The system will never substitute another player’s link.</p><form method="post" action="/admin/invitations/test"><label>Test player email<input type="email" name="email" placeholder="you@example.com" required></label><button ${data.emailRelayConfigured && data.selectedGame.is_active ? "" : "disabled"}>Send test email</button></form></div>
          <div class="action-card"><p class="step-label">Step 4</p><h3>Send the next five</h3><p>Sends only unsent real players, in order. Repeat after each successful batch.</p><form method="post" action="/admin/invitations/send-batch" onsubmit="return confirm('Send up to 5 real player invitations now? This will email actual players.')"><button class="send-real" ${data.emailRelayConfigured && data.selectedGame.is_active && data.invitationStats.ready ? "" : "disabled"}>Send next 5 real invitations</button></form></div>
        </div>
        <p class="muted">Safety behavior: the batch stops at the first failure or quota pause. That recipient remains unsent for retry, and there is no unreliable fallback mailer.</p>
      </section>

      <section class="panel" id="reminder-template">
        <h2>Reminder email</h2>
        <p>Edit the subject and message used for incomplete-player reminders. Use <code>{{name}}</code> for the player’s name and <code>{{link}}</code> for their personalized link.</p>
        <form method="post" action="/admin/reminder-template">
          <label>Subject<input name="subject" value="${esc(data.reminderTemplate.subject)}" maxlength="200" required></label>
          <label>Message body<textarea name="body" rows="10" maxlength="10000" required>${esc(data.reminderTemplate.body)}</textarea></label>
          <button>Save reminder email</button>
        </form>
        <p class="muted"><code>{{link}}</code> is required. Saving this template does not send email.</p>
      </section>

      <section class="panel" id="reminders">
        <h2>Send quiz reminders</h2>
        <p>Send one reminder to each invited real player who has not completed the quiz. Each recipient receives the saved reminder template above with their own personalized link.</p>
        <div class="invite-summary" aria-label="Reminder status">
          <div><strong>${data.reminderStats.eligible}</strong><span>eligible now</span></div>
          <div><strong>${data.reminderStats.sent}</strong><span>already reminded</span></div>
          <div><strong>${data.reminderStats.needsAttention}</strong><span>need attention</span></div>
        </div>
        <form method="post" action="/admin/reminders/send" onsubmit="return confirm('Send reminder email to ${data.reminderStats.eligible} incomplete real player${data.reminderStats.eligible === 1 ? "" : "s"} now?')"><button class="send-real" ${data.emailRelayConfigured && data.selectedGame.is_active && data.reminderStats.eligible ? "" : "disabled"}>Send ${data.reminderStats.eligible} reminder${data.reminderStats.eligible === 1 ? "" : "s"}</button></form>
        <p class="muted">Test players, completed players, players who were never invited, and players already sent this reminder are skipped. The send starts only if relay capacity covers the entire group and stops at the first failure. Public players are never included.</p>
      </section>
      </details>
      </section>` : ""}

      <section class="panel" ${section === "progress" ? "" : "hidden"}>
        <h2>Progress and results</h2>
        <p><a class="button" href="/admin/results.csv">Download real results CSV</a> <a class="button secondary" href="/admin/test-results.csv">Download test results CSV</a></p>
        <p class="muted">The two files remain separate so rehearsal accounts never appear in the real rankings.</p>
        <label class="progress-filter"><input id="showTestPlayers" type="checkbox" checked> Show test players <span id="testPlayerCount" class="muted">(${data.results.filter((player) => player.is_test).length})</span></label>
        <div class="progress-list">${progressCards || "<p>No players have been imported.</p>"}</div>
      </section>

      <section class="panel" id="completion-notifications" ${section === "progress" ? "" : "hidden"}>
        <h2>Completion notifications</h2>
        <p>Send one admin email when a player submits all answers. Each attempt is claimed before sending so completion-page refreshes cannot create duplicates.</p>
        <form method="post" action="/admin/completion-notifications">
          <label>Notification email<input type="email" name="recipient" value="${esc(data.completionNotifications.recipient)}" placeholder="you@example.com"></label>
          <label><input type="checkbox" name="enabled" value="1" ${data.completionNotifications.enabled ? "checked" : ""}> Email me when an attempt is completed</label>
          <label>Who counts<select name="scope">
            <option value="invited" ${data.completionNotifications.scope === "invited" ? "selected" : ""}>Invited and test players only</option>
            <option value="all" ${data.completionNotifications.scope === "all" ? "selected" : ""}>Everyone, including public players</option>
          </select></label>
          <button>Save completion notifications</button>
        </form>
        <p class="muted">The message includes the player’s type, score, answer time, completion time, and a link to their admin answer sheet. <strong>Everyone</strong> means one email per completion on an open game, so it is limited by the same Workspace relay quota as any other send — leave it on invited players unless you want that volume.</p>
      </section>

      <section class="panel" id="completion-copy" ${section === "players" ? "" : "hidden"}>
        <h2>Player completion screen</h2>
        <p>Edit the text players see after finishing. Scores and submitted answers remain unavailable until every answer in that attempt has a final correct or incorrect verdict.</p>
        <form method="post" action="/admin/completion-copy">
          <label>Heading<input name="title" value="${esc(data.completionCopy.title)}" maxlength="160" required></label>
          <label>Completion message<textarea name="message" rows="4" maxlength="1500" required>${esc(data.completionCopy.message)}</textarea></label>
          <label>Grading-pending message<textarea name="pendingMessage" rows="4" maxlength="1500" required>${esc(data.completionCopy.pendingMessage)}</textarea></label>
          <label>Results button<input name="resultsButtonLabel" value="${esc(data.completionCopy.resultsButtonLabel)}" maxlength="100" required></label>
          <label>Game chooser button<input name="chooserButtonLabel" value="${esc(data.completionCopy.chooserButtonLabel)}" maxlength="100" required></label>
          <button>Save completion screen</button>
        </form>
      </section>

      <section class="panel" id="review" ${section === "review" ? "" : "hidden"}>
        <h2>Grading</h2>
        <p>Every distinct answer given to every question, grouped by question. Answers awaiting a decision are listed first; answers already counted correct or incorrect are collapsed but always one click from being changed — including the ones the grader decided on its own.</p>
        <p class="muted">Each decision applies to every player who typed the same answer, and to anyone who types it later. Identical answers share one row.</p>
        ${gradingJump}
        ${gradingSections}
      </section>

      <section class="panel" id="security" ${section === "players" ? "" : "hidden"}>
        <h2>Change admin password</h2>
        <p>Changing the password signs out every existing administrator session. A long, unique password is recommended but not required.</p>
        <form method="post" action="/admin/password">
          <label>Current password<input name="currentPassword" type="password" autocomplete="current-password" required></label>
          <label>New password<input name="newPassword" type="password" autocomplete="new-password" maxlength="256" required></label>
          <label>Confirm new password<input name="confirmPassword" type="password" autocomplete="new-password" maxlength="256" required></label>
          <button>Change admin password</button>
        </form>
      </section>
      <script>
        document.querySelector('#questionCsvFile').addEventListener('change', function () {
          var file = this.files && this.files[0];
          if (!file) return;
          file.text().then(function (text) { document.querySelector('#questionImportData').value = text; });
        });
        document.querySelector('#playerCsvFile').addEventListener('change', function () {
          var file = this.files && this.files[0];
          if (!file) return;
          file.text().then(function (text) { document.querySelector('#playerImportData').value = text; });
        });
        document.querySelectorAll('.italic-button').forEach(function (button) {
          button.addEventListener('click', function () {
            var textarea = button.parentElement.querySelector('.question-prompt');
            var start = textarea.selectionStart;
            var end = textarea.selectionEnd;
            if (start === end) { textarea.focus(); return; }
            textarea.setRangeText('*' + textarea.value.slice(start, end) + '*', start, end, 'select');
            textarea.focus();
          });
        });
        (function () {
          var toggle = document.querySelector('#showTestPlayers');
          if (!toggle) return;
          try { toggle.checked = localStorage.getItem('pcb-show-test-players') !== '0'; } catch (error) {}
          function applyTestPlayerFilter() {
            document.querySelectorAll('.progress-card[data-test-player="1"]').forEach(function (card) {
              card.hidden = !toggle.checked;
            });
            try { localStorage.setItem('pcb-show-test-players', toggle.checked ? '1' : '0'); } catch (error) {}
          }
          toggle.addEventListener('change', applyTestPlayerFilter);
          applyTestPlayerFilter();
        })();
      </script>
    </main>`,
  );
}
