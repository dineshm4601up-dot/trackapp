import Link from "next/link";
import { ClipboardList } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { listMyTasks, type AgentView } from "@/features/tasks/agent-queries";
import { AgentTaskCard } from "@/features/tasks/components/agent-task-card";
import { cn } from "@/lib/utils";

const VIEW_LABELS: Record<AgentView, string> = {
  today: "Today",
  upcoming: "Upcoming",
  all: "All",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

const EMPTY_TEXT: Record<AgentView, string> = {
  today: "Nothing scheduled for today. Check Upcoming for later tasks.",
  upcoming: "No upcoming tasks yet.",
  all: "No tasks have been assigned to you yet.",
  completed: "No completed tasks yet.",
  failed: "No failed tasks.",
  cancelled: "No cancelled tasks.",
};

/** Scrollable filter tabs (links, so they work without JavaScript). */
export function AgentViewTabs({ basePath, views, current }: { basePath: string; views: readonly AgentView[]; current: AgentView }) {
  return (
    <nav aria-label="Task filter" className="-mx-4 overflow-x-auto px-4">
      <ul className="flex w-max gap-2">
        {views.map((view) => (
          <li key={view}>
            <Link
              href={`${basePath}?view=${view}`}
              scroll={false}
              aria-current={view === current ? "page" : undefined}
              className={cn(
                "inline-flex h-10 items-center rounded-full border px-4 text-sm font-medium transition-colors",
                view === current ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {VIEW_LABELS[view]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export async function AgentTaskList({ view }: { view: AgentView }) {
  const tasks = await listMyTasks(view);
  if (tasks.length === 0) {
    return <EmptyState icon={ClipboardList} title="No tasks here" description={EMPTY_TEXT[view]} />;
  }
  return (
    <ul className="space-y-3" aria-label={`${VIEW_LABELS[view]} tasks`}>
      {tasks.map((task) => (
        <li key={task.id}>
          <AgentTaskCard task={task} />
        </li>
      ))}
    </ul>
  );
}
