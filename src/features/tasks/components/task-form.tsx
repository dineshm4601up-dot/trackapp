"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";

import { AsyncCombobox } from "@/components/shared/async-combobox";
import { FieldShell, FormError, FormSection, TextareaField, TextField } from "@/components/shared/form-fields";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { customerLabel, renderCustomerOption } from "@/features/customers/components/customer-picker";
import type { CustomerOption } from "@/features/customers/schemas";
import { searchTaskAgents, searchTaskCustomers, searchTaskLocations } from "@/features/tasks/actions";
import { lineErrors, ProductLinesEditor, type ProductLine } from "@/features/tasks/components/product-lines-editor";
import {
  DEFAULT_PRIORITY,
  PRIORITIES,
  priorityLabel,
  TASK_TYPE_META,
  TASK_TYPES,
  type TaskStatus,
  type TaskType,
} from "@/features/tasks/constants";
import type { AgentOption, LocationOption } from "@/features/tasks/schemas";
import { useFormAction } from "@/hooks/use-form-action";
import { formatCalendarDate, formatMoney, formatWallTime } from "@/lib/format";
import type { FormState } from "@/lib/form-state";

export type TaskFormInitial = {
  task_type: TaskType;
  title: string;
  description: string;
  priority: number;
  customer: CustomerOption;
  location: LocationOption;
  agent: AgentOption | null;
  expected_amount: string;
  scheduled_date: string;
  scheduled_start_time: string;
  scheduled_end_time: string;
  lines: ProductLine[];
};

type TaskFormProps = {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  /** Present when editing. */
  initial?: TaskFormInitial;
  status?: TaskStatus;
  cancelHref: string;
  /** Default scheduled date for new tasks (business-time-zone "today"). */
  today: string;
};

export const agentLabel = (a: AgentOption) =>
  [a.full_name ?? "Unnamed agent", a.employee_code].filter(Boolean).join(" · ");

export function renderAgentOption(a: AgentOption) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <span className="min-w-0 flex-1 truncate">{a.full_name ?? "Unnamed agent"}</span>
      <span className="shrink-0 text-xs text-muted-foreground">
        <span className="font-mono">{a.employee_code}</span>
        {a.phone ? ` · ${a.phone}` : ""}
      </span>
    </span>
  );
}

const locationLabel = (l: LocationOption) => (l.city ? `${l.location_name} — ${l.city}` : l.location_name);

