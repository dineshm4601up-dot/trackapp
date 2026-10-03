import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarDays, MapPinCheck, Navigation, Phone, UserRound } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { LiveUpdates } from "@/components/shared/live-updates";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getSuccessfulCheckIn } from "@/features/checkin/queries";
import { ExecutionForm } from "@/features/execution/components/execution-form";
import { CashSummary, DeliverySummary } from "@/features/execution/components/execution-summary";
import { ProofGallery } from "@/features/execution/components/proof-gallery";
import { ProofUploader } from "@/features/execution/components/proof-uploader";
import { getCashCollection, getTaskProofs } from "@/features/execution/queries";
import { getMyTask } from "@/features/tasks/agent-queries";
import { AgentTaskActions } from "@/features/tasks/components/agent-task-actions";
import { PriorityText, TaskStatusBadge, taskTypeLabel } from "@/features/tasks/components/task-badges";
import { TaskStatusTimeline } from "@/features/tasks/components/task-status-timeline";
import { DONE_STATUSES, priorityLabel, TASK_TYPE_META } from "@/features/tasks/constants";
import { TaskExecutionView } from "@/features/tasks/execution/task-execution-view";
import { getTaskHistory } from "@/features/tasks/queries";
import { LocationSharing } from "@/features/tracking/components/location-sharing";
import { isTrackable } from "@/features/tracking/config";
import { requireAgent } from "@/lib/auth/session";
import { numericText } from "@/lib/decimal";
import { businessToday, formatCalendarDate, formatWallTime, formatWallTimeOfInstant } from "@/lib/format";

export const metadata: Metadata = { title: "Task" };

function joinAddress(parts: (string | null | undefined)[]) {
  return parts.filter(Boolean).join(", ");
}

