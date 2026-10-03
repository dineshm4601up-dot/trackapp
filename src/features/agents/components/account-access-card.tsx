"use client";

import { useState, useTransition } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { generateAgentSetupLink } from "@/features/agents/actions";
import { SetupLinkDialog } from "@/features/agents/components/setup-link-dialog";

type AccountAccessCardProps = {
  agentId: string;
  agentName: string;
  accountActive: boolean;
};

export function AccountAccessCard({ agentId, agentName, accountActive }: AccountAccessCardProps) {
  const [link, setLink] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function generate() {
    startTransition(async () => {
      const result = await generateAgentSetupLink(agentId);
      if (result.ok) setLink(result.link);
      else toast.error(result.message);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Sign-in access
          <Badge variant={accountActive ? "success" : "secondary"}>
            {accountActive ? "Account enabled" : "Account disabled"}
          </Badge>
        </CardTitle>
        <CardDescription>
          Generate a one-time link for the agent to set (or reset) their password. Admins never see or choose
          passwords.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button type="button" variant="outline" onClick={generate} disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <KeyRound aria-hidden />}
          Generate setup link
        </Button>
      </CardContent>
      <SetupLinkDialog link={link} agentName={agentName} onClose={() => setLink(null)} />
    </Card>
  );
}
