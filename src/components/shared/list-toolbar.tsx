"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { SearchBox } from "@/components/shared/search-box";
import { STATUS_FILTERS, type StatusFilter } from "@/lib/list-params";
import { cn } from "@/lib/utils";

const statusLabels: Record<StatusFilter, string> = { all: "All", active: "Active", inactive: "Inactive" };

/** Search box and active/inactive filter for master-data list pages. */
export function ListToolbar({ searchPlaceholder }: { searchPlaceholder: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const status = (searchParams.get("status") ?? "all") as StatusFilter;

  function statusHref(value: StatusFilter) {
    const params = new URLSearchParams(searchParams);
    if (value === "all") params.delete("status");
    else params.set("status", value);
    params.delete("page");
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <SearchBox placeholder={searchPlaceholder} />
      <nav aria-label="Status filter" className="inline-flex rounded-lg border p-0.5">
        {STATUS_FILTERS.map((value) => (
          <Link
            key={value}
            href={statusHref(value)}
            scroll={false}
            aria-current={status === value ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
              status === value && "bg-muted text-foreground",
            )}
          >
            {statusLabels[value]}
          </Link>
        ))}
      </nav>
    </div>
  );
}
