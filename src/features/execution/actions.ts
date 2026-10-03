"use server";

import { createHash, randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  AMOUNT_PATTERN,
  PROOF_BUCKET,
  PROOF_MAX_BYTES,
  PROOF_MIME_BY_TYPE,
  PROOF_MIME_EXTENSIONS,
  PROOF_TYPES,
  QUANTITY_PATTERN,
  type ProofMime,
} from "@/features/execution/config";
import { PAYMENT_METHODS } from "@/features/tasks/constants";
import { requireAgent } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// Completion
//
// The client sends raw execution data only: delivered quantities, the amount
// actually collected, the payment method. The resulting status (COMPLETED vs
// PARTIALLY_COMPLETED), the shortfall, the agent and the timestamps are all
// decided inside agent_complete_task(). Unknown keys (e.g. "status",
// "agent_id", "expected_amount") are stripped here and have no parameter to
// reach in the database function anyway.
// ---------------------------------------------------------------------------

const optionalText = (max: number) => z.string().trim().max(max).optional();

const completeSchema = z.object({
  taskId: z.uuid(),
  lines: z
    .array(
      z.object({
        id: z.uuid(),
        delivered: z.string().trim().regex(QUANTITY_PATTERN),
        notes: optionalText(500),
      }),
    )
    .max(100)
    .optional(),
  cash: z
    .object({
      collected: z.string().trim().regex(AMOUNT_PATTERN),
      method: z.enum(PAYMENT_METHODS.map((m) => m.value) as [string, ...string[]]),
      reference: optionalText(64),
      notes: optionalText(500),
    })
    .optional(),
  notes: optionalText(2000),
  reason: optionalText(500),
  partial: z.boolean().optional(),
});

export type CompleteInput = z.input<typeof completeSchema>;
export type CompleteResult =
  | { ok: true; status: "COMPLETED" | "PARTIALLY_COMPLETED"; summary: string; message: string }
  | { ok: false; code: string; message: string };

const COMPLETE_ERRORS: Record<string, string> = {
  UNAUTHORIZED: "Your account can't update tasks. Please contact your administrator.",
  TASK_NOT_FOUND: "This task is no longer available for action.",
  STATUS_CHANGED: "This task has changed. Please refresh the task.",
  TEXT_TOO_LONG: "Some notes are too long. Please shorten them.",
  NO_PRODUCT_LINES: "This delivery has no products. Please contact your administrator.",
  LINES_MISMATCH: "The product list has changed. Please refresh the task.",
  QUANTITY_INVALID: "Delivered quantity must be between 0 and the assigned quantity (up to 3 decimals).",
  NOTHING_DELIVERED: "Nothing was delivered. Use “Report a problem” to mark the task as failed instead.",
  PROOF_REQUIRED: "Add the required proof before completing this task.",
  EXPECTED_AMOUNT_MISSING: "No amount to collect is set for this task. Please contact your administrator.",
  COLLECTION_ALREADY_RECORDED: "A collection is already recorded for this task.",
  AMOUNT_INVALID: "Enter a valid amount with up to 2 decimal places.",
  NOTHING_COLLECTED: "Nothing was collected. Use “Report a problem” to mark the task as failed instead.",
  OVER_COLLECTION: "The collected amount can't be more than the expected amount.",
  INVALID_PAYMENT_METHOD: "Select a payment method.",
  REFERENCE_REQUIRED: "A reference (transaction or cheque number) is required for this payment method.",
  REFERENCE_INVALID: "The reference may only contain letters, numbers and . _ / : # - (max 64).",
  SENSITIVE_REFERENCE: "That looks like a card number. Never record card numbers — enter the receipt or approval code instead.",
  RESULT_REQUIRED: "Describe the result before completing this task.",
  REASON_REQUIRED: "Please give a reason for the shortfall (at least 3 characters).",
};

