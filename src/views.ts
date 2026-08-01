import type { AdminQuestionRow, InvitationStats, ResultRow, UnresolvedRow } from "./admin.ts";

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

export function adminLoginPage(failed: boolean): string {
  return page(
    "Admin sign in",
    `<main class="card narrow">
      <p class="eyebrow">Quiz administration</p>
      <h1>Sign in</h1>
      ${failed ? '<p class="notice">Sign-in failed. Try again.</p>' : ""}
      <form method="post" action="/admin/login">
        <label>Password<input name="password" type="password" required autofocus></label>
        <button>Sign in</button>
      </form>
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
<script src="/quiz.js"></script>
</body>
</html>`;
}

export interface AdminPageData {
  questionCount: number;
  closesAt: number | null;
  results: ResultRow[];
  unresolved: UnresolvedRow[];
  questions: AdminQuestionRow[];
  questionsLocked: boolean;
  emailRelayConfigured: boolean;
  invitationStats: InvitationStats;
}

export function adminPage(data: AdminPageData): string {
  const closesLabel = data.closesAt
    ? new Date(data.closesAt).toLocaleString("en-US", { timeZone: "America/Chicago", timeZoneName: "short" })
    : "not set";
  const rows = data.results
    .map(
      (p) => `<tr>
        <td>${esc(p.email)}</td>
        <td>${esc(p.display_name)}</td>
        <td>${esc(p.status ?? "not started")}</td>
        <td>${p.score}</td>
        <td>${(p.correct_time_ms / 1000).toFixed(1)}s</td>
        <td>${p.is_test ? "yes" : ""}</td>
        <td>${p.invite_sent_at ? `sent ${esc(new Date(p.invite_sent_at).toLocaleString())}` : p.token_ciphertext ? (p.invite_last_error ? `paused: ${esc(p.invite_last_error)}` : "not sent") : "rotate required"}</td>
        <td><form method="post" action="/admin/player/${p.id}/rotate-invitation"><button class="small secondary">Rotate link</button></form></td>
        <td><form method="post" action="/admin/restart"><input type="hidden" name="playerId" value="${p.id}">
          <input name="reason" aria-label="Restart reason" placeholder="Reason" required>
          <button class="small">Grant restart</button></form></td>
      </tr>`,
    )
    .join("");
  const unresolved = data.unresolved.length
    ? data.unresolved
        .map(
          (v) => `<form class="review" method="post" action="/admin/review">
        <input type="hidden" name="questionId" value="${v.question_id}">
        <input type="hidden" name="answer" value="${esc(v.normalized_answer)}">
        <strong>Q${v.position}</strong>
        <span>“${esc(v.normalized_answer)}”</span>
        <span>${v.n} player${v.n === 1 ? "" : "s"}</span>
        <input name="note" placeholder="Optional note">
        <button name="verdict" value="correct">Correct</button>
        <button class="secondary" name="verdict" value="incorrect">Incorrect</button>
      </form>`,
        )
        .join("")
    : "<p>No unresolved answers yet.</p>";
  const questionForms = data.questions.map((q) => {
    const aliases = (JSON.parse(q.aliases_json) as string[]).join(", ");
    return `<form class="question-editor" id="question-${q.id}" method="post" action="/admin/question/${q.id}">
      <div class="question-number">${q.position}</div>
      <label>Category<input name="category" value="${esc(q.category)}" required ${data.questionsLocked ? "disabled" : ""}></label>
      <label>Question<textarea name="prompt" rows="3" required ${data.questionsLocked ? "disabled" : ""}>${esc(q.prompt)}</textarea></label>
      <label>Answer<input name="answer" value="${esc(q.canonical_answer)}" required ${data.questionsLocked ? "disabled" : ""}></label>
      <label>Aliases <span class="muted">(comma or line separated)</span><input name="aliases" value="${esc(aliases)}" ${data.questionsLocked ? "disabled" : ""}></label>
      ${data.questionsLocked ? "" : '<button class="small">Save question</button>'}
    </form>`;
  }).join("");

  return page(
    "Quiz admin",
    `<main class="admin">
      <header>
        <p class="eyebrow">Trivia Nationals</p>
        <h1>Pop Culture Bee Quiz</h1>
        <p>${data.questionCount}/50 questions &middot; cutoff ${esc(closesLabel)} &middot; release ${esc(process.env.RELEASE_ID ?? "local")}</p>
      </header>

      <section class="panel">
        <h2>Import questions</h2>
        <p>Download the current question bank, edit it in Excel or Google Sheets, and upload the CSV. Keep the header row; separate multiple accepted aliases with <code>|</code>. Import locks after the first attempt starts.</p>
        <p><a class="button secondary" href="/admin/questions.csv">Download current questions CSV</a></p>
        <form method="post" action="/admin/questions">
          <label>Question CSV<input id="questionCsvFile" type="file" accept=".csv,text/csv"></label>
          <label>CSV preview or pasted CSV<textarea id="questionImportData" name="questions" rows="7" required placeholder="position,category,question,answer,aliases"></textarea></label>
          <button>Validate and import 50 questions</button>
        </form>
        <p class="muted">JSON imports are still accepted for compatibility.</p>
      </section>

      <section class="panel" id="questions">
        <h2>Edit questions</h2>
        <p>${data.questionsLocked ? "Question editing is locked because an attempt exists." : "Edit the category header, question, canonical answer, or accepted aliases."}</p>
        <div class="question-list">${questionForms}</div>
      </section>

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
          <div class="action-card"><p class="step-label">Step 2</p><h3>Check capacity</h3><p>Read the Workspace account’s current Apps Script quota before sending.</p><form method="post" action="/admin/invitations/quota"><button ${data.emailRelayConfigured ? "" : "disabled"}>Check email quota</button></form></div>
          <div class="action-card"><p class="step-label">Step 3</p><h3>Send yourself a test</h3><p>Uses a test player’s personalized link. It does not mark a real invitation sent.</p><form method="post" action="/admin/invitations/test"><label>Test recipient<input type="email" name="email" placeholder="you@example.com" required></label><button ${data.emailRelayConfigured ? "" : "disabled"}>Send test email</button></form></div>
          <div class="action-card"><p class="step-label">Step 4</p><h3>Send the next five</h3><p>Sends only unsent real players, in order. Repeat after each successful batch.</p><form method="post" action="/admin/invitations/send-batch" onsubmit="return confirm('Send up to 5 real player invitations now? This will email actual players.')"><button class="send-real" ${data.emailRelayConfigured && data.invitationStats.ready ? "" : "disabled"}>Send next 5 real invitations</button></form></div>
        </div>
        <p class="muted">Safety behavior: the batch stops at the first failure or quota pause. That recipient remains unsent for retry, and there is no unreliable fallback mailer.</p>
      </section>

      <section class="panel">
        <h2>Progress and results</h2>
        <p><a class="button" href="/admin/results.csv">Download results CSV</a> Test accounts are excluded from the CSV.</p>
        <div class="table"><table>
          <thead><tr><th>Email</th><th>Name</th><th>Status</th><th>Score</th><th>Correct time</th><th>Test</th><th>Invitation</th><th>Link</th><th>Restart</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </section>

      <section class="panel" id="review">
        <h2>Review queue</h2>
        ${unresolved}
      </section>

      <section class="panel" id="security">
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
      </script>
    </main>`,
  );
}
