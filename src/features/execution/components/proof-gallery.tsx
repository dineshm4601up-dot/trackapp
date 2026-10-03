import { FileText, ImageOff } from "lucide-react";

import type { TaskProof } from "@/features/execution/queries";
import { formatBytes } from "@/features/execution/config";
import { formatDateTime } from "@/lib/format";

/** Proof thumbnails; each opens its short-lived signed URL in a new tab. */
export function ProofGallery({ proofs, emptyText = "No proof added yet." }: { proofs: TaskProof[]; emptyText?: string }) {
  if (proofs.length === 0) return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Proof">
      {proofs.map((proof) => {
        const isImage = proof.mime_type?.startsWith("image/");
        const label = proof.description ?? proof.file_name ?? (proof.proof_type === "PHOTO" ? "Photo" : "Document");
        const body = (
          <>
            <span className="flex aspect-square items-center justify-center overflow-hidden rounded-md bg-muted">
              {proof.url && isImage ? (
                // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not optimisable
                <img src={proof.url} alt={label} className="size-full object-cover" loading="lazy" />
              ) : proof.url ? (
                <FileText className="size-10 text-muted-foreground" aria-hidden />
              ) : (
                <ImageOff className="size-10 text-muted-foreground" aria-hidden />
              )}
            </span>
            <span className="mt-1 block truncate text-xs font-medium">{label}</span>
            <span className="block text-xs text-muted-foreground">
              {proof.proof_type === "PHOTO" ? "Photo" : "Document"}
              {proof.file_size_bytes ? ` · ${formatBytes(proof.file_size_bytes)}` : ""} · {formatDateTime(proof.created_at)}
            </span>
          </>
        );
        return (
          <li key={proof.id} className="min-w-0">
            {proof.url ? (
              <a href={proof.url} target="_blank" rel="noopener noreferrer" className="block rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                {body}
              </a>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ul>
  );
}
