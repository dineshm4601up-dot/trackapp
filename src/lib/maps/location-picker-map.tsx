"use client";

import "leaflet/dist/leaflet.css";

import { useEffect, useRef, useState } from "react";
import type { Circle, Map as LeafletMap, Marker } from "leaflet";

import { DEFAULT_VIEW, PICKER_ZOOM, TILE_LAYER } from "@/lib/maps/provider";
import { cn } from "@/lib/utils";

type Leaflet = typeof import("leaflet");
type Point = { latitude: number; longitude: number };

function pinElement() {
  const el = document.createElement("div");
  el.className = "size-5 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full bg-primary shadow-md ring-2 ring-white";
  return el;
}

type LocationPickerMapProps = {
  /** The selected point, or null when nothing valid is selected yet. */
  position: Point | null;
  /** Radius of the preview circle around the point; null hides it. */
  radiusMeters: number | null;
  /** Called when the point is chosen on the map itself (click or drag). */
  onPick: (latitude: number, longitude: number) => void;
  /** Accessible name of the map region. */
  label: string;
  className?: string;
};

/**
 * Single-point picker: click to place the pin, drag to adjust it, with a
 * circle showing the radius. The point is owned by the caller; this component
 * only draws it and reports where the user moved it.
 */
export function LocationPickerMap({ position, radiusMeters, onPick, label, className }: LocationPickerMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const leaflet = useRef<Leaflet | null>(null);
  const map = useRef<LeafletMap | null>(null);
  const marker = useRef<Marker | null>(null);
  const circle = useRef<Circle | null>(null);
  const pick = useRef(onPick);
  const pickedOnMap = useRef<Point | null>(null);
  const drawnRadius = useRef<number | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    pick.current = onPick;
  }, [onPick]);

  useEffect(() => {
    let cancelled = false;
    const report = (lat: number, lng: number) => {
      const point = { latitude: Math.max(-90, Math.min(90, lat)), longitude: lng };
      pickedOnMap.current = point;
      pick.current(point.latitude, point.longitude);
    };
    import("leaflet")
      .then((L) => {
        if (cancelled || !container.current) return;
        const instance = L.map(container.current, { center: DEFAULT_VIEW.center, zoom: DEFAULT_VIEW.zoom });
        L.tileLayer(TILE_LAYER.url, { attribution: TILE_LAYER.attribution, maxZoom: TILE_LAYER.maxZoom }).addTo(instance);
        instance.on("click", (event) => {
          const at = event.latlng.wrap();
          report(at.lat, at.lng);
        });
        const pin = L.marker(DEFAULT_VIEW.center, {
          icon: L.divIcon({ html: pinElement(), className: "", iconSize: [0, 0] }),
          draggable: true,
          keyboard: false, // the coordinate fields are the keyboard route
          title: "Drag to adjust the location",
          alt: "Selected location",
        });
        pin.on("drag", () => circle.current?.setLatLng(pin.getLatLng()));
        pin.on("dragend", () => {
          const at = pin.getLatLng().wrap();
          report(at.lat, at.lng);
        });
        leaflet.current = L;
        map.current = instance;
        marker.current = pin;
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      marker.current = null;
      circle.current = null;
      drawnRadius.current = null;
    };
  }, []);

  const latitude = position?.latitude ?? null;
  const longitude = position?.longitude ?? null;

  useEffect(() => {
    const L = leaflet.current;
    const instance = map.current;
    const pin = marker.current;
    if (!ready || !L || !instance || !pin) return;

    if (latitude === null || longitude === null) {
      pin.remove();
      circle.current?.remove();
      circle.current = null;
      drawnRadius.current = null;
      return;
    }

    const at = L.latLng(latitude, longitude);
    pin.setLatLng(at).addTo(instance);

    if (radiusMeters === null) {
      circle.current?.remove();
      circle.current = null;
    } else if (circle.current) {
      circle.current.setLatLng(at).setRadius(radiusMeters);
    } else {
      circle.current = L.circle(at, {
        radius: radiusMeters,
        weight: 2,
        fillOpacity: 0.12,
        interactive: false,
        className: "fill-primary stroke-primary",
      }).addTo(instance);
    }

    // A point chosen on the map keeps the admin's view; one that came from the
    // form, a search or the device is brought into view.
    const last = pickedOnMap.current;
    const cameFromMap = last !== null && Math.abs(last.latitude - latitude) < 1e-6 && Math.abs(last.longitude - longitude) < 1e-6;
    const radiusChanged = drawnRadius.current !== radiusMeters;
    drawnRadius.current = radiusMeters;
    if (!cameFromMap) instance.setView(at, Math.max(instance.getZoom(), PICKER_ZOOM));
    if (circle.current && (!cameFromMap || radiusChanged) && !instance.getBounds().contains(circle.current.getBounds())) {
      instance.fitBounds(circle.current.getBounds(), { padding: [24, 24] });
    }
  }, [latitude, longitude, radiusMeters, ready]);

  if (failed) {
    return (
      <div className={cn("flex items-center justify-center rounded-lg border bg-muted p-6 text-center text-sm text-muted-foreground", className)}>
        The map could not be loaded. You can still use your current location or type the coordinates.
      </div>
    );
  }
  return (
    <div className={cn("relative z-0 overflow-hidden rounded-lg border", className)}>
      <div ref={container} role="region" aria-label={label} className="absolute inset-0" />
      {!ready && (
        <p className="absolute inset-0 flex items-center justify-center bg-muted text-sm text-muted-foreground" role="status">
          Loading map…
        </p>
      )}
    </div>
  );
}
