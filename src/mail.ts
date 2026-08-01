import { config } from "./config.ts";
import { renderInvitationTemplate } from "./invitation-template.ts";

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
  const { subject, html, plain } = renderInvitationTemplate(name, invitationUrl, test);
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
