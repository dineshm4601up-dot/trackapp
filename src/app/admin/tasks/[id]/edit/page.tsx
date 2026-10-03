import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Lock } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { updateTask } from "@/features/tasks/actions";
import { TaskStatusBadge } from "@/features/tasks/components/task-badges";
import { TaskForm } from "@/features/tasks/components/task-form";
import { isEditable } from "@/features/tasks/constants";
import { toFormInitial } from "@/features/tasks/form-initial";
import { getTask } from "@/features/tasks/queries";
import { requireAdmin } from "@/lib/auth/session";
import { businessToday } from "@/lib/format";

export const metadata: Metadata = { title: "Edit task" };

export default async function EditTaskPage(props: PageProps<"/admin/tasks/[id]/edit">) {
  await requireAdmin();
  const { id } = await props.params;
  const task = await getTask(id);
  if (!task) notFound();
  const initial = toFormInitial(task);
  const detailHref = `/admin/tasks/${task.id}`;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title={`Edit ${task.task_code}`}
        description={task.title}
        actions={<TaskStatusBadge status={task.status} />}
      />
      {isEditable(task.status) && initial ? (
        <TaskForm
          action={updateTask.bind(null, task.id)}
          initial={initial}
          status={task.status}
          cancelHref={detailHref}
          today={businessToday()}
        />
      ) : (
        <EmptyState
          icon={Lock}
          title="This task can no longer be edited."
          description="Tasks can be edited while they are Draft or Assigned. Once the agent has accepted it, its setup is locked to preserve history."
          action={
            <Button variant="outline" asChild>
              <Link href={detailHref}>Back to task</Link>
            </Button>
          }
        />
      )}
    </div>
  );
}
