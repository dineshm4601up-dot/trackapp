import { Badge } from "@/components/ui/badge";
import { TASK_STATUS_META, TASK_TYPE_META, type TaskStatus, type TaskType } from "@/features/tasks/constants";

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const meta = TASK_STATUS_META[status];
  return <Badge variant={meta.badge}>{meta.label}</Badge>;
}

export function taskTypeLabel(type: TaskType) {
  return TASK_TYPE_META[type].label;
}

export function PriorityText({ priority }: { priority: number }) {
  const tone = priority <= 1 ? "text-destructive font-medium" : priority === 2 ? "text-warning font-medium" : "";
  return <span className={tone}>P{priority}</span>;
}
