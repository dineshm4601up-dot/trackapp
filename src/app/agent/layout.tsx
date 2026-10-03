import type { Metadata } from "next";

import { AgentBottomNav } from "@/components/layout/agent-bottom-nav";
import { AgentHeader } from "@/components/layout/agent-header";
import { SkipLink } from "@/components/layout/skip-link";
import { LiveUpdates } from "@/components/shared/live-updates";
import { siteConfig } from "@/config/site";
import { getBellNotifications } from "@/features/notifications/queries";
import { requireAgent } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: { default: "Agent", template: `%s · ${siteConfig.name}` },
};

// Mobile-first: a single phone-width column, centred on larger screens.
export default async function AgentLayout({ children }: LayoutProps<"/agent">) {
  const { user, profile } = await requireAgent();
  const { unread } = await getBellNotifications(user.id);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col md:max-w-lg md:border-x">
      <SkipLink />
      <AgentHeader profile={profile} unread={unread} />
      {/* One channel for the notification centre: only this user's own rows. */}
      <LiveUpdates
        channel="notifications"
        bindings={[
          { table: "notifications", event: "INSERT", filter: `recipient_user_id=eq.${user.id}` },
          { table: "notifications", event: "UPDATE", filter: `recipient_user_id=eq.${user.id}` },
        ]}
        hidden
      />
      <main
        id="main"
        className="flex-1 space-y-6 px-4 pt-4 pb-[calc(5rem+env(safe-area-inset-bottom))]"
      >
        {children}
      </main>
      <AgentBottomNav />
    </div>
  );
}
