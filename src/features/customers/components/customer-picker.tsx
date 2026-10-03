"use client";

import { useState } from "react";

import { AsyncCombobox } from "@/components/shared/async-combobox";
import { searchCustomerOptions } from "@/features/customers/actions";
import type { CustomerOption } from "@/features/customers/schemas";

export function customerLabel(option: CustomerOption) {
  return option.customer_code ? `${option.name} (${option.customer_code})` : option.name;
}

export function renderCustomerOption(option: CustomerOption) {
  return (
    <>
      <span className="truncate">{option.name}</span>
      {option.customer_code && (
        <span className="ml-auto font-mono text-xs text-muted-foreground">{option.customer_code}</span>
      )}
    </>
  );
}

type CustomerPickerProps = {
  name: string;
  initial?: CustomerOption | null;
  invalid?: boolean;
  describedBy?: string;
};

/** Self-contained customer select for plain forms; submits the id under `name`. */
export function CustomerPicker({ name, initial, invalid, describedBy }: CustomerPickerProps) {
  const [selected, setSelected] = useState<CustomerOption | null>(initial ?? null);

  return (
    <>
      <input type="hidden" name={name} value={selected?.id ?? ""} />
      <AsyncCombobox
        id={name}
        value={selected}
        onChange={setSelected}
        search={searchCustomerOptions}
        getLabel={customerLabel}
        renderOption={renderCustomerOption}
        placeholder="Select a customer…"
        searchPlaceholder="Search by name or code…"
        emptyText="No active customers found."
        invalid={invalid}
        describedBy={describedBy}
      />
      {selected && !selected.is_active && (
        <p className="text-xs text-warning">This customer is inactive. Choose an active customer to change it.</p>
      )}
    </>
  );
}
