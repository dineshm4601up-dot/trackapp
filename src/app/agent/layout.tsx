import type { Metadata } from "next";

import { AgentBottomNav } from "@/components/layout/agent-bottom-nav";
import { AgentHeader } from "@/components/layout/agent-header";
import { SkipLink } from "@/components/layout/skip-link";
import { siteConfig } from "@/config/site";

export const metadata: Metadata = {
  title: { default: "Agent", template: `%s · ${siteConfig.name}` },
};

// Mobile-first: a single phone-width column, centred on larger screens.
export default function AgentLayout({ children }: LayoutProps<"/agent">) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col md:max-w-lg md:border-x">
      <SkipLink />
      <AgentHeader />
      <main
        id="main"
        className="flex-1 space-y-6 px-4 pt-4 pb-[calc(5rem+env(safe-area-inset-bottom))]"
      >
        {children}
      </main>
      <AgentBottomNav />
    </div>
  );
}
