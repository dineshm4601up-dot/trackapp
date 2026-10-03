import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Map } from "lucide-react";

import { ListSkeleton } from "@/components/shared/list-states";
import { LiveUpdates } from "@/components/shared/live-updates";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { MonitorList } from "@/features/monitoring/components/monitor-list";
import { MONITORING_BINDINGS } from "@/features/monitoring/config";
import { TaskFiltersBar } from "@/features/tasks/components/task-filters";
import { getFilterSelections } from "@/features/tasks/queries";
import { parseTaskFilters, taskFilterQuery } from "@/features/tasks/schemas";
import { requireAdmin } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Monitoring" };

export default async function MonitoringPage(props: PageProps<"/admin/monitoring">) {
  await requireAdmin();
  const filters = parseTaskFilters(await props.searchParams);
  const selections = await getFilterSelections(filters);

  return (
    <>
      <PageHeader
        title="Monitoring"
        description="Open tasks by status, updated live as agents work. Use the filters to look at other dates or outcomes."
        actions={
          <>
            <LiveUpdates channel="admin-monitoring" bindings={MONITORING_BINDINGS} />
            <Button variant="outline" asChild>
              <Link href="/admin/monitoring/map">
                <Map data-icon="inline-start" aria-hidden />
                Map
              </Link>
            </Button>
          </>
        }
      />
      <TaskFiltersBar
        selectedAgent={selections.agent}
        selectedCustomer={selections.customer}
        selectedLocation={selections.location}
      />
      {/* Keyed by filters only: a live refresh updates the list in place, without a loading flash. */}
      <Suspense key={JSON.stringify({ ...taskFilterQuery(filters), page: filters.page })} fallback={<ListSkeleton label="Loading tasks…" />}>
        <MonitorList filters={filters} />
      </Suspense>
    </>
  );
}
