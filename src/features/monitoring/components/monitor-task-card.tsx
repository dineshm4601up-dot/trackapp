import Link from "next/link";
import { Banknote, FileCheck, MapPin, MapPinCheck, Navigation, Package, UserRound, type LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { LocationAge, TimeAgo } from "@/features/monitoring/components/live-time";
import { TRACKED_STATUSES } from "@/features/monitoring/config";
import type { MonitorTask } from "@/features/monitoring/queries";
import { PriorityText, TaskStatusBadge, taskTypeLabel } from "@/features/tasks/components/task-badges";
import { DONE_STATUSES, TASK_TYPE_META } from "@/features/tasks/constants";
import { formatQuantity, numericText } from "@/lib/decimal";
import { formatMoney, formatWallTimeOfInstant } from "@/lib/format";

/** One task on the monitoring board. All figures are database values. */
export function MonitorTaskCard({ task }: { task: MonitorTask }) {
  const tracked = task.status !== null && (TRACKED_STATUSES as readonly string[]).includes(task.status);
  const done = task.status !== null && DONE_STATUSES.includes(task.status);
  const meta = task.task_type ? TASK_TYPE_META[task.task_type] : null;
  return (
    <Card size="sm">
      <CardContent className="space-y-2 text-sm">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <Link href={`/admin/tasks/${task.id}`} className="font-mono text-xs font-medium hover:underline">
              {task.task_code}
            </Link>
            <p className="truncate font-medium">{task.title}</p>
            <p className="text-xs text-muted-foreground">
              {task.task_type ? taskTypeLabel(task.task_type) : "—"}
              {task.priority ? (
                <>
                  {" · "}
                  <PriorityText priority={task.priority} />
                </>
              ) : null}
            </p>
          </div>
          {task.status && <TaskStatusBadge status={task.status} />}
        </div>

        <dl className="space-y-1">
          <Row icon={UserRound} label="Agent">
            {task.agent_name ?? "Unassigned"}
          </Row>
          <Row icon={MapPin} label="Customer">
            <span className="block truncate">
              {task.customer_name ?? "—"}
              {task.location_name ? ` · ${task.location_name}` : ""}
              {task.location_city ? `, ${task.location_city}` : ""}
            </span>
          </Row>
          {(tracked || task.last_location_at) && (
            <Row icon={Navigation} label="Location">
              <LocationAge at={task.last_location_at} accuracy={task.last_accuracy_meters} tracked={tracked} />
            </Row>
          )}
          {task.checked_in_at && (
            <Row icon={MapPinCheck} label="Checked in">
              Checked in {formatWallTimeOfInstant(task.checked_in_at)}
            </Row>
          )}
          {meta?.execution === "delivery" && task.assigned_total !== null && (
            <Row icon={Package} label="Delivery">
              {done
                ? `${formatQuantity(numericText(task.delivered_total, 3))} / ${formatQuantity(numericText(task.assigned_total, 3))} delivered`
                : `${formatQuantity(numericText(task.assigned_total, 3))} to deliver · ${task.line_count} line${task.line_count === 1 ? "" : "s"}`}
            </Row>
          )}
          {meta?.execution === "cash" && task.expected_amount !== null && (
            <Row icon={Banknote} label="Cash">
              {task.collected_amount !== null
                ? `${formatMoney(numericText(task.collected_amount, 2))} / ${formatMoney(numericText(task.expected_amount, 2))} collected`
                : `${formatMoney(numericText(task.expected_amount, 2))} to collect`}
            </Row>
          )}
          {(task.proof_count ?? 0) > 0 && (
            <Row icon={FileCheck} label="Proof">
              {task.proof_count} proof file{task.proof_count === 1 ? "" : "s"}
            </Row>
          )}
        </dl>
        {task.updated_at && (
          <p className="text-xs text-muted-foreground">
            Last change <TimeAgo at={task.updated_at} />
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <dt className="sr-only">{label}</dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}
