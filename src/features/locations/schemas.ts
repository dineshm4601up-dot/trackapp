import { z } from "zod";

import {
  checkbox,
  integerInRange,
  isValidPostalCode,
  optionalDecimal,
  optionalPhone,
  optionalText,
  requiredText,
} from "@/lib/validation/fields";

export const GEOFENCE_DEFAULT = 100;
export const GEOFENCE_MIN = 10;
export const GEOFENCE_MAX = 5000;

const COORDINATE_MESSAGE = "Please enter valid latitude and longitude.";

export const locationSchema = z
  .object({
    customer_id: z.preprocess((v) => (typeof v === "string" ? v : ""), z.uuid("Select a customer.")),
    location_name: requiredText("Location name", 200),
    address_line1: optionalText("Address line 1"),
    address_line2: optionalText("Address line 2"),
    city: optionalText("City", 100),
    state: optionalText("State", 100),
    postal_code: optionalText("Postal code", 12),
    country: requiredText("Country", 100),
    // numeric(10,7)
    latitude: optionalDecimal("Latitude", { integerDigits: 2, fractionDigits: 7, min: -90, max: 90, signed: true }),
    longitude: optionalDecimal("Longitude", { integerDigits: 3, fractionDigits: 7, min: -180, max: 180, signed: true }),
    geofence_radius_meters: integerInRange("Geofence radius", GEOFENCE_MIN, GEOFENCE_MAX, GEOFENCE_DEFAULT),
    contact_person: optionalText("Contact person", 200),
    contact_phone: optionalPhone,
    is_active: checkbox,
  })
  .superRefine((value, ctx) => {
    if ((value.latitude === null) !== (value.longitude === null)) {
      const missing = value.latitude === null ? "latitude" : "longitude";
      ctx.addIssue({ code: "custom", path: [missing], message: `${COORDINATE_MESSAGE} Both are needed.` });
    }
    if (value.postal_code && !isValidPostalCode(value.postal_code, value.country)) {
      ctx.addIssue({
        code: "custom",
        path: ["postal_code"],
        message:
          value.country.toLowerCase() === "india" ? "Enter a 6-digit PIN code." : "Enter a valid postal code.",
      });
    }
  });

export type LocationInput = z.infer<typeof locationSchema>;

