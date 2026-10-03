"use client";

import { useTransition } from "react";
import { Check, CheckCheck, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  markAllNotificationsRead,
  markNotificationRead,
  retryCommunication,
  type NotificationActionResult,
} from "@/features/notifications/actions";
import { isNetworkError, NETWORK_ERROR_MESSAGE } from "@/lib/network";

function useAction() {
  const [pending, startTransition] = useTransition();
  const run = (action: () => Promise<NotificationActionResult>, announce = false) =>
    startTransition(async () => {
      try {
        const result = await action();
        if (!result.ok) toast.error(result.message);
        else if (announce && result.message) toast.success(result.message);
      } catch (error) {
        if (!isNetworkError(error)) throw error;
        toast.error(NETWORK_ERROR_MESSAGE);
      }
    });
  return { pending, run };
}

export function MarkReadButton({ id, title }: { id: string; title: string }) {
  const { pending, run } = useAction();
  return (
    <Button
      variant="ghost"
      size="icon"
      className="m-2 size-11 shrink-0 self-center"
      aria-label={`Mark "${title}" as read`}
      onClick={() => run(() => markNotificationRead(id))}
      disabled={pending}
    >
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
    </Button>
  );
}

export function MarkAllReadButton() {
  const { pending, run } = useAction();
  return (
    <Button variant="outline" size="sm" onClick={() => run(markAllNotificationsRead, true)} disabled={pending}>
      {pending ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden /> : <CheckCheck data-icon="inline-start" aria-hidden />}
      Mark all as read
    </Button>
  );
}

export function RetryCommunicationButton({ queueId }: { queueId: string }) {
  const { pending, run } = useAction();
  return (
    <Button variant="outline" size="sm" onClick={() => run(() => retryCommunication(queueId), true)} disabled={pending}>
      {pending ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden /> : <RotateCcw data-icon="inline-start" aria-hidden />}
      Retry
    </Button>
  );
}
