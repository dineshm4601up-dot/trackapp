import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Plus } from "lucide-react";

import { ListSkeleton, listKey } from "@/components/shared/list-states";
import { ListToolbar } from "@/components/shared/list-toolbar";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { LocationList } from "@/features/locations/components/location-list";
import { requireAdmin } from "@/lib/auth/session";
import { parseListParams } from "@/lib/list-params";

export const metadata: Metadata = { title: "Locations" };

export default async function LocationsPage(props: PageProps<"/admin/locations">) {
  await requireAdmin();
  const params = parseListParams(await props.searchParams);

  return (
    <>
      <PageHeader
        title="Locations"
        description="Physical sites where agents perform tasks. Each belongs to a customer."
        actions={
          <Button asChild>
            <Link href="/admin/locations/new">
              <Plus data-icon="inline-start" aria-hidden />
              Add location
            </Link>
          </Button>
        }
      />
      <ListToolbar searchPlaceholder="Search location, customer, city or state" />
      <Suspense key={listKey(params)} fallback={<ListSkeleton label="Loading locations…" />}>
        <LocationList params={params} />
      </Suspense>
    </>
  );
}
