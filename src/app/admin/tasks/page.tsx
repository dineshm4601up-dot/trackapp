import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Plus } from "lucide-react";

import { ListSkeleton } from "@/components/shared/list-states";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { TaskFiltersBar } from "@/features/tasks/components/task-filters";
import { TaskList } from "@/features/tasks/components/task-list";
import { getFilterSelections } from "@/features/tasks/queries";
import { parseTaskFilters } from "@/features/tasks/schemas";
import { requireAdmin } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Tasks" };

export default async function TasksPage(props: PageProps<"/admin/tasks">) {
  await requireAdmin();
  const filters = parseTaskFilters(await props.searchParams);
  const selections = await getFilterSelections(filters);

  return (
    <>
      <PageHeader
        title="Tasks"
        description="Create, assign and track field tasks."
        actions={
          <Button asChild>
            <Link href="/admin/tasks/new">
              <Plus data-icon="inline-start" aria-hidden />
              Create task
            </Link>
          </Button>
        }
      />
      <TaskFiltersBar selectedAgent={selections.agent} selectedCustomer={selections.customer} />
      <Suspense key={JSON.stringify(filters)} fallback={<ListSkeleton label="Loading tasks…" />}>
        <TaskList filters={filters} />
      </Suspense>
    </>
  );
}
