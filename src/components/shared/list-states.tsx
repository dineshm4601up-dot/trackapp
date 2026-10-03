import Link from "next/link";
import { Plus, SearchX, type LucideIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { ListParams } from "@/lib/list-params";

export function ActiveBadge({ isActive }: { isActive: boolean }) {
  return <Badge variant={isActive ? "success" : "secondary"}>{isActive ? "Active" : "Inactive"}</Badge>;
}

export function ListSkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-2" role="status" aria-label={label}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-12 rounded-lg" />
      ))}
    </div>
  );
}

/** "Nothing yet" with a create button, or "no matches" when filters are applied. */
export function ListEmpty({
  params,
  icon,
  plural,
  createHref,
  createLabel,
}: {
  params: ListParams;
  icon: LucideIcon;
  plural: string;
  createHref: string;
  createLabel: string;
}) {
  const filtered = params.q !== "" || params.status !== "all";
  if (filtered) {
    return (
      <EmptyState
        icon={SearchX}
        title={`No matching ${plural} found.`}
        description="Try a different search term or status filter."
      />
    );
  }
  return (
    <EmptyState
      icon={icon}
      title={`No ${plural} found.`}
      description={`Create your first ${plural.replace(/s$/, "")} to get started.`}
      action={
        <Button asChild>
          <Link href={createHref}>
            <Plus data-icon="inline-start" aria-hidden />
            {createLabel}
          </Link>
        </Button>
      }
    />
  );
}

/** Stable key so a list re-suspends (shows its skeleton) when filters change. */
export function listKey(params: ListParams) {
  return `${params.q}|${params.status}|${params.page}`;
}
