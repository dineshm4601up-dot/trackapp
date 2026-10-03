"use client";

import { useCallback, useState, useTransition } from "react";
import { Loader2, LocateFixed, Search } from "lucide-react";

import { FormSection, TextField } from "@/components/shared/form-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { searchLocationPlaces } from "@/features/locations/actions";
import { GEOFENCE_DEFAULT, GEOFENCE_MAX, GEOFENCE_MIN } from "@/features/locations/schemas";
import { LocationPickerMap } from "@/lib/maps/location-picker-map";
import type { PlaceResult } from "@/lib/maps/types";
import { cn } from "@/lib/utils";

// Same contract as the server schema: numeric(10,7), both or neither.
const LATITUDE = /^-?\d{1,2}(\.\d{1,7})?$/;
const LONGITUDE = /^-?\d{1,3}(\.\d{1,7})?$/;
const LOW_ACCURACY_METERS = 100;

/** At most 7 decimals, without trailing zeros. */
function formatCoordinate(value: number) {
  const text = value.toFixed(7).replace(/\.?0+$/, "");
  return text === "-0" ? "0" : text;
}

function parse(text: string, pattern: RegExp, limit: number) {
  const trimmed = text.trim();
  if (!pattern.test(trimmed)) return null;
  const value = Number(trimmed);
  return Math.abs(value) <= limit ? value : null;
}

type Notice = { tone: "info" | "warning" | "error"; text: string };

const UNAVAILABLE = "Your device could not determine the current location. Please search for the location on the map.";
const GEOLOCATION_ERRORS: Record<number, string | undefined> = {
  1: "Unable to access your current location. Please allow location permission or select the location using the map.",
  2: UNAVAILABLE,
  3: "Finding your location took too long. Please try again or select the location using the map.",
};

type CoordinatePickerProps = {
  latitude: string;
  longitude: string;
  radius: string;
  errorFor: (field: string) => string | undefined;
};

/**
 * Coordinates and geofence radius of a location. The three inputs are the
 * existing form fields; the device location, the place search and the map are
 * only ways to fill them in. Nothing is saved until the form is submitted.
 */