export async function completeMyTask(input: CompleteInput): Promise<CompleteResult> {
  await requireAgent();
  const parsed = completeSchema.safeParse(input);
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] ?? "");
    const code = field === "lines" ? "QUANTITY_INVALID" : field === "cash" ? "AMOUNT_INVALID" : field === "taskId" ? "TASK_NOT_FOUND" : "INVALID";
    return { ok: false, code, message: COMPLETE_ERRORS[code] ?? "Invalid request." };
  }
  const { taskId, lines, cash, notes, reason, partial } = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("agent_complete_task", {
    p_task_id: taskId,
    p_lines: lines?.map((l) => ({ task_product_id: l.id, delivered_quantity: l.delivered, notes: l.notes ?? null })),
    p_cash: cash
      ? { collected_amount: cash.collected, payment_method: cash.method, reference: cash.reference ?? null, notes: cash.notes ?? null }
      : undefined,
    p_notes: notes || undefined,
    p_reason: reason || undefined,
    p_partial: partial ?? false,
  });

  if (error) {
    const known = error.message ? COMPLETE_ERRORS[error.message] : undefined;
    if (!known) console.error("Task completion failed", { code: error.code, message: error.message });
    return { ok: false, code: known ? error.message : "UNKNOWN", message: known ?? "The task could not be completed. Please try again." };
  }

  const result = z.object({ status: z.enum(["COMPLETED", "PARTIALLY_COMPLETED"]), summary: z.string() }).parse(data);
  revalidatePath("/agent", "layout");
  revalidatePath(`/admin/tasks/${taskId}`);
  return {
    ok: true,
    ...result,
    message: result.status === "COMPLETED" ? "Task completed." : "Task recorded as partially completed.",
  };
}

// ---------------------------------------------------------------------------
// Proof upload
//
// 1. createProofUpload: the server picks the object name
//    (tasks/{taskId}/proofs/{random uuid}.{ext}) and asks Storage for a
//    one-time signed upload URL *as the agent* — the bucket's INSERT policy
//    only allows the agent's own CHECKED_IN / IN_PROGRESS task.
// 2. The browser uploads the file straight to Storage (no app-server body limit).
// 3. finalizeProof: the server re-reads the object as the agent, checks its
//    real content (magic bytes), hashes it, and registers it through
//    agent_add_task_proof(), which re-checks ownership, status, path, size and
//    MIME. Anything rejected is removed again.
// ---------------------------------------------------------------------------

const PROOF_PATH = /^tasks\/([0-9a-f-]{36})\/proofs\/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$/;

export type ProofResult<T> = ({ ok: true } & T) | { ok: false; code: string; message: string };

const PROOF_ERRORS: Record<string, string> = {
  UNAUTHORIZED: "Your account can't upload proof. Please contact your administrator.",
  TASK_NOT_FOUND: "This task is no longer available for action.",
  INVALID_TASK_STATUS: "Proof can only be added after check-in and before the task is finished. Please refresh the task.",
  INVALID_PATH: "The upload could not be verified. Please try again.",
  INVALID_PROOF_TYPE: "Choose photo or document.",
  INVALID_FILE: "The file could not be read. Please try another file.",
  INVALID_FILE_TYPE: "Only JPEG, PNG or WEBP photos and PDF documents are allowed.",
  FILE_TOO_LARGE: "The file is too large. The maximum is 10 MB.",
  FILE_EMPTY: "The file is empty.",
  FILE_NOT_FOUND: "The upload did not complete. Please try again.",
  PROOF_DUPLICATE: "This file has already been added to the task.",
  TEXT_TOO_LONG: "The description is too long.",
  UPLOAD_FAILED: "The upload could not be started. Please try again.",
};

const proofFail = (code: string): { ok: false; code: string; message: string } => ({
  ok: false,
  code,
  message: PROOF_ERRORS[code] ?? "The proof could not be saved. Please try again.",
});

const createUploadSchema = z.object({
  taskId: z.uuid(),
  proofType: z.enum(PROOF_TYPES),
  mimeType: z.string(),
  size: z.number().int(),
});

