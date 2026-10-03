"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { completeMyTask, type CompleteInput } from "@/features/execution/actions";
import {
  AMOUNT_PATTERN,
  looksLikeCardNumber,
  QUANTITY_PATTERN,
  REFERENCE_MAX,
  REFERENCE_PATTERN,
  SHORTFALL_REASONS,
} from "@/features/execution/config";
import { EXECUTION_FORM_ID } from "@/features/tasks/components/agent-task-actions";
import { PAYMENT_METHODS, paymentMethodLabel, REFERENCE_REQUIRED_METHODS, type TaskTypeMeta } from "@/features/tasks/constants";
import { compareDecimal, decimalDiff, formatQuantity } from "@/lib/decimal";
import { formatMoney } from "@/lib/format";
import { isNetworkError, NETWORK_ERROR_MESSAGE } from "@/lib/network";

export type ExecutionLine = { id: string; name: string; sku: string | null; unit: string | null; assigned: string };

type ExecutionFormProps = {
  taskId: string;
  meta: TaskTypeMeta;
  lines: ExecutionLine[];
  /** numeric(14,2) as text, or null when not set */
  expectedAmount: string | null;
  photoCount: number;
  proofCount: number;
};

type Errors = Partial<Record<string, string>>;

/**
 * Captures what actually happened (delivered quantities, money collected,
 * result notes). The client only previews the outcome; the server re-validates
 * everything and decides COMPLETED vs PARTIALLY_COMPLETED.
 */
