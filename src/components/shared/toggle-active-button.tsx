"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Power, PowerOff } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/form-state";
import { isNetworkError, NETWORK_ERROR_MESSAGE } from "@/lib/network";

type ToggleActiveButtonProps = {
  /** e.g. "agent", "customer" — used in the dialog copy. */
  entity: string;
  name: string;
  isActive: boolean;
  /** Server Action bound to the record id. */
  action: (active: boolean) => Promise<ActionResult>;
  /** Shown in the deactivate dialog: what deactivation means for this entity. */
  consequence: string;
};

/**
 * Activate immediately; deactivate only after confirmation. Never deletes:
 * historical records keep referencing the entity.
 */
export function ToggleActiveButton({ entity, name, isActive, action, consequence }: ToggleActiveButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function run(active: boolean) {
    startTransition(async () => {
      const result = await action(active).catch((error: unknown) => {
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

  if (!isActive) {
    return (
      <Button variant="outline" size="sm" disabled={pending} onClick={() => run(true)} aria-label={`Activate ${name}`}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Power aria-hidden />}
        Activate
      </Button>
    );
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} aria-label={`Deactivate ${name}`}>
        <PowerOff aria-hidden />
        Deactivate
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Deactivate {entity}?</AlertDialogTitle>
          <AlertDialogDescription>
            <span className="font-medium text-foreground">{name}</span> {consequence} Existing history is
            kept, and you can reactivate at any time.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={(event) => {
              event.preventDefault(); // keep open until the action finishes
              run(false);
            }}
          >
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            Deactivate
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
