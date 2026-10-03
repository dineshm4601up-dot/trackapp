import type { Metadata } from "next";
import Link from "next/link";
import {
  Banknote,
  Building2,
  ChartColumn,
  ClipboardList,
  MapPin,
  MapPinCheck,
  Package,
  ShieldAlert,
  TriangleAlert,
  Users,
  type LucideIcon,
} from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { siteConfig } from "@/config/site";
import { KPI_DEFINITIONS } from "@/lib/analytics/definitions";
import { requireAdmin } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Reports" };

const REPORTS: { href: string; title: string; description: string; icon: LucideIcon }[] = [
  { href: "/admin/analytics", title: "Analytics overview", description: "KPIs, trends, breakdowns and exceptions for a period.", icon: ChartColumn },
  { href: "/admin/reports/tasks", title: "Tasks", description: "Every task with its outcome and timing, plus time between stages.", icon: ClipboardList },
  { href: "/admin/reports/agents", title: "Agents", description: "Workload, outcomes, on-time and timing per agent.", icon: Users },
  { href: "/admin/reports/deliveries", title: "Deliveries", description: "Assigned, delivered and outstanding quantity per product.", icon: Package },
  { href: "/admin/reports/cash", title: "Cash", description: "Expected, collected and outstanding, with reconciliation.", icon: Banknote },
  { href: "/admin/reports/checkins", title: "Check-ins", description: "Accepted and rejected GPS check-ins by day, agent and location.", icon: MapPinCheck },
  { href: "/admin/reports/customers", title: "Customers", description: "Tasks, deliveries and cash per customer.", icon: Building2 },
  { href: "/admin/reports/locations", title: "Locations", description: "Volume, completion and check-in success per location.", icon: MapPin },
  { href: "/admin/reports/exceptions", title: "Exceptions", description: "Overdue, failed, short, unpaid and unproven work.", icon: TriangleAlert },
  { href: "/admin/reports/data-quality", title: "Data quality", description: "Inconsistent or incomplete records to review.", icon: ShieldAlert },
];

export default async function ReportsPage() {
  await requireAdmin();
  return (
    <>
      <PageHeader title="Reports" description="Each report can be filtered by period, agent, customer, location, task type, status and priority, and exported to CSV or Excel." />
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {REPORTS.map((report) => (
          <li key={report.href}>
            <Link href={report.href} className="block h-full rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
              <Card size="sm" className="h-full transition-colors hover:bg-muted/50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <report.icon className="size-4" aria-hidden />
                    {report.title}
                  </CardTitle>
                  <CardDescription>{report.description}</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
      <section aria-labelledby="definitions" className="space-y-2">
        <h2 id="definitions" className="text-lg font-semibold">
          How the numbers are defined
        </h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {Object.values(KPI_DEFINITIONS).map((definition) => (
            <li key={definition}>{definition}</li>
          ))}
          <li>All dates and times use the business time zone ({siteConfig.timeZone}).</li>
          <li>A rate with nothing to divide by is shown as N/A, never as 0%.</li>
        </ul>
      </section>
    </>
  );
}
