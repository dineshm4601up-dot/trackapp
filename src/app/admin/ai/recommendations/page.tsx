import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Lightbulb } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { PaginationBar } from "@/components/shared/pagination-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RecommendationActions } from "@/features/ai/components/ai-buttons";
import { listRecommendations, RECOMMENDATION_PAGE_SIZE, RECOMMENDATION_STATUSES } from "@/features/ai/queries";
import { requireAdmin } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "AI recommendations" };

const STATUS = {
  PENDING: { label: "To review", badge: "warning" },
  ACCEPTED: { label: "Accepted", badge: "success" },
  REJECTED: { label: "Rejected", badge: "secondary" },
  EXPIRED: { label: "Expired", badge: "secondary" },
} as const;

const ENTITY = { TASK: "Task", LOCATION: "Location", AGENT: "Agent schedule", ORGANISATION: "Organisation" } as const;

export default async function RecommendationsPage(props: PageProps<"/admin/ai/recommendations">) {
  await requireAdmin();
  const searchParams = await props.searchParams;
  const first = (key: string) => {
    const value = searchParams[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const status = RECOMMENDATION_STATUSES.find((s) => s === first("status"));
  const page = Math.max(1, Math.min(10_000, Number.parseInt(first("page") ?? "1", 10) || 1));
  const { rows, total } = await listRecommendations(status, page);

  return (
    <>
      <PageHeader
        title="AI recommendations"
        description="Advice for you to review. Accepting a recommendation records your agreement — it never changes, reassigns or reschedules a task."
        actions={
          <Button variant="outline" asChild>
            <Link href="/admin/ai">
              <ArrowLeft data-icon="inline-start" aria-hidden />
              AI insights
            </Link>
          </Button>
        }
      />
      <nav aria-label="Recommendation status" className="flex w-fit flex-wrap gap-1 rounded-lg bg-muted p-1 text-sm">
        {[undefined, ...RECOMMENDATION_STATUSES].map((s) => (
          <Link
            key={s ?? "all"}
            href={s ? `/admin/ai/recommendations?status=${s}` : "/admin/ai/recommendations"}
            aria-current={status === s ? "page" : undefined}
            className={cn("rounded-md px-3 py-1.5 font-medium", status === s ? "bg-background shadow-sm" : "text-muted-foreground")}
          >
            {s ? STATUS[s].label : "All"}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <EmptyState icon={Lightbulb} title="No recommendations here." description="Recommendations appear when a prediction run finds something that needs attention." />
      ) : (
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <caption className="sr-only">AI recommendations</caption>
              <thead className="bg-muted/50 text-left">
                <tr>
                  {["Recommendation", "Entity", "Confidence", "Reason", "Created", "Status", "Actions"].map((h) => (
                    <th key={h} scope="col" className="px-3 py-2 font-medium whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((rec) => {
                  const state = STATUS[rec.status as keyof typeof STATUS] ?? STATUS.EXPIRED;
                  const reasons = (rec.reasoning as { reasons?: unknown } | null)?.reasons;
                  const reasonList = Array.isArray(reasons) ? reasons.filter((r): r is string => typeof r === "string") : [];
                  return (
                    <tr key={rec.id} className="border-t align-top">
                      <td className="px-3 py-2">
                        <span className="block max-w-64 font-medium">{rec.title}</span>
                        <span className="text-xs text-muted-foreground">
                          {rec.model_name} v{rec.model_version}
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {ENTITY[rec.entity_type as keyof typeof ENTITY] ?? rec.entity_type}
                        {rec.entity_type === "TASK" && rec.entity_id && (
                          <Link href={`/admin/tasks/${rec.entity_id}`} className="block text-xs underline">
                            View entity
                          </Link>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{rec.confidence === null ? "—" : `${Math.round(rec.confidence * 100)}%`}</td>
                      <td className="px-3 py-2">
                        <span className="block max-w-80">{rec.description}</span>
                        {reasonList.length > 1 && (
                          <ul className="mt-1 max-w-80 list-disc pl-4 text-xs text-muted-foreground">
                            {reasonList.slice(1, 4).map((reason) => (
                              <li key={reason}>{reason}</li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(rec.created_at)}</td>
                      <td className="px-3 py-2">
                        <Badge variant={state.badge}>{state.label}</Badge>
                        {rec.reviewed_at && (
                          <span className="mt-1 block max-w-48 text-xs text-muted-foreground">
                            {rec.reviewer?.full_name ?? "Administrator"} · {formatDateTime(rec.reviewed_at)}
                            {rec.review_notes && ` · “${rec.review_notes}”`}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">{rec.status === "PENDING" ? <RecommendationActions id={rec.id} title={rec.title} /> : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <PaginationBar basePath="/admin/ai/recommendations" page={page} total={total} pageSize={RECOMMENDATION_PAGE_SIZE} query={{ status }} />
        </div>
      )}
    </>
  );
}
