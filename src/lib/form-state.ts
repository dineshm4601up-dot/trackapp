import { z } from "zod";

/** Result of a form Server Action, consumed by `useFormAction`. */
export type FormState = {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Record<string, string | undefined>;
  /** Submitted values, echoed back so the form keeps them after an error. */
  values?: Record<string, string>;
  redirectTo?: string;
  /** Extra data for the client on success (e.g. a one-time setup link). */
  data?: Record<string, string>;
};

export const initialFormState: FormState = { status: "idle" };

/** Plain string values of a form (files and repeated keys are not used here). */
export function formValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && !key.startsWith("$ACTION")) values[key] = value;
  }
  return values;
}

export function validationError(error: z.ZodError, values: Record<string, string>): FormState {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "");
    if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return { status: "error", message: "Please correct the highlighted fields.", fieldErrors, values };
}

/** Result of a simple (non-form) action such as activate/deactivate. */
export type ActionResult = { ok: true; message: string } | { ok: false; message: string };
