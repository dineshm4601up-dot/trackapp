import { Sparkles } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FeedbackButtons } from "@/features/ai/components/ai-buttons";
import { Confidence, ExperimentalBadge, Factors, Provenance, RiskBadge } from "@/features/ai/components/ai-parts";
import type { TaskInsights } from "@/features/ai/queries";
import { formatWallTimeOfInstant } from "@/lib/format";

type Props = { taskId: string; insights: TaskInsights; feedback: Record<string, string> };

/**
 * AI insights for one open task: stored estimates with their reasons, when
 * they were made and by which model version. Advice only — nothing here
 * changes the task.
 */
export function TaskInsightsCard({ taskId, insights, feedback }: Props) {
  const { delay, failure, eta } = insights;
  if (!delay && !failure && !eta) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="size-4" aria-hidden />
            AI insights
          </CardTitle>
          <CardDescription>No estimate has been generated for this task yet. Refresh predictions on the AI page.</CardDescription>
        </CardHeader>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Sparkles className="size-4" aria-hidden />
          AI insights
          <ExperimentalBadge />
        </CardTitle>
        <CardDescription>Estimates to help you decide. They never change the task.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {delay && (
          <section aria-label="Delay risk" className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <RiskBadge prefix="Delay risk" level={delay.value.available ? delay.value.level : null} />
              <Confidence value={delay.confidence} />
            </div>
            <Factors items={delay.factors} label={delay.value.available ? "Why" : "Why there is no estimate"} />
            <Provenance generatedAt={delay.generatedAt} model={delay.model} version={delay.version} stale={delay.stale} />
            <FeedbackButtons predictionId={delay.id} taskId={taskId} current={feedback[delay.id]} subject="the delay-risk estimate" />
          </section>
        )}
        {failure && (
          <section aria-label="Failure risk" className="space-y-2 border-t pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <RiskBadge prefix="Failure risk" level={failure.value.available ? failure.value.level : null} />
              {failure.value.available && (
                <span className="text-sm">
                  Estimated failure risk: {Math.round(failure.value.estimated_rate * 100)}%{" "}
                  <span className="text-xs text-muted-foreground">(how often similar tasks failed; {failure.value.based_on} tasks)</span>
                </span>
              )}
            </div>
            <Confidence value={failure.confidence} />
            <Factors items={failure.factors} label={failure.value.available ? "Why" : "Why there is no estimate"} />
            <Provenance generatedAt={failure.generatedAt} model={failure.model} version={failure.version} stale={failure.stale} />
            <FeedbackButtons predictionId={failure.id} taskId={taskId} current={feedback[failure.id]} subject="the failure-risk estimate" />
          </section>
        )}
        {eta && (
          <section aria-label="Estimated completion" className="space-y-2 border-t pt-4">
            {eta.value.available ? (
              <>
                <p className="text-sm">
                  <span className="text-xs text-muted-foreground">Estimated completion ({eta.value.label})</span>
                  <span className="block text-xl font-semibold">{formatWallTimeOfInstant(eta.value.eta)}</span>
                  <span className="text-muted-foreground">
                    Expected range: {formatWallTimeOfInstant(eta.value.earliest)} – {formatWallTimeOfInstant(eta.value.latest)}
                  </span>
                </p>
                <Confidence value={eta.confidence} />
              </>
            ) : (
              <RiskBadge prefix="Estimated completion" level={null} />
            )}
            <Factors items={eta.factors} label={eta.value.available ? "Based on" : "Why there is no estimate"} />
            <Provenance generatedAt={eta.generatedAt} model={eta.model} version={eta.version} stale={eta.stale} />
            <FeedbackButtons predictionId={eta.id} taskId={taskId} current={feedback[eta.id]} subject="the completion estimate" />
          </section>
        )}
      </CardContent>
    </Card>
  );
}
