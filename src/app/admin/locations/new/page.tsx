import type { Metadata } from "next";

import { PageHeader } from "@/components/shared/page-header";
import { createLocation } from "@/features/locations/actions";
import { LocationForm } from "@/features/locations/components/location-form";
import { requireAdmin } from "@/lib/auth/session";

export const metadata: Metadata = { title: "New location" };

export default async function NewLocationPage() {
  await requireAdmin();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="New location" />
      <LocationForm action={createLocation} />
    </div>
  );
}
