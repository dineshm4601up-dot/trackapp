import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { createAgent } from "@/features/agents/actions";
import { AgentForm } from "@/features/agents/components/agent-form";
import { requireAdmin } from "@/lib/auth/session";

export const metadata: Metadata = { title: "New agent" };

export default async function NewAgentPage() {
  await requireAdmin();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="New agent"
        description="Creates the agent's sign-in account. You'll get a one-time link for them to set their password."
      />
      <AgentForm action={createAgent} />
    </div>
  );
}
