"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { RefreshCw, X } from "lucide-react";

import { AsyncCombobox } from "@/components/shared/async-combobox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { customerLabel, renderCustomerOption } from "@/features/customers/components/customer-picker";
import type { CustomerOption } from "@/features/customers/schemas";
import { searchAllLocations, searchTaskAgents, searchTaskCustomers } from "@/features/tasks/actions";
import { agentLabel, renderAgentOption } from "@/features/tasks/components/task-form";
import { PRIORITIES, TASK_STATUS_META, TASK_STATUSES, TASK_TYPE_META, TASK_TYPES, type TaskStatus, type TaskType } from "@/features/tasks/constants";
import type { AgentOption, LocationOption } from "@/features/tasks/schemas";
import { RANGE_PRESETS, type RangePreset } from "@/lib/analytics/range";
import { cn } from "@/lib/utils";

const searchAllAgents = (term: string) => searchTaskAgents(term, true);
const searchAllCustomers = (term: string) => searchTaskCustomers(term, true);
const locationLabel = (l: LocationOption) => (l.city ? `${l.location_name}, ${l.city}` : l.location_name);
const ALL = "all";

export type FilterKey = "agent" | "type" | "status" | "customer" | "location" | "priority";

type ReportFilterBarProps = {
  preset: RangePreset;
  from: string;
  to: string;
  selectedAgent: AgentOption | null;
  selectedCustomer: CustomerOption | null;
  selectedLocation: LocationOption | null;
  /** Filters that make no sense on this report. */
  hide?: FilterKey[];
};

/**
 * The one filter row above every report: date range first, then dimensions.
 * Filters live in the URL, so every number, table and export below them is
 * computed on the server for exactly this slice.
 */
export function ReportFilterBar({ preset, from, to, selectedAgent, selectedCustomer, selectedLocation, hide = [] }: ReportFilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [customFrom, setCustomFrom] = useState(from);
  const [customTo, setCustomTo] = useState(to);
  const show = (key: FilterKey) => !hide.includes(key);

  function update(changes: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (value && value !== ALL) params.set(key, value);
      else params.delete(key);
    }
    params.delete("page");
    startTransition(() => router.replace(`${pathname}?${params}`, { scroll: false }));
  }

  function setPreset(value: string) {
    if (value === "custom") update({ range: "custom", from: customFrom, to: customTo });
    else update({ range: value, from: null, to: null });
  }

  const active = ["agent", "type", "status", "customer", "location", "priority", "segment"].some((k) => searchParams.get(k));
  const type = searchParams.get("type");
  const status = searchParams.get("status");
  const priority = searchParams.get("priority");

  return (
    <div className={cn("space-y-3 rounded-xl border p-3", pending && "opacity-70")} role="search" aria-label="Report filters">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field id="rf-range" label="Period">
          <Select value={preset} onValueChange={setPreset}>
            <SelectTrigger id="rf-range" className="h-10 w-full">
              <SelectValue>{RANGE_PRESETS.find((p) => p.key === preset)?.label}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {RANGE_PRESETS.map((p) => (
                <SelectItem key={p.key} value={p.key}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {preset === "custom" && (
          <>
            <Field id="rf-from" label="From">
              <Input id="rf-from" type="date" className="h-10" value={customFrom} max={customTo} onChange={(e) => setCustomFrom(e.target.value)} />
            </Field>
            <Field id="rf-to" label="To">
              <Input id="rf-to" type="date" className="h-10" value={customTo} min={customFrom} onChange={(e) => setCustomTo(e.target.value)} />
            </Field>
            <div className="flex items-end">
              <Button variant="outline" onClick={() => update({ range: "custom", from: customFrom, to: customTo })} disabled={!customFrom || !customTo || customFrom > customTo}>
                Apply range
              </Button>
            </div>
          </>
        )}
        {show("agent") && (
          <Field id="rf-agent" label="Agent">
            <AsyncCombobox<AgentOption>
              id="rf-agent"
              value={selectedAgent}
              onChange={(a) => update({ agent: a?.id ?? null })}
              search={searchAllAgents}
              getLabel={agentLabel}
              renderOption={renderAgentOption}
              placeholder="All agents"
              searchPlaceholder="Search agents…"
              clearable
            />
          </Field>
        )}
        {show("customer") && (
          <Field id="rf-customer" label="Customer">
            <AsyncCombobox<CustomerOption>
              id="rf-customer"
              value={selectedCustomer}
              onChange={(c) => update({ customer: c?.id ?? null })}
              search={searchAllCustomers}
              getLabel={customerLabel}
              renderOption={renderCustomerOption}
              placeholder="All customers"
              searchPlaceholder="Search customers…"
              clearable
            />
          </Field>
        )}
        {show("location") && (
          <Field id="rf-location" label="Location">
            <AsyncCombobox<LocationOption>
              id="rf-location"
              value={selectedLocation}
              onChange={(l) => update({ location: l?.id ?? null })}
              search={searchAllLocations}
              getLabel={locationLabel}
              renderOption={(l) => <span className="truncate">{locationLabel(l)}</span>}
              placeholder="All locations"
              searchPlaceholder="Search locations…"
              clearable
            />
          </Field>
        )}
        {show("type") && (
          <Field id="rf-type" label="Task type">
            <Select value={type ?? ALL} onValueChange={(v) => update({ type: v })}>
              <SelectTrigger id="rf-type" className="h-10 w-full">
                <SelectValue>{type && type in TASK_TYPE_META ? TASK_TYPE_META[type as TaskType].label : "All types"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All types</SelectItem>
                {TASK_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {TASK_TYPE_META[t].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
        {show("status") && (
          <Field id="rf-status" label="Status">
            <Select value={status ?? ALL} onValueChange={(v) => update({ status: v })}>
              <SelectTrigger id="rf-status" className="h-10 w-full">
                <SelectValue>{status && status in TASK_STATUS_META ? TASK_STATUS_META[status as TaskStatus].label : "All statuses"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All statuses</SelectItem>
                {TASK_STATUSES.filter((s) => s !== "DRAFT").map((s) => (
                  <SelectItem key={s} value={s}>
                    {TASK_STATUS_META[s].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
        {show("priority") && (
          <Field id="rf-priority" label="Priority">
            <Select value={priority ?? ALL} onValueChange={(v) => update({ priority: v })}>
              <SelectTrigger id="rf-priority" className="h-10 w-full">
                <SelectValue>{PRIORITIES.find((p) => String(p.value) === priority)?.label ?? "Any priority"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Any priority</SelectItem>
                {PRIORITIES.map((p) => (
                  <SelectItem key={p.value} value={String(p.value)}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => startTransition(() => router.refresh())} disabled={pending}>
          <RefreshCw className={cn(pending && "animate-spin")} data-icon="inline-start" aria-hidden />
          Refresh
        </Button>
        {active && (
          <Button variant="ghost" size="sm" asChild>
            <Link href={`${pathname}?range=${preset}${preset === "custom" ? `&from=${from}&to=${to}` : ""}`} scroll={false}>
              <X data-icon="inline-start" aria-hidden />
              Clear filters
            </Link>
          </Button>
        )}
      </div>
    </div>
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
