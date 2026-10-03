import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shared/page-header";
import { updateCustomer } from "@/features/customers/actions";
import { CustomerForm } from "@/features/customers/components/customer-form";
import { getCustomer } from "@/features/customers/queries";
import { requireAdmin } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Edit customer" };

export default async function EditCustomerPage(props: PageProps<"/admin/customers/[id]/edit">) {
  await requireAdmin();
  const { id } = await props.params;
  const customer = await getCustomer(id);
  if (!customer) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Edit customer" description={customer.name} />
      <CustomerForm action={updateCustomer.bind(null, customer.id)} customer={customer} />
    </div>
  );
}
