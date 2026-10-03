import type { Metadata } from "next";
import { Suspense } from "react";

import { ListSkeleton } from "@/components/shared/list-states";
import { LiveUpdates } from "@/components/shared/live-updates";
import { PageHeader } from "@/components/shared/page-header";
import { AGENT_VIEWS, type AgentView } from "@/features/tasks/agent-queries";
import { AgentTaskList, AgentViewTabs } from "@/features/tasks/components/agent-task-list";
import { requireAgent } from "@/lib/auth/session";

export const metadata: Metadata = { title: "My tasks" };

// RLS delivers only changes to the signed-in agent own, non-draft tasks.
const LIST_BINDINGS = [
  { table: "tasks", event: "INSERT" },
  { table: "tasks", event: "UPDATE" },
] as const;

const VIEWS: readonly AgentView[] = ["today", "upcoming", "all", "completed", "failed", "cancelled"];

export default async function AgentTasksPage(props: PageProps<"/agent/tasks">) {
  await requireAgent();
  const raw = (await props.searchParams).view;
  const view = (AGENT_VIEWS as readonly string[]).includes(String(raw)) ? (raw as AgentView) : "today";

  return (
    <>
      <PageHeader title="My tasks" />
      <LiveUpdates channel="agent-tasks" bindings={LIST_BINDINGS} hidden />
      <AgentViewTabs basePath="/agent/tasks" views={VIEWS} current={view} />
      <Suspense key={view} fallback={<ListSkeleton label="Loading tasks…" />}>
        <AgentTaskList view={view} />
      </Suspense>
    </>
  );
}
