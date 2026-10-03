import "server-only";

import { headers } from "next/headers";
import { z } from "zod";

/**
 * Absolute origin of the app for links the server hands out (e.g. password
 * setup links). Prefers NEXT_PUBLIC_APP_URL; falls back to the request host.
 */
export async function getAppOrigin() {
  const configured = z.url().safeParse(process.env.NEXT_PUBLIC_APP_URL);
  if (configured.success) return new URL(configured.data).origin;

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  if (!host) throw new Error("Cannot determine the app URL. Set NEXT_PUBLIC_APP_URL.");
  return `${proto}://${host}`;
}
