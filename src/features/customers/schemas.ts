import { z } from "zod";

import {
  checkbox,
  codeText,
  isValidPostalCode,
  optionalEmail,
  optionalPhone,
  optionalText,
  requiredText,
} from "@/lib/validation/fields";

export const customerSchema = z
  .object({
    customer_code: codeText("Customer code"),
    name: requiredText("Customer name", 200),
    phone: optionalPhone,
    email: optionalEmail,
    address_line1: optionalText("Address line 1"),
    address_line2: optionalText("Address line 2"),
    city: optionalText("City", 100),
    state: optionalText("State", 100),
    postal_code: optionalText("Postal code", 12),
    country: requiredText("Country", 100),
    is_active: checkbox,
  })
  .superRefine((value, ctx) => {
    if (value.postal_code && !isValidPostalCode(value.postal_code, value.country)) {
      ctx.addIssue({
        code: "custom",
        path: ["postal_code"],
        message:
          value.country.toLowerCase() === "india"
            ? "Enter a 6-digit PIN code."
            : "Enter a valid postal code.",
      });
    }
  });

export type CustomerInput = z.infer<typeof customerSchema>;

export type CustomerOption = { id: string; name: string; customer_code: string | null; is_active: boolean };
