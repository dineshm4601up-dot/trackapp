import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { createTask } from "@/features/tasks/actions";
import { TaskForm } from "@/features/tasks/components/task-form";
import { requireAdmin } from "@/lib/auth/session";
import { businessToday } from "@/lib/format";

export const metadata: Metadata = { title: "Create task" };

export default async function NewTaskPage() {
  await requireAdmin();
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Create task"
        description="Choose the customer site, the agent and what needs to be done. The task code is generated automatically."
      />
      <TaskForm action={createTask} cancelHref="/admin/tasks" today={businessToday()} />
    </div>
  );
}
