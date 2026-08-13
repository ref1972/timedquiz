import { getAppSetting, setAppSetting } from "./db.ts";

export interface SigninTemplate {
  subject: string;
  body: string;
}

// The wording shipped hardcoded in account.ts through rc41, kept verbatim as
// the default so making it editable changes nothing until somebody edits it.
export const defaultSigninTemplate: SigninTemplate = {
  subject: "Sign in to Pop Culture Bee",
  body: `Use this secure link to sign in to your Pop Culture Bee account:

{{link}}

This link expires in 15 minutes and can be used once.`,
};

export function getSigninTemplate(): SigninTemplate {
  return {
    subject: getAppSetting("signin_email_subject") ?? defaultSigninTemplate.subject,
    body: getAppSetting("signin_email_body") ?? defaultSigninTemplate.body,
  };
}

export function setSigninTemplate(template: SigninTemplate): void {
  setAppSetting("signin_email_subject", template.subject);
  setAppSetting("signin_email_body", template.body);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

/**
 * Deliberately takes no name: a sign-in link is requested by typing an email
 * address, so at that moment there may be no verified identity to greet, and
 * echoing an unverified name back into mail is not worth the confusion.
 */
export function renderSigninEmail(link: string): { subject: string; plain: string; html: string } {
  const template = getSigninTemplate();
  const plain = template.body.replaceAll("{{link}}", link);
  const htmlBody = template.body.split(/(\{\{link\}\})/g).map((part) => {
    if (part === "{{link}}") return `<a href="${escapeHtml(link)}" style="color:#7b68ae;font-weight:700">Sign in to my account</a>`;
    return escapeHtml(part).replaceAll("\n", "<br>");
  }).join("");
  const html = `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#172033;line-height:1.6">${htmlBody}</div>`;
  return { subject: template.subject.replaceAll("{{link}}", link), plain, html };
}
