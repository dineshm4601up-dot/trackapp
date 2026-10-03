import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CircleCheck, Pencil, Plus } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CheckInSummaryCard } from "@/features/checkin/components/check-in-summary-card";
import { getCheckInSummary } from "@/features/checkin/queries";
import { CashSummary } from "@/features/execution/components/execution-summary";
import { ProofGallery } from "@/features/execution/components/proof-gallery";
import { getCashCollection, getTaskProofs } from "@/features/execution/queries";
import { CancelTaskButton } from "@/features/tasks/components/cancel-task-button";
import { PriorityText, TaskStatusBadge, taskTypeLabel } from "@/features/tasks/components/task-badges";
import { DONE_STATUSES, isCancellable, isEditable, priorityLabel, TASK_STATUS_META, TASK_TYPE_META } from "@/features/tasks/constants";
import { TaskStatusTimeline } from "@/features/tasks/components/task-status-timeline";
import { getTask, getTaskHistory } from "@/features/tasks/queries";
import { requireAdmin } from "@/lib/auth/session";
import { compareDecimal, decimalDiff, formatQuantity, lineAmount, numericText, sumAmounts } from "@/lib/decimal";
import { formatCalendarDate, formatDateTime, formatMoney, formatWallTime, mapsSearchUrl } from "@/lib/format";

export const metadata: Metadata = { title: "Task" };

