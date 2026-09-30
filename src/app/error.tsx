"use client";

import { RouteError, type RouteErrorProps } from "@/components/shared/route-error";

export default function RootError(props: RouteErrorProps) {
  return (
    <main className="px-4">
      <RouteError {...props} />
    </main>
  );
}
