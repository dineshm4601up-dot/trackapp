import type { TaskStatus } from "@/features/tasks/constants";

/**
 * Location is shared only while a task is in one of these states — the same
 * list agent_record_location() enforces. Nothing is collected before travel
 * starts or after the task ends.
 */
export const TRACKABLE_STATUSES: readonly TaskStatus[] = ["ON_THE_WAY", "ARRIVED", "CHECKED_IN", "IN_PROGRESS"];

export const isTrackable = (status: TaskStatus) => TRACKABLE_STATUSES.includes(status);

/** How often a position is sent while sharing is active. The server ignores anything faster than its own minimum. */
export const LOCATION_SEND_INTERVAL_MS = 45_000;

/** A watched position older than this is refreshed before sending (the device may be stationary). */
export const LOCATION_FRESH_MS = 60_000;

/** Balanced power use: no forced high-accuracy GPS for monitoring updates. */
export const WATCH_OPTIONS: PositionOptions = { enableHighAccuracy: false, maximumAge: 30_000, timeout: 20_000 };
