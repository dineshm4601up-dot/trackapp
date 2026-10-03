"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CheckInPanel } from "@/features/checkin/components/check-in-panel";
import { transitionMyTask, type TransitionInput } from "@/features/tasks/agent-actions";
import { AGENT_NEXT_STEP, FAILABLE_STATUSES, FAILURE_REASONS, type TaskStatus } from "@/features/tasks/constants";
import { isNetworkError } from "@/lib/network";

type DialogKind = "confirm" | "fail" | null;

type AgentTaskActionsProps = {
  taskId: string;
  /** Status as rendered; sent back so a stale screen can never overwrite newer state. */
  status: TaskStatus;
};

/** id of the execution form rendered on the page while IN_PROGRESS */
export const EXECUTION_FORM_ID = "execution-form";

/**
 * One clear primary action per status, plus "Report a problem" where allowed.
 * Nothing is shown as successful until the server confirms it.
 */
export function AgentTaskActions({ taskId, status }: AgentTaskActionsProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pendingLabel, setPendingLabel] = useState("Updating…");
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");

  const step = AGENT_NEXT_STEP[status];
  const canFail = FAILABLE_STATUSES.includes(status);

  function run(to: TransitionInput["to"], label: string, extra: { reason?: string; notes?: string } = {}) {
    setPendingLabel(label);
    startTransition(async () => {
      let result;
      try {
        result = await transitionMyTask({ taskId, expected: status, to, ...extra });
      } catch (error) {
        if (!isNetworkError(error)) throw error;
        toast.error("Unable to update task. Please check your connection and try again.");
        return;
      }
      if (result.ok) {
        toast.success(result.message);
        setDialog(null);
        setReason("");
        setNotes("");
      } else {
        toast.error(result.message);
        if (result.code === "STATUS_CHANGED" || result.code === "TASK_NOT_FOUND") setDialog(null);
      }
      router.refresh();
    });
  }

  function primary() {
    if (!step) return;
    if (step.confirm) setDialog("confirm");
    else run(step.to, step.pendingLabel);
  }

  return (
    <>
      <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 -mx-4 space-y-2 border-t bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        {status === "ARRIVED" ? (
          // The only way forward from ARRIVED: server-validated GPS check-in.
          <CheckInPanel taskId={taskId} />
        ) : status === "IN_PROGRESS" ? (
          // Completion is submitted by the execution form, which the server validates.
          <Button type="submit" form={EXECUTION_FORM_ID} size="xl" className="w-full" disabled={pending}>
            Review &amp; complete
          </Button>
        ) : step ? (
          <Button size="xl" className="w-full" onClick={primary} disabled={pending}>
            {pending && <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden />}
            {pending ? pendingLabel : step.label}
          </Button>
        ) : null}

        {canFail && (
          <Button variant="outline" size="lg" className="w-full text-destructive" onClick={() => setDialog("fail")} disabled={pending}>
            <CircleAlert data-icon="inline-start" aria-hidden />
            Report a problem
          </Button>
        )}

        {!step && !canFail && status !== "ARRIVED" && status !== "IN_PROGRESS" && (
          <Button variant="outline" size="lg" className="w-full" onClick={() => router.refresh()}>
            <RefreshCw data-icon="inline-start" aria-hidden />
            Refresh
          </Button>
        )}
      </div>

      {/* Simple confirmation (e.g. accept) */}
      <Dialog open={dialog === "confirm"} onOpenChange={(open) => !pending && setDialog(open ? "confirm" : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{step?.confirm?.title}</DialogTitle>
            <DialogDescription>{step?.confirm?.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="lg" onClick={() => setDialog(null)} disabled={pending}>
              Not now
            </Button>
            <Button size="lg" onClick={() => step && run(step.to, step.pendingLabel)} disabled={pending}>
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              {pending ? pendingLabel : step?.label}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Failure: reason required, note optional */}
      <Dialog open={dialog === "fail"} onOpenChange={(open) => !pending && setDialog(open ? "fail" : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark task as failed?</DialogTitle>
            <DialogDescription>The task will stop here and your administrator will be able to reschedule it.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="fail-reason">Reason</Label>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger id="fail-reason" className="h-11 w-full">
                  <SelectValue placeholder="Select a reason">{reason || undefined}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {FAILURE_REASONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="fail-notes">Notes {reason === "Other" ? "" : "(optional)"}</Label>
              <Textarea id="fail-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="lg" onClick={() => setDialog(null)} disabled={pending}>
              Back
            </Button>
            <Button
              variant="destructive"
              size="lg"
              onClick={() => run("FAILED", "Reporting…", { reason, notes })}
              disabled={pending || !reason || (reason === "Other" && notes.trim().length < 3)}
            >
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              {pending ? "Reporting…" : "Report failure"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
