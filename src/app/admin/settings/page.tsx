import type { Metadata } from "next";
import Link from "next/link";
import { Bell, Sparkles } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdmin } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Settings" };

const SECTIONS = [
  { href: "/admin/settings/ai", title: "AI", description: "Feature switches, models, runs, usage and evaluation.", icon: Sparkles },
  { href: "/admin/notifications?view=settings", title: "Notifications", description: "Your notification preferences and channel status.", icon: Bell },
];

export default async function SettingsPage() {
  await requireAdmin();
  return (
    <>
      <PageHeader title="Settings" />
      <ul className="grid gap-3 sm:grid-cols-2">
        {SECTIONS.map((section) => (
          <li key={section.href}>
            <Link href={section.href} className="block h-full rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
              <Card size="sm" className="h-full transition-colors hover:bg-muted/50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <section.icon className="size-4" aria-hidden />
                    {section.title}
                  </CardTitle>
                  <CardDescription>{section.description}</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
