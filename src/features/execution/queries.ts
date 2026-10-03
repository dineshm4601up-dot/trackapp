import "server-only";

import { PROOF_BUCKET } from "@/features/execution/config";
import { createClient } from "@/lib/supabase/server";

/** Short-lived links: proof is never publicly addressable. */
const SIGNED_URL_SECONDS = 10 * 60;

export type TaskProof = {
  id: string;
  proof_type: string;
  file_name: string | null;
  mime_type: string | null;
  file_size_bytes: number | null;
  description: string | null;
  created_at: string;
  url: string | null;
};

/**
 * Proofs for a task, with signed view URLs. Runs with the caller's session:
 * RLS on task_proofs and the bucket's SELECT policy limit this to admins and
 * the assigned agent.
 */
export async function getTaskProofs(taskId: string): Promise<TaskProof[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("task_proofs")
    .select("id, proof_type, file_name, mime_type, file_size_bytes, description, created_at, storage_path")
    .eq("task_id", taskId)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("Failed to load proofs", { code: error.code, message: error.message });
    throw new Error("Unable to load proof.");
  }

  const paths = data.flatMap((p) => (p.storage_path ? [p.storage_path] : []));
  const urls = new Map<string, string>();
  if (paths.length) {
    const { data: signed } = await supabase.storage.from(PROOF_BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS);
    for (const s of signed ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  }

  return data.map(({ storage_path, ...proof }) => ({ ...proof, url: storage_path ? (urls.get(storage_path) ?? null) : null }));
}

/** The recorded collection (one per task), visible to admins and the assigned agent. */
export async function getCashCollection(taskId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cash_collections")
    .select("expected_amount, collected_amount, currency, payment_method, collection_reference, collected_at, notes")
    .eq("task_id", taskId)
    .maybeSingle();
  if (error) throw new Error("Unable to load the cash collection.");
  return data;
}

export type CashCollection = NonNullable<Awaited<ReturnType<typeof getCashCollection>>>;
