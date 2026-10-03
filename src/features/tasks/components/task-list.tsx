import Link from "next/link";
import { ClipboardList, Eye, Pencil, Plus, SearchX } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { PaginationBar } from "@/components/shared/pagination-bar";
import { ResponsiveTable, type Column } from "@/components/shared/responsive-table";
import { Button } from "@/components/ui/button";
import { isEditable } from "@/features/tasks/constants";
import { PriorityText, TaskStatusBadge, taskTypeLabel } from "@/features/tasks/components/task-badges";
import { listTasks, type TaskListRow } from "@/features/tasks/queries";
import { taskFilterQuery, type TaskFilters } from "@/features/tasks/schemas";
import { formatDate, formatShortCalendarDate, formatWallTime } from "@/lib/format";

const columns: Column<TaskListRow>[] = [
  {
    header: "Task",
    cell: (t) => (
      <span className="flex max-w-56 flex-col">
        <Link href={`/admin/tasks/${t.id}`} className="font-mono text-xs font-medium hover:underline">
          {t.task_code}
        </Link>
        <span className="truncate text-xs text-muted-foreground">{t.title}</span>
      </span>
    ),
    hideOnMobile: true,
  },
  { header: "Type", cell: (t) => (t.task_type ? taskTypeLabel(t.task_type) : "—") },
  {
    header: "Customer",
    cell: (t) => <span className="block max-w-48 truncate">{t.customer_name ?? "—"}</span>,
  },
  {
    header: "Location",
    cell: (t) => <span className="block max-w-48 truncate">{t.location_name ?? "—"}</span>,
    className: "hidden 2xl:table-cell",
  },
  {
    header: "Agent",
    cell: (t) => (t.agent_name ? <span className="block max-w-40 truncate">{t.agent_name}</span> : <span className="text-muted-foreground">Unassigned</span>),
  },
  {
    header: "Scheduled",
    cell: (t) =>
      t.scheduled_date ? (
        <span className="flex flex-col whitespace-nowrap">
          {formatShortCalendarDate(t.scheduled_date)}
          {t.scheduled_start_time && <span className="text-xs text-muted-foreground">{formatWallTime(t.scheduled_start_time)}</span>}
        </span>
      ) : (
        "—"
      ),
  },
  { header: "Priority", cell: (t) => (t.priority ? <PriorityText priority={t.priority} /> : "—") },
  { header: "Status", cell: (t) => (t.status ? <TaskStatusBadge status={t.status} /> : "—") },
  { header: "Created", cell: (t) => formatDate(t.created_at), className: "hidden 2xl:table-cell" },
];

export async function TaskList({ filters }: { filters: TaskFilters }) {
  const { rows, total } = await listTasks(filters);

  if (rows.length === 0) {
    const filtered = Object.values(taskFilterQuery(filters)).some(Boolean);
    return filtered ? (
      <EmptyState icon={SearchX} title="No matching tasks found." description="Try a different search or clear some filters." />
    ) : (
      <EmptyState
        icon={ClipboardList}
        title="No tasks yet."
        description="Create your first task and assign it to an agent."
        action={
          <Button asChild>
            <Link href="/admin/tasks/new">
              <Plus data-icon="inline-start" aria-hidden />
              Create task
            </Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <ResponsiveTable
        caption="Tasks"
        rows={rows}
        columns={columns}
        title={(t) => (
          <span className="flex flex-col">
            <span className="font-mono text-xs text-muted-foreground">{t.task_code}</span>
            {t.title}
          </span>
        )}
        actions={(t) => (
          <>
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/admin/tasks/${t.id}`} aria-label={`View ${t.task_code}`}>
                <Eye aria-hidden />
                View
              </Link>
            </Button>
            {t.status && isEditable(t.status) && (
              <Button variant="ghost" size="sm" asChild>
                <Link href={`/admin/tasks/${t.id}/edit`} aria-label={`Edit ${t.task_code}`}>
                  <Pencil aria-hidden />
                  Edit
                </Link>
              </Button>
            )}
          </>
        )}
      />
      <PaginationBar basePath="/admin/tasks" page={filters.page} total={total} query={taskFilterQuery(filters)} />
    </div>
  );
}
