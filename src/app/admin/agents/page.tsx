import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Plus } from "lucide-react";

import { ListSkeleton, listKey } from "@/components/shared/list-states";
import { ListToolbar } from "@/components/shared/list-toolbar";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { AgentList } from "@/features/agents/components/agent-list";
import { requireAdmin } from "@/lib/auth/session";
import { parseListParams } from "@/lib/list-params";

export const metadata: Metadata = { title: "Agents" };

export default async function AgentsPage(props: PageProps<"/admin/agents">) {
  await requireAdmin();
  const params = parseListParams(await props.searchParams);

  return (
    <>
      <PageHeader
        title="Agents"
        description="Field staff who receive and carry out tasks."
        actions={
          <Button asChild>
            <Link href="/admin/agents/new">
              <Plus data-icon="inline-start" aria-hidden />
              Add agent
            </Link>
          </Button>
        }
      />
      <ListToolbar searchPlaceholder="Search code, name, phone or email" />
      <Suspense key={listKey(params)} fallback={<ListSkeleton label="Loading agents…" />}>
        <AgentList params={params} />
      </Suspense>
    </>
  );
}
