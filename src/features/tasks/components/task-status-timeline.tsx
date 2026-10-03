import { Check, Circle, X } from "lucide-react";

import { TASK_STATUS_META, TIMELINE_STEPS, type TaskStatus } from "@/features/tasks/constants";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type HistoryEntry = { new_status: TaskStatus; changed_at: string; reason?: string | null };

type TaskStatusTimelineProps = {
  status: TaskStatus;
  /** Rows from task_status_history (oldest first). Times shown are only ever real ones. */
  history: HistoryEntry[];
};

const OFF_PATH: readonly TaskStatus[] = ["FAILED", "CANCELLED", "PARTIALLY_COMPLETED"];

/**
 * Milestones of the normal path with the time each was reached (from history).
 * A task that ended off the path (failed / cancelled / partial) shows that
 * outcome after the last milestone it reached.
 */
export function TaskStatusTimeline({ status, history }: TaskStatusTimelineProps) {
  const reachedAt = new Map<TaskStatus, string>();
  for (const entry of history) reachedAt.set(entry.new_status, entry.changed_at);
  // Only the check-in step shows its reason ("GPS geofence check-in"); other notes stay private.
  const checkInReason = history.findLast((e) => e.new_status === "CHECKED_IN")?.reason ?? undefined;

  const offPath = OFF_PATH.includes(status) ? status : null;
  const lastReached = TIMELINE_STEPS.reduce((last, step, i) => (reachedAt.has(step) ? i : last), -1);
  const steps = offPath ? TIMELINE_STEPS.slice(0, lastReached + 1) : TIMELINE_STEPS;

  return (
    <ol className="space-y-0" aria-label="Task progress">
      {steps.map((step, i) => {
        const at = reachedAt.get(step);
        const current = !offPath && step === status;
        const done = Boolean(at) || i < lastReached;
        return (
          <TimelineItem
            key={step}
            label={TASK_STATUS_META[step].label}
            time={at ? formatDateTime(at) : done ? "—" : undefined}
            note={step === "CHECKED_IN" && at ? checkInReason : undefined}
            state={current ? "current" : done ? "done" : "future"}
            last={i === steps.length - 1 && !offPath}
          />
        );
      })}
      {offPath && (
        <TimelineItem
          label={TASK_STATUS_META[offPath].label}
          time={reachedAt.get(offPath) ? formatDateTime(reachedAt.get(offPath)) : undefined}
          state={offPath === "PARTIALLY_COMPLETED" ? "current" : "stopped"}
          last
        />
      )}
    </ol>
  );
}

function TimelineItem({
  label,
  time,
  note,
  state,
  last,
}: {
  label: string;
  time?: string;
  note?: string;
  state: "done" | "current" | "future" | "stopped";
  last: boolean;
}) {
  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      {!last && <span className={cn("absolute top-6 left-[11px] h-full w-px", state === "future" ? "bg-border" : "bg-primary/40")} aria-hidden />}
      <span
        className={cn(
          "relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border",
          state === "done" && "border-primary bg-primary text-primary-foreground",
          state === "current" && "border-primary bg-background text-primary ring-3 ring-primary/20",
          state === "future" && "border-border bg-background text-muted-foreground",
          state === "stopped" && "border-destructive bg-destructive text-white",
        )}
        aria-hidden
      >
        {state === "done" ? <Check className="size-3.5" /> : state === "stopped" ? <X className="size-3.5" /> : <Circle className="size-2 fill-current" />}
      </span>
      <div className="min-w-0 pt-0.5 text-sm">
        <p className={cn("font-medium", state === "future" && "text-muted-foreground")}>
          {label}
          {state === "current" && <span className="sr-only"> (current)</span>}
        </p>
        {time && <p className="text-xs text-muted-foreground">{time}</p>}
        {note && <p className="text-xs text-success">{note}</p>}
      </div>
    </li>
  );
}
