import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Plus } from "lucide-react";

import { ListSkeleton, listKey } from "@/components/shared/list-states";
import { ListToolbar } from "@/components/shared/list-toolbar";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { CustomerList } from "@/features/customers/components/customer-list";
import { requireAdmin } from "@/lib/auth/session";
import { parseListParams } from "@/lib/list-params";

export const metadata: Metadata = { title: "Customers" };

export default async function CustomersPage(props: PageProps<"/admin/customers">) {
  await requireAdmin();
  const params = parseListParams(await props.searchParams);

  return (
    <>
      <PageHeader
        title="Customers"
        description="Businesses and people you serve. Their sites are managed under Locations."
        actions={
          <Button asChild>
            <Link href="/admin/customers/new">
              <Plus data-icon="inline-start" aria-hidden />
              Add customer
            </Link>
          </Button>
        }
      />
      <ListToolbar searchPlaceholder="Search code, name, phone, email or city" />
      <Suspense key={listKey(params)} fallback={<ListSkeleton label="Loading customers…" />}>
        <CustomerList params={params} />
      </Suspense>
    </>
  );
}
