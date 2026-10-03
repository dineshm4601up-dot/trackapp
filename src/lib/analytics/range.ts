// Date-range presets, resolved in the business time zone. All arithmetic is on
// calendar dates (YYYY-MM-DD) in UTC, so no browser or server zone can shift it.

export const RANGE_PRESETS = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "this_week", label: "This week" },
  { key: "last_week", label: "Last week" },
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "custom", label: "Custom range" },
] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number]["key"];
export const DEFAULT_PRESET: RangePreset = "30d";

/** Longest period a report will run for (about two years). */
export const MAX_RANGE_DAYS = 731;

const DAY = 86_400_000;
const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const toIso = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (iso: string, days: number) => toIso(new Date(toDate(iso).getTime() + days * DAY));

export type ResolvedRange = { preset: RangePreset; from: string; to: string; label: string; days: number };

/**
 * @param today today's date in the business time zone (businessToday()).
 * Weeks run Monday–Sunday. An invalid custom range falls back to the default preset.
 */
export function resolveRange(preset: RangePreset, today: string, customFrom?: string, customTo?: string): ResolvedRange {
  const make = (key: RangePreset, from: string, to: string): ResolvedRange => ({
    preset: key,
    from,
    to,
    label: RANGE_PRESETS.find((p) => p.key === key)!.label,
    days: Math.round((toDate(to).getTime() - toDate(from).getTime()) / DAY) + 1,
  });
  const weekday = (toDate(today).getUTCDay() + 6) % 7; // Monday = 0
  const monthStart = `${today.slice(0, 8)}01`;
  switch (preset) {
    case "today":
      return make(preset, today, today);
    case "yesterday":
      return make(preset, addDays(today, -1), addDays(today, -1));
    case "7d":
      return make(preset, addDays(today, -6), today);
    case "30d":
      return make(preset, addDays(today, -29), today);
    case "this_week":
      return make(preset, addDays(today, -weekday), addDays(today, 6 - weekday));
    case "last_week":
      return make(preset, addDays(today, -weekday - 7), addDays(today, -weekday - 1));
    case "this_month": {
      const next = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 1));
      return make(preset, monthStart, toIso(new Date(next.getTime() - DAY)));
    }
    case "last_month": {
      const end = addDays(monthStart, -1);
      return make(preset, `${end.slice(0, 8)}01`, end);
    }
    case "custom": {
      if (customFrom && customTo && customFrom <= customTo) {
        const range = make(preset, customFrom, customTo);
        if (range.days <= MAX_RANGE_DAYS) return range;
      }
      return resolveRange(DEFAULT_PRESET, today);
    }
  }
}
