import { config } from "./config.ts";

interface RelayResponse {
  ok?: boolean;
  error?: string;
  remaining?: number;
  quota_exhausted?: boolean;
}

export interface MailResult {
  ok: boolean;
  error: string;
  quotaExhausted: boolean;
  remaining: number | null;
}

export function relayConfigured(): boolean {
  return Boolean(config.emailRelayUrl && config.emailRelaySecret);
}

async function relay(payload: Record<string, unknown>): Promise<RelayResponse> {
  if (!relayConfigured()) throw new Error("Workspace email relay is not configured.");
  const response = await fetch(config.emailRelayUrl, {
    method: "POST",
    redirect: "follow",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ secret: config.emailRelaySecret, ...payload }),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let result: RelayResponse;
  try {
    result = JSON.parse(text) as RelayResponse;
  } catch {
    throw new Error(`Workspace relay returned an unreadable response (HTTP ${response.status}).`);
  }
  if (!response.ok) throw new Error(result.error || `Workspace relay failed (HTTP ${response.status}).`);
  return result;
}

export async function remainingEmailQuota(): Promise<number> {
  const result = await relay({ action: "email_quota" });
  if (!result.ok || !Number.isFinite(result.remaining)) throw new Error(result.error || "Workspace relay did not report its remaining quota.");
  return Math.max(0, Math.floor(result.remaining!));
}

export async function sendInvitationEmail(to: string, name: string, invitationUrl: string, test = false): Promise<MailResult> {
  const greeting = name.trim() ? `Hi ${escapeHtml(name.trim())},` : "Hello,";
  const subject = `${test ? "[TEST] " : ""}Your Trivia Nationals Pop Culture Bee invitation`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#172033">
    <p>${greeting}</p>
    <p>You’re invited to complete the Trivia Nationals Pop Culture Bee preliminary quiz.</p>
    <p>The quiz has 50 questions. Each question has a 20-second timer, and your personalized link permits one attempt.</p>
    <p style="margin:28px 0"><a href="${escapeHtml(invitationUrl)}" style="display:inline-block;background:#7b68ae;color:#fff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:10px">Open the Pop Culture Bee quiz</a></p>
    <p style="font-size:13px;color:#5c6879">This link is personalized. Please do not forward it. If you have trouble opening it, reply to this email.</p>
    <p>Trivia Nationals</p>
  </div>`;
  const plain = `${name.trim() ? `Hi ${name.trim()},` : "Hello,"}\n\nYou’re invited to complete the Trivia Nationals Pop Culture Bee preliminary quiz. The quiz has 50 questions, each with a 20-second timer.\n\nOpen your personalized quiz: ${invitationUrl}\n\nPlease do not forward this personalized link.\n\nTrivia Nationals`;
  try {
    const result = await relay({ action: "send_email", to, subject, html_body: html, plain_body: plain });
    const error = result.error || "Workspace relay rejected the message.";
    const quotaExhausted = Boolean(result.quota_exhausted) || /quota|too many times/i.test(error);
    return { ok: Boolean(result.ok), error: result.ok ? "" : error, quotaExhausted, remaining: Number.isFinite(result.remaining) ? Number(result.remaining) : null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Workspace relay failed.";
    return { ok: false, error: message, quotaExhausted: /quota|too many times/i.test(message), remaining: null };
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}
