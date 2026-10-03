/** Provider-neutral marker: screens describe what to show, the map component decides how. */
export type MapMarkerTone = "info" | "success" | "warning" | "muted";

export type MapMarker = {
  id: string;
  latitude: number;
  longitude: number;
  /** Short text shown on the marker itself (status is never conveyed by colour alone). */
  label: string;
  tone: MapMarkerTone;
  /** Popup heading and rows. Plain text only. */
  title: string;
  details: readonly (readonly [label: string, value: string])[];
  link?: { href: string; text: string };
};
