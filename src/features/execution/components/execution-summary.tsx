import { Banknote, Package } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { CashCollection } from "@/features/execution/queries";
import { paymentMethodLabel } from "@/features/tasks/constants";
import { compareDecimal, decimalDiff, formatQuantity, numericText } from "@/lib/decimal";
import { formatDateTime, formatMoney } from "@/lib/format";

export type DeliveryLine = {
  id: string;
  name: string;
  sku: string | null;
  unit: string | null;
  assigned: number;
  delivered: number | null;
  notes: string | null;
};

/** Assigned / delivered / variance per line. Values are as recorded by the database. */
export function DeliverySummary({ lines, title = "Delivery" }: { lines: DeliveryLine[]; title?: string }) {
  const recorded = lines.some((l) => l.delivered !== null);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Package className="size-4" aria-hidden />
          {title}
        </CardTitle>
        {!recorded && <CardDescription>No delivery recorded yet.</CardDescription>}
      </CardHeader>
      <CardContent>
        <ul className="divide-y" aria-label={`${title} lines`}>
          {lines.map((line) => {
            const assigned = numericText(line.assigned, 3);
            const delivered = line.delivered === null ? null : numericText(line.delivered, 3);
            const variance = delivered === null ? null : decimalDiff(assigned, delivered, 3);
            const short = variance !== null && compareDecimal(variance, "0", 3) === 1;
            return (
              <li key={line.id} className="space-y-1 py-3 first:pt-0 last:pb-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{line.name}</p>
                    {line.sku && <p className="font-mono text-xs text-muted-foreground">{line.sku}</p>}
                  </div>
                  {delivered !== null && (
                    <Badge variant={short ? "warning" : "success"}>{short ? "Short" : "Delivered"}</Badge>
                  )}
                </div>
                <dl className="grid grid-cols-3 gap-2 text-sm">
                  <Figure label="Assigned" value={`${formatQuantity(assigned)} ${line.unit ?? ""}`} />
                  <Figure label="Delivered" value={delivered === null ? "—" : `${formatQuantity(delivered)} ${line.unit ?? ""}`} />
                  <Figure
                    label="Outstanding"
                    value={variance === null ? "—" : `${formatQuantity(variance)} ${line.unit ?? ""}`}
                    tone={short ? "warning" : undefined}
                  />
                </dl>
                {line.notes && <p className="text-sm text-muted-foreground">“{line.notes}”</p>}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

/** Expected vs collected, method and reference. Card data is never stored, so never shown. */
export function CashSummary({ expected, cash }: { expected: number | null; cash: CashCollection | null }) {
  const expectedText = cash ? numericText(cash.expected_amount, 2) : expected === null ? null : numericText(expected, 2);
  const collected = cash ? numericText(cash.collected_amount, 2) : null;
  const outstanding = expectedText && collected ? decimalDiff(expectedText, collected, 2) : null;
  const short = outstanding !== null && compareDecimal(outstanding, "0", 2) === 1;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Banknote className="size-4" aria-hidden />
          Cash collection
          {cash && <Badge variant={short ? "warning" : "success"}>{short ? "Partial" : "Collected"}</Badge>}
        </CardTitle>
        {!cash && <CardDescription>No collection recorded yet.</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="grid grid-cols-3 gap-2 text-sm">
          <Figure label="Expected" value={formatMoney(expectedText)} />
          <Figure label="Collected" value={formatMoney(collected)} />
          <Figure label="Outstanding" value={formatMoney(outstanding)} tone={short ? "warning" : undefined} />
        </dl>
        {cash && (
          <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Method</dt>
            <dd>{paymentMethodLabel(cash.payment_method)}</dd>
            <dt className="text-muted-foreground">Reference</dt>
            <dd className="font-mono break-all">{cash.collection_reference ?? "—"}</dd>
            <dt className="text-muted-foreground">Collected at</dt>
            <dd>{formatDateTime(cash.collected_at)}</dd>
            {cash.notes && (
              <>
                <dt className="text-muted-foreground">Notes</dt>
                <dd className="whitespace-pre-wrap">{cash.notes}</dd>
              </>
            )}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: "warning" }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={tone === "warning" ? "font-semibold text-warning tabular-nums" : "font-semibold tabular-nums"}>{value}</dd>
    </div>
  );
}
