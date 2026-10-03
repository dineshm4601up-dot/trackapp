"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, FileText, Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createProofUpload, finalizeProof } from "@/features/execution/actions";
import {
  DOCUMENT_ACCEPT,
  formatBytes,
  PHOTO_ACCEPT,
  PROOF_BUCKET,
  PROOF_MAX_BYTES,
  PROOF_MIME_BY_TYPE,
  type ProofType,
} from "@/features/execution/config";
import { isNetworkError, NETWORK_ERROR_MESSAGE } from "@/lib/network";
import { createClient } from "@/lib/supabase/client";

type Selected = { file: File; type: ProofType; preview: string | null };

/**
 * Pick → preview → upload. The file goes straight to private storage under a
 * server-generated name; the server then verifies its real content before it
 * counts as proof. Nothing is shown as saved until the server confirms.
 */
export function ProofUploader({ taskId, allowDocuments }: { taskId: string; allowDocuments: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Selected | null>(null);
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const documentInput = useRef<HTMLInputElement>(null);

  useEffect(() => () => {
    if (selected?.preview) URL.revokeObjectURL(selected.preview);
  }, [selected]);

  function choose(type: ProofType, file: File | undefined) {
    setError(null);
    if (!file) return;
    if (!(PROOF_MIME_BY_TYPE[type] as readonly string[]).includes(file.type)) {
      setError(type === "PHOTO" ? "Choose a JPEG, PNG or WEBP photo." : "Choose a PDF, or a JPEG / PNG / WEBP image.");
      return;
    }
    if (file.size === 0) return setError("That file is empty.");
    if (file.size > PROOF_MAX_BYTES) return setError(`That file is ${formatBytes(file.size)}. The maximum is 10 MB.`);
    setSelected({ file, type, preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : null });
  }

  function clear() {
    setSelected(null);
    setDescription("");
    if (photoInput.current) photoInput.current.value = "";
    if (documentInput.current) documentInput.current.value = "";
  }

  async function upload() {
    if (!selected || uploading) return;
    setUploading(true);
    setError(null);
    try {
      const ticket = await createProofUpload({
        taskId,
        proofType: selected.type,
        mimeType: selected.file.type,
        size: selected.file.size,
      });
      if (!ticket.ok) return setError(ticket.message);

      const { error: uploadError } = await createClient()
        .storage.from(PROOF_BUCKET)
        .uploadToSignedUrl(ticket.path, ticket.token, selected.file, { contentType: selected.file.type });
      if (uploadError) {
        return setError("The upload did not complete. Please check your connection and try again.");
      }

      const result = await finalizeProof({
        taskId,
        path: ticket.path,
        proofType: selected.type,
        fileName: selected.file.name,
        description,
      });
      if (!result.ok) return setError(result.message);

      toast.success(selected.type === "PHOTO" ? "Photo added." : "Document added.");
      clear();
      router.refresh();
    } catch (e) {
      if (!isNetworkError(e)) throw e;
      setError(NETWORK_ERROR_MESSAGE);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-3">
      <input
        ref={photoInput}
        type="file"
        accept={PHOTO_ACCEPT}
        capture="environment"
        className="sr-only"
        aria-label="Take or choose a photo"
        onChange={(e) => choose("PHOTO", e.target.files?.[0])}
        disabled={uploading}
      />
      <input
        ref={documentInput}
        type="file"
        accept={DOCUMENT_ACCEPT}
        className="sr-only"
        aria-label="Choose a document"
        onChange={(e) => choose("DOCUMENT", e.target.files?.[0])}
        disabled={uploading}
      />

      {!selected ? (
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="lg" className="flex-1" onClick={() => photoInput.current?.click()}>
            <Camera data-icon="inline-start" aria-hidden />
            Add photo
          </Button>
          {allowDocuments && (
            <Button type="button" variant="outline" size="lg" className="flex-1" onClick={() => documentInput.current?.click()}>
              <FileText data-icon="inline-start" aria-hidden />
              Add document
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3 rounded-lg border p-3">
          <div className="flex items-start gap-3">
            {selected.preview ? (
              // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
              <img src={selected.preview} alt="Selected proof preview" className="size-20 shrink-0 rounded-md object-cover" />
            ) : (
              <span className="flex size-20 shrink-0 items-center justify-center rounded-md bg-muted">
                <FileText className="size-8 text-muted-foreground" aria-hidden />
              </span>
            )}
            <div className="min-w-0 flex-1 text-sm">
              <p className="truncate font-medium">{selected.file.name}</p>
              <p className="text-muted-foreground">
                {selected.type === "PHOTO" ? "Photo" : "Document"} · {formatBytes(selected.file.size)}
              </p>
            </div>
            <Button type="button" variant="ghost" size="icon" onClick={clear} disabled={uploading} aria-label="Remove selected file">
              <X aria-hidden />
            </Button>
          </div>
          <div className="space-y-2">
            <Label htmlFor="proof-description">Caption (optional)</Label>
            <Input
              id="proof-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              placeholder="e.g. Goods at reception"
              disabled={uploading}
            />
          </div>
          <Button type="button" size="lg" className="w-full" onClick={upload} disabled={uploading}>
            {uploading ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden /> : <Upload data-icon="inline-start" aria-hidden />}
            {uploading ? "Uploading…" : "Upload"}
          </Button>
        </div>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
