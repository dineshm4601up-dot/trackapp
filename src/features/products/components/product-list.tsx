import Link from "next/link";
import { Package, Pencil } from "lucide-react";

import { ActiveBadge, ListEmpty } from "@/components/shared/list-states";
import { PaginationBar } from "@/components/shared/pagination-bar";
import { ResponsiveTable, type Column } from "@/components/shared/responsive-table";
import { ToggleActiveButton } from "@/components/shared/toggle-active-button";
import { Button } from "@/components/ui/button";
import { setProductActive } from "@/features/products/actions";
import { listProducts, type ProductListRow } from "@/features/products/queries";
import { formatDate, formatMoney } from "@/lib/format";
import { listQuery, type ListParams } from "@/lib/list-params";

const columns: Column<ProductListRow>[] = [
  { header: "SKU", cell: (p) => p.sku, cellClassName: "font-mono text-xs" },
  { header: "Product name", cell: (p) => <span className="font-medium">{p.product_name}</span>, hideOnMobile: true },
  { header: "Unit", cell: (p) => p.unit },
  { header: "Price", cell: (p) => formatMoney(p.price), cellClassName: "tabular-nums" },
  { header: "Status", cell: (p) => <ActiveBadge isActive={p.is_active} /> },
  { header: "Created", cell: (p) => formatDate(p.created_at), className: "hidden lg:table-cell" },
];

export async function ProductList({ params }: { params: ListParams }) {
  const { rows, total } = await listProducts(params);

  if (rows.length === 0) {
    return (
      <ListEmpty
        params={params}
        icon={Package}
        plural="products"
        createHref="/admin/products/new"
        createLabel="Add product"
      />
    );
  }

  return (
    <div className="space-y-4">
      <ResponsiveTable
        caption="Products"
        rows={rows}
        columns={columns}
        title={(p) => p.product_name}
        actions={(p) => (
          <>
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/admin/products/${p.id}/edit`} aria-label={`Edit ${p.product_name}`}>
                <Pencil aria-hidden />
                Edit
              </Link>
            </Button>
            <ToggleActiveButton
              entity="product"
              name={p.product_name}
              isActive={p.is_active}
              action={setProductActive.bind(null, p.id)}
              consequence="will no longer be available for new tasks."
            />
          </>
        )}
      />
      <PaginationBar basePath="/admin/products" page={params.page} total={total} query={listQuery(params)} />
    </div>
  );
}
