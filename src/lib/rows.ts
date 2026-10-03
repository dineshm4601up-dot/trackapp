/**
 * Postgres reports every view column as nullable, so generated view types have
 * `id: string | null`. Rows from our views always have an id; this narrows the
 * type without non-null assertions.
 */
export function withIds<T extends { id: string | null }>(rows: T[]): (T & { id: string })[] {
  return rows.filter((row): row is T & { id: string } => row.id !== null);
}
