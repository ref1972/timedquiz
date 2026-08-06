function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

export interface ReminderMessage {
  subject: string;
  plain: string;
  html: string;
}

export function renderReminderEmail(name: string, invitationUrl: string): ReminderMessage {
  const greeting = name.trim() ? `Hi ${name.trim()},` : "Hello,";
  const subject = "Reminder: Complete your Pop Culture Bee quiz by Thursday";
  const plain = `${greeting}\n\nThis is a reminder to complete your Trivia Nationals Pop Culture Bee preliminary quiz. The deadline is midnight (Central time) Thursday.\n\nUse your personalized link:\n${invitationUrl}\n\nPlease do not share this link; it is unique to you.`;
  const html = `<p>${escapeHtml(greeting)}</p><p>This is a reminder to complete your Trivia Nationals Pop Culture Bee preliminary quiz. <strong>The deadline is midnight (Central time) Thursday.</strong></p><p><a href="${escapeHtml(invitationUrl)}">Open your personalized quiz</a></p><p>Please do not share this link; it is unique to you.</p>`;
  return { subject, plain, html };
}
