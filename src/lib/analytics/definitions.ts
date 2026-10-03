// One place for every KPI formula and how its result is shown. Counts and sums
// come from SQL (report_* functions); ratios are derived here so that every
// screen and export uses the same definition. See docs/analytics.md.

/** numerator / denominator, or null ("N/A") when there is nothing to divide by. Never a fake 0%. */
export function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

export function formatRate(value: number | null) {
  return value === null ? "N/A" : `${(value * 100).toFixed(1)}%`;
}

/** Seconds as a readable duration; null (no valid sample) is "N/A", never 0. */
export function formatDuration(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined) return "N/A";
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  const minutes = Math.round(s / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest ? `${hours} h ${rest} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days} d ${hours % 24} h` : `${days} d`;
}

export function formatCount(value: number) {
  return new Intl.NumberFormat("en-IN").format(value);
}

/** Averages over fewer samples than this are flagged as a small sample. */
export const SMALL_SAMPLE = 5;

/** The definitions shown in the UI (as hints) and in the documentation. */
export const KPI_DEFINITIONS = {
  eligible:
    "Eligible tasks: every task given to an agent in the period — all statuses except Draft, Cancelled and Rescheduled.",
  completionRate: "Completion rate = Completed (incl. Verified) ÷ Eligible tasks. Open tasks count as not yet completed.",
  partialRate: "Partial rate = Partially completed ÷ Eligible tasks.",
  failureRate: "Failure rate = Failed ÷ Eligible tasks.",
  onTimeRate:
    "On-time rate = Completed on or before the scheduled end ÷ Completed tasks that had a scheduled end time. Tasks without an end time are not counted (N/A).",
  overdue: "Overdue: still open after its scheduled end (or start, or end of day if no time was set). Status is not changed.",
  fulfilment:
    "Fulfilment = Delivered quantity ÷ Assigned quantity, over closed delivery tasks. A failed delivery counts as nothing delivered; open tasks are excluded.",
  collectionRate: "Collection rate = Collected ÷ Expected, over closed cash tasks. Open tasks are shown separately as awaiting collection.",
  checkinSuccess: "Check-in success = Accepted check-ins ÷ All check-in attempts.",
  period: "A task belongs to the day it is scheduled for (or the day it was created, if unscheduled) in the business time zone.",
} as const;
