import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { createProduct } from "@/features/products/actions";
import { ProductForm } from "@/features/products/components/product-form";
import { requireAdmin } from "@/lib/auth/session";

export const metadata: Metadata = { title: "New product" };

export default async function NewProductPage() {
  await requireAdmin();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="New product" />
      <ProductForm action={createProduct} />
    </div>
  );
}
