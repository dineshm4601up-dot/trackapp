import Link from "next/link";
import { Pencil, Users } from "lucide-react";

import { ActiveBadge, ListEmpty } from "@/components/shared/list-states";
import { PaginationBar } from "@/components/shared/pagination-bar";
import { ResponsiveTable, type Column } from "@/components/shared/responsive-table";
import { ToggleActiveButton } from "@/components/shared/toggle-active-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { setAgentActive } from "@/features/agents/actions";
import { listAgents, type AgentListRow } from "@/features/agents/queries";
import { formatDate } from "@/lib/format";
import { listQuery, type ListParams } from "@/lib/list-params";

const columns: Column<AgentListRow>[] = [
  { header: "Employee code", cell: (a) => a.employee_code ?? "—", cellClassName: "font-mono text-xs" },
  { header: "Name", cell: (a) => <span className="font-medium">{a.full_name ?? "—"}</span>, hideOnMobile: true },
  { header: "Email", cell: (a) => a.email ?? "—" },
  { header: "Phone", cell: (a) => a.phone ?? "—" },
  {
    header: "Status",
    cell: (a) => (
      <span className="inline-flex flex-wrap items-center gap-1">
        <ActiveBadge isActive={a.is_active ?? false} />
        {a.account_active === false && <Badge variant="warning">Sign-in disabled</Badge>}
      </span>
    ),
  },
  { header: "Created", cell: (a) => formatDate(a.created_at), className: "hidden lg:table-cell" },
];

export async function AgentList({ params }: { params: ListParams }) {
  const { rows, total } = await listAgents(params);

  if (rows.length === 0) {
    return (
      <ListEmpty params={params} icon={Users} plural="agents" createHref="/admin/agents/new" createLabel="Add agent" />
    );
  }

  return (
    <div className="space-y-4">
      <ResponsiveTable
        caption="Agents"
        rows={rows}
        columns={columns}
        title={(a) => a.full_name ?? a.email}
        actions={(a) => {
          const name = a.full_name ?? a.email ?? "agent";
          return (
            <>
              <Button variant="ghost" size="sm" asChild>
                <Link href={`/admin/agents/${a.id}/edit`} aria-label={`Edit ${name}`}>
                  <Pencil aria-hidden />
                  Edit
                </Link>
              </Button>
              <ToggleActiveButton
                entity="agent"
                name={name}
                isActive={a.is_active ?? false}
                action={setAgentActive.bind(null, a.id)}
                consequence="will be signed out on their next request and can't be assigned new tasks."
              />
            </>
          );
        }}
      />
      <PaginationBar basePath="/admin/agents" page={params.page} total={total} query={listQuery(params)} />
    </div>
  );
}
