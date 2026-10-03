import { z } from "zod";

export const PAGE_SIZE = 20;

export const STATUS_FILTERS = ["all", "active", "inactive"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

// Every value is validated and clamped; anything unexpected falls back to a default.
const listParamsSchema = z.object({
  q: z.string().trim().max(100).catch(""),
  status: z.enum(STATUS_FILTERS).catch("all"),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});

export type ListParams = z.infer<typeof listParamsSchema>;

type SearchParams = Record<string, string | string[] | undefined>;

export function parseListParams(searchParams: SearchParams): ListParams {
  const first = (key: string) => {
    const value = searchParams[key];
    return Array.isArray(value) ? value[0] : value;
  };
  return listParamsSchema.parse({ q: first("q") ?? "", status: first("status"), page: first("page") });
}

/** Inclusive row range for Supabase `.range()`. */
export function pageRange(page: number, pageSize = PAGE_SIZE) {
  const from = (page - 1) * pageSize;
  return { from, to: from + pageSize - 1 };
}

/** `true` / `false` for an `is_active` filter, or null for "all". */
export function activeFilterValue(status: StatusFilter) {
  return status === "all" ? null : status === "active";
}

/**
 * PostgREST `or` filter matching `term` case-insensitively in any of the
 * allow-listed `columns`. User input is escaped twice: LIKE wildcards (so `%`
 * and `_` match literally) and PostgREST quoting (so `,` `(` `)` `.` cannot
 * inject extra filter clauses). Column names must be compile-time constants.
 */
export function searchFilter(columns: readonly string[], term: string) {
  if (!term) return null;
  const like = term.replace(/[\\%_]/g, (c) => `\\${c}`);
  const quoted = `"%${like.replace(/[\\"]/g, (c) => `\\${c}`)}%"`;
  return columns.map((column) => `${column}.ilike.${quoted}`).join(",");
}

/** Filters of a master-data list, for pagination links. */
export function listQuery(params: ListParams) {
  return { q: params.q, status: params.status === "all" ? undefined : params.status };
}
