import Link from "next/link";
import { Send, SearchX } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { PaginationBar } from "@/components/shared/pagination-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RetryCommunicationButton } from "@/features/notifications/components/notification-buttons";
import {
  CHANNEL_LABELS,
  LOG_CHANNELS,
  LOG_STATUSES,
  NOTIFICATION_PAGE_SIZE,
  NOTIFICATION_TYPES,
  NOTIFICATION_TYPE_META,
  notificationTypeMeta,
  STATUS_LABELS,
} from "@/features/notifications/constants";
import { listCommunicationLog, logFilterQuery, type LogFilters } from "@/features/notifications/queries";
import { businessUtcOffset, formatDateTime } from "@/lib/format";

const selectClass =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

/** Filters are a plain GET form: they work without JavaScript and keep the URL shareable. */
export function CommunicationLogFilters({ filters }: { filters: LogFilters }) {
  return (
    <form method="get" action="/admin/notifications" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Notification log filters">
      <input type="hidden" name="view" value="log" />
      <Field id="log-q" label="Recipient or task">
        <Input id="log-q" name="q" defaultValue={filters.q} placeholder="Name, address or task code" className="h-10" maxLength={100} />
      </Field>
      <Field id="log-type" label="Type">
        <select id="log-type" name="type" defaultValue={filters.type ?? ""} className={selectClass}>
          <option value="">All types</option>
          {NOTIFICATION_TYPES.map((type) => (
            <option key={type} value={type}>
              {NOTIFICATION_TYPE_META[type].label}
            </option>
          ))}
        </select>
      </Field>
      <Field id="log-channel" label="Channel">
        <select id="log-channel" name="channel" defaultValue={filters.channel ?? ""} className={selectClass}>
          <option value="">All channels</option>
          {LOG_CHANNELS.map((channel) => (
            <option key={channel} value={channel}>
              {CHANNEL_LABELS[channel]}
            </option>
          ))}
        </select>
      </Field>
      <Field id="log-status" label="Status">
        <select id="log-status" name="status" defaultValue={filters.status ?? ""} className={selectClass}>
          <option value="">All statuses</option>
          {LOG_STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status].label}
            </option>
          ))}
        </select>
      </Field>
      <Field id="log-from" label="From">
        <Input id="log-from" name="from" type="date" defaultValue={filters.from ?? ""} className="h-10" />
      </Field>
      <Field id="log-to" label="To">
        <Input id="log-to" name="to" type="date" defaultValue={filters.to ?? ""} className="h-10" />
      </Field>
      <div className="flex items-end gap-2">
        <Button type="submit">Apply filters</Button>
        <Button variant="ghost" asChild>
          <Link href="/admin/notifications?view=log">Clear</Link>
        </Button>
      </div>
    </form>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

/** Read-only history of what was sent to whom, by which channel, and what happened. */
export async function CommunicationLog({ filters }: { filters: LogFilters }) {
  const { rows, total } = await listCommunicationLog(filters, businessUtcOffset());
  if (rows.length === 0) {
    const filtered = Object.entries(logFilterQuery(filters)).some(([key, value]) => key !== "view" && value);
    return filtered ? (
      <EmptyState icon={SearchX} title="No notifications match these filters." description="Try different filters or clear them." />
    ) : (
      <EmptyState icon={Send} title="No notifications yet." description="Notifications appear here as tasks are assigned and worked on." />
    );
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <caption className="sr-only">Notification delivery log</caption>
          <TableHeader>
            <TableRow>
              <TableHead>Created</TableHead>
              <TableHead>Notification</TableHead>
              <TableHead>Recipient</TableHead>
              <TableHead>Task</TableHead>
              <TableHead>Channel</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Sent</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const status = row.status && row.status in STATUS_LABELS ? STATUS_LABELS[row.status as keyof typeof STATUS_LABELS] : null;
              const channel = row.channel && row.channel in CHANNEL_LABELS ? CHANNEL_LABELS[row.channel as keyof typeof CHANNEL_LABELS] : row.channel;
              return (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap">{formatDateTime(row.created_at)}</TableCell>
                  <TableCell>
                    <span className="block max-w-56 truncate font-medium">{row.title}</span>
                    <span className="text-xs text-muted-foreground">{row.type ? notificationTypeMeta(row.type).label : "—"}</span>
                  </TableCell>
                  <TableCell>
                    <span className="block max-w-44 truncate">{row.recipient_name ?? "—"}</span>
                    {row.recipient_address && <span className="block max-w-44 truncate text-xs text-muted-foreground">{row.recipient_address}</span>}
                  </TableCell>
                  <TableCell>
                    {row.task_id && row.task_code ? (
                      <Link href={`/admin/tasks/${row.task_id}`} className="font-mono text-xs hover:underline">
                        {row.task_code}
                      </Link>
                    ) : (
                      <span className="font-mono text-xs">{row.task_code ?? "—"}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {channel}
                    {row.provider && <span className="block text-xs text-muted-foreground">{row.provider}</span>}
                  </TableCell>
                  <TableCell>{status ? <Badge variant={status.badge}>{status.label}</Badge> : row.status}</TableCell>
                  <TableCell className="whitespace-nowrap">{row.channel === "IN_APP" ? "—" : formatDateTime(row.sent_at)}</TableCell>
                  <TableCell>
                    <div className="flex max-w-64 flex-col items-start gap-1 text-xs">
                      {(row.attempt_count ?? 0) > 0 && (
                        <span className="text-muted-foreground">
                          {row.attempt_count} attempt{row.attempt_count === 1 ? "" : "s"}
                        </span>
                      )}
                      {row.last_error && <span className="break-words text-destructive">{row.last_error}</span>}
                      {row.status === "FAILED" && row.queue_id && <RetryCommunicationButton queueId={row.queue_id} />}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <PaginationBar basePath="/admin/notifications" page={filters.page} total={total} pageSize={NOTIFICATION_PAGE_SIZE} query={logFilterQuery(filters)} />
    </div>
  );
}
