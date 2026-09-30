"use client";

import { RouteError, type RouteErrorProps } from "@/components/shared/route-error";

export default function AgentError(props: RouteErrorProps) {
  return <RouteError {...props} />;
}
