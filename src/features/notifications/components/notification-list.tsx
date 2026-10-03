import Link from "next/link";
import { Bell, ChevronRight } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { PaginationBar } from "@/components/shared/pagination-bar";
import { Badge } from "@/components/ui/badge";
import { TimeAgo } from "@/features/monitoring/components/live-time";
import { openNotification } from "@/features/notifications/actions";
import { MarkAllReadButton, MarkReadButton } from "@/features/notifications/components/notification-buttons";
import { NOTIFICATION_PAGE_SIZE, notificationTypeMeta } from "@/features/notifications/constants";
import { listMyNotifications, type InboxParams } from "@/features/notifications/queries";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const TONE_BADGE = { info: "info", success: "success", warning: "warning", destructive: "destructive", muted: "secondary" } as const;

type NotificationListProps = {
  userId: string;
  params: InboxParams;
  /** e.g. /agent/notifications */
  basePath: string;
  /** Extra query to keep in links (the admin page's view switch). */
  query?: Record<string, string | undefined>;
};

/** The signed-in user's notification centre: newest first, paginated. */
export async function NotificationList({ userId, params, basePath, query = {} }: NotificationListProps) {
  const { rows, total } = await listMyNotifications(userId, params);
  const linkQuery = (filter: "all" | "unread") => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (value) search.set(key, value);
    if (filter === "unread") search.set("filter", "unread");
    const qs = search.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav aria-label="Notification filter" className="flex gap-1 rounded-lg bg-muted p-1 text-sm">
          {(["all", "unread"] as const).map((filter) => (
            <Link
              key={filter}
              href={linkQuery(filter)}
              aria-current={params.filter === filter ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-1.5 font-medium",
                params.filter === filter ? "bg-background shadow-sm" : "text-muted-foreground",
              )}
            >
              {filter === "all" ? "All" : "Unread"}
            </Link>
          ))}
        </nav>
        <MarkAllReadButton />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Bell}
          title={params.filter === "unread" ? "No unread notifications." : "No notifications yet."}
          description="Task assignments, updates and reminders will appear here."
        />
      ) : (
        <ul className="space-y-2" aria-label="Notifications">
          {rows.map((item) => {
            const meta = notificationTypeMeta(item.type);
            return (
              <li
                key={item.id}
                className={cn("flex items-stretch gap-1 rounded-xl border bg-card", !item.is_read && "border-info/40 bg-info/5")}
              >
                <form action={openNotification.bind(null, item.id)} className="min-w-0 flex-1">
                  <button
                    type="submit"
                    className="flex h-full w-full items-start gap-3 rounded-xl p-4 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", item.is_read ? "bg-transparent" : "bg-info")} aria-hidden />
                    <span className="min-w-0 flex-1 space-y-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{item.title}</span>
                        <Badge variant={TONE_BADGE[meta.tone]}>{meta.label}</Badge>
                        {!item.is_read && <span className="sr-only">Unread</span>}
                      </span>
                      <span className="block text-sm text-muted-foreground">{item.message}</span>
                      <span className="block text-xs text-muted-foreground" title={formatDateTime(item.created_at)}>
                        <TimeAgo at={item.created_at} /> · {formatDateTime(item.created_at)}
                      </span>
                    </span>
                    {item.task_id && <ChevronRight className="mt-1 size-5 shrink-0 text-muted-foreground" aria-hidden />}
                  </button>
                </form>
                {!item.is_read && <MarkReadButton id={item.id} title={item.title} />}
              </li>
            );
          })}
        </ul>
      )}
      <PaginationBar
        basePath={basePath}
        page={params.page}
        total={total}
        pageSize={NOTIFICATION_PAGE_SIZE}
        query={{ ...query, filter: params.filter === "unread" ? "unread" : undefined }}
      />
    </div>
  );
}