export async function createProofUpload(
  input: z.input<typeof createUploadSchema>,
): Promise<ProofResult<{ path: string; token: string }>> {
  await requireAgent();
  const parsed = createUploadSchema.safeParse(input);
  if (!parsed.success) return proofFail("INVALID_FILE");
  const { taskId, proofType, mimeType, size } = parsed.data;

  if (!(PROOF_MIME_BY_TYPE[proofType] as readonly string[]).includes(mimeType)) return proofFail("INVALID_FILE_TYPE");
  if (size <= 0) return proofFail("FILE_EMPTY");
  if (size > PROOF_MAX_BYTES) return proofFail("FILE_TOO_LARGE");

  const supabase = await createClient();
  // Friendly early check (RLS: only the agent's own tasks are visible). The
  // storage policy and agent_add_task_proof() enforce the same rule.
  const { data: task } = await supabase.from("tasks").select("status").eq("id", taskId).maybeSingle();
  if (!task) return proofFail("TASK_NOT_FOUND");
  if (task.status !== "CHECKED_IN" && task.status !== "IN_PROGRESS") return proofFail("INVALID_TASK_STATUS");

  // Never derived from the browser's file name: no traversal, no overwrite.
  const path = `tasks/${taskId}/proofs/${randomUUID()}.${PROOF_MIME_EXTENSIONS[mimeType as ProofMime]}`;
  const { data, error } = await supabase.storage.from(PROOF_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    console.error("Proof upload URL failed", { message: error?.message });
    return proofFail("UPLOAD_FAILED");
  }
  return { ok: true, path: data.path, token: data.token };
}

const finalizeSchema = z.object({
  taskId: z.uuid(),
  path: z.string().max(200),
  proofType: z.enum(PROOF_TYPES),
  fileName: z.string().trim().max(200).optional(),
  description: z.string().trim().max(500).optional(),
});

/** First bytes of each allowed format. The declared MIME type alone is never trusted. */
function sniffMime(bytes: Uint8Array): ProofMime | null {
  const at = (offset: number, ...sig: number[]) => sig.every((b, i) => bytes[offset + i] === b);
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  if (at(0, 0x25, 0x50, 0x44, 0x46, 0x2d)) return "application/pdf";
  return null;
}

/** Display name only (never used as a storage path). */
function cleanFileName(name: string | undefined) {
  const cleaned = (name ?? "").replace(/[\\/]/g, "_").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return cleaned.slice(0, 200) || undefined;
}

export async function finalizeProof(input: z.input<typeof finalizeSchema>): Promise<ProofResult<{ id: string }>> {
  await requireAgent();
  const parsed = finalizeSchema.safeParse(input);
  if (!parsed.success) return proofFail("INVALID_FILE");
  const { taskId, path, proofType, description } = parsed.data;

  // The path must be one this flow generates, for this task.
  const match = PROOF_PATH.exec(path);
  if (!match || match[1] !== taskId) return proofFail("INVALID_PATH");

  const supabase = await createClient();
  // Read back as the agent: the storage SELECT policy only exposes own-task proofs.
  const { data: blob, error: downloadError } = await supabase.storage.from(PROOF_BUCKET).download(path);
  if (downloadError || !blob) return proofFail("FILE_NOT_FOUND");

  const reject = async (code: string) => {
    await removeOrphan(path);
    return proofFail(code);
  };

  if (blob.size <= 0) return reject("FILE_EMPTY");
  if (blob.size > PROOF_MAX_BYTES) return reject("FILE_TOO_LARGE");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const sniffed = sniffMime(bytes);
  const extension = match[2];
  if (!sniffed || PROOF_MIME_EXTENSIONS[sniffed] !== extension || !(PROOF_MIME_BY_TYPE[proofType] as readonly string[]).includes(sniffed)) {
    return reject("INVALID_FILE_TYPE");
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  const { data, error } = await supabase.rpc("agent_add_task_proof", {
    p_task_id: taskId,
    p_path: path,
    p_proof_type: proofType,
    p_file_name: cleanFileName(parsed.data.fileName) ?? `proof.${extension}`,
    p_sha256: sha256,
    p_description: description || undefined,
  });
  if (error) {
    const known = error.message && PROOF_ERRORS[error.message] ? error.message : null;
    if (!known) console.error("Proof registration failed", { code: error.code, message: error.message });
    return reject(known ?? "UNKNOWN");
  }

  revalidatePath(`/agent/tasks/${taskId}`);
  revalidatePath(`/admin/tasks/${taskId}`);
  return { ok: true, id: data };
}

/**
 * Removes an object this request just validated and rejected. Agents have no
 * storage DELETE permission (proof is immutable once accepted), so this uses
 * the server-only service client — limited to a generated, unregistered path.
 */
async function removeOrphan(path: string) {
  try {
    const admin = createAdminClient();
    const { count } = await admin.from("task_proofs").select("id", { count: "exact", head: true }).eq("storage_path", path);
    if (count === 0) await admin.storage.from(PROOF_BUCKET).remove([path]);
  } catch (error) {
    console.error("Failed to remove rejected proof upload", { message: (error as Error).message });
  }
}
