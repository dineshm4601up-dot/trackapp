import "server-only";

import type { FormState } from "@/lib/form-state";

type DbError = { code?: string; message?: string; details?: string };

/** Friendly message (and the form field it belongs to) for a unique constraint. */
export type UniqueMessages = Record<string, { field: string; message: string }>;

export type DescribedDbError = { message: string; field?: string };

/**
 * Translates a PostgREST/Postgres error into user-facing text. Raw database
 * messages are logged server-side only and never returned to the browser.
 */
export function describeDbError(
  error: DbError,
  context: string,
  uniques: UniqueMessages = {},
): DescribedDbError {
  switch (error.code) {
    case "23505": {
      const constraint = Object.keys(uniques).find((name) => error.message?.includes(name));
      if (constraint) return uniques[constraint]!;
      return { message: "A record with these details already exists." };
    }
    case "23503":
      return { message: "A related record no longer exists. Refresh and try again." };
    case "23514":
    case "22P02":
    case "22003":
      return { message: "Some values are not allowed. Check the form and try again." };
    case "42501":
      return { message: "You don't have permission to do that." };
    default:
      console.error(`Database error (${context})`, { code: error.code, message: error.message });
      return { message: "Something went wrong while saving. Please try again." };
  }
}

/** Form state for a failed write, keeping the user's input. */
export function dbErrorState(
  error: DbError,
  context: string,
  uniques: UniqueMessages,
  values: Record<string, string>,
): FormState {
  const { message, field } = describeDbError(error, context, uniques);
  return field
    ? { status: "error", message: "Please correct the highlighted fields.", fieldErrors: { [field]: message }, values }
    : { status: "error", message, values };
}

/** Rows and total for a paginated list query; failures go to the error boundary. */
export async function fetchPage<Row>(
  query: PromiseLike<{ data: Row[] | null; count: number | null; error: DbError | null }>,
  context: string,
): Promise<{ rows: Row[]; total: number }> {
  const { data, count, error } = await query;
  if (error) {
    // Requested page is past the end (e.g. a stale or hand-edited URL).
    if (error.code === "PGRST103") return { rows: [], total: 0 };
    console.error(`Failed to load ${context}`, { code: error.code, message: error.message });
    throw new Error(`Unable to load ${context}.`);
  }
  return { rows: data ?? [], total: count ?? 0 };
}