export function TaskForm({ action, initial, status, cancelHref, today }: TaskFormProps) {
  const { state, formAction, pending, errorFor } = useFormAction(action);
  const [intent, setIntent] = useState<"draft" | "assign">("assign");

  const [taskType, setTaskType] = useState<TaskType>(initial?.task_type ?? "DELIVER_PRODUCTS");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [priority, setPriority] = useState(String(initial?.priority ?? DEFAULT_PRIORITY));
  const [customer, setCustomer] = useState<CustomerOption | null>(initial?.customer ?? null);
  const [location, setLocation] = useState<LocationOption | null>(initial?.location ?? null);
  const [agent, setAgent] = useState<AgentOption | null>(initial?.agent ?? null);
  const [date, setDate] = useState(initial ? initial.scheduled_date : today);
  const [start, setStart] = useState(initial?.scheduled_start_time ?? "");
  const [end, setEnd] = useState(initial?.scheduled_end_time ?? "");
  const [lines, setLines] = useState<ProductLine[]>(initial?.lines ?? []);
  const [expectedAmount, setExpectedAmount] = useState(initial?.expected_amount ?? "");
  const isCash = TASK_TYPE_META[taskType].execution === "cash";

  const productsRule = TASK_TYPE_META[taskType].products;
  const submittedLines = productsRule === "none" ? [] : lines;
  const linesValid = submittedLines.every((line) => {
    const e = lineErrors(line);
    return !e.quantity && !e.unitPrice;
  });

  const searchLocations = useCallback(
    (term: string) => (customer ? searchTaskLocations(customer.id, term) : Promise.resolve([])),
    [customer],
  );

  function changeCustomer(next: CustomerOption | null) {
    if (next?.id !== customer?.id) setLocation(null);
    setCustomer(next);
  }

  const isDraftOrNew = !status || status === "DRAFT";
  const pendingLabel = !initial
    ? intent === "assign" ? "Creating task…" : "Saving draft…"
    : intent === "assign" && status === "DRAFT" ? "Assigning task…" : "Updating task…";

  return (
    <form action={formAction} className="space-y-6" noValidate>
      <FormError message={state.status === "error" ? state.message : undefined} />

      {/* Values held in React state are submitted through hidden inputs. */}
      <input type="hidden" name="task_type" value={taskType} />
      <input type="hidden" name="priority" value={priority} />
      <input type="hidden" name="customer_id" value={customer?.id ?? ""} />
      <input type="hidden" name="location_id" value={location?.id ?? ""} />
      <input type="hidden" name="agent_id" value={agent?.id ?? ""} />
      <input
        type="hidden"
        name="products"
        value={JSON.stringify(
          submittedLines.map((l) => ({
            product_id: l.product.id,
            assigned_quantity: l.quantity.trim(),
            unit_price: l.unitPrice.trim(),
          })),
        )}
      />

      <FormSection title="Task information">
        <FieldShell id="task_type" label="Task type" required error={errorFor("task_type")}>
          <Select value={taskType} onValueChange={(v) => setTaskType(v as TaskType)}>
            <SelectTrigger id="task_type" className="h-10 w-full">
              <SelectValue>{TASK_TYPE_META[taskType].label}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {TASK_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {TASK_TYPE_META[type].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldShell>
        <FieldShell id="priority" label="Priority" required error={errorFor("priority")}>
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger id="priority" className="h-10 w-full">
              <SelectValue>{priorityLabel(Number(priority))}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {PRIORITIES.map((p) => (
                <SelectItem key={p.value} value={String(p.value)}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldShell>
        <TextField
          name="title"
          label="Title"
          required
          maxLength={200}
          placeholder="e.g. Deliver monthly product order"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          error={errorFor("title")}
          fieldClassName="sm:col-span-2"
        />
        <TextareaField
          name="description"
          label="Instructions"
          rows={4}
          maxLength={4000}
          hint="Plain text shown to the agent."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          error={errorFor("description")}
          fieldClassName="sm:col-span-2"
        />
      </FormSection>

      <FormSection title="Customer & location" description="Only active customers and their active locations can be selected.">
        <FieldShell id="customer_id" label="Customer" required error={errorFor("customer_id")}>
          <AsyncCombobox<CustomerOption>
            id="customer_id"
            value={customer}
            onChange={changeCustomer}
            search={searchTaskCustomers}
            getLabel={customerLabel}
            renderOption={renderCustomerOption}
            placeholder="Select a customer…"
            searchPlaceholder="Search by name or code…"
            emptyText="No active customers found."
            invalid={Boolean(errorFor("customer_id"))}
            describedBy={errorFor("customer_id") ? "customer_id-error" : undefined}
          />
        </FieldShell>
        <FieldShell
          id="location_id"
          label="Location"
          required
          error={errorFor("location_id")}
          hint={customer ? undefined : "Select a customer first."}
        >
          <AsyncCombobox<LocationOption>
            key={customer?.id ?? "none"}
            id="location_id"
            value={location}
            onChange={setLocation}
            search={searchLocations}
            getLabel={locationLabel}
            placeholder={customer ? "Select a location…" : "Select a customer first"}
            searchPlaceholder="Search locations…"
            emptyText="This customer has no active locations."
            disabled={!customer}
            invalid={Boolean(errorFor("location_id"))}
            describedBy={errorFor("location_id") ? "location_id-error" : customer ? undefined : "location_id-hint"}
          />
        </FieldShell>
      </FormSection>

      <FormSection title="Assignment" description="Only active agents can be assigned.">
        <FieldShell
          id="agent_id"
          label="Agent"
          required={!isDraftOrNew || intent === "assign"}
          error={errorFor("agent_id")}
          hint="Required to assign. Drafts may be saved without an agent."
          className="sm:col-span-2"
        >
          <AsyncCombobox<AgentOption>
            id="agent_id"
            value={agent}
            onChange={setAgent}
            search={searchTaskAgents}
            getLabel={agentLabel}
            renderOption={renderAgentOption}
            placeholder="Select an agent…"
            searchPlaceholder="Search by name, code or phone…"
            emptyText="No active agents found."
            clearable={isDraftOrNew}
            invalid={Boolean(errorFor("agent_id"))}
            describedBy={errorFor("agent_id") ? "agent_id-error" : "agent_id-hint"}
          />
        </FieldShell>
      </FormSection>

      <FormSection title="Schedule" description="Business-local date and time; stored exactly as entered.">
        <TextField
          name="scheduled_date"
          label="Scheduled date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          error={errorFor("scheduled_date")}
          fieldClassName="sm:col-span-2"
        />
        <TextField
          name="scheduled_start_time"
          label="Start time"
          type="time"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          error={errorFor("scheduled_start_time")}
        />
        <TextField
          name="scheduled_end_time"
          label="End time"
          type="time"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          error={errorFor("scheduled_end_time")}
        />
      </FormSection>

      {isCash && (
        <FormSection title="Cash collection" description="The agent records the amount actually collected against this.">
          <TextField
            name="expected_amount"
            label="Expected amount"
            required={intent === "assign" || !isDraftOrNew}
            inputMode="decimal"
            placeholder="0.00"
            hint="Up to 2 decimal places."
            value={expectedAmount}
            onChange={(e) => setExpectedAmount(e.target.value)}
            error={errorFor("expected_amount")}
          />
        </FormSection>
      )}

      {productsRule !== "none" && (
        <Card>
          <CardHeader>
            <CardTitle>
              Products {productsRule === "optional" && <span className="text-sm font-normal text-muted-foreground">(optional)</span>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ProductLinesEditor lines={lines} onChange={setLines} required={productsRule === "required"} error={errorFor("products")} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Review</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
            <ReviewRow label="Task type" value={TASK_TYPE_META[taskType].label} />
            <ReviewRow label="Title" value={title.trim() || null} required />
            <ReviewRow label="Customer" value={customer ? customerLabel(customer) : null} required />
            <ReviewRow label="Location" value={location ? locationLabel(location) : null} required />
            <ReviewRow label="Agent" value={agent ? agentLabel(agent) : null} required={!isDraftOrNew || intent === "assign"} />
            <ReviewRow label="Priority" value={priorityLabel(Number(priority))} />
            {isCash && <ReviewRow label="Expected amount" value={expectedAmount ? formatMoney(expectedAmount) : null} required />}
            <ReviewRow
              label="Schedule"
              value={
                date
                  ? `${formatCalendarDate(date)}${start ? `, ${formatWallTime(start)}` : ""}${end ? ` – ${formatWallTime(end)}` : ""}`
                  : "Not scheduled"
              }
            />
            {productsRule !== "none" && (
              <ReviewRow
                label="Products"
                value={submittedLines.length ? `${submittedLines.length} line${submittedLines.length === 1 ? "" : "s"}` : null}
                required={productsRule === "required"}
              />
            )}
          </dl>
        </CardContent>
      </Card>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" size="lg" asChild>
          <Link href={cancelHref}>Cancel</Link>
        </Button>
        {isDraftOrNew && (
          <Button
            type="submit"
            name="intent"
            value="draft"
            variant="outline"
            size="lg"
            disabled={pending || !linesValid}
            onClick={() => setIntent("draft")}
          >
            {initial ? "Save draft" : "Save as draft"}
          </Button>
        )}
        <Button
          type="submit"
          name="intent"
          value="assign"
          size="lg"
          disabled={pending || !linesValid}
          onClick={() => setIntent("assign")}
        >
          {pending && <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden />}
          {pending ? pendingLabel : !initial ? "Create & assign" : status === "DRAFT" ? "Save & assign" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

function ReviewRow({ label, value, required }: { label: string; value: string | null; required?: boolean }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={value ? "" : required ? "text-destructive" : "text-muted-foreground"}>
        {value ?? (required ? "Required" : "—")}
      </dd>
    </>
  );
}
