import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { createCustomer } from "@/features/customers/actions";
import { CustomerForm } from "@/features/customers/components/customer-form";
import { requireAdmin } from "@/lib/auth/session";

export const metadata: Metadata = { title: "New customer" };

export default async function NewCustomerPage() {
  await requireAdmin();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="New customer" />
      <CustomerForm action={createCustomer} />
    </div>
  );
}