export default async function TaskDetailPage(props: PageProps<"/admin/tasks/[id]">) {
  await requireAdmin();
  const [{ id }, searchParams] = await Promise.all([props.params, props.searchParams]);
  const task = await getTask(id);
  if (!task) notFound();
  const meta = TASK_TYPE_META[task.task_type];
  const [history, checkIn, proofs, cash] = await Promise.all([
    getTaskHistory(task.id),
    getCheckInSummary(task.id),
    getTaskProofs(task.id),
    meta.execution === "cash" ? getCashCollection(task.id) : Promise.resolve(null),
  ]);
  // delivered_quantity defaults to 0: it is only meaningful once a delivery was completed.
  const deliveryRecorded = meta.execution === "delivery" && DONE_STATUSES.includes(task.status);
  const justCreated = searchParams.created === "1";
  const agentProfile = task.agent?.profile;

  const lines = task.task_products.map((line) => {
    const price = numericText(line.unit_price, 2);
    const assigned = numericText(line.assigned_quantity, 3);
    const delivered = deliveryRecorded ? numericText(line.delivered_quantity, 3) : null;
    const outstanding = delivered === null ? null : decimalDiff(assigned, delivered, 3);
    return {
      ...line,
      amount: price ? lineAmount(assigned, price) : null,
      delivered,
      outstanding,
      short: outstanding !== null && compareDecimal(outstanding, "0", 3) === 1,
    };
  });
  const total = sumAmounts(lines.flatMap((l) => (l.amount ? [l.amount] : [])));
  const address = [task.location?.address_line1, task.location?.address_line2, task.location?.city, task.location?.state, task.location?.postal_code]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="space-y-6">
      {justCreated && (
        <Alert>
          <CircleCheck className="text-success" aria-hidden />
          <AlertTitle>Task created successfully.</AlertTitle>
          <AlertDescription>
            <p>
              <span className="font-mono">{task.task_code}</span> · {agentProfile?.full_name ?? "No agent yet"} ·{" "}
              {task.scheduled_date ? formatCalendarDate(task.scheduled_date) : "Not scheduled"} ·{" "}
              {TASK_STATUS_META[task.status].label}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" asChild>
                <Link href="/admin/tasks/new">
                  <Plus data-icon="inline-start" aria-hidden />
                  Create another task
                </Link>
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link href="/admin/tasks">Back to tasks</Link>
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      <PageHeader
        title={task.title}
        description={`${task.task_code} · ${taskTypeLabel(task.task_type)}`}
        actions={
          <>
            {isEditable(task.status) && (
              <Button variant="outline" asChild>
                <Link href={`/admin/tasks/${task.id}/edit`}>
                  <Pencil data-icon="inline-start" aria-hidden />
                  Edit
                </Link>
              </Button>
            )}
            {isCancellable(task.status) && <CancelTaskButton taskId={task.id} taskCode={task.task_code} />}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Task summary</CardTitle>
            </CardHeader>
            <CardContent>
              <Details
                rows={[
                  ["Task code", <span key="c" className="font-mono">{task.task_code}</span>],
                  ["Task type", taskTypeLabel(task.task_type)],
                  ["Status", <TaskStatusBadge key="s" status={task.status} />],
                  ["Priority", <span key="p"><PriorityText priority={task.priority} /> · {priorityLabel(task.priority).replace(/^\d — /, "")}</span>],
                  ["Title", task.title],
                  ...(meta.execution === "cash"
                    ? ([["Expected amount", formatMoney(numericText(task.expected_amount, 2) || null)]] as const)
                    : []),
                  ["Instructions", task.description ? <span key="d" className="whitespace-pre-wrap">{task.description}</span> : "—"],
                  ...(task.cancellation_reason ? ([["Cancellation reason", task.cancellation_reason]] as const) : []),
                  ...(task.failure_reason ? ([["Failure reason", task.failure_reason]] as const) : []),
                  ...(task.completion_notes ? ([["Agent notes", task.completion_notes]] as const) : []),
                ]}
              />
            </CardContent>
          </Card>

          {task.task_products.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Products</CardTitle>
              </CardHeader>
              <CardContent className="px-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="px-4">SKU</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">{deliveryRecorded ? "Assigned" : "Quantity"}</TableHead>
                      {deliveryRecorded && <TableHead className="text-right">Delivered</TableHead>}
                      {deliveryRecorded && <TableHead className="text-right">Outstanding</TableHead>}
                      <TableHead>Unit</TableHead>
                      <TableHead className="text-right">Unit price</TableHead>
                      <TableHead className="px-4 text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((line) => (
                      <TableRow key={line.id}>
                        <TableCell className="px-4 font-mono text-xs">{line.product?.sku}</TableCell>
                        <TableCell>{line.product?.product_name}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatQuantity(line.assigned_quantity)}</TableCell>
                        {deliveryRecorded && (
                          <TableCell className="text-right tabular-nums">{line.delivered === null ? "—" : formatQuantity(line.delivered)}</TableCell>
                        )}
                        {deliveryRecorded && (
                          <TableCell className={line.short ? "text-right font-medium text-warning tabular-nums" : "text-right tabular-nums"}>
                            {line.outstanding === null ? "—" : formatQuantity(line.outstanding)}
                            {line.delivery_notes && (
                              <span className="block max-w-48 truncate text-xs font-normal text-muted-foreground" title={line.delivery_notes}>
                                {line.delivery_notes}
                              </span>
                            )}
                          </TableCell>
                        )}
                        <TableCell>{line.product?.unit}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatMoney(numericText(line.unit_price, 2) || null)}</TableCell>
                        <TableCell className="px-4 text-right tabular-nums">{formatMoney(line.amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={deliveryRecorded ? 7 : 5} className="px-4 text-right">
                        Total
                      </TableCell>
                      <TableCell className="px-4 text-right font-semibold tabular-nums">{formatMoney(total)}</TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </CardContent>
            </Card>
          )}

          {meta.execution === "cash" && <CashSummary expected={task.expected_amount} cash={cash} />}

          <Card>
            <CardHeader>
              <CardTitle>Proof</CardTitle>
            </CardHeader>
            <CardContent>
              <ProofGallery proofs={proofs} emptyText="No photos or documents uploaded." />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-3">
                {history.map((entry) => (
                  <li key={entry.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
                    {entry.old_status ? <TaskStatusBadge status={entry.old_status} /> : <span className="text-muted-foreground">Created</span>}
                    <span aria-hidden>→</span>
                    <TaskStatusBadge status={entry.new_status} />
                    <span className="text-muted-foreground">
                      by {entry.actor?.full_name ?? entry.actor?.email ?? "system"} · {formatDateTime(entry.changed_at)}
                    </span>
                    {entry.reason && <span className="w-full text-muted-foreground">“{entry.reason}”</span>}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Assignment</CardTitle>
            </CardHeader>
            <CardContent>
              <Details
                rows={[
                  [
                    "Agent",
                    task.agent ? (
                      <span key="a" className="inline-flex flex-wrap items-center gap-2">
                        {agentProfile?.full_name ?? "—"}
                        {!task.agent.is_active && <Badge variant="warning">Inactive</Badge>}
                      </span>
                    ) : (
                      "Unassigned"
                    ),
                  ],
                  ["Employee code", task.agent?.employee_code ?? "—"],
                  ["Phone", agentProfile?.phone ?? "—"],
                  ["Assigned at", formatDateTime(task.assigned_at)],
                ]}
              />
            </CardContent>
          </Card>

          <CheckInSummaryCard summary={checkIn} site={task.location} />

          <Card>
            <CardHeader>
              <CardTitle>Progress</CardTitle>
            </CardHeader>
            <CardContent>
              <TaskStatusTimeline status={task.status} history={history} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Schedule</CardTitle>
            </CardHeader>
            <CardContent>
              <Details
                rows={[
                  ["Date", formatCalendarDate(task.scheduled_date)],
                  ["Start time", formatWallTime(task.scheduled_start_time)],
                  ["End time", formatWallTime(task.scheduled_end_time)],
                  ["Accepted", formatDateTime(task.accepted_at)],
                  ["Work started", formatDateTime(task.started_at)],
                  ["Completed", formatDateTime(task.completed_at)],
                  ["Created", formatDateTime(task.created_at)],
                  ["Created by", task.creator?.full_name ?? task.creator?.email ?? "—"],
                ]}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Customer & location</CardTitle>
            </CardHeader>
            <CardContent>
              <Details
                rows={[
                  [
                    "Customer",
                    <span key="c" className="inline-flex flex-wrap items-center gap-2">
                      {task.customer?.name ?? "—"}
                      {task.customer && !task.customer.is_active && <Badge variant="warning">Inactive</Badge>}
                    </span>,
                  ],
                  ["Customer code", task.customer?.customer_code ?? "—"],
                  [
                    "Location",
                    <span key="l" className="inline-flex flex-wrap items-center gap-2">
                      {task.location?.location_name ?? "—"}
                      {task.location && !task.location.is_active && <Badge variant="warning">Inactive</Badge>}
                    </span>,
                  ],
                  ["Address", address || "—"],
                  ["City", task.location?.city ?? "—"],
                  ["State", task.location?.state ?? "—"],
                  ["Contact", [task.location?.contact_person, task.location?.contact_phone].filter(Boolean).join(" · ") || "—"],
                ]}
              />
              {task.location?.latitude != null && task.location.longitude != null && (
                <a
                  href={mapsSearchUrl(task.location.latitude, task.location.longitude)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline"
                >
                  View site on map ({task.location.geofence_radius_meters} m geofence)
                </a>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Details({ rows }: { rows: ReadonlyArray<readonly [string, React.ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
