import "server-only";

import { z } from "zod";

import { siteConfig } from "@/config/site";
import { GEOCODER } from "@/lib/maps/provider";
import type { PlaceResult } from "@/lib/maps/types";

const responseSchema = z.array(
  z.object({
    place_id: z.union([z.number(), z.string()]),
    lat: z.coerce.number().min(-90).max(90),
    lon: z.coerce.number().min(-180).max(180),
    display_name: z.string().min(1).max(500),
  }),
);

// The provider allows one request per second; later callers wait their turn.
let nextSlot = 0;

async function takeSlot() {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + GEOCODER.minIntervalMs;
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}

/**
 * Looks up an address, place or landmark. Runs on the server so the provider
 * can be swapped here alone, the app identifies itself as the usage policy
 * requires, and the response is validated before it reaches the browser.
 * Throws when the provider cannot be reached or answers unexpectedly.
 */
export async function searchPlaces(query: string): Promise<PlaceResult[]> {
  await takeSlot();
  // GEOCODER_URL points at a self-hosted or commercial Nominatim-compatible service.
  const url = new URL(process.env.GEOCODER_URL || GEOCODER.url);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", String(GEOCODER.maxResults));

  const response = await fetch(url, {
    headers: {
      "User-Agent": `${siteConfig.name}/1.0 (${process.env.NEXT_PUBLIC_APP_URL ?? "self-hosted"})`,
      "Accept-Language": "en",
    },
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Place search failed: ${response.status}`);

  return responseSchema.parse(await response.json()).map((place) => ({
    id: String(place.place_id),
    label: place.display_name,
    latitude: place.lat,
    longitude: place.lon,
  }));
}
