import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList, ListChecks } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { Button } from "@/components/ui/button";
import { requireAgent } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Home" };

export default async function AgentHomePage() {
  const { profile } = await requireAgent();

  return (
    <>
      <PageHeader
        title={`Welcome, ${profile.full_name ?? profile.email ?? "Agent"}`}
        description={`Role: ${profile.role}`}
      />

      <section aria-label="Today's summary" className="grid grid-cols-3 gap-3">
        <StatCard label="Assigned" value="—" />
        <StatCard label="Done" value="—" />
        <StatCard label="Pending" value="—" />
      </section>

      <section aria-labelledby="today-heading" className="space-y-3">
        <h2 id="today-heading" className="text-lg font-semibold">
          Today&apos;s tasks
        </h2>
        <EmptyState
          icon={ClipboardList}
          title="No tasks assigned yet"
          description="Tasks assigned to you will appear here once task management is live."
        />
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
