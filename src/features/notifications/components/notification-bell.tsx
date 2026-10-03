"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Bell, CheckCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TimeAgo } from "@/features/monitoring/components/live-time";
import { markAllNotificationsRead, openNotification } from "@/features/notifications/actions";
import type { BellNotifications } from "@/features/notifications/queries";
import { cn } from "@/lib/utils";

function UnreadBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span
      aria-hidden
      className="absolute -top-0.5 -right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[11px] leading-none font-semibold text-white"
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

const bellLabel = (unread: number) => (unread ? `Notifications, ${unread} unread` : "Notifications");

/** Mobile: the bell is a plain link to the notification centre. */
export function NotificationBellLink({ unread, href }: { unread: number; href: string }) {
  return (
    <Link href={href} aria-label={bellLabel(unread)} className="relative flex size-11 items-center justify-center rounded-full">
      <Bell className="size-5" aria-hidden />
      <UnreadBadge count={unread} />
    </Link>
  );
}

/** Desktop: bell with unread badge and a dropdown of the newest notifications. */
export function NotificationBell({ notifications, href }: { notifications: BellNotifications; href: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const { unread, items } = notifications;

  function markAll() {
    startTransition(async () => {
      const result = await markAllNotificationsRead();
      if (!result.ok) toast.error(result.message);
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative rounded-full" aria-label={bellLabel(unread)}>
          <Bell aria-hidden />
          <UnreadBadge count={unread} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-88 max-w-[calc(100vw-2rem)] p-0">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <p className="font-semibold">Notifications</p>
          <Button variant="ghost" size="sm" onClick={markAll} disabled={pending || unread === 0}>
            <CheckCheck data-icon="inline-start" aria-hidden />
            Mark all as read
          </Button>
        </div>
        {items.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">You have no notifications yet.</p>
        ) : (
          <ul className="max-h-96 divide-y overflow-y-auto" aria-label="Latest notifications">
            {items.map((item) => (
              <li key={item.id}>
                <form action={openNotification.bind(null, item.id)}>
                  <button
                    type="submit"
                    className={cn(
                      "flex w-full items-start gap-3 px-4 py-3 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted",
                      !item.is_read && "bg-info/5",
                    )}
                  >
                    <span
                      className={cn("mt-1.5 size-2 shrink-0 rounded-full", item.is_read ? "bg-transparent" : "bg-info")}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">
                        {item.title}
                        {!item.is_read && <span className="sr-only"> (unread)</span>}
                      </span>
                      <span className="block text-muted-foreground">{item.message}</span>
                      <span className="block text-xs text-muted-foreground">
                        <TimeAgo at={item.created_at} />
                      </span>
                    </span>
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t p-2">
          <Button variant="ghost" size="sm" className="w-full" asChild>
            <Link href={href} onClick={() => setOpen(false)}>
              View all notifications
            </Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
