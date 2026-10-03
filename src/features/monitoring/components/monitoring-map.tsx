"use client";

import { useMemo } from "react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { LocationAge, useNow } from "@/features/monitoring/components/live-time";
import { isStale, timeAgo } from "@/features/monitoring/config";
import { TASK_STATUS_META, TASK_TYPE_META, type TaskStatus, type TaskType } from "@/features/tasks/constants";
import { MapView } from "@/lib/maps/map-view";
import type { MapMarker, MapMarkerTone } from "@/lib/maps/types";

export type MapPoint = {
  id: string;
  task_code: string | null;
  task_type: TaskType | null;
  status: TaskStatus | null;
  customer_name: string | null;
  agent_name: string | null;
  last_latitude: number | null;
  last_longitude: number | null;
  last_accuracy_meters: number | null;
  last_location_at: string | null;
};

const STATE: Partial<Record<TaskStatus, { label: string; tone: MapMarkerTone }>> = {
  ON_THE_WAY: { label: "On the way", tone: "info" },
  ARRIVED: { label: "At location", tone: "info" },
  CHECKED_IN: { label: "At location", tone: "info" },
  IN_PROGRESS: { label: "Working", tone: "success" },
};

const LEGEND: { label: string; tone: MapMarkerTone; text: string }[] = [
  { label: "On the way", tone: "info", text: "travelling to the location" },
  { label: "At location", tone: "info", text: "arrived or checked in" },
  { label: "Working", tone: "success", text: "task in progress" },
  { label: "Stale", tone: "warning", text: "no update for 5+ minutes — last known location" },
];

const TONE_BADGE = { info: "info", success: "success", warning: "warning", muted: "secondary" } as const;

/**
 * Operational map: the latest location of each task that is being tracked
 * right now — one marker per task, never a trail. The same information is
 * listed beside the map, so it stays usable if the map cannot load.
 */
export function MonitoringMap({ points }: { points: MapPoint[] }) {
  const now = useNow();

  const entries = useMemo(
    () =>
      points.flatMap((point) => {
        if (point.last_latitude === null || point.last_longitude === null || !point.last_location_at || !point.status) return [];
        const stale = isStale(point.last_location_at, now);
        const state = stale ? { label: "Stale", tone: "warning" as const } : (STATE[point.status] ?? { label: "Active", tone: "muted" as const });
        return [{ point, state, stale, at: point.last_location_at, latitude: point.last_latitude, longitude: point.last_longitude }];
      }),
    [points, now],
  );

  const markers = useMemo<MapMarker[]>(
    () =>
      entries.map(({ point, state, stale, at, latitude, longitude }) => ({
        id: point.id,
        latitude,
        longitude,
        label: `${point.agent_name?.split(" ")[0] ?? "Agent"} · ${state.label}`,
        tone: state.tone,
        title: point.agent_name ?? "Agent",
        details: [
          ["Task", point.task_code ?? "—"],
          ["Type", point.task_type ? TASK_TYPE_META[point.task_type].label : "—"],
          ["Customer", point.customer_name ?? "—"],
          ["Status", point.status ? TASK_STATUS_META[point.status].label : "—"],
          [stale ? "Last known location" : "Last updated", `${timeAgo(at, now)}${stale ? " — may be stale" : ""}`],
          ["GPS accuracy", point.last_accuracy_meters === null ? "—" : `±${Math.round(point.last_accuracy_meters)} m`],
        ],
        link: { href: `/admin/tasks/${point.id}`, text: "Open task" },
      })),
    [entries, now],
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-3">
        <MapView markers={markers} label="Agent locations map" className="h-[28rem] lg:h-[36rem]" />
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Map legend">
          {LEGEND.map((item) => (
            <li key={item.label} className="flex items-center gap-1.5">
              <Badge variant={TONE_BADGE[item.tone]}>{item.label}</Badge>
              {item.text}
            </li>
          ))}
        </ul>
      </div>

      <section aria-labelledby="map-list-heading" className="space-y-3">
        <h2 id="map-list-heading" className="text-sm font-semibold">
          Tracked tasks ({entries.length})
        </h2>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No agent is sharing a location right now. Locations appear while a task is on the way, at the location or in
            progress.
          </p>
        ) : (
          <ul className="space-y-2">
            {entries.map(({ point, state }) => (
              <li key={point.id} className="rounded-lg border p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium">{point.agent_name ?? "Agent"}</p>
                  <Badge variant={TONE_BADGE[state.tone]}>{state.label}</Badge>
                </div>
                <p className="text-muted-foreground">
                  <Link href={`/admin/tasks/${point.id}`} className="font-mono text-xs hover:underline">
                    {point.task_code}
                  </Link>
                  {point.customer_name ? ` · ${point.customer_name}` : ""}
                </p>
                <p className="text-xs">
                  <LocationAge at={point.last_location_at} accuracy={point.last_accuracy_meters} />
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
