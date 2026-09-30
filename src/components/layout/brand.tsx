import Link from "next/link";
import { Route } from "lucide-react";

import { siteConfig } from "@/config/site";

export function Brand({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 font-semibold tracking-tight">
      <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <Route className="size-4" aria-hidden />
      </span>
      {siteConfig.name}
    </Link>
  );
}
