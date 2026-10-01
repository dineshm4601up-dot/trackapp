import type { Metadata } from "next";
import Link from "next/link";
import { CircleCheck, ClipboardList, Clock, Users } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Admin Dashboard" };

type FoundationItem = {
  area: string;
  state: "ready" | "planned";
  detail: string;
};

const stateBadge = {
  ready: { label: "Ready", variant: "success" },
  planned: { label: "Planned", variant: "outline" },
} as const;

const items: FoundationItem[] = [
  { area: "Next.js App Router", state: "ready", detail: "TypeScript strict, Tailwind, shadcn/ui" },
  { area: "Admin & agent layouts", state: "ready", detail: "Sidebar shell and mobile bottom navigation" },
  { area: "Authentication & roles", state: "ready", detail: "Supabase Auth, profiles, role-based routes" },
  { area: "Database & RLS", state: "planned", detail: "Phase 3" },
];

export default async function AdminDashboardPage() {
  const { profile } = await requireAdmin();

  return (
    <>
      <PageHeader
        title={`Welcome, ${profile.full_name ?? profile.email ?? "Administrator"}`}
        description={`Role: ${profile.role}`}
        actions={
          <Button variant="outline" asChild>
            <Link href="/status">System status</Link>
          </Button>
        }
      />

      <section aria-label="Today at a glance" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Tasks today" value="—" icon={ClipboardList} hint="Available from Phase 5" />
        <StatCard label="In progress" value="—" icon={Clock} hint="Available from Phase 5" />
        <StatCard label="Completed" value="—" icon={CircleCheck} hint="Available from Phase 5" />
        <StatCard label="Active agents" value="—" icon={Users} hint="Available from Phase 4" />
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Foundation status</CardTitle>
          <CardDescription>What this build includes so far.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Area</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden sm:table-cell">Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.area}>
                  <TableCell className="font-medium">{item.area}</TableCell>
                  <TableCell>
                    <Badge variant={stateBadge[item.state].variant}>
                      {stateBadge[item.state].label}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">
                    {item.detail}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
