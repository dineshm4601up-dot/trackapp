import { Banknote, ClipboardCheck, Package } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { MyTaskDetail } from "@/features/tasks/agent-queries";
import type { TaskType } from "@/features/tasks/constants";
import { formatQuantity, numericText } from "@/lib/decimal";
import { formatMoney } from "@/lib/format";

type ExecutionProps = { task: MyTaskDetail };

/**
 * What the task involves, shown before work starts (execution capture itself
 * is the ExecutionForm, shown once the task is IN_PROGRESS).
 */
const EXECUTION_VIEWS: Record<TaskType, (props: ExecutionProps) => React.ReactNode> = {
  DELIVER_PRODUCTS: (p) => <ProductsSection {...p} title="Products to deliver" note="You record delivered quantities and a delivery photo after check-in." />,
  PICKUP: (p) => <ProductsSection {...p} title="Items to pick up" note="Follow the instructions above." />,
  REPLACEMENT: (p) => <ProductsSection {...p} title="Items to replace" note="Follow the replacement instructions above." />,
  COLLECT_CASH: CashSection,
  VERIFICATION: (p) => <GuidanceSection {...p} text="Verify the details described in the instructions with the customer." />,
  INSPECTION: (p) => <GuidanceSection {...p} text="Carry out the inspection described in the instructions." />,
  DOCUMENT_COLLECTION: (p) => <GuidanceSection {...p} text="Collect the documents listed in the instructions. You upload them after check-in." />,
  SURVEY: (p) => <GuidanceSection {...p} text="Complete the survey as described in the instructions." />,
  OTHER: (p) => <GuidanceSection {...p} text="Follow the instructions above." />,
};

export function TaskExecutionView({ task }: ExecutionProps) {
  const View = EXECUTION_VIEWS[task.task_type];
  return <View task={task} />;
}

function ProductsSection({ task, title, note }: ExecutionProps & { title: string; note: string }) {
  if (task.task_products.length === 0) return <GuidanceSection task={task} text={note} />;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Package className="size-4" aria-hidden />
          {title}
        </CardTitle>
        <CardDescription>{note}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y" aria-label={title}>
          {task.task_products.map((line) => (
            <li key={line.id} className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <p className="font-medium">{line.product?.product_name ?? "Product"}</p>
                <p className="font-mono text-xs text-muted-foreground">{line.product?.sku}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-base font-semibold tabular-nums">
                  {formatQuantity(line.assigned_quantity)} {line.product?.unit}
                </p>
                {line.unit_price !== null && (
                  <p className="text-xs text-muted-foreground">{formatMoney(numericText(line.unit_price, 2))} each</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function CashSection({ task }: ExecutionProps) {
  const expected = numericText(task.expected_amount, 2) || null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Banknote className="size-4" aria-hidden />
          Expected collection
        </CardTitle>
        <CardDescription>You record the amount collected after check-in.</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tabular-nums">{expected ? formatMoney(expected) : "Not specified"}</p>
      </CardContent>
    </Card>
  );
}

function GuidanceSection({ text }: ExecutionProps & { text: string }) {
  return (
    <Card size="sm">
      <CardContent className="flex items-start gap-3 text-sm text-muted-foreground">
        <ClipboardCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p>{text}</p>
      </CardContent>
    </Card>
  );
}
