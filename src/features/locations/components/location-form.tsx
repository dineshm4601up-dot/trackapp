"use client";

import {
  FieldShell,
  FormError,
  FormFooter,
  FormSection,
  SwitchField,
  TextField,
} from "@/components/shared/form-fields";
import { CustomerPicker } from "@/features/customers/components/customer-picker";
import { CoordinatePicker } from "@/features/locations/components/coordinate-picker";
import type { LocationWithCustomer } from "@/features/locations/queries";
import { GEOFENCE_DEFAULT } from "@/features/locations/schemas";
import { useFormAction } from "@/hooks/use-form-action";
import type { FormState } from "@/lib/form-state";

type LocationFormProps = {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  location?: LocationWithCustomer;
};

export function LocationForm({ action, location }: LocationFormProps) {
  const { state, formAction, pending, formKey, errorFor, valueFor } = useFormAction(action);
  const isActive =
    state.status === "error" && state.values ? state.values.is_active === "on" : (location?.is_active ?? true);

  return (
    <form
      key={formKey}
      action={formAction}
      className="space-y-6"
      noValidate
      onSubmit={(event) => {
        // Coordinates the server would reject are stopped here; the fields already say why.
        if (!event.currentTarget.querySelector("[data-coordinates-invalid]")) return;
        event.preventDefault();
        event.currentTarget.querySelector<HTMLInputElement>("#latitude")?.focus();
      }}
    >
      <FormError message={state.status === "error" ? state.message : undefined} />

      <FormSection title="Location">
        <FieldShell id="customer_id" label="Customer" required error={errorFor("customer_id")} className="sm:col-span-2">
          <CustomerPicker
            name="customer_id"
            initial={location?.customer ?? null}
            invalid={Boolean(errorFor("customer_id"))}
            describedBy={errorFor("customer_id") ? "customer_id-error" : undefined}
          />
        </FieldShell>
        <TextField
          name="location_name"
          label="Location name"
          required
          maxLength={200}
          placeholder="e.g. ABC Traders – Main Warehouse"
          defaultValue={valueFor("location_name", location?.location_name)}
          error={errorFor("location_name")}
          fieldClassName="sm:col-span-2"
        />
      </FormSection>

      <FormSection title="Address">
        <TextField
          name="address_line1"
          label="Address line 1"
          defaultValue={valueFor("address_line1", location?.address_line1)}
          error={errorFor("address_line1")}
          fieldClassName="sm:col-span-2"
        />
        <TextField
          name="address_line2"
          label="Address line 2"
          defaultValue={valueFor("address_line2", location?.address_line2)}
          error={errorFor("address_line2")}
          fieldClassName="sm:col-span-2"
        />
        <TextField name="city" label="City" defaultValue={valueFor("city", location?.city)} error={errorFor("city")} />
        <TextField name="state" label="State" defaultValue={valueFor("state", location?.state)} error={errorFor("state")} />
        <TextField
          name="postal_code"
          label="Postal code"
          inputMode="numeric"
          defaultValue={valueFor("postal_code", location?.postal_code)}
          error={errorFor("postal_code")}
        />
        <TextField
          name="country"
          label="Country"
          required
          defaultValue={valueFor("country", location?.country ?? "India")}
          error={errorFor("country")}
        />
      </FormSection>

      <CoordinatePicker
        latitude={valueFor("latitude", location?.latitude?.toString())}
        longitude={valueFor("longitude", location?.longitude?.toString())}
        radius={valueFor("geofence_radius_meters", String(location?.geofence_radius_meters ?? GEOFENCE_DEFAULT))}
        errorFor={errorFor}
      />

      <FormSection title="On-site contact">
        <TextField
          name="contact_person"
          label="Contact person"
          defaultValue={valueFor("contact_person", location?.contact_person)}
          error={errorFor("contact_person")}
        />
        <TextField
          name="contact_phone"
          label="Contact phone"
          type="tel"
          inputMode="tel"
          defaultValue={valueFor("contact_phone", location?.contact_phone)}
          error={errorFor("contact_phone")}
        />
      </FormSection>

      <SwitchField
        name="is_active"
        label="Active"
        description="Inactive locations can't be selected for new tasks."
        defaultChecked={isActive}
      />

      <FormFooter cancelHref="/admin/locations" pending={pending} submitLabel={location ? "Save changes" : "Create location"} />
    </form>
  );
}
