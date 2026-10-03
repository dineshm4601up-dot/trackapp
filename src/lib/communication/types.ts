// Provider-neutral contracts. Task and notification code never imports a
// concrete provider: the dispatcher asks the registry for whatever the server
// is configured with, so providers can be added or swapped in one place.

export type Channel = "EMAIL" | "SMS" | "WHATSAPP";

export type SendResult =
  | { ok: true; messageId: string | null }
  /** permanent: retrying cannot help (bad address, rejected content, bad credentials). */
  | { ok: false; permanent: boolean; error: string };

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Stable per queued message, so a retried request is not delivered twice. */
  idempotencyKey: string;
};

export interface EmailProvider {
  readonly name: string;
  sendEmail(message: EmailMessage): Promise<SendResult>;
}

export type TextMessage = { to: string; body: string; idempotencyKey: string };

/** SMS and WhatsApp share one shape: a short text to a phone number. */
export interface MessageProvider {
  readonly name: string;
  readonly channel: Exclude<Channel, "EMAIL">;
  sendMessage(message: TextMessage): Promise<SendResult>;
}
