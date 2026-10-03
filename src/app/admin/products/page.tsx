import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Plus } from "lucide-react";

import { ListSkeleton, listKey } from "@/components/shared/list-states";
import { ListToolbar } from "@/components/shared/list-toolbar";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { ProductList } from "@/features/products/components/product-list";
import { requireAdmin } from "@/lib/auth/session";
import { parseListParams } from "@/lib/list-params";

export const metadata: Metadata = { title: "Products" };

export default async function ProductsPage(props: PageProps<"/admin/products">) {
  await requireAdmin();
  const params = parseListParams(await props.searchParams);

  return (
    <>
      <PageHeader
        title="Products"
        description="Catalog items that can be delivered, picked up or replaced on tasks."
        actions={
          <Button asChild>
            <Link href="/admin/products/new">
              <Plus data-icon="inline-start" aria-hidden />
              Add product
            </Link>
          </Button>
        }
      />
      <ListToolbar searchPlaceholder="Search SKU, name or description" />
      <Suspense key={listKey(params)} fallback={<ListSkeleton label="Loading products…" />}>
        <ProductList params={params} />
      </Suspense>
    </>
  );
}
