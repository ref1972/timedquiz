import type { AdminQuestionRow, ResultRow, UnresolvedRow } from "./admin.ts";

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
        <p>JSON array: <code>{"position":1,"category":"Movies","prompt":"…","answer":"…","aliases":["…"]}</code>. Import locks after the first attempt starts.</p>
        <form method="post" action="/admin/questions">
          <textarea name="questions" rows="7" required></textarea>
          <button>Validate and import 50 questions</button>
        </form>
      </section>

      <section class="panel" id="questions">
        <h2>Edit questions</h2>
        <p>${data.questionsLocked ? "Question editing is locked because an attempt exists." : "Edit the category header, question, canonical answer, or accepted aliases."}</p>
        <div class="question-list">${questionForms}</div>
      </section>

      <section class="panel">
        <h2>Import players</h2>
        <p>One per line: <code>email,name,test</code>. New personalized links appear after import. Links are stored encrypted for Workspace delivery and can be rotated if compromised or lost.</p>
        <form method="post" action="/admin/players">
          <textarea name="players" rows="7" required></textarea>
          <button>Create invitation links</button>
        </form>
      </section>

      <section class="panel" id="invitations">
        <h2>Email invitations</h2>
        <p>${data.emailRelayConfigured ? "The Google Workspace relay is configured. Sends are limited to five recipients per resumable batch and stop on the first failure." : "The Workspace relay is not configured. Set EMAIL_RELAY_URL and EMAIL_RELAY_SECRET on the server before attempting email."}</p>
        <div class="admin-actions">
          <form method="post" action="/admin/invitations/quota"><button ${data.emailRelayConfigured ? "" : "disabled"}>Check Workspace quota</button></form>
          <form method="post" action="/admin/invitations/test"><label>Test recipient<input type="email" name="email" placeholder="you@example.com" required></label><button ${data.emailRelayConfigured ? "" : "disabled"}>Send test invitation</button></form>
          <form method="post" action="/admin/invitations/send-batch" onsubmit="return confirm('Send the next batch of up to 5 real invitations through Google Workspace?')"><button ${data.emailRelayConfigured ? "" : "disabled"}>Send next batch of 5</button></form>
        </div>
        <p class="muted">There is intentionally no <code>wp_mail()</code> fallback. A failed or quota-paused recipient remains unsent and is retried by the next batch.</p>
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
    </main>`,
  );
}
