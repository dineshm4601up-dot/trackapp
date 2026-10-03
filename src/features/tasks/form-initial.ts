import type { TaskFormInitial } from "@/features/tasks/components/task-form";
import type { TaskDetail } from "@/features/tasks/queries";
import { formatQuantity, numericText } from "@/lib/decimal";

/** Maps a loaded task to the edit form's initial state. */
export function toFormInitial(task: TaskDetail): TaskFormInitial | null {
  if (!task.customer || !task.location) return null;
  const profile = task.agent?.profile;
  return {
    task_type: task.task_type,
    title: task.title,
    description: task.description ?? "",
    priority: task.priority,
    customer: task.customer,
    location: {
      id: task.location.id,
      location_name: task.location.location_name,
      city: task.location.city,
      is_active: task.location.is_active,
    },
    agent: task.agent
      ? {
          id: task.agent.id,
          full_name: profile?.full_name ?? null,
          employee_code: task.agent.employee_code,
          phone: profile?.phone ?? null,
          is_active: task.agent.is_active && (profile?.is_active ?? false),
        }
      : null,
    expected_amount: numericText(task.expected_amount, 2),
    scheduled_date: task.scheduled_date ?? "",
    scheduled_start_time: task.scheduled_start_time?.slice(0, 5) ?? "",
    scheduled_end_time: task.scheduled_end_time?.slice(0, 5) ?? "",
    lines: task.task_products.flatMap((line) =>
      line.product
        ? [
            {
              product: line.product,
              quantity: formatQuantity(line.assigned_quantity),
              unitPrice: numericText(line.unit_price, 2),
            },
          ]
        : [],
    ),
  };
}
