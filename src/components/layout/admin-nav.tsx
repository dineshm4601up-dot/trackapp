"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { adminNav, isNavItemActive } from "@/config/navigation";
import { cn } from "@/lib/utils";

export function AdminNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Admin">
      <ul className="flex flex-col gap-1">
        {adminNav.map(({ title, href, icon: Icon }) => {
          const active = isNavItemActive(adminNav, href, pathname);
          return (
            <li key={href}>
              <Link
                href={href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-9 items-center gap-3 rounded-lg px-3 text-sm font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  active && "bg-sidebar-accent text-sidebar-accent-foreground",
                )}
              >
                <Icon className="size-4" aria-hidden />
                {title}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
