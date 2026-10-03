import Link from "next/link";

import type { ActivityItem } from "@/features/monitoring/queries";
import { formatWallTimeOfInstant } from "@/lib/format";

/** Compact feed of what just happened in the field. */
export function RecentActivity({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">No activity yet.</p>;
  return (
    <ol className="space-y-2.5" aria-label="Recent activity">
      {items.map((item) => (
        <li key={item.id} className="flex gap-3 text-sm">
          <time dateTime={item.at} className="w-16 shrink-0 text-xs text-muted-foreground tabular-nums">
            {formatWallTimeOfInstant(item.at)}
          </time>
          <p className="min-w-0">
            <span className="font-medium">{item.actor}</span> {item.text}{" "}
            <Link href={`/admin/tasks/${item.taskId}`} className="font-mono text-xs hover:underline">
              {item.taskCode}
            </Link>
          </p>
        </li>
      ))}
    </ol>
  );
}
