import { MapPinCheck, MapPinX } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CheckInSummary } from "@/features/checkin/queries";
import { formatDateTime, mapsSearchUrl } from "@/lib/format";

type CheckInSummaryCardProps = {
  summary: CheckInSummary;
  site: { latitude: number | null; longitude: number | null } | null;
};

const metres = (value: number | null | undefined) => (value === null || value === undefined ? "—" : `${Math.round(value)} m`);

/** Admin view of the server-validated check-in (static; no live tracking). */
export function CheckInSummaryCard({ summary, site }: CheckInSummaryCardProps) {
  const { success, rejectedAttempts, lastRejected } = summary;
  const agent = success?.agent;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Check-in
          {success ? (
            <Badge variant="success">
              <MapPinCheck aria-hidden /> Verified
            </Badge>
          ) : (
            <Badge variant="outline">Not completed</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {success ? (
          <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2">
            <dt className="text-muted-foreground">Checked in</dt>
            <dd>{formatDateTime(success.checked_in_at)}</dd>
            <dt className="text-muted-foreground">Agent</dt>
            <dd>
              {agent?.profile?.full_name ?? "—"}
              {agent?.employee_code && <span className="text-muted-foreground"> · {agent.employee_code}</span>}
            </dd>
            <dt className="text-muted-foreground">GPS accuracy</dt>
            <dd>±{metres(success.accuracy_meters)}</dd>
            <dt className="text-muted-foreground">Distance</dt>
            <dd>{metres(success.distance_from_location_meters)} from the location (server-calculated)</dd>
            <dt className="text-muted-foreground">Allowed radius</dt>
            <dd>{metres(success.geofence_radius_meters)}</dd>
          </dl>
        ) : (
          <p className="text-muted-foreground">The agent has not checked in at the location yet.</p>
        )}

        {rejectedAttempts > 0 && (
          <p className="flex items-start gap-2 text-muted-foreground">
            <MapPinX className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <span>
              {rejectedAttempts} attempt{rejectedAttempts === 1 ? "" : "s"} rejected outside the check-in area
              {lastRejected && ` (last: ${metres(lastRejected.distance_from_location_meters)} away, ${formatDateTime(lastRejected.checked_in_at)})`}.
            </span>
          </p>
        )}

        {success && (
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {site?.latitude != null && site.longitude != null && (
              <a
                href={mapsSearchUrl(site.latitude, site.longitude)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Assigned location
              </a>
            )}
            <a
              href={mapsSearchUrl(success.latitude, success.longitude)}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              Check-in point
            </a>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
