/**
 * The only provider-specific settings. Swapping the tile provider (or moving
 * to a keyed service) is a change to this file and map-view.tsx alone.
 * OpenStreetMap's public tiles need no API key; attribution is required.
 */
export const TILE_LAYER = {
  url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19,
} as const;

/** Shown before any marker exists (centre of India). */
export const DEFAULT_VIEW = { center: [20.59, 78.96] as [number, number], zoom: 5 };

/** Zoom used when a single point is shown for fine positioning. */
export const PICKER_ZOOM = 16;

/**
 * Place search (OpenStreetMap Nominatim, no API key). Called from the server
 * only — see geocoding.ts. Its usage policy allows at most one request per
 * second and no search-as-you-type, so searches run on submit.
 */
export const GEOCODER = {
  url: "https://nominatim.openstreetmap.org/search",
  minIntervalMs: 1100,
  maxResults: 5,
} as const;
