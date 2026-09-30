"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export type RouteErrorProps = {
  error: Error & { digest?: string };
  retry: () => void;
};

/**
 * Fallback for `error.tsx` boundaries. Never shows the raw error message:
 * in production, server errors only expose a digest to match server logs.
 */
export function RouteError({ error, retry }: RouteErrorProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto w-full max-w-lg py-10">
      <Alert variant="destructive">
        <TriangleAlert aria-hidden />
        <AlertTitle>Something went wrong</AlertTitle>
        <AlertDescription>
          <p>This page could not be loaded. Please try again.</p>
          {error.digest && <p className="font-mono text-xs">Reference: {error.digest}</p>}
        </AlertDescription>
      </Alert>
      <Button className="mt-4" variant="outline" onClick={() => retry()}>
        Try again
      </Button>
    </div>
  );
}
