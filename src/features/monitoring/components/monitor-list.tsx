import { Activity, SearchX } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { PaginationBar } from "@/components/shared/pagination-bar";
import { MonitorTaskCard } from "@/features/monitoring/components/monitor-task-card";
import { STATUS_GROUP_ORDER } from "@/features/monitoring/config";
import { listMonitorTasks, MONITOR_PAGE_SIZE } from "@/features/monitoring/queries";
import { TASK_STATUS_META } from "@/features/tasks/constants";
import { taskFilterQuery, type TaskFilters } from "@/features/tasks/schemas";

/** Tasks grouped by status. Filtering, search and paging happen in the database. */
export async function MonitorList({ filters }: { filters: TaskFilters }) {
  const { rows, total } = await listMonitorTasks(filters);

  if (rows.length === 0) {
    const filtered = Object.values(taskFilterQuery(filters)).some(Boolean);
    return filtered ? (
      <EmptyState icon={SearchX} title="No tasks match these filters." description="Try a different search or clear some filters." />
    ) : (
      <EmptyState
        icon={Activity}
        title="No open tasks right now."
        description="Assigned and in-progress tasks appear here as agents work on them."
      />
    );
  }

  const groups = STATUS_GROUP_ORDER.flatMap((status) => {
    const tasks = rows.filter((task) => task.status === status);
    return tasks.length ? [{ status, tasks }] : [];
  });

  return (
    <div className="space-y-6">
      {groups.map(({ status, tasks }) => (
        <section key={status} aria-labelledby={`group-${status}`} className="space-y-3">
          <h2 id={`group-${status}`} className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
            {TASK_STATUS_META[status].label} <span className="tabular-nums">({tasks.length})</span>
          </h2>
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {tasks.map((task) => (
              <li key={task.id}>
                <MonitorTaskCard task={task} />
              </li>
            ))}
          </ul>
        </section>
      ))}
      <PaginationBar
        basePath="/admin/monitoring"
        page={filters.page}
        total={total}
        pageSize={MONITOR_PAGE_SIZE}
        query={taskFilterQuery(filters)}
      />
    </div>
  );
}
