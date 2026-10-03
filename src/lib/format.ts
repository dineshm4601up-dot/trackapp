import { siteConfig } from "@/config/site";

// Display conventions:
//  * timestamptz values (created_at, assigned_at, …) are instants, shown in the
//    business time zone (siteConfig.timeZone).
//  * scheduled_date (DATE) and scheduled_*_time (TIME) are business-local wall
//    clock values, stored and shown exactly as entered — never converted.

const dateFormatter = new Intl.DateTimeFormat(siteConfig.locale, {
  dateStyle: "medium",
  timeZone: siteConfig.timeZone,
});

const dateTimeFormatter = new Intl.DateTimeFormat(siteConfig.locale, {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: siteConfig.timeZone,
});

// Calendar dates and wall-clock times are formatted in UTC so no shift happens.
const calendarDateFormatter = new Intl.DateTimeFormat(siteConfig.locale, {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const shortCalendarDateFormatter = new Intl.DateTimeFormat(siteConfig.locale, {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const wallTimeFormatter = new Intl.DateTimeFormat(siteConfig.locale, {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});

const currencyFormatter = new Intl.NumberFormat(siteConfig.locale, {
  style: "currency",
  currency: siteConfig.currency,
});

export function formatDate(value: string | null | undefined) {
  return value ? dateFormatter.format(new Date(value)) : "—";
}

export function formatDateTime(value: string | null | undefined) {
  return value ? dateTimeFormatter.format(new Date(value)) : "—";
}

/** A DATE column value ("2026-10-03"), shown as-is. */
export function formatCalendarDate(value: string | null | undefined) {
  return value ? calendarDateFormatter.format(new Date(`${value}T00:00:00Z`)) : "—";
}

/** Compact DATE value for dense tables ("6 Oct 2026"). */
export function formatShortCalendarDate(value: string | null | undefined) {
  return value ? shortCalendarDateFormatter.format(new Date(`${value}T00:00:00Z`)) : "—";
}

/** A TIME column value ("14:30:00"), shown as-is. */
export function formatWallTime(value: string | null | undefined) {
  return value ? wallTimeFormatter.format(new Date(`1970-01-01T${value.slice(0, 5)}:00Z`)) : "—";
}

const instantTimeFormatter = new Intl.DateTimeFormat(siteConfig.locale, {
  hour: "numeric",
  minute: "2-digit",
  timeZone: siteConfig.timeZone,
});

/** Time of day of a timestamptz, in the business time zone ("10:42 am"). */
export function formatWallTimeOfInstant(value: string | null | undefined) {
  return value ? instantTimeFormatter.format(new Date(value)) : "—";
}

/** Today's date in the business time zone, as YYYY-MM-DD. */
export function businessToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: siteConfig.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Display-only. Monetary values are never computed client-side with floats. */
export function formatMoney(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  // Intl accepts decimal strings and formats them exactly.
  return currencyFormatter.format(value as Parameters<typeof currencyFormatter.format>[0]);
}

export function formatCoordinate(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : value.toFixed(6);
}

export function mapsSearchUrl(latitude: number | string, longitude: number | string) {
  return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
}

/** UTC offset of the business time zone right now, e.g. "+05:30" (for day-boundary filters). */
export function businessUtcOffset() {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: siteConfig.timeZone, timeZoneName: "longOffset" })
    .formatToParts(new Date())
    .find((p) => p.type === "timeZoneName")?.value;
  const match = /GMT([+-]\d{2}:\d{2})/.exec(part ?? "");
  return match ? match[1]! : "+00:00";
}
