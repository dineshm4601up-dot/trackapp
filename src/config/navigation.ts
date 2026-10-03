import {
  Activity,
  Building2,
  ChartColumn,
  ClipboardList,
  History,
  House,
  LayoutDashboard,
  ListChecks,
  MapPin,
  Package,
  Settings,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
  /** Development phase that builds this module; absent once it exists. */
  plannedPhase?: number;
};

export type NavGroup = { label?: string; items: NavItem[] };

export const adminNavGroups: NavGroup[] = [
  { items: [{ title: "Dashboard", href: "/admin", icon: LayoutDashboard }] },
  {
    label: "Master data",
    items: [
      { title: "Agents", href: "/admin/agents", icon: Users },
      { title: "Customers", href: "/admin/customers", icon: Building2 },
      { title: "Locations", href: "/admin/locations", icon: MapPin },
      { title: "Products", href: "/admin/products", icon: Package },
    ],
  },
  {
    label: "Operations",
    items: [
      { title: "Tasks", href: "/admin/tasks", icon: ClipboardList },
      { title: "Monitoring", href: "/admin/monitoring", icon: Activity, plannedPhase: 11 },
      { title: "Reports", href: "/admin/reports", icon: ChartColumn, plannedPhase: 12 },
    ],
  },
  { label: "System", items: [{ title: "Settings", href: "/admin/settings", icon: Settings, plannedPhase: 12 }] },
];

export const adminNav: NavItem[] = adminNavGroups.flatMap((group) => group.items);

export const agentNav: NavItem[] = [
  { title: "Home", href: "/agent", icon: House },
  { title: "Tasks", href: "/agent/tasks", icon: ListChecks },
  { title: "History", href: "/agent/history", icon: History },
  { title: "Profile", href: "/agent/profile", icon: UserRound },
];

/** The section root (first item) matches exactly; others match their subtree. */
export function isNavItemActive(items: NavItem[], href: string, pathname: string) {
  if (href === items[0]?.href) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Placeholder sections that don't have their own route yet. */
export function plannedSections(items: NavItem[], basePath: string) {
  return items
    .filter((item) => item.plannedPhase !== undefined)
    .map((item) => ({ ...item, section: item.href.slice(basePath.length + 1) }));
}
