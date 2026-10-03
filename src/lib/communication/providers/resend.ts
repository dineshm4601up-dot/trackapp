import "server-only";

import type { EmailMessage, EmailProvider, SendResult } from "@/lib/communication/types";

const DEFAULT_BASE_URL = "https://api.resend.com";
const TIMEOUT_MS = 10_000;

/**
 * Resend adapter (plain HTTPS, no SDK). The API key is read on the server
 * only and never logged or returned.
 */
export function createResendProvider(config: { apiKey: string; from: string; baseUrl?: string }): EmailProvider {
  const endpoint = `${(config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "")}/emails`;
  return {
    name: "resend",
    async sendEmail(message: EmailMessage): Promise<SendResult> {
      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": message.idempotencyKey,
          },
          body: JSON.stringify({
            from: config.from,
            to: [message.to],
            subject: message.subject,
            html: message.html,
            text: message.text,
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
          cache: "no-store",
        });
      } catch (error) {
        // Network problem or timeout: worth another attempt.
        return { ok: false, permanent: false, error: `Provider unreachable: ${(error as Error).name}` };
      }

      if (response.ok) {
        const body = (await response.json().catch(() => null)) as { id?: unknown } | null;
        return { ok: true, messageId: typeof body?.id === "string" ? body.id : null };
      }
      const detail = (await response.text().catch(() => "")).slice(0, 200);
      // 429 and 5xx are temporary; other 4xx (invalid address, rejected sender, bad key) will not fix themselves.
      const permanent = response.status >= 400 && response.status < 500 && response.status !== 429;
      return { ok: false, permanent, error: `HTTP ${response.status}${detail ? `: ${detail}` : ""}` };
    },
  };
}
