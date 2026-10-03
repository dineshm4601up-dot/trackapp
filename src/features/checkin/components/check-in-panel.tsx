"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, Loader2, LocateFixed, MapPinCheck, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { checkInMyTask } from "@/features/checkin/actions";
import { DEVICE_ID_STORAGE_KEY, GEOLOCATION_OPTIONS } from "@/features/checkin/config";
import { isNetworkError } from "@/lib/network";

type Phase =
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "validating" }
  | { kind: "error"; title: string; message: string; detail?: string };

/** Optional random id per browser; informational only. Storage may be unavailable. */
function deviceId() {
  try {
    let id = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(DEVICE_ID_STORAGE_KEY, id);
    }
    return id;
  } catch {
    return undefined;
  }
}

function currentPosition() {
  return new Promise<GeolocationPosition>((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, reject, GEOLOCATION_OPTIONS),
  );
}

const GEO_ERRORS: Record<number, { title: string; message: string }> = {
  1: {
    title: "Location permission needed",
    message: "Location permission is required to check in. Please allow location access in your browser settings and try again.",
  },
  2: {
    title: "Location unavailable",
    message: "Your current location could not be determined. Please move to an area with better GPS signal and try again.",
  },
  3: { title: "Location timed out", message: "Location detection timed out. Please try again." },
};

/**
 * GPS check-in for an ARRIVED task. Location permission is requested only when
 * the agent taps the button. The server decides whether the reading is inside
 * the geofence; nothing is shown as successful until it confirms.
 */
export function CheckInPanel({ taskId }: { taskId: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const busy = useRef(false);

  async function checkIn() {
    if (busy.current) return; // no duplicate submissions
    busy.current = true;
    try {
      if (!("geolocation" in navigator) || !window.isSecureContext) {
        setPhase({
          kind: "error",
          title: "Location not available",
          message: "This browser can't provide your location. Open the app over a secure (https) connection in Chrome or Safari.",
        });
        return;
      }

      setPhase({ kind: "locating" });
      let position: GeolocationPosition;
      try {
        position = await currentPosition();
      } catch (error) {
        const code = (error as GeolocationPositionError).code;
        setPhase({ kind: "error", ...(GEO_ERRORS[code] ?? GEO_ERRORS[2]!) });
        return;
      }

      setPhase({ kind: "validating" });
      let result;
      try {
        result = await checkInMyTask({
          taskId,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          capturedAt: Math.round(position.timestamp),
          deviceId: deviceId(),
        });
      } catch (error) {
        if (!isNetworkError(error)) throw error;
        setPhase({
          kind: "error",
          title: "Check-in not confirmed",
          message: "We could not confirm your check-in. Please check your internet connection and try again.",
        });
        router.refresh(); // re-read the real task state before another attempt
        return;
      }

      if (result.success) {
        toast.success("Check-in successful");
        setPhase({ kind: "idle" });
        router.refresh();
        return;
      }

      const titles: Partial<Record<typeof result.code, string>> = {
        OUTSIDE_GEOFENCE: "Outside check-in area",
        GPS_ACCURACY_TOO_LOW: "GPS accuracy too low",
      };
      setPhase({
        kind: "error",
        title: titles[result.code] ?? "Check-in failed",
        message: result.message,
        detail:
          result.code === "OUTSIDE_GEOFENCE" && result.distanceMeters !== undefined
            ? `Detected distance: about ${result.distanceMeters} m · Required: within ${result.radiusMeters} m`
            : undefined,
      });
      if (["CHECKIN_ALREADY_EXISTS", "INVALID_TASK_STATUS", "TASK_NOT_FOUND"].includes(result.code)) router.refresh();
    } finally {
      busy.current = false;
    }
  }

  const working = phase.kind === "locating" || phase.kind === "validating";
  const status =
    phase.kind === "locating"
      ? "Getting your current location…"
      : phase.kind === "validating"
        ? "Validating your location…"
        : phase.kind === "idle"
          ? "Ready to check in"
          : phase.title;

  return (
    <div className="space-y-2">
      <p className="sr-only" role="status" aria-live="polite">
        {status}
      </p>
      {phase.kind === "error" && (
        <Alert variant="destructive" role="alert">
          <CircleAlert aria-hidden />
          <AlertTitle>{phase.title}</AlertTitle>
          <AlertDescription>
            <p>{phase.message}</p>
            {phase.detail && <p className="font-medium">{phase.detail}</p>}
          </AlertDescription>
        </Alert>
      )}
      <Button size="xl" className="w-full" onClick={checkIn} disabled={working}>
        {working ? (
          <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden />
        ) : phase.kind === "error" ? (
          <RotateCcw data-icon="inline-start" aria-hidden />
        ) : (
          <LocateFixed data-icon="inline-start" aria-hidden />
        )}
        {working ? status : phase.kind === "error" ? "Try Again" : "Check In at Location"}
      </Button>
      {phase.kind === "idle" && (
        <p className="flex items-start justify-center gap-1.5 text-center text-xs text-muted-foreground">
          <MapPinCheck className="mt-px size-3.5 shrink-0" aria-hidden />
          Check-in required. Your location is used once, only to confirm you are at the site.
        </p>
      )}
    </div>
  );
}
