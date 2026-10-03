import Link from "next/link";
import { CalendarDays, CircleCheck, ChevronRight, MapPin } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import type { MyTaskCard } from "@/features/tasks/agent-queries";
import { PriorityText, TaskStatusBadge, taskTypeLabel } from "@/features/tasks/components/task-badges";
import { ACTIVE_STATUSES, priorityLabel } from "@/features/tasks/constants";
import { businessToday, formatCalendarDate, formatDateTime, formatWallTime } from "@/lib/format";

/** Mobile task card; the whole card opens the task. */
export function AgentTaskCard({ task }: { task: MyTaskCard }) {
  const today = businessToday();
  const date =
    task.scheduled_date === today
      ? "Today"
      : task.scheduled_date
        ? formatCalendarDate(task.scheduled_date)
        : "Not scheduled";
  const overdue = task.scheduled_date !== null && task.scheduled_date < today && ACTIVE_STATUSES.includes(task.status);
  const time = task.scheduled_start_time
    ? `${formatWallTime(task.scheduled_start_time)}${task.scheduled_end_time ? ` – ${formatWallTime(task.scheduled_end_time)}` : ""}`
    : null;

  return (
    <Link
      href={`/agent/tasks/${task.id}`}
      className="block rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <Card size="sm" className="transition-colors active:bg-muted">
        <CardContent className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <p className="font-mono text-xs text-muted-foreground">
              {task.task_code} · {taskTypeLabel(task.task_type)}
            </p>
            <TaskStatusBadge status={task.status} />
          </div>
          <p className="text-base leading-snug font-medium">{task.title}</p>
          <div className="space-y-1 text-sm text-muted-foreground">
            {(task.customer || task.location) && (
              <p className="flex items-start gap-2">
                <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span className="min-w-0">
                  {task.customer && <span className="block truncate text-foreground">{task.customer.name}</span>}
                  {task.location && (
                    <span className="block truncate">
                      {task.location.location_name}
                      {task.location.city ? `, ${task.location.city}` : ""}
                    </span>
                  )}
                </span>
              </p>
            )}
            <p className="flex items-center gap-2">
              <CalendarDays className="size-4 shrink-0" aria-hidden />
              <span className={overdue ? "font-medium text-destructive" : undefined}>
                {date}
                {overdue && " (overdue)"}
              </span>
              {time && <span>· {time}</span>}
            </p>
            {task.completed_at && (
              <p className="flex items-center gap-2">
                <CircleCheck className="size-4 shrink-0" aria-hidden />
                Finished {formatDateTime(task.completed_at)}
              </p>
            )}
          </div>
          <div className="flex items-center justify-between text-sm">
            <span>
              Priority: <PriorityText priority={task.priority} />{" "}
              <span className="text-muted-foreground">{priorityLabel(task.priority).replace(/^\d — /, "")}</span>
            </span>
            <ChevronRight className="size-5 text-muted-foreground" aria-hidden />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
