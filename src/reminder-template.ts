import { getAppSetting, setAppSetting } from "./db.ts";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

export interface ReminderMessage {
  subject: string;
  plain: string;
  html: string;
}

export interface ReminderTemplate {
  subject: string;
  body: string;
}

export const defaultReminderTemplate: ReminderTemplate = {
  subject: "Reminder: Complete your Pop Culture Bee quiz by Thursday",
  body: `Hi {{name}},

This is a reminder to complete your Trivia Nationals Pop Culture Bee preliminary quiz. The deadline is midnight (Central time) Thursday.

Use your personalized link: {{link}}

Please do not share this link; it is unique to you.`,
};

export function getReminderTemplate(): ReminderTemplate {
  return {
    subject: getAppSetting("reminder_email_subject") ?? defaultReminderTemplate.subject,
    body: getAppSetting("reminder_email_body") ?? defaultReminderTemplate.body,
  };
}

export function setReminderTemplate(template: ReminderTemplate): void {
  setAppSetting("reminder_email_subject", template.subject);
  setAppSetting("reminder_email_body", template.body);
}

function replaceText(template: string, name: string, link: string): string {
  return template.replaceAll("{{name}}", name.trim() || "there").replaceAll("{{link}}", link);
}

export function renderReminderEmail(name: string, invitationUrl: string): ReminderMessage {
  const template = getReminderTemplate();
  const subject = replaceText(template.subject, name, invitationUrl);
  const plain = replaceText(template.body, name, invitationUrl);
  const htmlBody = template.body.split(/(\{\{name\}\}|\{\{link\}\})/g).map((part) => {
    if (part === "{{name}}") return escapeHtml(name.trim() || "there");
    if (part === "{{link}}") return `<a href="${escapeHtml(invitationUrl)}" style="color:#7b68ae;font-weight:700">${escapeHtml(invitationUrl)}</a>`;
    return escapeHtml(part).replaceAll("\n", "<br>");
  }).join("");
  const html = `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#172033;line-height:1.6">${htmlBody}</div>`;
  return { subject, plain, html };
}
