import type { Metadata } from "next";
import { Suspense } from "react";

import { ListSkeleton } from "@/components/shared/list-states";
import { PageHeader } from "@/components/shared/page-header";
import type { AgentView } from "@/features/tasks/agent-queries";
import { AgentTaskList, AgentViewTabs } from "@/features/tasks/components/agent-task-list";
import { requireAgent } from "@/lib/auth/session";

export const metadata: Metadata = { title: "History" };

const VIEWS: readonly AgentView[] = ["completed", "failed", "cancelled"];

export default async function AgentHistoryPage(props: PageProps<"/agent/history">) {
  await requireAgent();
  const raw = (await props.searchParams).view;
  const view = VIEWS.includes(raw as AgentView) ? (raw as AgentView) : "completed";

  return (
    <>
      <PageHeader title="History" description="Tasks you have finished." />
      <AgentViewTabs basePath="/agent/history" views={VIEWS} current={view} />
      <Suspense key={view} fallback={<ListSkeleton label="Loading history…" />}>
        <AgentTaskList view={view} />
      </Suspense>
    </>
  );
}
