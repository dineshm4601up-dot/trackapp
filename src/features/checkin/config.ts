// Browser-side GPS capture settings. Acceptance thresholds (accuracy, age,
// clock skew, max radius) are NOT here: they live in the database
// (public.app_settings) and are applied by agent_check_in(), so a client can
// never relax them.
export const GEOLOCATION_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 20_000, // ms to wait for a fix
  maximumAge: 0, // never reuse a cached position
};

/** Random per-browser identifier (optional, informational only — never used for security). */
export const DEVICE_ID_STORAGE_KEY = "fieldtrack.device-id";
