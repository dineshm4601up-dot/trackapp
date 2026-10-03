import type { Metadata } from "next";
import { Suspense } from "react";

import { ListSkeleton } from "@/components/shared/list-states";
import { PageHeader } from "@/components/shared/page-header";
import { NotificationList } from "@/features/notifications/components/notification-list";
import { inboxParamsSchema } from "@/features/notifications/queries";
import { requireAgent } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Notifications" };

export default async function AgentNotificationsPage(props: PageProps<"/agent/notifications">) {
  const { user } = await requireAgent();
  const searchParams = await props.searchParams;
  const first = (key: string) => {
    const value = searchParams[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const params = inboxParamsSchema.parse({ filter: first("filter"), page: first("page") });

  return (
    <>
      <PageHeader title="Notifications" />
      <Suspense fallback={<ListSkeleton label="Loading notifications…" />}>
        <NotificationList userId={user.id} params={params} basePath="/agent/notifications" />
      </Suspense>
    </>
  );
}
