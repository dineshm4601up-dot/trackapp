import "server-only";

import { z } from "zod";

import { createResendProvider } from "@/lib/communication/providers/resend";
import type { Channel, EmailProvider, MessageProvider } from "@/lib/communication/types";

// Server-only configuration. None of these may ever be NEXT_PUBLIC_*.
const emailEnvSchema = z.object({
  provider: z.enum(["resend"]),
  apiKey: z.string().min(1),
  from: z.string().min(3),
  baseUrl: z.url().optional(),
});

export type ProviderState<T> = { enabled: true; provider: T } | { enabled: false; reason: string };

/** The configured e-mail provider, or why e-mail is disabled. Nothing is ever "sent" without one. */
export function getEmailProvider(): ProviderState<EmailProvider> {
  if (!process.env.EMAIL_PROVIDER) return { enabled: false, reason: "No e-mail provider is configured (EMAIL_PROVIDER)." };
  const env = emailEnvSchema.safeParse({
    provider: process.env.EMAIL_PROVIDER,
    apiKey: process.env.EMAIL_API_KEY,
    from: process.env.EMAIL_FROM,
    baseUrl: process.env.EMAIL_API_BASE_URL || undefined,
  });
  if (!env.success) {
    return { enabled: false, reason: "E-mail is misconfigured: check EMAIL_PROVIDER, EMAIL_API_KEY and EMAIL_FROM." };
  }
  // Add further providers (SendGrid, SES, SMTP) as cases here; nothing else changes.
  switch (env.data.provider) {
    case "resend":
      return { enabled: true, provider: createResendProvider(env.data) };
  }
}

/**
 * SMS / WhatsApp. The interface and queue support exist, but no adapter is
 * implemented yet, so these channels report as disabled rather than pretending
 * to send. To enable one: implement MessageProvider, return it here based on
 * SMS_PROVIDER / WHATSAPP_PROVIDER, and set channel_*_enabled in app_settings.
 */
export function getMessageProvider(channel: Exclude<Channel, "EMAIL">): ProviderState<MessageProvider> {
  return { enabled: false, reason: `No ${channel === "SMS" ? "SMS" : "WhatsApp"} provider is implemented.` };
}

/** For the admin screen: which channels can actually deliver right now. */
export function channelStatus() {
  const email = getEmailProvider();
  return {
    EMAIL: email.enabled ? { enabled: true as const, provider: email.provider.name } : { enabled: false as const, reason: email.reason },
    SMS: { enabled: false as const, reason: "No SMS provider is implemented." },
    WHATSAPP: { enabled: false as const, reason: "No WhatsApp provider is implemented." },
  };
}
