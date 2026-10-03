"use client";

import "leaflet/dist/leaflet.css";

import { useEffect, useRef, useState } from "react";
import type { LayerGroup, Map as LeafletMap } from "leaflet";

import { DEFAULT_VIEW, TILE_LAYER } from "@/lib/maps/provider";
import type { MapMarker, MapMarkerTone } from "@/lib/maps/types";
import { cn } from "@/lib/utils";

const TONE_CLASS: Record<MapMarkerTone, string> = {
  info: "bg-info text-white",
  success: "bg-success text-white",
  warning: "bg-warning text-white",
  muted: "bg-muted-foreground text-white",
};

function markerElement(marker: MapMarker) {
  const el = document.createElement("div");
  el.className = cn(
    "inline-flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full px-2 py-1 text-xs font-medium whitespace-nowrap shadow-md ring-2 ring-white",
    TONE_CLASS[marker.tone],
  );
  el.textContent = `● ${marker.label}`; // textContent: never interpreted as HTML
  return el;
}

function popupElement(marker: MapMarker) {
  const root = document.createElement("div");
  root.className = "space-y-1 text-sm";
  const title = document.createElement("p");
  title.className = "font-semibold";
  title.textContent = marker.title;
  root.append(title);
  for (const [label, value] of marker.details) {
    const row = document.createElement("p");
    const key = document.createElement("span");
    key.className = "text-muted-foreground";
    key.textContent = `${label}: `;
    row.append(key, value);
    root.append(row);
  }
  if (marker.link) {
    const link = document.createElement("a");
    link.href = marker.link.href;
    link.textContent = marker.link.text;
    link.className = "font-medium underline";
    root.append(link);
  }
  return root;
}

type MapViewProps = {
  markers: readonly MapMarker[];
  className?: string;
  /** Accessible name of the map region. */
  label: string;
};

/**
 * Marker map. The map library is loaded in the browser only, and a failure to
 * load it shows a notice instead of breaking the screen around it.
 */
export function MapView({ markers, className, label }: MapViewProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const layer = useRef<LayerGroup | null>(null);
  const fitted = useRef(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    import("leaflet")
      .then((L) => {
        if (cancelled || !container.current) return;
        const instance = L.map(container.current, { center: DEFAULT_VIEW.center, zoom: DEFAULT_VIEW.zoom });
        const tiles = L.tileLayer(TILE_LAYER.url, { attribution: TILE_LAYER.attribution, maxZoom: TILE_LAYER.maxZoom });
        tiles.addTo(instance);
        map.current = instance;
        layer.current = L.layerGroup().addTo(instance);
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      layer.current = null;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    void import("leaflet").then((L) => {
      const group = layer.current;
      if (cancelled || !group || !map.current) return;
      group.clearLayers();
      for (const marker of markers) {
        L.marker([marker.latitude, marker.longitude], {
          icon: L.divIcon({ html: markerElement(marker), className: "", iconSize: [0, 0] }),
          title: `${marker.title} — ${marker.label}`,
          alt: `${marker.title} — ${marker.label}`,
          keyboard: true,
        })
          .bindPopup(popupElement(marker))
          .addTo(group);
      }
      // Frame the markers once; later live updates keep the admin's own view.
      if (!fitted.current && markers.length > 0) {
        fitted.current = true;
        map.current.fitBounds(L.latLngBounds(markers.map((m) => [m.latitude, m.longitude])), { padding: [48, 48], maxZoom: 15 });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [markers, ready]);

  if (failed) {
    return (
      <div className={cn("flex items-center justify-center rounded-lg border bg-muted p-6 text-center text-sm text-muted-foreground", className)}>
        The map could not be loaded. Task monitoring remains available in the list.
      </div>
    );
  }
  return <div ref={container} role="region" aria-label={label} className={cn("z-0 overflow-hidden rounded-lg border", className)} />;
}
