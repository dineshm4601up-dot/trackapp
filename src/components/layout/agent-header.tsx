import Link from "next/link";

import { Brand } from "@/components/layout/brand";
import { UserAvatar } from "@/components/layout/user-avatar";
import { NotificationBellLink } from "@/features/notifications/components/notification-bell";
import type { Profile } from "@/lib/auth/profile";

export function AgentHeader({ profile, unread }: { profile: Profile; unread: number }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <Brand href="/agent" />
      <div className="flex items-center">
        <NotificationBellLink unread={unread} href="/agent/notifications" />
        <Link
          href="/agent/profile"
          aria-label="Profile"
          className="flex size-11 items-center justify-center rounded-full"
        >
          <UserAvatar profile={profile} />
        </Link>
      </div>
    </header>
  );
}
