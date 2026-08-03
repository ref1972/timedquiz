import { getAppSetting, setAppSetting } from "./db.ts";

export interface InvitationTemplate {
  subject: string;
  body: string;
}

export const defaultInvitationTemplate: InvitationTemplate = {
  subject: "Your Trivia Nationals Pop Culture Bee invitation",
  body: `Hi {{name}},

You’re invited to complete the Trivia Nationals Pop Culture Bee preliminary quiz.

The quiz has 50 questions. Each question has a 25-second timer, and your personalized link permits one attempt.

Open your personalized quiz: {{link}}

This link is personalized. Please do not forward it. If you have trouble opening it, reply to this email.

Trivia Nationals`,
};

export function getInvitationTemplate(): InvitationTemplate {
  return {
    subject: getAppSetting("invitation_email_subject") ?? defaultInvitationTemplate.subject,
    body: getAppSetting("invitation_email_body") ?? defaultInvitationTemplate.body,
  };
}

export function setInvitationTemplate(template: InvitationTemplate): void {
  setAppSetting("invitation_email_subject", template.subject);
  setAppSetting("invitation_email_body", template.body);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

function replaceText(template: string, name: string, link: string): string {
  return template.replaceAll("{{name}}", name.trim() || "there").replaceAll("{{link}}", link);
}

export function renderInvitationTemplate(name: string, link: string, test = false): { subject: string; plain: string; html: string } {
  const template = getInvitationTemplate();
  const subject = `${test ? "[TEST] " : ""}${replaceText(template.subject, name, link)}`;
  const plain = replaceText(template.body, name, link);
  const htmlBody = template.body.split(/(\{\{name\}\}|\{\{link\}\})/g).map((part) => {
    if (part === "{{name}}") return escapeHtml(name.trim() || "there");
    if (part === "{{link}}") return `<a href="${escapeHtml(link)}" style="color:#7b68ae;font-weight:700">${escapeHtml(link)}</a>`;
    return escapeHtml(part).replaceAll("\n", "<br>");
  }).join("");
  const html = `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#172033;line-height:1.6">${htmlBody}</div>`;
  return { subject, plain, html };
}