/** Directions to the task location (opens the device's maps app). Navigation only — no visit verification. */
function directionsUrl(lat: number | null, lng: number | null, address: string) {
  const destination = lat !== null && lng !== null ? `${lat},${lng}` : address;
  return destination ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}` : null;
}

export default async function AgentTaskPage(props: PageProps<"/agent/tasks/[id]">) {
  await requireAgent();
  const { id } = await props.params;
  // RLS returns the task only if it is assigned to this agent.
  const task = await getMyTask(id);
  if (!task) notFound();
  const meta = TASK_TYPE_META[task.task_type];
  const working = task.status === "CHECKED_IN" || task.status === "IN_PROGRESS";
  // delivered_quantity defaults to 0, so execution data only counts once the task is done.
  const done = DONE_STATUSES.includes(task.status);
  const finished = done || task.status === "FAILED";
  const [history, checkIn, proofs, cash] = await Promise.all([
    getTaskHistory(task.id),
    getSuccessfulCheckIn(task.id),
    working || finished ? getTaskProofs(task.id) : Promise.resolve([]),
    done && meta.execution === "cash" ? getCashCollection(task.id) : Promise.resolve(null),
  ]);
  const productLines = task.task_products.map((line) => ({
    id: line.id,
    name: line.product?.product_name ?? "Product",
    sku: line.product?.sku ?? null,
    unit: line.product?.unit ?? null,
    assigned: line.assigned_quantity,
    delivered: done ? line.delivered_quantity : null,
    notes: line.delivery_notes,
  }));
  const photoCount = proofs.filter((p) => p.proof_type === "PHOTO").length;

  const location = task.location;
  const locationAddress = joinAddress([
    location?.address_line1,
    location?.address_line2,
    location?.city,
    location?.state,
    location?.postal_code,
  ]);
  const customerAddress = joinAddress([task.customer?.address_line1, task.customer?.address_line2, task.customer?.city]);
  const navigateUrl = location ? directionsUrl(location.latitude, location.longitude, locationAddress) : null;
  const phone = location?.contact_phone ?? task.customer?.phone ?? null;
  const scheduled =
    task.scheduled_date === businessToday() ? "Today" : task.scheduled_date ? formatCalendarDate(task.scheduled_date) : "Not scheduled";
  const time = task.scheduled_start_time
    ? `${formatWallTime(task.scheduled_start_time)}${task.scheduled_end_time ? ` – ${formatWallTime(task.scheduled_end_time)}` : ""}`
    : null;

  return (
    <>
      <div className="space-y-2">
        <Button variant="ghost" size="sm" className="-ml-2" asChild>
          <Link href="/agent/tasks">
            <ArrowLeft data-icon="inline-start" aria-hidden />
            My tasks
          </Link>
        </Button>
        <p className="font-mono text-xs text-muted-foreground">
          {task.task_code} · {taskTypeLabel(task.task_type)}
        </p>
        <h1 className="text-2xl leading-tight font-semibold">{task.title}</h1>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <TaskStatusBadge status={task.status} />
          <span>
            Priority <PriorityText priority={task.priority} />{" "}
            <span className="text-muted-foreground">{priorityLabel(task.priority).replace(/^\d — /, "")}</span>
          </span>
        </div>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CalendarDays className="size-4" aria-hidden />
          {scheduled}
          {time && ` · ${time}`}
        </p>
      </div>

      {/* Admin changes to this task (cancellation, rescheduling) arrive live. RLS limits the channel to the agent own task. */}
      <LiveUpdates channel={`agent-task-${task.id}`} bindings={[{ table: "tasks", event: "UPDATE", filter: `id=eq.${task.id}` }]} hidden />

      {/* Mounted only while the task is in an active field state: the GPS watcher cannot outlive it. */}
      {isTrackable(task.status) && <LocationSharing key={task.id} taskId={task.id} />}

      {checkIn && (
        <Card size="sm" className="ring-success/30">
          <CardContent className="flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-success/10 text-success">
              <MapPinCheck className="size-5" aria-hidden />
            </span>
            <div className="text-sm">
              <p className="font-medium">✓ Checked in · {formatWallTimeOfInstant(checkIn.checked_in_at)}</p>
              <p className="text-muted-foreground">Location verified</p>
            </div>
          </CardContent>
        </Card>
      )}

      {task.status === "CANCELLED" && (
        <Alert>
          <AlertTitle>This task was cancelled</AlertTitle>
          <AlertDescription>{task.cancellation_reason ?? "No action is needed."}</AlertDescription>
        </Alert>
      )}
      {task.status === "FAILED" && task.failure_reason && (
        <Alert variant="destructive">
          <AlertTitle>Reported as failed</AlertTitle>
          <AlertDescription>{task.failure_reason}</AlertDescription>
        </Alert>
      )}
      {task.status === "PARTIALLY_COMPLETED" && task.completion_notes && (
        <Alert>
          <AlertTitle>Partially completed</AlertTitle>
          <AlertDescription>{task.completion_notes}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Instructions</CardTitle>
        </CardHeader>
        <CardContent>
          {task.description ? (
            <p className="text-sm whitespace-pre-wrap">{task.description}</p>
          ) : (
            <p className="text-sm text-muted-foreground">No special instructions.</p>
          )}
        </CardContent>
      </Card>

      {task.status === "IN_PROGRESS" ? (
        <ExecutionForm
          taskId={task.id}
          meta={meta}
          lines={productLines.map((l) => ({ ...l, assigned: numericText(l.assigned, 3) }))}
          expectedAmount={numericText(task.expected_amount, 2) || null}
          photoCount={photoCount}
          proofCount={proofs.length}
        />
      ) : done ? (
        <>
          {meta.execution === "delivery" && productLines.length > 0 && <DeliverySummary lines={productLines} />}
          {meta.execution === "cash" && <CashSummary expected={task.expected_amount} cash={cash} />}
          {task.completion_notes && task.status !== "PARTIALLY_COMPLETED" && (
            <Card size="sm">
              <CardContent className="text-sm">
                <p className="text-muted-foreground">Your notes</p>
                <p className="whitespace-pre-wrap">{task.completion_notes}</p>
              </CardContent>
            </Card>
          )}
        </>
      ) : (
        <TaskExecutionView task={task} />
      )}

      {(working || proofs.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle>
              {meta.proof === "photo-required" ? "Delivery photo" : meta.documents ? "Photos & documents" : "Photos"}
            </CardTitle>
            {working && (
              <CardDescription>
                {meta.proof === "photo-required"
                  ? "Required: at least one photo of the delivered goods."
                  : meta.proof === "any-required"
                    ? "Required: a photo or PDF of the collected document."
                    : "Optional. Photos are stored privately for your administrator."}
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <ProofGallery proofs={proofs} />
            {working && <ProofUploader taskId={task.id} allowDocuments={meta.documents} />}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Location</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <p className="font-medium">{location?.location_name ?? "—"}</p>
            {locationAddress && <p className="text-muted-foreground">{locationAddress}</p>}
          </div>
          {location?.contact_person && (
            <p className="flex items-center gap-2 text-muted-foreground">
              <UserRound className="size-4" aria-hidden />
              On-site contact: <span className="text-foreground">{location.contact_person}</span>
            </p>
          )}
          {navigateUrl && (
            <Button size="lg" variant="outline" className="w-full" asChild>
              <a href={navigateUrl} target="_blank" rel="noopener noreferrer">
                <Navigation data-icon="inline-start" aria-hidden />
                Navigate
              </a>
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Customer</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <p className="font-medium">{task.customer?.name ?? "—"}</p>
            {customerAddress && <p className="text-muted-foreground">{customerAddress}</p>}
          </div>
          {phone && (
            <Button size="lg" variant="outline" className="w-full" asChild>
              <a href={`tel:${phone.replace(/[^\d+]/g, "")}`}>
                <Phone data-icon="inline-start" aria-hidden />
                Call {location?.contact_phone ? "on-site contact" : "customer"} · {phone}
              </a>
            </Button>
          )}
          <p className="text-xs text-muted-foreground">Details wrong? Let your administrator know.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Progress</CardTitle>
        </CardHeader>
        <CardContent>
          {history.length ? (
            <TaskStatusTimeline status={task.status} history={history} />
          ) : (
            <EmptyState icon={CalendarDays} title="No activity yet" />
          )}
        </CardContent>
      </Card>

      <AgentTaskActions taskId={task.id} status={task.status} />
    </>
  );
}
