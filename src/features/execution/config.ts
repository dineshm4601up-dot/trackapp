// Client-safe execution constants. The database re-validates every one of
// these (agent_complete_task, agent_add_task_proof, storage bucket limits);
// they exist here only so the UI can explain problems before a round trip.

export const PROOF_BUCKET = "task-proofs";

/** Mirrors the bucket's file_size_limit and the proof_max_file_bytes setting. */
export const PROOF_MAX_BYTES = 10 * 1024 * 1024;

export const PROOF_TYPES = ["PHOTO", "DOCUMENT"] as const;
export type ProofType = (typeof PROOF_TYPES)[number];

/** Allowed MIME type → the only extension a generated object name may carry. */
export const PROOF_MIME_EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
} as const;
export type ProofMime = keyof typeof PROOF_MIME_EXTENSIONS;

export const PROOF_MIME_BY_TYPE: Record<ProofType, readonly ProofMime[]> = {
  PHOTO: ["image/jpeg", "image/png", "image/webp"],
  DOCUMENT: ["application/pdf", "image/jpeg", "image/png", "image/webp"],
};

export const PHOTO_ACCEPT = PROOF_MIME_BY_TYPE.PHOTO.join(",");
export const DOCUMENT_ACCEPT = PROOF_MIME_BY_TYPE.DOCUMENT.join(",");

/** Payment reference: short, plain characters (mirrors agent_complete_task). */
export const REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._/:#-]*$/;
export const REFERENCE_MAX = 64;

/** 12–19 digits once spaces/dashes are removed looks like a card number: never stored. */
export function looksLikeCardNumber(value: string) {
  return /^\d{12,19}$/.test(value.replace(/[\s-]/g, ""));
}

export const AMOUNT_PATTERN = /^\d{1,12}(\.\d{1,2})?$/; // numeric(14,2)
export const QUANTITY_PATTERN = /^\d{1,11}(\.\d{1,3})?$/; // numeric(14,3)

export const SHORTFALL_REASONS = [
  "Customer accepted only part",
  "Stock short / damaged",
  "Customer paid partially",
  "Customer requested later delivery",
  "Other",
] as const;

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
