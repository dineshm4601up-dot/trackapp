import { z } from "zod";

import { checkbox, optionalDecimal, optionalText, requiredCode, requiredText } from "@/lib/validation/fields";

export const productSchema = z.object({
  sku: requiredCode("SKU", 64),
  product_name: requiredText("Product name", 200),
  description: optionalText("Description", 1000),
  unit: requiredText("Unit", 20).transform((v) => v.toUpperCase()),
  // numeric(14,2): up to 12 integer digits, 2 decimals.
  price: optionalDecimal("Price", { integerDigits: 12, fractionDigits: 2, min: 0, max: 999_999_999_999.99 }),
  is_active: checkbox,
});

export type ProductInput = z.infer<typeof productSchema>;

/** Suggestions for the unit field; any short unit is accepted. */
export const COMMON_UNITS = ["PCS", "BOX", "CTN", "PACK", "KG", "G", "L", "ML", "M", "SET", "DOZEN"] as const;
