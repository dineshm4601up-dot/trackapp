"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createAgentSchema, updateAgentSchema } from "@/features/agents/schemas";
import { requireAdmin } from "@/lib/auth/session";
import { createPasswordSetupLink } from "@/lib/auth/setup-link";
import { dbErrorState, describeDbError, type UniqueMessages } from "@/lib/db-errors";
import { formValues, validationError, type ActionResult, type FormState } from "@/lib/form-state";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation/fields";

const LIST_PATH = "/admin/agents";
const UNIQUES: UniqueMessages = {
  agents_employee_code_key: {
    field: "employee_code",
    message: "An agent with this employee code already exists.",
  },
  agents_profile_id_key: { field: "email", message: "This person is already an agent." },
};

/**
 * Creates an agent. If the email already belongs to an AGENT account without
 * an agent record, that account is linked; otherwise a new auth user is
 * created (no password) and a one-time setup link is returned for the admin to
 * share. Data writes use the admin's session so RLS and audit attribution apply;
 * the service-role client is used only for the Auth admin API.
 */
export async function createAgent(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const values = formValues(formData);
  const parsed = createAgentSchema.safeParse(values);
  if (!parsed.success) return validationError(parsed.error, values);
  const { email, full_name, phone, employee_code, is_active } = parsed.data;

  const supabase = await createClient();
  const fieldError = (field: string, message: string): FormState => ({
    status: "error",
    message: "Please correct the highlighted fields.",
    fieldErrors: { [field]: message },
    values,
  });

  // Fail fast on a duplicate employee code before touching Auth.
  const { data: codeTaken } = await supabase.from("agents").select("id").eq("employee_code", employee_code).maybeSingle();
  if (codeTaken) return fieldError("employee_code", "An agent with this employee code already exists.");

  const { data: existing, error: lookupError } = await supabase
    .from("profiles")
    .select("id, role, is_active, agents(id)")
    .eq("email", email)
    .maybeSingle();
  if (lookupError) return dbErrorState(lookupError, "agent profile lookup", UNIQUES, values);

  let profileId: string;
  let createdAuthUser = false;

  if (existing) {
    if (existing.role !== "AGENT") return fieldError("email", "This email belongs to an administrator account.");
    if (existing.agents) return fieldError("email", "This person is already an agent.");
    profileId = existing.id;
  } else {
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { full_name },
    });
    if (error || !data.user) {
      if (error?.code === "email_exists") return fieldError("email", "An account with this email already exists.");
      console.error("createUser failed", { code: error?.code, status: error?.status });
      return { status: "error", message: "Could not create the agent's account. Please try again.", values };
    }
    profileId = data.user.id;
    createdAuthUser = true;
  }

  const rollback = async () => {
    if (createdAuthUser) await createAdminClient().auth.admin.deleteUser(profileId);
  };

  const { error: profileError } = await supabase.from("profiles").update({ full_name, phone }).eq("id", profileId);
  if (profileError) {
    await rollback();
    return dbErrorState(profileError, "update agent profile", UNIQUES, values);
  }

  const { error: agentError } = await supabase.from("agents").insert({ profile_id: profileId, employee_code, is_active });
  if (agentError) {
    await rollback();
    return dbErrorState(agentError, "create agent", UNIQUES, values);
  }

  revalidatePath(LIST_PATH);

  if (!createdAuthUser) {
    const note = existing?.is_active ? "" : " Note: this account is inactive and cannot sign in yet.";
    return {
      status: "success",
      message: `Existing account linked as agent "${full_name}".${note}`,
      redirectTo: LIST_PATH,
    };
  }

  try {
    const setupLink = await createPasswordSetupLink(email);
    return { status: "success", message: `Agent "${full_name}" created.`, redirectTo: LIST_PATH, data: { setupLink, name: full_name } };
  } catch {
    return {
      status: "success",
      message: `Agent "${full_name}" created, but the setup link could not be generated. Generate one from the agent's edit page.`,
      redirectTo: LIST_PATH,
    };
  }
}

export async function updateAgent(id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const values = formValues(formData);
  if (!uuid.safeParse(id).success) return { status: "error", message: "Agent not found.", values };
  const parsed = updateAgentSchema.safeParse(values);
  if (!parsed.success) return validationError(parsed.error, values);
  const { employee_code, is_active, full_name, phone } = parsed.data;

  const supabase = await createClient();
  const { data: agent, error } = await supabase
    .from("agents")
    .update({ employee_code, is_active })
    .eq("id", id)
    .select("profile_id")
    .maybeSingle();
  if (error) return dbErrorState(error, "update agent", UNIQUES, values);
  if (!agent) return { status: "error", message: "Agent not found.", values };

  // Name and phone live on the linked profile (single source of truth).
  const { error: profileError } = await supabase
    .from("profiles")
    .update({ full_name, phone })
    .eq("id", agent.profile_id);
  if (profileError) return dbErrorState(profileError, "update agent profile", UNIQUES, values);

  revalidatePath(LIST_PATH);
  return { status: "success", message: `Agent "${full_name}" updated.`, redirectTo: LIST_PATH };
}

export async function setAgentActive(id: string, active: boolean): Promise<ActionResult> {
  await requireAdmin();
  if (!uuid.safeParse(id).success || !z.boolean().safeParse(active).success) {
    return { ok: false, message: "Invalid request." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agents")
    .update({ is_active: active })
    .eq("id", id)
    .select("employee_code");
  if (error) return { ok: false, message: describeDbError(error, "toggle agent").message };
  if (!data[0]) return { ok: false, message: "Agent not found." };

  revalidatePath(LIST_PATH);
  return { ok: true, message: `Agent ${data[0].employee_code ?? ""} ${active ? "activated" : "deactivated"}.` };
}

export type SetupLinkResult = { ok: true; link: string } | { ok: false; message: string };

/** New one-time password setup link (also serves as a password reset). */
export async function generateAgentSetupLink(id: string): Promise<SetupLinkResult> {
  await requireAdmin();
  if (!uuid.safeParse(id).success) return { ok: false, message: "Invalid request." };

  const supabase = await createClient();
  const { data } = await supabase.from("agent_directory").select("email").eq("id", id).maybeSingle();
  if (!data?.email) return { ok: false, message: "Agent not found." };

  try {
    return { ok: true, link: await createPasswordSetupLink(data.email) };
  } catch {
    return { ok: false, message: "Could not generate a setup link. Please try again." };
  }
}
