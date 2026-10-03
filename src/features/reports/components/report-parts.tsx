import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronsUpDown, Download, SearchX, type LucideIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { PaginationBar } from "@/components/shared/pagination-bar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ReportColumn } from "@/features/reports/definitions";
import { reportHref } from "@/features/reports/filters";
import { REPORT_PAGE_SIZE } from "@/features/reports/service";
import { cn } from "@/lib/utils";

// Server-rendered building blocks shared by every report page.

/** A headline number. When it links, it opens the report rows it was counted from. */
export function Kpi({ label, value, hint, href, icon: Icon }: { label: string; value: string; hint?: string; href?: string; icon?: LucideIcon }) {
  const card = (
    <Card size="sm" className={cn("h-full", href && "transition-colors hover:bg-muted/50")}>
      <CardHeader>
        <CardDescription className="flex items-center justify-between gap-2">
          {label}
          {Icon && <Icon className="size-4" aria-hidden />}
        </CardDescription>
        <CardTitle className="text-2xl font-semibold">{value}</CardTitle>
      </CardHeader>
      {hint && (
        <CardContent>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </CardContent>
      )}
    </Card>
  );
  return href ? (
    <Link href={href} className="rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50" aria-label={`${label}: ${value}. Open the underlying records.`}>
      {card}
    </Link>
  ) : (
    card
  );
}

export function KpiGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{children}</div>;
}

export function Section({ id, title, description, action, children }: { id: string; title: string; description?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id={id} className="text-lg font-semibold">
            {title}
          </h2>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export type BarRow = { key: string; label: string; value: number; display: string; note?: string; href?: string };

/**
 * Horizontal bars for comparing magnitudes (one hue; the value is written at
 * the end of every row, so nothing depends on colour or on hovering).
 */
export function BarList({ rows, label, empty = "No data for this period." }: { rows: BarRow[]; label: string; empty?: string }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.value), 0) || 1;
  return (
    <ul className="space-y-2.5" aria-label={label}>
      {rows.map((row) => {
        const name = row.href ? (
          <Link href={row.href} className="truncate hover:underline">
            {row.label}
          </Link>
        ) : (
          <span className="truncate">{row.label}</span>
        );
        return (
          <li key={row.key} className="space-y-1 text-sm" title={`${row.label}: ${row.display}${row.note ? ` (${row.note})` : ""}`}>
            <div className="flex items-baseline justify-between gap-3">
              {name}
              <span className="shrink-0 tabular-nums">
                <span className="font-medium">{row.display}</span>
                {row.note && <span className="text-xs text-muted-foreground"> · {row.note}</span>}
              </span>
            </div>
            <div className="h-2 rounded-r-[4px]" style={{ background: "var(--viz-track)" }} aria-hidden>
              <div className="h-2 rounded-r-[4px]" style={{ width: `${Math.max(row.value > 0 ? 1.5 : 0, (row.value / max) * 100)}%`, background: "var(--viz-bar)" }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** A ratio against its whole. `value` null means N/A: the track stays empty and the text says so. */
export function Meter({ label, value, display, detail }: { label: string; value: number | null; display: string; detail: string }) {
  return (
    <div className="space-y-1.5 text-sm">
      <div className="flex items-baseline justify-between gap-3">
        <span>{label}</span>
        <span className="font-semibold tabular-nums">{display}</span>
      </div>
      <div
        className="h-2 rounded-full"
        style={{ background: "var(--viz-track)" }}
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value === null ? undefined : Math.round(value * 100)}
        aria-valuetext={display}
      >
        <div className="h-2 rounded-full" style={{ width: `${Math.min(100, (value ?? 0) * 100)}%`, background: "var(--viz-bar)" }} />
      </div>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

export function ExportButtons({ report, query }: { report: string; query: Record<string, string | undefined> }) {
  return (
    <div className="flex gap-2">
      {(["csv", "xlsx"] as const).map((format) => (
        <Button key={format} variant="outline" size="sm" asChild>
          {/* A plain download link: the file is generated on the server with these filters. */}
          <a href={reportHref("/admin/reports/export", query, { report, format })} download>
            <Download data-icon="inline-start" aria-hidden />
            {format === "csv" ? "CSV" : "Excel"}
          </a>
        </Button>
      ))}
    </div>
  );
}

type ReportTableProps<Row> = {
  caption: string;
  columns: ReportColumn<Row>[];
  rows: Row[];
  total: number;
  rowKey: (row: Row, index: number) => string;
  /** Path of the page, for sort and page links. */
  basePath: string;
  /** Current filters (kept in every link). */
  query: Record<string, string | undefined>;
  page: number;
  sort?: string;
  dir: "asc" | "desc";
  /** Extra parameters this page uses (e.g. segment). */
  extra?: Record<string, string | undefined>;
  emptyTitle?: string;
};

/** Paginated, server-sorted report table. Every sort and page link keeps the active filters. */
export function ReportTable<Row>({ caption, columns, rows, total, rowKey, basePath, query, page, sort, dir, extra = {}, emptyTitle }: ReportTableProps<Row>) {
  if (rows.length === 0) {
    return <EmptyState icon={SearchX} title={emptyTitle ?? "Nothing to show for this period and these filters."} description="Try a wider date range or clear some filters." />;
  }
  const linkQuery = { ...query, ...extra };
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-muted/50 text-left">
            <tr>
              {columns.map((column) => {
                const active = column.sort !== undefined && column.sort === sort;
                const next = active && dir === "desc" ? "asc" : "desc";
                return (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined}
                    className={cn("px-3 py-2 font-medium whitespace-nowrap", column.align === "right" && "text-right", column.wide && "hidden lg:table-cell")}
                  >
                    {column.sort ? (
                      <Link
                        href={reportHref(basePath, linkQuery, { sort: column.sort, dir: next })}
                        className={cn("inline-flex items-center gap-1 hover:underline", column.align === "right" && "flex-row-reverse")}
                        scroll={false}
                      >
                        {column.header}
                        {active ? dir === "asc" ? <ArrowUp className="size-3.5" aria-hidden /> : <ArrowDown className="size-3.5" aria-hidden /> : <ChevronsUpDown className="size-3.5 text-muted-foreground" aria-hidden />}
                      </Link>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={rowKey(row, index)} className="border-t">
                {columns.map((column) => {
                  const raw = column.value(row);
                  const text = column.display ? column.display(row) : raw === null || raw === "" ? "—" : String(raw);
                  const href = column.href?.(row, query);
                  return (
                    <td key={column.key} className={cn("px-3 py-2", column.align === "right" && "text-right tabular-nums", column.wide && "hidden lg:table-cell")}>
                      {href ? (
                        <Link href={href} className="font-medium hover:underline">
                          {text}
                        </Link>
                      ) : (
                        <span className="block max-w-56 truncate" title={text.length > 28 ? text : undefined}>
                          {text}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <PaginationBar basePath={basePath} page={page} total={total} pageSize={REPORT_PAGE_SIZE} query={{ ...linkQuery, sort, dir: sort ? dir : undefined }} />
    </div>
  );
}
