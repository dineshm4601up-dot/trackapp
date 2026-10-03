import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { ListSkeleton } from "@/components/shared/list-states";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CommunicationLog, CommunicationLogFilters } from "@/features/notifications/components/communication-log";
import { NotificationList } from "@/features/notifications/components/notification-list";
import { NotificationPreferencesForm } from "@/features/notifications/components/preferences-form";
import { CHANNEL_LABELS } from "@/features/notifications/constants";
import { getMyPreferences, inboxParamsSchema, logFiltersSchema } from "@/features/notifications/queries";
import { requireAdmin } from "@/lib/auth/session";
import { channelStatus } from "@/lib/communication/providers";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Notifications" };

const VIEWS = [
  { key: "inbox", label: "My notifications" },
  { key: "log", label: "Delivery log" },
  { key: "settings", label: "Settings" },
] as const;
type View = (typeof VIEWS)[number]["key"];

export default async function AdminNotificationsPage(props: PageProps<"/admin/notifications">) {
  const { user } = await requireAdmin();
  const searchParams = await props.searchParams;
  const first = (key: string) => {
    const value = searchParams[key];
    const v = Array.isArray(value) ? value[0] : value;
    return v === "" ? undefined : v;
  };
  const view: View = VIEWS.some((v) => v.key === first("view")) ? (first("view") as View) : "inbox";

  return (
    <>
      <PageHeader title="Notifications" description="Your notifications, what was sent to everyone, and your preferences." />
      <nav aria-label="Notification views" className="flex w-fit gap-1 rounded-lg bg-muted p-1 text-sm">
        {VIEWS.map((v) => (
          <Link
            key={v.key}
            href={v.key === "inbox" ? "/admin/notifications" : `/admin/notifications?view=${v.key}`}
            aria-current={view === v.key ? "page" : undefined}
            className={cn("rounded-md px-3 py-1.5 font-medium", view === v.key ? "bg-background shadow-sm" : "text-muted-foreground")}
          >
            {v.label}
          </Link>
        ))}
      </nav>

      {view === "inbox" && (
        <Suspense fallback={<ListSkeleton label="Loading notifications…" />}>
          <NotificationList
            userId={user.id}
            params={inboxParamsSchema.parse({ filter: first("filter"), page: first("page") })}
            basePath="/admin/notifications"
          />
        </Suspense>
      )}

      {view === "log" && <LogView filters={logFiltersSchema.parse(Object.fromEntries(["q", "type", "channel", "status", "from", "to", "page"].map((k) => [k, first(k) ?? (k === "q" ? "" : undefined)])))} />}

      {view === "settings" && <SettingsView userId={user.id} />}
    </>
  );
}

function LogView({ filters }: { filters: ReturnType<typeof logFiltersSchema.parse> }) {
  return (
    <>
      <CommunicationLogFilters filters={filters} />
      <Suspense key={JSON.stringify(filters)} fallback={<ListSkeleton label="Loading the delivery log…" />}>
        <CommunicationLog filters={filters} />
      </Suspense>
    </>
  );
}

async function SettingsView({ userId }: { userId: string }) {
  const [preferences, channels] = [await getMyPreferences(userId), channelStatus()];
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <NotificationPreferencesForm initial={preferences} emailAvailable={channels.EMAIL.enabled} />
      <Card>
        <CardHeader>
          <CardTitle>Channels</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3 text-sm" aria-label="Communication channels">
            <li className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">{CHANNEL_LABELS.IN_APP}</p>
                <p className="text-xs text-muted-foreground">Notification centre with live updates.</p>
              </div>
              <Badge variant="success">Enabled</Badge>
            </li>
            {(["EMAIL", "SMS", "WHATSAPP"] as const).map((channel) => {
              const state = channels[channel];
              return (
                <li key={channel} className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{CHANNEL_LABELS[channel]}</p>
                    <p className="text-xs text-muted-foreground">{state.enabled ? `Provider: ${state.provider}` : state.reason}</p>
                  </div>
                  <Badge variant={state.enabled ? "success" : "secondary"}>{state.enabled ? "Enabled" : "Not enabled"}</Badge>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
