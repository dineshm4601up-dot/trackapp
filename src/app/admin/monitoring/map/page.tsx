import type { Metadata } from "next";
import Link from "next/link";
import { List } from "lucide-react";

import { LiveUpdates } from "@/components/shared/live-updates";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MonitoringMap } from "@/features/monitoring/components/monitoring-map";
import { MAP_BINDINGS } from "@/features/monitoring/config";
import { getMapPoints, getTrackedWithoutLocation } from "@/features/monitoring/queries";
import { TaskStatusBadge } from "@/features/tasks/components/task-badges";
import { requireAdmin } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Monitoring map" };

// Coordinates are read per request, for a verified admin only — never cached or prerendered.
export const dynamic = "force-dynamic";

export default async function MonitoringMapPage() {
  await requireAdmin();
  const [points, waiting] = await Promise.all([getMapPoints(), getTrackedWithoutLocation()]);

  return (
    <>
      <PageHeader
        title="Monitoring map"
        description="Last known location of each task that is on the way, at the location or in progress."
        actions={
          <>
            <LiveUpdates channel="admin-monitoring-map" bindings={MAP_BINDINGS} />
            <Button variant="outline" asChild>
              <Link href="/admin/monitoring">
                <List data-icon="inline-start" aria-hidden />
                List
              </Link>
            </Button>
          </>
        }
      />
      <MonitoringMap points={points} />
      {waiting.length > 0 && (
        <Card size="sm">
          <CardHeader>
            <CardTitle>Active tasks with no location yet ({waiting.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-2 text-sm text-muted-foreground">
              The agent may not have allowed location access, may have closed the task screen, or may have no signal.
            </p>
            <ul className="space-y-1 text-sm">
              {waiting.map((task) => (
                <li key={task.id} className="flex flex-wrap items-center gap-2">
                  <Link href={`/admin/tasks/${task.id}`} className="font-mono text-xs hover:underline">
                    {task.task_code}
                  </Link>
                  <span>{task.agent_name ?? "Agent"}</span>
                  {task.customer_name && <span className="text-muted-foreground">· {task.customer_name}</span>}
                  {task.status && <TaskStatusBadge status={task.status} />}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </>
  );
}
