"use client";

import { useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";

import { AsyncCombobox } from "@/components/shared/async-combobox";
import { SearchBox } from "@/components/shared/search-box";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { customerLabel, renderCustomerOption } from "@/features/customers/components/customer-picker";
import type { CustomerOption } from "@/features/customers/schemas";
import { searchTaskAgents, searchTaskCustomers } from "@/features/tasks/actions";
import { agentLabel, renderAgentOption } from "@/features/tasks/components/task-form";
import {
  PRIORITIES,
  TASK_STATUS_META,
  TASK_STATUSES,
  TASK_TYPE_META,
  TASK_TYPES,
  type TaskStatus,
  type TaskType,
} from "@/features/tasks/constants";
import type { AgentOption } from "@/features/tasks/schemas";

// Filters include inactive agents/customers so historical tasks stay findable.
const searchAllAgents = (term: string) => searchTaskAgents(term, true);
const searchAllCustomers = (term: string) => searchTaskCustomers(term, true);

type TaskFiltersBarProps = {
  selectedAgent: AgentOption | null;
  selectedCustomer: CustomerOption | null;
};

const ALL = "all";

const statusLabel = (v: string | null) =>
  v && v in TASK_STATUS_META ? TASK_STATUS_META[v as TaskStatus].label : "All statuses";
const typeLabel = (v: string | null) => (v && v in TASK_TYPE_META ? TASK_TYPE_META[v as TaskType].label : "All types");
const priorityFilterLabel = (v: string | null) => PRIORITIES.find((p) => String(p.value) === v)?.label ?? "Any priority";

export function TaskFiltersBar({ selectedAgent, selectedCustomer }: TaskFiltersBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  function setParam(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams);
    if (value && value !== ALL) params.set(key, value);
    else params.delete(key);
    params.delete("page");
    startTransition(() => router.replace(`${pathname}?${params}`, { scroll: false }));
  }

  const active = ["q", "status", "type", "agent", "customer", "date", "priority"].some((k) => searchParams.get(k));

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchBox placeholder="Search code, customer, agent or location" />
        {active && (
          <Button variant="ghost" size="sm" asChild>
            <Link href={pathname} scroll={false}>
              <X aria-hidden />
              Clear filters
            </Link>
          </Button>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <FilterField id="filter-status" label="Status">
          <Select value={searchParams.get("status") ?? ALL} onValueChange={(v) => setParam("status", v)}>
            <SelectTrigger id="filter-status" className="h-10 w-full">
              {/* Explicit label so the value renders before hydration. */}
              <SelectValue>{statusLabel(searchParams.get("status"))}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              {TASK_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {TASK_STATUS_META[s].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FilterField>
        <FilterField id="filter-type" label="Task type">
          <Select value={searchParams.get("type") ?? ALL} onValueChange={(v) => setParam("type", v)}>
            <SelectTrigger id="filter-type" className="h-10 w-full">
              <SelectValue>{typeLabel(searchParams.get("type"))}</SelectValue>
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
        </FilterField>
        <FilterField id="filter-agent" label="Agent">
          <AsyncCombobox<AgentOption>
            id="filter-agent"
            value={selectedAgent}
            onChange={(a) => setParam("agent", a?.id ?? null)}
            search={searchAllAgents}
            getLabel={agentLabel}
            renderOption={renderAgentOption}
            placeholder="Any agent"
            searchPlaceholder="Search agents…"
            clearable
          />
        </FilterField>
        <FilterField id="filter-customer" label="Customer">
          <AsyncCombobox<CustomerOption>
            id="filter-customer"
            value={selectedCustomer}
            onChange={(c) => setParam("customer", c?.id ?? null)}
            search={searchAllCustomers}
            getLabel={customerLabel}
            renderOption={renderCustomerOption}
            placeholder="Any customer"
            searchPlaceholder="Search customers…"
            clearable
          />
        </FilterField>
        <FilterField id="filter-date" label="Scheduled date">
          <Input
            id="filter-date"
            type="date"
            className="h-10"
            value={searchParams.get("date") ?? ""}
            onChange={(e) => setParam("date", e.target.value || null)}
          />
        </FilterField>
        <FilterField id="filter-priority" label="Priority">
          <Select value={searchParams.get("priority") ?? ALL} onValueChange={(v) => setParam("priority", v)}>
            <SelectTrigger id="filter-priority" className="h-10 w-full">
              <SelectValue>{priorityFilterLabel(searchParams.get("priority"))}</SelectValue>
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
        </FilterField>
      </div>
    </div>
  );
}

function FilterField({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}
