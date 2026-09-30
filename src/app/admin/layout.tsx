import type { Metadata } from "next";

import { AdminHeader } from "@/components/layout/admin-header";
import { AdminNav } from "@/components/layout/admin-nav";
import { Brand } from "@/components/layout/brand";
import { SkipLink } from "@/components/layout/skip-link";
import { siteConfig } from "@/config/site";

export const metadata: Metadata = {
  title: { default: "Admin", template: `%s · Admin · ${siteConfig.name}` },
};

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="flex min-h-dvh">
      <SkipLink />
      <aside className="hidden w-64 shrink-0 border-r bg-sidebar text-sidebar-foreground lg:block">
        <div className="sticky top-0 flex h-dvh flex-col">
          <div className="flex h-14 items-center border-b px-4">
            <Brand href="/admin" />
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            <AdminNav />
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <AdminHeader />
        <main id="main" className="flex-1 p-4 md:p-6 lg:p-8">
          <div className="mx-auto w-full max-w-7xl space-y-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
