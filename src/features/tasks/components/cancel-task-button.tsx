"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cancelTask } from "@/features/tasks/actions";
import { isNetworkError, NETWORK_ERROR_MESSAGE } from "@/lib/network";

/** Cancels a task (with a required reason) instead of deleting it. */
export function CancelTaskButton({ taskId, taskCode }: { taskId: string; taskCode: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  const valid = reason.trim().length >= 3;

  function confirm() {
    startTransition(async () => {
      const result = await cancelTask(taskId, reason).catch((error: unknown) => {
        if (isNetworkError(error)) return { ok: false as const, message: NETWORK_ERROR_MESSAGE };
        throw error;
      });
      if (result.ok) {
        toast.success(result.message);
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Ban aria-hidden />
          Cancel task
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel {taskCode}?</DialogTitle>
          <DialogDescription>
            The task stops here and stays in the history. It can&apos;t be reopened or edited afterwards.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="cancel-reason">Reason</Label>
          <Textarea
            id="cancel-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="e.g. Customer postponed the order"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Keep task
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={pending || !valid}>
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            Cancel task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
