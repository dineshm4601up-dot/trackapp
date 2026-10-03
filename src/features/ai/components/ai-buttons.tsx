"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, RefreshCw, ThumbsDown, ThumbsUp, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  refreshPredictions,
  regenerateSummary,
  reviewRecommendation,
  setAiSetting,
  submitPredictionFeedback,
  type AiActionResult,
} from "@/features/ai/actions";
import { isNetworkError, NETWORK_ERROR_MESSAGE } from "@/lib/network";
import { cn } from "@/lib/utils";

function useAiAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = (action: () => Promise<AiActionResult>, after?: (result: AiActionResult) => void) =>
    startTransition(async () => {
      try {
        const result = await action();
        if (result.ok) toast.success(result.message);
        else toast.error(result.message);
        after?.(result);
        router.refresh(); // show what the server now has, whatever the outcome
      } catch (error) {
        if (!isNetworkError(error)) throw error;
        toast.error(NETWORK_ERROR_MESSAGE);
      }
    });
  return { pending, run };
}

export function RefreshPredictionsButton() {
  const { pending, run } = useAiAction();
  return (
    <Button variant="outline" onClick={() => run(refreshPredictions)} disabled={pending}>
      {pending ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden /> : <RefreshCw data-icon="inline-start" aria-hidden />}
      {pending ? "Refreshing…" : "Refresh predictions"}
    </Button>
  );
}

export function RegenerateSummaryButton({ hasSummary }: { hasSummary: boolean }) {
  const { pending, run } = useAiAction();
  return (
    <Button variant="outline" size="sm" onClick={() => run(regenerateSummary)} disabled={pending}>
      {pending ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden /> : <RefreshCw data-icon="inline-start" aria-hidden />}
      {hasSummary ? "Regenerate summary" : "Generate summary"}
    </Button>
  );
}

const RATINGS = [
  { value: "USEFUL", label: "Useful", icon: ThumbsUp },
  { value: "NOT_USEFUL", label: "Not useful", icon: ThumbsDown },
  { value: "INCORRECT", label: "Incorrect", icon: TriangleAlert },
] as const;

/** Feedback on one prediction. It is stored for evaluation; it does not change the model. */
export function FeedbackButtons({ predictionId, taskId, current, subject }: { predictionId: string; taskId?: string; current?: string; subject: string }) {
  const { pending, run } = useAiAction();
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={`Feedback on ${subject}`}>
      <span className="text-xs text-muted-foreground">Was this helpful?</span>
      {RATINGS.map((rating) => (
        <Button
          key={rating.value}
          variant={current === rating.value ? "secondary" : "ghost"}
          size="sm"
          aria-pressed={current === rating.value}
          disabled={pending}
          onClick={() => run(() => submitPredictionFeedback({ predictionId, rating: rating.value, taskId }))}
        >
          <rating.icon data-icon="inline-start" aria-hidden />
          {rating.label}
        </Button>
      ))}
    </div>
  );
}

/** Accept or reject a recommendation, with an optional note. Accepting only acknowledges it. */
export function RecommendationActions({ id, title }: { id: string; title: string }) {
  const { pending, run } = useAiAction();
  const [decision, setDecision] = useState<"ACCEPTED" | "REJECTED" | null>(null);
  const [notes, setNotes] = useState("");
  return (
    <>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => setDecision("ACCEPTED")} disabled={pending} aria-label={`Accept: ${title}`}>
          <Check data-icon="inline-start" aria-hidden />
          Accept
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setDecision("REJECTED")} disabled={pending} aria-label={`Reject: ${title}`}>
          <X data-icon="inline-start" aria-hidden />
          Reject
        </Button>
      </div>
      <Dialog open={decision !== null} onOpenChange={(open) => !pending && !open && setDecision(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{decision === "ACCEPTED" ? "Accept this recommendation?" : "Reject this recommendation?"}</DialogTitle>
            <DialogDescription>
              {decision === "ACCEPTED"
                ? "Accepting records that you have seen and agree with it. It does not change, reassign or reschedule anything — make any change yourself on the task."
                : "Rejecting records that the recommendation was not useful. Nothing else changes."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="review-notes">Note (optional)</Label>
            <Textarea id="review-notes" rows={3} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDecision(null)} disabled={pending}>
              Back
            </Button>
            <Button
              onClick={() =>
                decision &&
                run(
                  () => reviewRecommendation({ id, decision, notes }),
                  () => {
                    setDecision(null);
                    setNotes("");
                  },
                )
              }
              disabled={pending}
            >
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              {decision === "ACCEPTED" ? "Accept" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function SettingSwitch({ settingKey, label, description, enabled, lockedBy }: { settingKey: string; label: string; description: string; enabled: boolean; lockedBy?: string }) {
  const { pending, run } = useAiAction();
  const id = `ai-setting-${settingKey}`;
  return (
    <div className={cn("flex items-start justify-between gap-4", pending && "opacity-70")}>
      <div className="min-w-0 space-y-0.5">
        <Label htmlFor={id}>{label}</Label>
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {description}
          {lockedBy && <span className="font-medium text-warning"> {lockedBy}</span>}
        </p>
      </div>
      <Switch
        id={id}
        checked={enabled}
        disabled={pending}
        aria-describedby={`${id}-hint`}
        onCheckedChange={(checked) => run(() => setAiSetting({ key: settingKey, enabled: checked }))}
      />
    </div>
  );
}
