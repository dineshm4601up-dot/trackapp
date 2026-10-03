import type { AccessDeniedReason } from "@/lib/auth/profile";

// User-facing copy only. Never include provider or database error details.
export const authMessages = {
  invalidCredentials: "Invalid email or password.",
  rateLimited: "Too many sign-in attempts. Please wait a moment and try again.",
  unavailable: "We couldn't sign you in right now. Please try again shortly.",
  notConfigured: "Sign-in is not available: the application is not configured.",
} as const;

/** Reasons that can be shown on /login via `?reason=`. */
export type LoginNotice = AccessDeniedReason | "link_invalid";

export const loginNoticeMessages: Record<LoginNotice, string> = {
  inactive: "Your account is currently inactive. Please contact an administrator.",
  no_profile:
    "Your account is not set up for this application. Please contact an administrator.",
  invalid_role: "Your account does not have access to this application.",
  link_invalid:
    "This setup link is invalid or has expired. Ask your administrator for a new one.",
};

export function isLoginNotice(value: unknown): value is LoginNotice {
  return typeof value === "string" && Object.hasOwn(loginNoticeMessages, value);
}
