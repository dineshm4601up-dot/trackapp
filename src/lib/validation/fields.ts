import { z } from "zod";

// Field schemas for HTML form values. Missing fields arrive as `undefined`,
// so every schema first normalises its input to a string.
const formString = z.preprocess((v) => (typeof v === "string" ? v : ""), z.string());

export function requiredText(label: string, max = 200) {
  return formString.pipe(
    z
      .string()
      .trim()
      .min(1, `${label} is required.`)
      .max(max, `${label} must be ${max} characters or fewer.`),
  );
}

/** Trimmed text; empty becomes `null`. */
export function optionalText(label: string, max = 200) {
  return formString
    .pipe(z.string().trim().max(max, `${label} must be ${max} characters or fewer.`))
    .transform((v) => (v === "" ? null : v));
}

const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

/**
 * Business codes (SKU, customer code, employee code): trimmed, no spaces, and
 * upper-cased so "c-001" and "C-001" cannot become accidental duplicates.
 */
const codeMessage = (label: string) => `${label} may contain letters, numbers and . _ / - (no spaces).`;

/** Optional code; empty becomes `null`. */
export function codeText(label: string, max = 40) {
  return formString
    .pipe(z.string().trim().max(max, `${label} must be ${max} characters or fewer.`))
    .refine((v) => v === "" || CODE_PATTERN.test(v), codeMessage(label))
    .transform((v) => (v === "" ? null : v.toUpperCase()));
}

export function requiredCode(label: string, max = 40) {
  return formString
    .pipe(
      z
        .string()
        .trim()
        .min(1, `${label} is required.`)
        .max(max, `${label} must be ${max} characters or fewer.`),
    )
    .refine((v) => CODE_PATTERN.test(v), codeMessage(label))
    .transform((v) => v.toUpperCase());
}

export const optionalEmail = formString
  .pipe(z.string().trim().toLowerCase().max(254))
  .refine((v) => v === "" || z.email().safeParse(v).success, "Enter a valid email address.")
  .transform((v) => (v === "" ? null : v));

export const requiredEmail = formString.pipe(
  z.string().trim().toLowerCase().max(254).pipe(z.email("Enter a valid email address.")),
);

/** International-friendly: optional +, then 7–15 digits with common separators. */
export const optionalPhone = formString
  .pipe(z.string().trim().max(25))
  .refine((v) => {
    if (v === "") return true;
    const digits = v.replace(/\D/g, "").length;
    return /^\+?[0-9\s().-]+$/.test(v) && digits >= 7 && digits <= 15;
  }, "Enter a valid phone number.")
  .transform((v) => (v === "" ? null : v));

export const checkbox = z.preprocess((v) => v === "on" || v === "true", z.boolean());

/**
 * Decimal text → number. Validated as text first (digit counts), so values
 * stay exact for NUMERIC columns: the number is only serialised, never used in
 * arithmetic.
 */
export function optionalDecimal(
  label: string,
  opts: { integerDigits: number; fractionDigits: number; min: number; max: number; signed?: boolean },
) {
  const pattern = new RegExp(
    `^${opts.signed ? "-?" : ""}\\d{1,${opts.integerDigits}}(\\.\\d{1,${opts.fractionDigits}})?$`,
  );
  return formString
    .pipe(z.string().trim())
    .refine(
      (v) => v === "" || pattern.test(v),
      `${label} must be a number with up to ${opts.fractionDigits} decimal places.`,
    )
    .transform((v) => (v === "" ? null : Number(v)))
    .refine(
      (v) => v === null || (v >= opts.min && v <= opts.max),
      `${label} must be between ${opts.min} and ${opts.max}.`,
    );
}

export function integerInRange(label: string, min: number, max: number, fallback: number) {
  return formString
    .pipe(z.string().trim())
    .transform((v) => (v === "" ? String(fallback) : v))
    .refine((v) => /^\d+$/.test(v), `${label} must be a whole number.`)
    .transform(Number)
    .refine((v) => v >= min && v <= max, `${label} must be between ${min} and ${max}.`);
}

/** Indian PIN codes (6 digits, not starting with 0); a looser rule elsewhere. */
export function isValidPostalCode(postalCode: string, country: string) {
  if (country.trim().toLowerCase() === "india") return /^[1-9]\d{5}$/.test(postalCode.replace(/\s/g, ""));
  return /^[A-Za-z0-9][A-Za-z0-9 -]{1,9}$/.test(postalCode);
}

export const uuid = z.uuid("Invalid identifier.");
