import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shared/page-header";
import { updateLocation } from "@/features/locations/actions";
import { LocationForm } from "@/features/locations/components/location-form";
import { getLocation } from "@/features/locations/queries";
import { requireAdmin } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Edit location" };

export default async function EditLocationPage(props: PageProps<"/admin/locations/[id]/edit">) {
  await requireAdmin();
  const { id } = await props.params;
  const location = await getLocation(id);
  if (!location) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Edit location" description={`${location.location_name} · ${location.customer?.name ?? ""}`} />
      <LocationForm action={updateLocation.bind(null, location.id)} location={location} />
    </div>
  );
}
