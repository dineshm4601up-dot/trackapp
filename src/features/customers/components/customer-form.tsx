"use client";

import {
  FormError,
  FormFooter,
  FormSection,
  SwitchField,
  TextField,
} from "@/components/shared/form-fields";
import type { Customer } from "@/features/customers/queries";
import { useFormAction } from "@/hooks/use-form-action";
import type { FormState } from "@/lib/form-state";

type CustomerFormProps = {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  customer?: Customer;
};

export function CustomerForm({ action, customer }: CustomerFormProps) {
  const { state, formAction, pending, formKey, errorFor, valueFor } = useFormAction(action);
  const isActive =
    state.status === "error" && state.values ? state.values.is_active === "on" : (customer?.is_active ?? true);

  return (
    <form key={formKey} action={formAction} className="space-y-6" noValidate>
      <FormError message={state.status === "error" ? state.message : undefined} />

      <FormSection title="Customer details">
        <TextField
          name="name"
          label="Customer name"
          required
          maxLength={200}
          defaultValue={valueFor("name", customer?.name)}
          error={errorFor("name")}
          fieldClassName="sm:col-span-2"
        />
        <TextField
          name="customer_code"
          label="Customer code"
          maxLength={40}
          hint="Optional. Letters, numbers and . _ / - ; stored in upper case."
          defaultValue={valueFor("customer_code", customer?.customer_code)}
          error={errorFor("customer_code")}
        />
        <TextField
          name="phone"
          label="Phone"
          type="tel"
          inputMode="tel"
          autoComplete="off"
          defaultValue={valueFor("phone", customer?.phone)}
          error={errorFor("phone")}
        />
        <TextField
          name="email"
          label="Email"
          type="email"
          autoComplete="off"
          defaultValue={valueFor("email", customer?.email)}
          error={errorFor("email")}
          fieldClassName="sm:col-span-2"
        />
      </FormSection>

      <FormSection title="Address" description="Billing / head-office address. Task sites are managed under Locations.">
        <TextField
          name="address_line1"
          label="Address line 1"
          defaultValue={valueFor("address_line1", customer?.address_line1)}
          error={errorFor("address_line1")}
          fieldClassName="sm:col-span-2"
        />
        <TextField
          name="address_line2"
          label="Address line 2"
          defaultValue={valueFor("address_line2", customer?.address_line2)}
          error={errorFor("address_line2")}
          fieldClassName="sm:col-span-2"
        />
        <TextField name="city" label="City" defaultValue={valueFor("city", customer?.city)} error={errorFor("city")} />
        <TextField name="state" label="State" defaultValue={valueFor("state", customer?.state)} error={errorFor("state")} />
        <TextField
          name="postal_code"
          label="Postal code"
          inputMode="numeric"
          defaultValue={valueFor("postal_code", customer?.postal_code)}
          error={errorFor("postal_code")}
        />
        <TextField
          name="country"
          label="Country"
          required
          defaultValue={valueFor("country", customer?.country ?? "India")}
          error={errorFor("country")}
        />
      </FormSection>

      <SwitchField
        name="is_active"
        label="Active"
        description="Inactive customers can't be used for new tasks."
        defaultChecked={isActive}
      />

      <FormFooter cancelHref="/admin/customers" pending={pending} submitLabel={customer ? "Save changes" : "Create customer"} />
    </form>
  );
}
