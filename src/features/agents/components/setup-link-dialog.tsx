"use client";

import { useState } from "react";
import { Check, Copy, KeyRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type SetupLinkDialogProps = {
  link: string | null;
  agentName: string;
  onClose: () => void;
};

/** Shows a one-time password setup link once, with a copy button. */
export function SetupLinkDialog({ link, agentName, onClose }: SetupLinkDialogProps) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
  }

  return (
    <Dialog open={link !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-5" aria-hidden />
            Password setup link
          </DialogTitle>
          <DialogDescription>
            Send this link to <span className="font-medium text-foreground">{agentName}</span> through a private
            channel. They open it to choose their own password. It works once and expires after a short time (1
            hour by default). It won&apos;t be shown again, but you can generate a new one from the agent&apos;s page.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input readOnly value={link ?? ""} aria-label="Setup link" className="font-mono text-xs" onFocus={(e) => e.target.select()} />
          <Button type="button" variant="outline" onClick={copy} aria-label="Copy link">
            {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <DialogFooter>
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
