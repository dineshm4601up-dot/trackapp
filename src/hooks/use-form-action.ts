"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { initialFormState, type FormState } from "@/lib/form-state";
import { isNetworkError, NETWORK_ERROR_MESSAGE } from "@/lib/network";

type ServerFormAction = (prev: FormState, formData: FormData) => Promise<FormState>;
type KeyedState = FormState & { key: number };

/**
 * Wires a form Server Action to the UI: pending state, field errors, and on
 * success a toast plus navigation to `redirectTo` (unless `onSuccess` handles it).
 * `formKey` changes on every submission so the form remounts with the values
 * echoed back by the server — reliable for inputs, switches and selects alike.
 */
export function useFormAction(
  action: ServerFormAction,
  options: { onSuccess?: (state: FormState) => void } = {},
) {
  const router = useRouter();
  const { onSuccess } = options;

  const [state, formAction, pending] = useActionState<KeyedState, FormData>(
    async (prev, formData) => {
      try {
        return { ...(await action(initialFormState, formData)), key: prev.key + 1 };
      } catch (error) {
        // Keep the form (and the user's input) on a dropped connection.
        if (isNetworkError(error)) return { ...prev, status: "error", message: NETWORK_ERROR_MESSAGE };
        throw error;
      }
    },
    { ...initialFormState, key: 0 },
  );

  useEffect(() => {
    if (state.status !== "success") return;
    if (onSuccess) {
      onSuccess(state);
      return;
    }
    if (state.message) toast.success(state.message);
    if (state.redirectTo) {
      router.push(state.redirectTo);
      router.refresh();
    }
  }, [state, onSuccess, router]);

  const errorFor = (field: string) => (state.status === "error" ? state.fieldErrors?.[field] : undefined);
  const valueFor = (field: string, fallback: string | null | undefined = "") =>
    state.status === "error" && state.values ? (state.values[field] ?? "") : (fallback ?? "");

  return { state, formAction, pending, formKey: state.key, errorFor, valueFor };
}
