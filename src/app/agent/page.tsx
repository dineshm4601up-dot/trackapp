import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList, ListChecks } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { StatCard } from "@/components/shared/stat-card";
import { Button } from "@/components/ui/button";
import { siteConfig } from "@/config/site";
import { listMyTasks, myTodayCounts } from "@/features/tasks/agent-queries";
import { AgentTaskCard } from "@/features/tasks/components/agent-task-card";
import { ACTIVE_STATUSES } from "@/features/tasks/constants";
import { formatRate, rate } from "@/lib/analytics/definitions";
import { resolveRange } from "@/lib/analytics/range";
import { requireAgent } from "@/lib/auth/session";
import { businessToday } from "@/lib/format";
import { getMySummary } from "@/features/reports/service";

export const metadata: Metadata = { title: "Home" };

function greeting() {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: siteConfig.timeZone }).format(new Date()),
  );
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

export default async function AgentHomePage() {
  const { profile } = await requireAgent();
  // The agent own figures for the last 30 days (RLS: only their tasks exist for them).
  const [counts, today, mine] = await Promise.all([
    myTodayCounts(),
    listMyTasks("today", 20),
    getMySummary(resolveRange("30d", businessToday())),
  ]);
  const nextUp = today.filter((t) => ACTIVE_STATUSES.includes(t.status)).slice(0, 3);
  const firstName = profile.full_name?.split(" ")[0];

  return (
    <>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {greeting()}
          {firstName ? `, ${firstName}` : ""}
        </h1>
        <p className="text-sm text-muted-foreground">Here&apos;s your day.</p>
      </div>

      <section aria-label="Today's tasks" className="grid grid-cols-2 gap-3">
        <StatCard label="Assigned" value={counts.assigned} />
        <StatCard label="Accepted" value={counts.accepted} />
        <StatCard label="In progress" value={counts.inProgress} />
        <StatCard label="Completed" value={counts.completed} />
      </section>

      {mine && mine.eligible > 0 && (
        <section aria-labelledby="mine-heading" className="space-y-3">
          <h2 id="mine-heading" className="text-lg font-semibold">
            My last 30 days
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="My tasks" value={mine.eligible} />
            <StatCard label="Completed" value={mine.completed} hint={`Completion rate ${formatRate(rate(mine.completed, mine.eligible))}`} />
            <StatCard label="Pending" value={mine.active} />
            <StatCard label="Failed" value={mine.failed} hint={mine.partial ? `${mine.partial} partially completed` : undefined} />
          </div>
        </section>
      )}

      <section aria-labelledby="next-heading" className="space-y-3">
        <h2 id="next-heading" className="text-lg font-semibold">
          Next up
        </h2>
        {nextUp.length === 0 ? (
          <EmptyState icon={ClipboardList} title="You're all caught up" description="No open tasks for today." />
        ) : (
          <ul className="space-y-3">
            {nextUp.map((task) => (
              <li key={task.id}>
                <AgentTaskCard task={task} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <Button size="xl" className="w-full" asChild>
        <Link href="/agent/tasks">
          <ListChecks data-icon="inline-start" aria-hidden />
          View all tasks
        </Link>
      </Button>
    </>
  );
}
