import { CircleAlert, CircleCheck, CircleHelp, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { TimeAgo } from "@/features/monitoring/components/live-time";
import type { Level } from "@/lib/ai/models";
import { formatDateTime } from "@/lib/format";

const LEVELS: Record<Level, { label: string; variant: "destructive" | "warning" | "success"; icon: typeof CircleAlert }> = {
  HIGH: { label: "High", variant: "destructive", icon: CircleAlert },
  MEDIUM: { label: "Medium", variant: "warning", icon: TriangleAlert },
  LOW: { label: "Low", variant: "success", icon: CircleCheck },
};

/** Risk level as text plus an icon — never colour alone. `null` means no estimate could be made. */
export function RiskBadge({ level, prefix }: { level: Level | null; prefix?: string }) {
  if (!level) {
    return (
      <Badge variant="secondary">
        <CircleHelp aria-hidden />
        {prefix ? `${prefix}: ` : ""}N/A
      </Badge>
    );
  }
  const meta = LEVELS[level];
  return (
    <Badge variant={meta.variant}>
      <meta.icon aria-hidden />
      {prefix ? `${prefix}: ` : ""}
      {meta.label}
    </Badge>
  );
}

/** Confidence is how much history supports the estimate — labelled as such, never as a probability. */
export function Confidence({ value }: { value: number | null }) {
  if (value === null) return null;
  return (
    <span className="text-xs text-muted-foreground" title="How much history supports this estimate. It is not the probability of the outcome.">
      Prediction confidence: {Math.round(value * 100)}%
    </span>
  );
}

export function Factors({ items, label = "Why" }: { items: string[]; label?: string }) {
  if (items.length === 0) return null;
  return (
    <div className="text-sm">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

/** When the estimate was made, by which model version, and whether it is past its freshness limit. */
export function Provenance({ generatedAt, model, version, stale }: { generatedAt: string; model: string; version: string; stale: boolean }) {
  return (
    <p className="text-xs text-muted-foreground">
      <span title={formatDateTime(generatedAt)}>
        Generated <TimeAgo at={generatedAt} />
      </span>{" "}
      · {model} v{version}
      {stale && <span className="font-medium text-warning"> · Out of date — refresh predictions</span>}
    </p>
  );
}

export function ExperimentalBadge() {
  return (
    <Badge variant="outline" title="This estimate comes from a simple statistical baseline that has not yet been evaluated against enough real outcomes.">
      Experimental prediction
    </Badge>
  );
}