export function CoordinatePicker({ latitude, longitude, radius: initialRadius, errorFor }: CoordinatePickerProps) {
  const [lat, setLat] = useState(latitude);
  const [lng, setLng] = useState(longitude);
  const [radius, setRadius] = useState(initialRadius);
  const [edited, setEdited] = useState(false);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationNotice, setLocationNotice] = useState<Notice | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceResult[] | null>(null);
  const [searchNotice, setSearchNotice] = useState<Notice | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [searching, startSearch] = useTransition();

  const latValue = parse(lat, LATITUDE, 90);
  const lngValue = parse(lng, LONGITUDE, 180);
  const position = latValue !== null && lngValue !== null ? { latitude: latValue, longitude: lngValue } : null;
  const radiusValue = /^\d{1,4}$/.test(radius.trim()) ? Number(radius) : null;
  const circleRadius = radiusValue !== null && radiusValue >= GEOFENCE_MIN && radiusValue <= GEOFENCE_MAX ? radiusValue : null;

  const empty = lat.trim() === "" && lng.trim() === "";
  const invalid = !empty && position === null;
  const message = (text: string, value: number | null, range: string) =>
    !invalid || value !== null ? undefined : text.trim() === "" ? "Both coordinates are needed." : `Please enter a valid ${range}`;
  // After an edit the live check replaces the server's message for the old value.
  const latError = message(lat, latValue, "latitude (−90 to 90, up to 7 decimals).") ?? (edited ? undefined : errorFor("latitude"));
  const lngError = message(lng, lngValue, "longitude (−180 to 180, up to 7 decimals).") ?? (edited ? undefined : errorFor("longitude"));

  const setPoint = (latitudeValue: number, longitudeValue: number) => {
    setLat(formatCoordinate(latitudeValue));
    setLng(formatCoordinate(longitudeValue));
    setEdited(true);
  };

  const pickOnMap = useCallback((latitudeValue: number, longitudeValue: number) => {
    setLat(formatCoordinate(latitudeValue));
    setLng(formatCoordinate(longitudeValue));
    setEdited(true);
    setAccuracy(null);
    setSelected(null);
    setLocationNotice(null);
  }, []);

  function locate() {
    if (!("geolocation" in navigator)) {
      setLocationNotice({ tone: "error", text: "This browser cannot provide a location. Please search for the location on the map." });
      return;
    }
    setLocating(true);
    setLocationNotice(null);
    // One reading, on request. The position is not watched or stored.
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocating(false);
        setPoint(coords.latitude, coords.longitude);
        setSelected(null);
        const meters = Math.round(coords.accuracy);
        setAccuracy(meters);
        setLocationNotice(
          meters > LOW_ACCURACY_METERS
            ? { tone: "warning", text: "The location accuracy is low. Check the pin on the map and drag it to the exact place." }
            : null,
        );
      },
      (error) => {
        setLocating(false);
        setLocationNotice({ tone: "error", text: GEOLOCATION_ERRORS[error.code] ?? UNAVAILABLE });
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }

  function search() {
    const text = query.trim();
    if (searching) return;
    if (text.length < 3) {
      setSearchNotice({ tone: "info", text: "Enter at least 3 characters to search." });
      return;
    }
    setSearchNotice(null);
    startSearch(async () => {
      try {
        const outcome = await searchLocationPlaces(text);
        if (!outcome.ok) {
          setResults(null);
          setSearchNotice({ tone: "error", text: outcome.message });
        } else {
          setResults(outcome.results);
          if (outcome.results.length === 0) setSearchNotice({ tone: "info", text: "No places found. Try a nearby landmark, the city or the postal code." });
        }
      } catch {
        setResults(null);
        setSearchNotice({ tone: "error", text: "Unable to search this location. Please try again." });
      }
    });
  }

  function choose(place: PlaceResult) {
    setPoint(place.latitude, place.longitude);
    setAccuracy(null);
    setLocationNotice(null);
    setSelected(place.label);
    setResults(null);
  }

  return (
    <FormSection
      title="Select location"
      description="Use your current location, search for the place, or click the map. Drag the pin to fine-tune. Agents must be within the geofence radius of this point to check in."
    >
      <div className="space-y-4" data-coordinates-invalid={invalid || undefined}>
        <TextField
          name="latitude"
          label="Latitude"
          inputMode="decimal"
          placeholder="11.341234"
          hint="−90 to 90, up to 7 decimals"
          value={lat}
          onChange={(e) => {
            setLat(e.target.value);
            setEdited(true);
            setAccuracy(null);
          }}
          error={latError}
        />
        <TextField
          name="longitude"
          label="Longitude"
          inputMode="decimal"
          placeholder="77.717823"
          hint="−180 to 180, up to 7 decimals"
          value={lng}
          onChange={(e) => {
            setLng(e.target.value);
            setEdited(true);
            setAccuracy(null);
          }}
          error={lngError}
        />
        <div className="space-y-2">
          <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={locate} disabled={locating}>
            {locating ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden /> : <LocateFixed data-icon="inline-start" aria-hidden />}
            {locating ? "Getting location…" : "Use current location"}
          </Button>
          <div aria-live="polite" className="space-y-1">
            {accuracy !== null && <p className="text-sm">Location accuracy: ±{accuracy} m</p>}
            {locationNotice && <NoticeText notice={locationNotice} />}
          </div>
        </div>
      </div>

      <div className="space-y-3 sm:row-span-2">
        <div className="space-y-2">
          <Label htmlFor="place-search">Find location</Label>
          <div className="flex gap-2">
            <Input
              id="place-search"
              type="search"
              className="h-10"
              placeholder="Address, place, landmark, PIN code…"
              maxLength={200}
              autoComplete="off"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault(); // search, do not submit the location form
                search();
              }}
            />
            <Button type="button" variant="outline" className="h-10" onClick={search} disabled={searching}>
              {searching ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden /> : <Search data-icon="inline-start" aria-hidden />}
              {searching ? "Searching…" : "Search"}
            </Button>
          </div>
          <div aria-live="polite" className="space-y-2">
            {searchNotice && <NoticeText notice={searchNotice} />}
            {results && results.length > 0 && (
              <ul className="divide-y rounded-lg border" aria-label="Search results">
                {results.map((place) => (
                  <li key={place.id}>
                    <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none" onClick={() => choose(place)}>
                      {place.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {selected && <p className="text-xs text-muted-foreground">Selected: {selected}</p>}
          </div>
        </div>
        <LocationPickerMap position={position} radiusMeters={circleRadius} onPick={pickOnMap} label="Location map" className="h-72 sm:h-80" />
        <p className="text-xs text-muted-foreground">
          {position
            ? `Pin at ${formatCoordinate(position.latitude)}, ${formatCoordinate(position.longitude)}${circleRadius ? ` · circle shows the ${circleRadius} m geofence` : ""}. Click the map or drag the pin to move it.`
            : "Click anywhere on the map to select the location."}
        </p>
      </div>

      <TextField
        name="geofence_radius_meters"
        label="Geofence radius (metres)"
        inputMode="numeric"
        hint={`Allowed range: ${GEOFENCE_MIN}–${GEOFENCE_MAX} m. Default: ${GEOFENCE_DEFAULT} m.`}
        value={radius}
        onChange={(e) => setRadius(e.target.value)}
        error={
          radius === initialRadius
            ? errorFor("geofence_radius_meters")
            : circleRadius === null && radius.trim() !== ""
              ? `Enter a whole number from ${GEOFENCE_MIN} to ${GEOFENCE_MAX}.`
              : undefined
        }
      />
    </FormSection>
  );
}

function NoticeText({ notice }: { notice: Notice }) {
  return (
    <p className={cn("text-sm", notice.tone === "error" ? "text-destructive" : notice.tone === "warning" ? "text-warning" : "text-muted-foreground")}>
      {notice.text}
    </p>
  );
}
