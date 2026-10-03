import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PAGE_SIZE } from "@/lib/list-params";

type PaginationBarProps = {
  basePath: string;
  page: number;
  total: number;
  /** Active filters to keep in page links (empty values are dropped). */
  query: Record<string, string | undefined>;
  pageSize?: number;
};

function hrefFor(basePath: string, query: PaginationBarProps["query"], page: number) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value) search.set(key, value);
  if (page > 1) search.set("page", String(page));
  const qs = search.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

export function PaginationBar({ basePath, page: requested, total, query, pageSize = PAGE_SIZE }: PaginationBarProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requested, pageCount);
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-4 text-sm text-muted-foreground">
      <p>
        Showing <span className="font-medium text-foreground">{first}–{last}</span> of{" "}
        <span className="font-medium text-foreground">{total}</span>
      </p>
      {pageCount > 1 && (
        <div className="flex items-center gap-2">
          <PageLink href={hrefFor(basePath, query, page - 1)} disabled={page <= 1} label="Previous page">
            <ChevronLeft aria-hidden />
          </PageLink>
          <span>
            Page {page} of {pageCount}
          </span>
          <PageLink href={hrefFor(basePath, query, page + 1)} disabled={page >= pageCount} label="Next page">
            <ChevronRight aria-hidden />
          </PageLink>
        </div>
      )}
    </nav>
  );
}

function PageLink({ href, disabled, label, children }: { href: string; disabled: boolean; label: string; children: React.ReactNode }) {
  if (disabled) {
    return (
      <Button variant="outline" size="icon" disabled aria-label={label}>
        {children}
      </Button>
    );
  }
  return (
    <Button variant="outline" size="icon" asChild>
      <Link href={href} aria-label={label} scroll={false}>
        {children}
      </Link>
    </Button>
  );
}
