"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  FieldShell,
  FormError,
  FormFooter,
  FormSection,
  SwitchField,
  TextField,
} from "@/components/shared/form-fields";
import { Input } from "@/components/ui/input";
import { SetupLinkDialog } from "@/features/agents/components/setup-link-dialog";
import type { Agent } from "@/features/agents/queries";
import { useFormAction } from "@/hooks/use-form-action";
import type { FormState } from "@/lib/form-state";

type AgentFormProps = {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  agent?: Agent;
};

export function AgentForm({ action, agent }: AgentFormProps) {
  const router = useRouter();
  const [setup, setSetup] = useState<{ link: string; name: string } | null>(null);

  // A newly created login gets a one-time setup link: show it before leaving.
  const onSuccess = useCallback(
    (state: FormState) => {
      if (state.message) toast.success(state.message);
      if (state.data?.setupLink) {
        setSetup({ link: state.data.setupLink, name: state.data.name ?? "the agent" });
        return;
      }
      if (state.redirectTo) {
        router.push(state.redirectTo);
        router.refresh();
      }
    },
    [router],
  );

  const { state, formAction, pending, formKey, errorFor, valueFor } = useFormAction(action, { onSuccess });
  const isActive =
    state.status === "error" && state.values ? state.values.is_active === "on" : (agent?.is_active ?? true);

  return (
    <>
      <form key={formKey} action={formAction} className="space-y-6" noValidate>
        <FormError message={state.status === "error" ? state.message : undefined} />

        <FormSection title="Agent details">
          <TextField
            name="full_name"
            label="Full name"
            required
            maxLength={200}
            autoComplete="off"
            defaultValue={valueFor("full_name", agent?.full_name)}
            error={errorFor("full_name")}
            fieldClassName="sm:col-span-2"
          />
          <TextField
            name="employee_code"
            label="Employee code"
            required
            maxLength={40}
            hint="Unique. Stored in upper case."
            defaultValue={valueFor("employee_code", agent?.employee_code)}
            error={errorFor("employee_code")}
          />
          <TextField
            name="phone"
            label="Phone"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            defaultValue={valueFor("phone", agent?.phone)}
            error={errorFor("phone")}
          />
          {agent ? (
            <FieldShell id="email" label="Email (sign-in)" hint="The sign-in email can't be changed here." className="sm:col-span-2">
              <Input id="email" value={agent.email ?? ""} readOnly disabled aria-describedby="email-hint" className="h-10" />
            </FieldShell>
          ) : (
            <TextField
              name="email"
              label="Email (sign-in)"
              type="email"
              required
              autoComplete="off"
              hint="The agent signs in with this email. An existing agent account with this email is linked."
              defaultValue={valueFor("email")}
              error={errorFor("email")}
              fieldClassName="sm:col-span-2"
            />
          )}
        </FormSection>

        <SwitchField
          name="is_active"
          label="Active"
          description="Inactive agents can't sign in or be assigned new tasks. Their history is kept."
          defaultChecked={isActive}
        />

        <FormFooter cancelHref="/admin/agents" pending={pending} submitLabel={agent ? "Save changes" : "Create agent"} />
      </form>

      <SetupLinkDialog
        link={setup?.link ?? null}
        agentName={setup?.name ?? ""}
        onClose={() => {
          setSetup(null);
          router.push("/admin/agents");
          router.refresh();
        }}
      />
    </>
  );
}
