import type { AdminQuestionRow, GradingQuestion, GradingVariant, InvitationStats, PlayerAnswerAttempt, PlayerAnswerRow, ResultRow } from "./admin.ts";
import type { IntroCopy } from "./intro-copy.ts";
import type { InvitationTemplate } from "./invitation-template.ts";
import type { CompletionNotificationSettings } from "./completion-notification.ts";
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
  introCopy: IntroCopy;
  invitationTemplate: InvitationTemplate;
  completionNotifications: CompletionNotificationSettings;
}

export function questionPreviewPage(question: AdminQuestionRow, total: number, durationSeconds = 30): string {
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

export type AdminSection = "questions" | "players" | "progress" | "review";

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
    ? new Date(data.closesAt).toLocaleString("en-US", { timeZone: "America/Chicago", timeZoneName: "short" })
    : "not set";
  const progressCards = data.results
    .map(
      (p) => `<article class="progress-card">
        <header><div><h3>${esc(p.display_name || p.email)}</h3><p>${esc(p.email)}</p></div><span class="status-pill">${esc(p.status ?? "not started")}${p.is_test ? " · test" : ""}</span></header>
        <dl class="progress-stats"><div><dt>Score</dt><dd>${p.score}</dd></div><div><dt>Answer time</dt><dd>${(p.answer_time_ms / 1000).toFixed(1)}s</dd></div></dl>
        <div class="progress-details"><p><strong>Completion email</strong><br>${p.completion_notified_at ? `sent ${esc(new Date(p.completion_notified_at).toLocaleString())}` : p.completion_notification_error ? `failed: ${esc(p.completion_notification_error)}` : p.status === "completed" && p.completion_notification_started_at ? "send outcome unknown" : "—"}</p><p><strong>Invitation</strong><br>${p.is_test ? "Test account — use Step 3" : p.invite_sent_at ? `sent ${esc(new Date(p.invite_sent_at).toLocaleString())}` : p.token_ciphertext ? (p.invite_last_error ? `paused: ${esc(p.invite_last_error)}` : "not sent") : "rotate required"}</p></div>
        <div class="progress-actions"><a class="button small secondary" href="/admin/player/${p.id}/answers">View answers</a><form method="post" action="/admin/player/${p.id}/rotate-invitation"><button class="small secondary">Rotate link</button></form><form class="restart-form" method="post" action="/admin/restart"><input type="hidden" name="playerId" value="${p.id}"><input name="reason" aria-label="Restart reason for ${esc(p.display_name || p.email)}" placeholder="Restart reason" required><button class="small">Grant restart</button></form></div>
      </article>`,
    )
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
        <h1>Pop Culture Bee Quiz</h1>
        <p>${data.questionCount}/50 questions &middot; cutoff ${esc(closesLabel)} &middot; release ${esc(process.env.RELEASE_ID ?? "local")}</p>
      </header>
      <nav class="admin-nav" aria-label="Quiz administration">
        <a href="/admin/questions" ${section === "questions" ? 'aria-current="page"' : ""}>Questions &amp; Answers</a>
        <a href="/admin/players" ${section === "players" ? 'aria-current="page"' : ""}>Players</a>
        <a href="/admin/progress" ${section === "progress" ? 'aria-current="page"' : ""}>Progress</a>
        <a href="/admin/review" ${section === "review" ? 'aria-current="page"' : ""}>Grading${data.unresolvedCount ? ` (${data.unresolvedCount})` : ""}</a>
      </nav>

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
          <button>Validate and import 50 questions</button>
        </form>
        <p class="muted">JSON imports are still accepted for compatibility.</p>
      </section>

      <section class="panel" id="questions" ${section === "questions" ? "" : "hidden"}>
        <h2>Edit questions</h2>
        ${data.questionsLocked ? `<div class="notice edit-unlock"><p><strong>Question content is frozen because a real participant has started.</strong> You can temporarily unlock category and question wording. Answers, aliases, highlighted text, and scoring remain locked.</p><form method="post" action="/admin/question-text-editing" onsubmit="return ${data.questionTextEditingEnabled ? "true" : "confirm('Unlock category and question wording for editing? Changes will affect what future players see.')"}"><input type="hidden" name="enabled" value="${data.questionTextEditingEnabled ? "0" : "1"}"><button class="small ${data.questionTextEditingEnabled ? "secondary" : ""}">${data.questionTextEditingEnabled ? "Turn editing off" : "Turn editing on"}</button></form></div>` : "<p>Edit the category, question, optional gold-highlighted phrase, canonical answer, or accepted aliases. Test-player activity does not lock individual edits.</p>"}
        <div class="question-list">${questionForms}</div>
      </section>

      <section class="panel" id="players" ${section === "players" ? "" : "hidden"}>
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

      <section class="panel" id="invitation-template" ${section === "players" ? "" : "hidden"}>
        <h2>Invitation email</h2>
        <p>Edit the subject and message used by both test sends and real invitation batches. Use <code>{{name}}</code> for the player’s name and <code>{{link}}</code> for their personalized link.</p>
        <form method="post" action="/admin/invitation-template">
          <label>Subject<input name="subject" value="${esc(data.invitationTemplate.subject)}" maxlength="200" required></label>
          <label>Message body<textarea name="body" rows="12" maxlength="10000" required>${esc(data.invitationTemplate.body)}</textarea></label>
          <button>Save invitation email</button>
        </form>
        <p class="muted"><code>{{link}}</code> is required. Test messages automatically add <code>[TEST]</code> to the subject. Always use Step 3 below after editing.</p>
      </section>

      <section class="panel" id="invitations" ${section === "players" ? "" : "hidden"}>
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
          <div class="action-card"><p class="step-label">Step 3</p><h3>Send a test player’s link</h3><p>Enter the exact email of an imported test player. The system will never substitute another player’s link.</p><form method="post" action="/admin/invitations/test"><label>Test player email<input type="email" name="email" placeholder="you@example.com" required></label><button ${data.emailRelayConfigured ? "" : "disabled"}>Send test email</button></form></div>
          <div class="action-card"><p class="step-label">Step 4</p><h3>Send the next five</h3><p>Sends only unsent real players, in order. Repeat after each successful batch.</p><form method="post" action="/admin/invitations/send-batch" onsubmit="return confirm('Send up to 5 real player invitations now? This will email actual players.')"><button class="send-real" ${data.emailRelayConfigured && data.invitationStats.ready ? "" : "disabled"}>Send next 5 real invitations</button></form></div>
        </div>
        <p class="muted">Safety behavior: the batch stops at the first failure or quota pause. That recipient remains unsent for retry, and there is no unreliable fallback mailer.</p>
      </section>

      <section class="panel" ${section === "progress" ? "" : "hidden"}>
        <h2>Progress and results</h2>
        <p><a class="button" href="/admin/results.csv">Download real results CSV</a> <a class="button secondary" href="/admin/test-results.csv">Download test results CSV</a></p>
        <p class="muted">The two files remain separate so rehearsal accounts never appear in the real rankings.</p>
        <div class="progress-list">${progressCards || "<p>No players have been imported.</p>"}</div>
      </section>

      <section class="panel" id="completion-notifications" ${section === "progress" ? "" : "hidden"}>
        <h2>Completion notifications</h2>
        <p>Send one admin email when any player—including a test player—submits all answers. Each attempt is claimed before sending so completion-page refreshes cannot create duplicates.</p>
        <form method="post" action="/admin/completion-notifications">
          <label>Notification email<input type="email" name="recipient" value="${esc(data.completionNotifications.recipient)}" placeholder="you@example.com"></label>
          <label><input type="checkbox" name="enabled" value="1" ${data.completionNotifications.enabled ? "checked" : ""}> Email me when an attempt is completed</label>
          <button>Save completion notifications</button>
        </form>
        <p class="muted">The message includes test/real status, score, answer time, completion time, and a link to the player’s admin answer sheet.</p>
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
      </script>
    </main>`,
  );
}
