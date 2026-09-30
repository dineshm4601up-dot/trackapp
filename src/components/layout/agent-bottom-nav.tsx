"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { agentNav, isNavItemActive } from "@/config/navigation";
import { cn } from "@/lib/utils";

export function AgentBottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Agent"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-background/80"
    >
      <ul className="mx-auto grid max-w-md grid-cols-4 md:max-w-lg">
        {agentNav.map(({ title, href, icon: Icon }) => {
          const active = isNavItemActive(agentNav, href, pathname);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-medium text-muted-foreground transition-colors active:bg-muted",
                  active && "text-foreground",
                )}
              >
                <Icon className={cn("size-6", active && "stroke-[2.5]")} aria-hidden />
                {title}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
