import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity,
  Building2,
  CalendarDays,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  ClipboardList,
  FilePen,
  MapPin,
  MapPinCheck,
  Navigation,
  Package,
  Play,
  Plus,
  Users,
  type LucideIcon,
} from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { LiveUpdates } from "@/components/shared/live-updates";
import { StatCard } from "@/components/shared/stat-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AgentBoard } from "@/features/monitoring/components/agent-board";
import { RecentActivity } from "@/features/monitoring/components/recent-activity";
import { MONITORING_BINDINGS } from "@/features/monitoring/config";
import { countAgentsInField, getAgentBoard, getRecentActivity, getStatusCounts } from "@/features/monitoring/queries";
import { requireAdmin } from "@/lib/auth/session";
import { businessToday } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Admin Dashboard" };

type MasterTable = "agents" | "customers" | "locations" | "products";

const masterData: { table: MasterTable; label: string; href: string; icon: LucideIcon }[] = [
  { table: "agents", label: "Active agents", href: "/admin/agents", icon: Users },
  { table: "customers", label: "Active customers", href: "/admin/customers", icon: Building2 },
  { table: "locations", label: "Active locations", href: "/admin/locations", icon: MapPin },
  { table: "products", label: "Active products", href: "/admin/products", icon: Package },
];

/** Head-only count queries (no rows transferred), run in parallel. */
async function getActiveCounts() {
  const supabase = await createClient();
  return Promise.all(
    masterData.map(async ({ table }) => {
      const { count, error } = await supabase
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("is_active", true);
      return error ? null : count;
    }),
  );
}

/** Scheduled today (not cancelled), assigned, drafts — head-only counts in parallel. */
async function getTaskCounts(today: string) {
  const supabase = await createClient();
  const tasks = () => supabase.from("tasks").select("id", { count: "exact", head: true });
  const results = await Promise.all([
    tasks().eq("scheduled_date", today).neq("status", "CANCELLED"),
    tasks().eq("status", "ASSIGNED"),
    tasks().eq("status", "DRAFT"),
  ]);
  return results.map(({ count, error }) => (error ? null : count));
}

export default async function AdminDashboardPage() {
  const { profile } = await requireAdmin();
  const today = businessToday();
  const taskCards = [
    { label: "Scheduled today", href: `/admin/tasks?date=${today}`, icon: CalendarDays },
    { label: "Assigned", href: "/admin/tasks?status=ASSIGNED", icon: ClipboardList },
    { label: "Drafts", href: "/admin/tasks?status=DRAFT", icon: FilePen },
  ];
  const [counts, taskCounts, statusCounts, inField, agents, activity] = await Promise.all([
    getActiveCounts(),
    getTaskCounts(today),
    getStatusCounts(today),
    countAgentsInField(),
    getAgentBoard(12),
    getRecentActivity(12),
  ]);
  const n = (...statuses: (keyof NonNullable<typeof statusCounts>)[]) =>
    statusCounts ? statuses.reduce((sum, status) => sum + (statusCounts[status] ?? 0), 0) : "—";
  // Today = scheduled today, plus anything still out in the field from another day.
  const liveCards = [
    { label: "Agents in the field", value: inField ?? "—", href: "/admin/monitoring/map", icon: Users },
    { label: "Assigned", value: n("ASSIGNED", "ACCEPTED"), href: `/admin/monitoring?date=${today}&status=ASSIGNED`, icon: ClipboardList },
    { label: "On the way", value: n("ON_THE_WAY"), href: "/admin/monitoring?status=ON_THE_WAY", icon: Navigation },
    { label: "At location", value: n("ARRIVED", "CHECKED_IN"), href: "/admin/monitoring?status=CHECKED_IN", icon: MapPinCheck },
    { label: "In progress", value: n("IN_PROGRESS"), href: "/admin/monitoring?status=IN_PROGRESS", icon: Play },
    { label: "Completed", value: n("COMPLETED", "VERIFIED"), href: `/admin/monitoring?date=${today}&status=COMPLETED`, icon: CircleCheck },
    { label: "Partially completed", value: n("PARTIALLY_COMPLETED"), href: `/admin/monitoring?date=${today}&status=PARTIALLY_COMPLETED`, icon: CircleDashed },
    { label: "Failed", value: n("FAILED"), href: `/admin/monitoring?date=${today}&status=FAILED`, icon: CircleAlert },
  ];

  return (
    <>
      <PageHeader
        title={`Welcome, ${profile.full_name ?? profile.email ?? "Administrator"}`}
        description={`Role: ${profile.role}`}
        actions={<LiveUpdates channel="admin-dashboard" bindings={MONITORING_BINDINGS} />}
      />

      <section aria-labelledby="today-heading" className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <h2 id="today-heading" className="text-lg font-semibold">
            Today&apos;s operations
          </h2>
          <Button size="sm" variant="outline" asChild>
            <Link href="/admin/monitoring">
              <Activity data-icon="inline-start" aria-hidden />
              Open monitoring
            </Link>
          </Button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {liveCards.map((card) => (
            <Link key={card.label} href={card.href} className="rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
              <StatCard label={card.label} value={card.value} icon={card.icon} />
            </Link>
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Agents</CardTitle>
            </CardHeader>
            <CardContent>
              <AgentBoard agents={agents} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Recent activity</CardTitle>
            </CardHeader>
            <CardContent>
              <RecentActivity items={activity} />
            </CardContent>
          </Card>
        </div>
      </section>

      <section aria-labelledby="master-data-heading" className="space-y-3">
        <h2 id="master-data-heading" className="text-lg font-semibold">
          Master data
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {masterData.map((item, i) => (
            <Link
              key={item.table}
              href={item.href}
              className="rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <StatCard label={item.label} value={counts[i] ?? "—"} icon={item.icon} />
            </Link>
          ))}
        </div>
      </section>

      <section aria-labelledby="operations-heading" className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <h2 id="operations-heading" className="text-lg font-semibold">
            Tasks
          </h2>
          <Button size="sm" asChild>
            <Link href="/admin/tasks/new">
              <Plus data-icon="inline-start" aria-hidden />
              Create task
            </Link>
          </Button>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {taskCards.map((card, i) => (
            <Link
              key={card.label}
              href={card.href}
              className="rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <StatCard label={card.label} value={taskCounts[i] ?? "—"} icon={card.icon} />
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
