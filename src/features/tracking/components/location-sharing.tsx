"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LocateFixed, LocateOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { recordMyLocation } from "@/features/tracking/actions";
import { LOCATION_FRESH_MS, LOCATION_SEND_INTERVAL_MS, WATCH_OPTIONS } from "@/features/tracking/config";
import { formatWallTimeOfInstant } from "@/lib/format";
import { isNetworkError } from "@/lib/network";

type Phase = "checking" | "prompt" | "active" | "denied" | "unavailable";

/**
 * Task-scoped location sharing. Rendered only while the task is in an active
 * field state, so the GPS watcher exists only for that task and is cleared
 * when the task ends or this screen is left. The agent always sees whether
 * sharing is on; nothing runs in the background or outside this component.
 */
export function LocationSharing({ taskId }: { taskId: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("checking");
  const [lastSharedAt, setLastSharedAt] = useState<string | null>(null);
  const [problem, setProblem] = useState<"gps" | "network" | null>(null);

  // Coordinates live in refs: a new GPS fix never re-renders anything.
  const watchId = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const latest = useRef<GeolocationPosition | null>(null);
  const sending = useRef(false);
  const sentOnce = useRef(false);

  const stop = useCallback(() => {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    if (timer.current !== null) clearInterval(timer.current);
    watchId.current = null;
    timer.current = null;
    latest.current = null;
  }, []);

  const send = useCallback(
    async (position: GeolocationPosition) => {
      if (sending.current) return;
      sending.current = true;
      try {
        const result = await recordMyLocation({
          taskId,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          capturedAt: Math.round(position.timestamp),
        });
        if (result.ok) {
          setProblem(null);
          // Only a stored event counts as shared.
          if (result.outcome === "stored") setLastSharedAt(new Date().toISOString());
        } else if (result.stop) {
          // The task ended, was cancelled or reassigned: stop and show its real state.
          stop();
          router.refresh();
        } else {
          setProblem("gps");
        }
      } catch (error) {
        if (!isNetworkError(error)) throw error;
        setProblem("network"); // not stored; the next scheduled update tries again
      } finally {
        sending.current = false;
      }
    },
    [router, stop, taskId],
  );

  const start = useCallback(() => {
    if (watchId.current !== null) return; // never more than one watcher
    setPhase("active");
    watchId.current = navigator.geolocation.watchPosition(
      (position) => {
        latest.current = position;
        if (!sentOnce.current) {
          sentOnce.current = true;
          void send(position);
        }
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          stop();
          setPhase("denied");
        } else {
          setProblem("gps");
        }
      },
      WATCH_OPTIONS,
    );
    timer.current = setInterval(() => {
      const position = latest.current;
      if (position && Date.now() - position.timestamp <= LOCATION_FRESH_MS) {
        void send(position);
        return;
      }
      // Stationary devices may not get new fixes from the watcher: ask once.
      navigator.geolocation.getCurrentPosition(
        (fresh) => {
          if (watchId.current === null) return; // stopped meanwhile
          latest.current = fresh;
          void send(fresh);
        },
        () => setProblem("gps"),
        WATCH_OPTIONS,
      );
    }, LOCATION_SEND_INTERVAL_MS);
  }, [send, stop]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!("geolocation" in navigator) || !window.isSecureContext) {
        if (!cancelled) setPhase("unavailable");
        return;
      }
      // Start without a prompt only when the agent has already allowed location.
      let state: PermissionState = "prompt";
      try {
        state = (await navigator.permissions.query({ name: "geolocation" })).state;
      } catch {
        // Permissions API unavailable: ask through the button.
      }
      if (cancelled) return;
      if (state === "granted") start();
      else setPhase(state === "denied" ? "denied" : "prompt");
    })();
    return () => {
      cancelled = true;
      stop(); // leaving the task screen, or the task is no longer active
    };
  }, [start, stop]);

  const active = phase === "active";
  return (
    <Card size="sm" role="status" aria-label="Location sharing">
      <CardContent className="flex items-start gap-3">
        <span
          className={
            active && !problem
              ? "flex size-9 shrink-0 items-center justify-center rounded-full bg-success/10 text-success"
              : "flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
          }
        >
          {active ? <LocateFixed className="size-5" aria-hidden /> : <LocateOff className="size-5" aria-hidden />}
        </span>
        <div className="min-w-0 flex-1 space-y-1 text-sm">
          <p className="font-medium">Location Sharing</p>
          {phase === "checking" && <p className="text-muted-foreground">Checking…</p>}
          {active && (
            <>
              <p className={problem ? "text-warning" : "text-success"}>
                {problem === "gps"
                  ? "Location unavailable"
                  : problem === "network"
                    ? "● Active — last update not sent, retrying"
                    : "● Active for this task"}
              </p>
              <p className="text-muted-foreground">
                {lastSharedAt ? `Last shared ${formatWallTimeOfInstant(lastSharedAt)}. ` : ""}
                Shared with your administrator only while this task is active and this screen is open.
              </p>
            </>
          )}
          {phase === "prompt" && (
            <>
              <p className="text-muted-foreground">
                Not active. Share your location for this task so your administrator can follow its progress. Sharing stops
                when the task ends.
              </p>
              <Button type="button" size="sm" variant="outline" onClick={start}>
                <LocateFixed data-icon="inline-start" aria-hidden />
                Share location for this task
              </Button>
            </>
          )}
          {phase === "denied" && (
            <p className="text-muted-foreground">
              Location sharing is unavailable. Please allow location access to provide live task location updates.
            </p>
          )}
          {phase === "unavailable" && (
            <p className="text-muted-foreground">Location unavailable. This browser can&apos;t provide your location.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
