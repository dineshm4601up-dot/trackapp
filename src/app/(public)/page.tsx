import Link from "next/link";
import { Activity, ArrowRight, LayoutDashboard, Smartphone, type LucideIcon } from "lucide-react";

import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { siteConfig } from "@/config/site";

const entryPoints: { title: string; description: string; href: string; icon: LucideIcon }[] = [
  {
    title: "Admin console",
    description: "Manage agents, customers and tasks, and monitor field work.",
    href: "/admin",
    icon: LayoutDashboard,
  },
  {
    title: "Agent app",
    description: "Mobile view for agents to run their assigned tasks.",
    href: "/agent",
    icon: Smartphone,
  },
  {
    title: "System status",
    description: "Check the connection to Supabase from server and browser.",
    href: "/status",
    icon: Activity,
  },
];

export default function HomePage() {
  return (
    <div className="space-y-10">
      <div className="max-w-2xl space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{siteConfig.name}</h1>
        <p className="text-lg text-muted-foreground">{siteConfig.description}</p>
      </div>

      <ul className="grid gap-4 md:grid-cols-3">
        {entryPoints.map(({ title, description, href, icon: Icon }) => (
          <li key={href}>
            <Link href={href} className="group block h-full rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
              <Card className="h-full transition-colors group-hover:bg-muted/50">
                <CardHeader>
                  <Icon className="mb-2 size-5 text-muted-foreground" aria-hidden />
                  <CardTitle className="flex items-center gap-1">
                    {title}
                    <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </CardTitle>
                  <CardDescription>{description}</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
