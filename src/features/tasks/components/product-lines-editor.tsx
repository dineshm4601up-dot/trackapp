"use client";

import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { AsyncCombobox } from "@/components/shared/async-combobox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { searchTaskProducts } from "@/features/tasks/actions";
import { PRICE_PATTERN, QUANTITY_PATTERN, type ProductOption } from "@/features/tasks/schemas";
import { lineAmount, sumAmounts } from "@/lib/decimal";
import { formatMoney } from "@/lib/format";

export type ProductLine = { product: ProductOption; quantity: string; unitPrice: string };

export function lineErrors(line: ProductLine) {
  const quantity = !QUANTITY_PATTERN.test(line.quantity.trim()) || Number(line.quantity) <= 0
    ? "Enter a quantity greater than 0 (up to 3 decimals)."
    : undefined;
  const unitPrice =
    line.unitPrice.trim() !== "" && !PRICE_PATTERN.test(line.unitPrice.trim())
      ? "Enter a price of 0 or more (up to 2 decimals)."
      : undefined;
  return { quantity, unitPrice };
}

const productLabel = (p: ProductOption) => `${p.product_name} (${p.sku})`;

function renderProduct(p: ProductOption) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <span className="min-w-0 flex-1 truncate">
        {p.product_name} <span className="font-mono text-xs text-muted-foreground">{p.sku}</span>
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {p.unit} · {formatMoney(p.price)}
      </span>
    </span>
  );
}

type ProductLinesEditorProps = {
  lines: ProductLine[];
  onChange: (lines: ProductLine[]) => void;
  required: boolean;
  error?: string;
};

export function ProductLinesEditor({ lines, onChange, required, error }: ProductLinesEditorProps) {
  function add(product: ProductOption | null) {
    if (!product) return;
    if (lines.some((line) => line.product.id === product.id)) {
      toast.info(`${product.product_name} is already on this task. Update its quantity instead.`);
      document.getElementById(`qty-${product.id}`)?.focus();
      return;
    }
    onChange([...lines, { product, quantity: "1", unitPrice: product.price === null ? "" : product.price.toFixed(2) }]);
  }

  function update(index: number, patch: Partial<ProductLine>) {
    onChange(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  const amounts = lines.map((line) =>
    line.unitPrice.trim() === "" ? null : lineAmount(line.quantity.trim(), line.unitPrice.trim()),
  );
  const total = sumAmounts(amounts.filter((a): a is string => a !== null));

  return (
    <div className="space-y-3">
      <AsyncCombobox<ProductOption>
        id="add-product"
        ariaLabel="Add a product"
        value={null}
        onChange={add}
        search={searchTaskProducts}
        getLabel={productLabel}
        renderOption={renderProduct}
        placeholder="Add a product…"
        searchPlaceholder="Search by SKU or name…"
        emptyText="No active products found."
        invalid={Boolean(error)}
        describedBy={error ? "products-error" : undefined}
      />
      {error && (
        <p id="products-error" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {lines.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
          {required ? "Add at least one product before assigning this task." : "No products added (optional)."}
        </p>
      ) : (
        <ul className="divide-y rounded-lg border" aria-label="Product lines">
          {lines.map((line, index) => {
            const errors = lineErrors(line);
            return (
              <li key={line.product.id} className="grid gap-3 p-3 sm:grid-cols-[1fr_7rem_8rem_7rem_auto] sm:items-start">
                <div className="min-w-0">
                  <p className="truncate font-medium">{line.product.product_name}</p>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-mono">{line.product.sku}</span> · {line.product.unit}
                    {!line.product.is_active && (
                      <Badge variant="warning" className="ml-2">
                        Inactive
                      </Badge>
                    )}
                  </p>
                </div>
                <div className="space-y-1">
                  <label htmlFor={`qty-${line.product.id}`} className="text-xs text-muted-foreground">
                    Quantity
                  </label>
                  <Input
                    id={`qty-${line.product.id}`}
                    inputMode="decimal"
                    value={line.quantity}
                    onChange={(e) => update(index, { quantity: e.target.value })}
                    aria-invalid={errors.quantity ? true : undefined}
                    aria-describedby={errors.quantity ? `qty-${line.product.id}-error` : undefined}
                    className="h-9"
                  />
                  {errors.quantity && (
                    <p id={`qty-${line.product.id}-error`} className="text-xs text-destructive">
                      {errors.quantity}
                    </p>
                  )}
                </div>
                <div className="space-y-1">
                  <label htmlFor={`price-${line.product.id}`} className="text-xs text-muted-foreground">
                    Unit price
                  </label>
                  <Input
                    id={`price-${line.product.id}`}
                    inputMode="decimal"
                    value={line.unitPrice}
                    placeholder="0.00"
                    onChange={(e) => update(index, { unitPrice: e.target.value })}
                    aria-invalid={errors.unitPrice ? true : undefined}
                    aria-describedby={errors.unitPrice ? `price-${line.product.id}-error` : undefined}
                    className="h-9"
                  />
                  {errors.unitPrice && (
                    <p id={`price-${line.product.id}-error`} className="text-xs text-destructive">
                      {errors.unitPrice}
                    </p>
                  )}
                </div>
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground">Amount</span>
                  <p className="flex h-9 items-center tabular-nums">{formatMoney(amounts[index])}</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="sm:mt-5"
                  onClick={() => onChange(lines.filter((_, i) => i !== index))}
                  aria-label={`Remove ${line.product.product_name}`}
                >
                  <Trash2 aria-hidden />
                </Button>
              </li>
            );
          })}
          <li className="flex items-center justify-between p-3 text-sm">
            <span className="text-muted-foreground">
              {lines.length} product{lines.length === 1 ? "" : "s"}
            </span>
            <span>
              Total <span className="font-semibold tabular-nums">{formatMoney(total)}</span>
            </span>
          </li>
        </ul>
      )}
    </div>
  );
}
