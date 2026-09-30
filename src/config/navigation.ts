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

export const adminNav: NavItem[] = [
  { title: "Dashboard", href: "/admin", icon: LayoutDashboard },
  { title: "Agents", href: "/admin/agents", icon: Users, plannedPhase: 4 },
  { title: "Customers", href: "/admin/customers", icon: Building2, plannedPhase: 4 },
  { title: "Locations", href: "/admin/locations", icon: MapPin, plannedPhase: 4 },
  { title: "Products", href: "/admin/products", icon: Package, plannedPhase: 4 },
  { title: "Tasks", href: "/admin/tasks", icon: ClipboardList, plannedPhase: 5 },
  { title: "Monitoring", href: "/admin/monitoring", icon: Activity, plannedPhase: 11 },
  { title: "Reports", href: "/admin/reports", icon: ChartColumn, plannedPhase: 12 },
  { title: "Settings", href: "/admin/settings", icon: Settings, plannedPhase: 4 },
];

export const agentNav: NavItem[] = [
  { title: "Home", href: "/agent", icon: House },
  { title: "Tasks", href: "/agent/tasks", icon: ListChecks, plannedPhase: 6 },
  { title: "History", href: "/agent/history", icon: History, plannedPhase: 6 },
  { title: "Profile", href: "/agent/profile", icon: UserRound, plannedPhase: 6 },
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