export function ExecutionForm({ taskId, meta, lines, expectedAmount, photoCount, proofCount }: ExecutionFormProps) {
  const router = useRouter();
  const mode = meta.execution;
  const [delivered, setDelivered] = useState<Record<string, string>>(() =>
    Object.fromEntries(lines.map((l) => [l.id, formatQuantity(l.assigned)])),
  );
  const [lineNotes, setLineNotes] = useState<Record<string, string>>({});
  const [collected, setCollected] = useState("");
  const [method, setMethod] = useState("");
  const [reference, setReference] = useState("");
  const [cashNotes, setCashNotes] = useState("");
  const [notes, setNotes] = useState("");
  const [partial, setPartial] = useState(false);
  const [reasonChoice, setReasonChoice] = useState("");
  const [reasonDetail, setReasonDetail] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);

  // ---- outcome preview (display only)
  const outstandingLines = lines.flatMap((line) => {
    const value = delivered[line.id]?.trim() ?? "";
    const diff = QUANTITY_PATTERN.test(value) ? decimalDiff(line.assigned, value, 3) : null;
    return diff !== null && compareDecimal(diff, "0", 3) === 1 ? [{ line, outstanding: diff }] : [];
  });
  const cashOutstanding =
    expectedAmount && AMOUNT_PATTERN.test(collected.trim()) ? decimalDiff(expectedAmount, collected.trim(), 2) : null;
  const shortfall =
    mode === "delivery"
      ? outstandingLines.length > 0
      : mode === "cash"
        ? cashOutstanding !== null && compareDecimal(cashOutstanding, "0", 2) === 1
        : partial;
  const reason = reasonChoice === "Other" ? reasonDetail.trim() : [reasonChoice, reasonDetail.trim()].filter(Boolean).join(" — ");
  const referenceRequired = (REFERENCE_REQUIRED_METHODS as readonly string[]).includes(method);

  // Derived from props, so it clears as soon as the refreshed proof count arrives.
  const proofMissing =
    meta.proof === "photo-required" && photoCount === 0
      ? "Add at least one delivery photo before completing."
      : meta.proof === "any-required" && proofCount === 0
        ? "Add the collected document (photo or PDF) before completing."
        : null;

  function validate(): Errors {
    const next: Errors = {};
    if (mode === "delivery") {
      let total = false;
      for (const line of lines) {
        const value = delivered[line.id]?.trim() ?? "";
        if (!QUANTITY_PATTERN.test(value)) next[`line-${line.id}`] = "Enter a number (up to 3 decimals).";
        else if (compareDecimal(value, line.assigned, 3) === 1)
          next[`line-${line.id}`] = `Can't be more than the assigned ${formatQuantity(line.assigned)}.`;
        else if (compareDecimal(value, "0", 3) === 1) total = true;
      }
      if (!Object.keys(next).length && !total)
        next.form = "Nothing was delivered. Use “Report a problem” to mark the task as failed instead.";
    }
    if (mode === "cash") {
      const amount = collected.trim();
      if (!expectedAmount) next.form = "No amount to collect is set for this task. Please contact your administrator.";
      else if (!AMOUNT_PATTERN.test(amount)) next.collected = "Enter the amount collected (up to 2 decimals).";
      else if (compareDecimal(amount, "0", 2) !== 1)
        next.collected = "Nothing collected? Use “Report a problem” to mark the task as failed instead.";
      else if (compareDecimal(amount, expectedAmount, 2) === 1)
        next.collected = `Can't be more than the expected ${formatMoney(expectedAmount)}.`;
      if (!method) next.method = "Select how the customer paid.";
      const ref = reference.trim();
      if (referenceRequired && !ref) next.reference = "Enter the transaction or cheque number.";
      else if (ref && (ref.length > REFERENCE_MAX || !REFERENCE_PATTERN.test(ref)))
        next.reference = "Letters, numbers and . _ / : # - only (max 64).";
      else if (ref && looksLikeCardNumber(ref))
        next.reference = "That looks like a card number. Never record card numbers — use the receipt or approval code.";
    }
    if (meta.result === "required" && notes.trim().length < 3) next.notes = "Describe the result (at least 3 characters).";
    if (shortfall && reason.length < 3) next.reason = "Give a reason for the shortfall.";
    if (proofMissing) next.proof = proofMissing;
    return next;
  }

  function review(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    setAttempted(true);
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length) {
      if (next.form) setFormError(next.form);
      return;
    }
    setConfirmOpen(true);
  }

  async function submit() {
    if (busy.current) return; // one submission at a time
    busy.current = true;
    setPending(true);
    const input: CompleteInput = {
      taskId,
      notes: notes.trim() || undefined,
      reason: shortfall ? reason : undefined,
      partial: mode === "generic" ? partial : undefined,
      lines:
        mode === "delivery"
          ? lines.map((l) => ({ id: l.id, delivered: delivered[l.id]!.trim(), notes: lineNotes[l.id]?.trim() || undefined }))
          : undefined,
      cash:
        mode === "cash"
          ? { collected: collected.trim(), method, reference: reference.trim() || undefined, notes: cashNotes.trim() || undefined }
          : undefined,
    };
    try {
      const result = await completeMyTask(input);
      if (result.ok) {
        toast.success(result.message);
        setConfirmOpen(false);
      } else {
        setConfirmOpen(false);
        setFormError(result.message);
        toast.error(result.message);
      }
      router.refresh();
    } catch (error) {
      if (!isNetworkError(error)) throw error;
      setConfirmOpen(false);
      setFormError(NETWORK_ERROR_MESSAGE);
      router.refresh(); // re-read the real state before trying again
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <form id={EXECUTION_FORM_ID} onSubmit={review} noValidate className="space-y-4">
      {(formError || (attempted && proofMissing)) && (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertTitle>Can&apos;t complete yet</AlertTitle>
          <AlertDescription>{formError ?? proofMissing}</AlertDescription>
        </Alert>
      )}

      {mode === "delivery" && (
        <Card>
          <CardHeader>
            <CardTitle>Delivered quantities</CardTitle>
            <CardDescription>Change a quantity only if less was delivered than assigned.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {lines.map((line) => {
                const id = `delivered-${line.id}`;
                const error = errors[`line-${line.id}`];
                const short = outstandingLines.find((o) => o.line.id === line.id);
                return (
                  <li key={line.id} className="space-y-2 py-3 first:pt-0 last:pb-0">
                    <div className="flex items-end justify-between gap-3">
                      <div className="min-w-0">
                        <Label htmlFor={id} className="font-medium">
                          {line.name}
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          {line.sku && <span className="font-mono">{line.sku} · </span>}
                          Assigned {formatQuantity(line.assigned)} {line.unit}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Input
                          id={id}
                          inputMode="decimal"
                          className="h-11 w-24 text-right text-base tabular-nums"
                          value={delivered[line.id] ?? ""}
                          onChange={(e) => setDelivered((d) => ({ ...d, [line.id]: e.target.value }))}
                          aria-invalid={Boolean(error)}
                          aria-describedby={error ? `${id}-error` : undefined}
                        />
                        <span className="w-10 text-sm text-muted-foreground">{line.unit}</span>
                      </div>
                    </div>
                    {error && (
                      <p id={`${id}-error`} className="text-sm text-destructive">
                        {error}
                      </p>
                    )}
                    {short && (
                      <>
                        <p className="text-sm text-warning">
                          {formatQuantity(short.outstanding)} {line.unit} not delivered
                        </p>
                        <Input
                          aria-label={`Note for ${line.name}`}
                          placeholder="Note for this product (optional)"
                          maxLength={500}
                          value={lineNotes[line.id] ?? ""}
                          onChange={(e) => setLineNotes((n) => ({ ...n, [line.id]: e.target.value }))}
                        />
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {mode === "cash" && (
        <Card>
          <CardHeader>
            <CardTitle>Payment received</CardTitle>
            <CardDescription>
              Expected: <span className="font-semibold text-foreground">{formatMoney(expectedAmount)}</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field id="collected" label="Amount collected" error={errors.collected}>
              <Input
                id="collected"
                inputMode="decimal"
                placeholder="0.00"
                className="h-11 text-base tabular-nums"
                value={collected}
                onChange={(e) => setCollected(e.target.value)}
                aria-invalid={Boolean(errors.collected)}
              />
            </Field>
            {shortfall && cashOutstanding && (
              <p className="text-sm text-warning">{formatMoney(cashOutstanding)} will remain outstanding.</p>
            )}
            <Field id="payment-method" label="Payment method" error={errors.method}>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger id="payment-method" className="h-11 w-full" aria-invalid={Boolean(errors.method)}>
                  <SelectValue placeholder="Select method">{method ? paymentMethodLabel(method) : undefined}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field
              id="reference"
              label={referenceRequired ? "Reference" : "Reference (optional)"}
              error={errors.reference}
              hint={
                method === "CARD"
                  ? "Receipt or approval code only. Never enter card numbers, CVV or PINs."
                  : "Transaction ID, cheque number or receipt number."
              }
            >
              <Input
                id="reference"
                autoComplete="off"
                maxLength={REFERENCE_MAX}
                className="h-11"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                aria-invalid={Boolean(errors.reference)}
              />
            </Field>
            <Field id="cash-notes" label="Collection notes (optional)">
              <Textarea id="cash-notes" rows={2} maxLength={500} value={cashNotes} onChange={(e) => setCashNotes(e.target.value)} />
            </Field>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{meta.result === "required" ? "Result" : "Notes"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field
            id="completion-notes"
            label={meta.result === "required" ? "What did you find?" : "Notes for your administrator (optional)"}
            error={errors.notes}
          >
            <Textarea
              id="completion-notes"
              rows={3}
              maxLength={2000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              aria-invalid={Boolean(errors.notes)}
            />
          </Field>
          {mode === "generic" && (
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="partial">Only partly done</Label>
              <Switch id="partial" checked={partial} onCheckedChange={setPartial} />
            </div>
          )}
          {shortfall && (
            <div className="space-y-3 rounded-lg border border-warning/40 p-3">
              <Field id="shortfall-reason" label="Reason for the shortfall" error={errors.reason}>
                <Select value={reasonChoice} onValueChange={setReasonChoice}>
                  <SelectTrigger id="shortfall-reason" className="h-11 w-full" aria-invalid={Boolean(errors.reason)}>
                    <SelectValue placeholder="Select a reason">{reasonChoice || undefined}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {SHORTFALL_REASONS.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field id="shortfall-detail" label={reasonChoice === "Other" ? "Details" : "Details (optional)"}>
                <Textarea
                  id="shortfall-detail"
                  rows={2}
                  maxLength={400}
                  value={reasonDetail}
                  onChange={(e) => setReasonDetail(e.target.value)}
                />
              </Field>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={confirmOpen} onOpenChange={(open) => !pending && setConfirmOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{shortfall ? "Submit as partially completed?" : "Complete this task?"}</DialogTitle>
            <DialogDescription>Check the details. Once submitted, they can&apos;t be changed.</DialogDescription>
          </DialogHeader>
          <ul className="space-y-1 text-sm">
            {mode === "delivery" &&
              lines.map((line) => (
                <li key={line.id} className="flex justify-between gap-3">
                  <span className="truncate">{line.name}</span>
                  <span className="shrink-0 tabular-nums">
                    {formatQuantity(delivered[line.id]?.trim() || "0")} / {formatQuantity(line.assigned)} {line.unit}
                  </span>
                </li>
              ))}
            {mode === "cash" && (
              <>
                <li className="flex justify-between gap-3">
                  <span>Collected</span>
                  <span className="font-semibold tabular-nums">
                    {formatMoney(collected.trim())} of {formatMoney(expectedAmount)}
                  </span>
                </li>
                {shortfall && (
                  <li className="flex justify-between gap-3 text-warning">
                    <span>Outstanding</span>
                    <span className="tabular-nums">{formatMoney(cashOutstanding)}</span>
                  </li>
                )}
                <li className="flex justify-between gap-3">
                  <span>Method</span>
                  <span>
                    {paymentMethodLabel(method)}
                    {reference.trim() && ` · ${reference.trim()}`}
                  </span>
                </li>
              </>
            )}
            {shortfall && <li className="text-muted-foreground">Reason: {reason}</li>}
            {proofCount > 0 && (
              <li className="text-muted-foreground">
                {proofCount} proof file{proofCount === 1 ? "" : "s"} attached
              </li>
            )}
          </ul>
          <DialogFooter>
            <Button type="button" variant="outline" size="lg" onClick={() => setConfirmOpen(false)} disabled={pending}>
              Back
            </Button>
            <Button type="button" size="lg" onClick={submit} disabled={pending}>
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              {pending ? "Submitting…" : shortfall ? "Submit partial" : "Complete task"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}

function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
