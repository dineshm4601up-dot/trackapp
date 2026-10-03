import Link from "next/link";
import { MapPin, Pencil } from "lucide-react";

import { ActiveBadge, ListEmpty } from "@/components/shared/list-states";
import { PaginationBar } from "@/components/shared/pagination-bar";
import { ResponsiveTable, type Column } from "@/components/shared/responsive-table";
import { ToggleActiveButton } from "@/components/shared/toggle-active-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { setLocationActive } from "@/features/locations/actions";
import { listLocations, type LocationListRow } from "@/features/locations/queries";
import { formatCoordinate, mapsSearchUrl } from "@/lib/format";
import { listQuery, type ListParams } from "@/lib/list-params";

const columns: Column<LocationListRow>[] = [
  {
    header: "Location",
    cell: (l) => <span className="font-medium">{l.location_name}</span>,
    hideOnMobile: true,
  },
  {
    header: "Customer",
    cell: (l) => (
      <span className="inline-flex items-center gap-2">
        {l.customer_name ?? "—"}
        {l.customer_active === false && <Badge variant="warning">Inactive</Badge>}
      </span>
    ),
  },
  { header: "City", cell: (l) => l.city ?? "—" },
  { header: "State", cell: (l) => l.state ?? "—", className: "hidden lg:table-cell" },
  {
    header: "Latitude",
    cell: (l) => formatCoordinate(l.latitude),
    className: "hidden xl:table-cell",
    cellClassName: "font-mono text-xs tabular-nums",
  },
  {
    header: "Longitude",
    cell: (l) => formatCoordinate(l.longitude),
    className: "hidden xl:table-cell",
    cellClassName: "font-mono text-xs tabular-nums",
  },
  {
    header: "Radius",
    cell: (l) => (l.geofence_radius_meters ? `${l.geofence_radius_meters} m` : "—"),
    cellClassName: "tabular-nums",
  },
  { header: "Status", cell: (l) => <ActiveBadge isActive={l.is_active ?? false} /> },
];

export async function LocationList({ params }: { params: ListParams }) {
  const { rows, total } = await listLocations(params);

  if (rows.length === 0) {
    return (
      <ListEmpty
        params={params}
        icon={MapPin}
        plural="locations"
        createHref="/admin/locations/new"
        createLabel="Add location"
      />
    );
  }

  return (
    <div className="space-y-4">
      <ResponsiveTable
        caption="Locations"
        rows={rows}
        columns={columns}
        title={(l) => l.location_name}
        actions={(l) => {
          const name = l.location_name ?? "location";
          return (
            <>
              {l.latitude !== null && l.longitude !== null && (
                <Button variant="ghost" size="sm" asChild>
                  <a
                    href={mapsSearchUrl(l.latitude, l.longitude)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`View ${name} on map`}
                  >
                    <MapPin aria-hidden />
                    Map
                  </a>
                </Button>
              )}
              <Button variant="ghost" size="sm" asChild>
                <Link href={`/admin/locations/${l.id}/edit`} aria-label={`Edit ${name}`}>
                  <Pencil aria-hidden />
                  Edit
                </Link>
              </Button>
              <ToggleActiveButton
                entity="location"
                name={name}
                isActive={l.is_active ?? false}
                action={setLocationActive.bind(null, l.id)}
                consequence="will no longer be selectable for new tasks."
              />
            </>
          );
        }}
      />
      <PaginationBar basePath="/admin/locations" page={params.page} total={total} query={listQuery(params)} />
    </div>
  );
}
