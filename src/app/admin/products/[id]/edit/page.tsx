import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shared/page-header";
import { updateProduct } from "@/features/products/actions";
import { ProductForm } from "@/features/products/components/product-form";
import { getProduct } from "@/features/products/queries";
import { requireAdmin } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Edit product" };

export default async function EditProductPage(props: PageProps<"/admin/products/[id]/edit">) {
  await requireAdmin();
  const { id } = await props.params;
  const product = await getProduct(id);
  if (!product) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Edit product" description={`${product.product_name} · ${product.sku}`} />
      <ProductForm action={updateProduct.bind(null, product.id)} product={product} />
    </div>
  );
}
