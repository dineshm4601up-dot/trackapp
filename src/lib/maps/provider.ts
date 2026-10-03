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
