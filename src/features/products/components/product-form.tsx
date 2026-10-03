"use client";

import {
  FormError,
  FormFooter,
  FormSection,
  SwitchField,
  TextareaField,
  TextField,
} from "@/components/shared/form-fields";
import type { Product } from "@/features/products/queries";
import { COMMON_UNITS } from "@/features/products/schemas";
import { useFormAction } from "@/hooks/use-form-action";
import type { FormState } from "@/lib/form-state";

type ProductFormProps = {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  product?: Product;
};

export function ProductForm({ action, product }: ProductFormProps) {
  const { state, formAction, pending, formKey, errorFor, valueFor } = useFormAction(action);
  const isActive =
    state.status === "error" && state.values ? state.values.is_active === "on" : (product?.is_active ?? true);

  return (
    <form key={formKey} action={formAction} className="space-y-6" noValidate>
      <FormError message={state.status === "error" ? state.message : undefined} />

      <FormSection title="Product details">
        <TextField
          name="sku"
          label="SKU"
          required
          maxLength={64}
          hint="Unique. Letters, numbers and . _ / - ; stored in upper case."
          defaultValue={valueFor("sku", product?.sku)}
          error={errorFor("sku")}
        />
        <TextField
          name="product_name"
          label="Product name"
          required
          maxLength={200}
          defaultValue={valueFor("product_name", product?.product_name)}
          error={errorFor("product_name")}
        />
        <TextareaField
          name="description"
          label="Description"
          rows={3}
          maxLength={1000}
          defaultValue={valueFor("description", product?.description)}
          error={errorFor("description")}
          fieldClassName="sm:col-span-2"
        />
        <TextField
          name="unit"
          label="Unit"
          required
          maxLength={20}
          list="unit-suggestions"
          hint="e.g. PCS, BOX, KG"
          defaultValue={valueFor("unit", product?.unit ?? "PCS")}
          error={errorFor("unit")}
        />
        <datalist id="unit-suggestions">
          {COMMON_UNITS.map((unit) => (
            <option key={unit} value={unit} />
          ))}
        </datalist>
        <TextField
          name="price"
          label="Price"
          inputMode="decimal"
          placeholder="0.00"
          hint="Optional. Up to 2 decimal places."
          defaultValue={valueFor("price", product?.price?.toFixed(2))}
          error={errorFor("price")}
        />
      </FormSection>

      <SwitchField
        name="is_active"
        label="Active"
        description="Inactive products can't be added to new tasks."
        defaultChecked={isActive}
      />

      <FormFooter cancelHref="/admin/products" pending={pending} submitLabel={product ? "Save changes" : "Create product"} />
    </form>
  );
}
