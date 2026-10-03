import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shared/page-header";
import { updateAgent } from "@/features/agents/actions";
import { AccountAccessCard } from "@/features/agents/components/account-access-card";
import { AgentForm } from "@/features/agents/components/agent-form";
import { getAgent } from "@/features/agents/queries";
import { requireAdmin } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Edit agent" };

export default async function EditAgentPage(props: PageProps<"/admin/agents/[id]/edit">) {
  await requireAdmin();
  const { id } = await props.params;
  const agent = await getAgent(id);
  if (!agent) notFound();
  const name = agent.full_name ?? agent.email ?? "Agent";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Edit agent" description={`${name} · ${agent.employee_code ?? ""}`} />
      <AgentForm action={updateAgent.bind(null, agent.id)} agent={agent} />
      <AccountAccessCard agentId={agent.id} agentName={name} accountActive={agent.account_active ?? false} />
    </div>
  );
}
