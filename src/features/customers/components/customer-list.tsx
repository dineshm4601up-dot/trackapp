import Link from "next/link";
import { Building2, Pencil } from "lucide-react";

import { ActiveBadge, ListEmpty } from "@/components/shared/list-states";
import { PaginationBar } from "@/components/shared/pagination-bar";
import { ResponsiveTable, type Column } from "@/components/shared/responsive-table";
import { ToggleActiveButton } from "@/components/shared/toggle-active-button";
import { Button } from "@/components/ui/button";
import { setCustomerActive } from "@/features/customers/actions";
import { listCustomers, type CustomerListRow } from "@/features/customers/queries";
import { listQuery, type ListParams } from "@/lib/list-params";

const columns: Column<CustomerListRow>[] = [
  { header: "Code", cell: (c) => c.customer_code ?? "—", cellClassName: "font-mono text-xs" },
  { header: "Customer name", cell: (c) => <span className="font-medium">{c.name}</span>, hideOnMobile: true },
  { header: "Phone", cell: (c) => c.phone ?? "—" },
  { header: "Email", cell: (c) => c.email ?? "—", className: "hidden lg:table-cell" },
  { header: "City", cell: (c) => c.city ?? "—" },
  { header: "State", cell: (c) => c.state ?? "—", className: "hidden xl:table-cell" },
  { header: "Status", cell: (c) => <ActiveBadge isActive={c.is_active} /> },
];

export async function CustomerList({ params }: { params: ListParams }) {
  const { rows, total } = await listCustomers(params);

  if (rows.length === 0) {
    return (
      <ListEmpty
        params={params}
        icon={Building2}
        plural="customers"
        createHref="/admin/customers/new"
        createLabel="Add customer"
      />
    );
  }

  return (
    <div className="space-y-4">
      <ResponsiveTable
        caption="Customers"
        rows={rows}
        columns={columns}
        title={(c) => c.name}
        actions={(c) => (
          <>
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/admin/customers/${c.id}/edit`} aria-label={`Edit ${c.name}`}>
                <Pencil aria-hidden />
                Edit
              </Link>
            </Button>
            <ToggleActiveButton
              entity="customer"
              name={c.name}
              isActive={c.is_active}
              action={setCustomerActive.bind(null, c.id)}
              consequence="will no longer be available for new tasks or locations."
            />
          </>
        )}
      />
      <PaginationBar basePath="/admin/customers" page={params.page} total={total} query={listQuery(params)} />
    </div>
  );
}
