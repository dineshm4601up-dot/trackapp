import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { adminNav, plannedSections } from "@/config/navigation";

// Temporary placeholder for sidebar modules not yet built. Each module's real
// static route (e.g. app/admin/agents/page.tsx) takes precedence over this one.
const sections = plannedSections(adminNav, "/admin");

export const dynamicParams = false;

export function generateStaticParams() {
  return sections.map(({ section }) => ({ section }));
}

async function getSection(params: PageProps<"/admin/[section]">["params"]) {
  const { section } = await params;
  const item = sections.find((s) => s.section === section);
  if (!item) notFound();
  return item;
}

export async function generateMetadata(props: PageProps<"/admin/[section]">): Promise<Metadata> {
  const item = await getSection(props.params);
  return { title: item.title };
}

export default async function AdminSectionPlaceholder(props: PageProps<"/admin/[section]">) {
  const item = await getSection(props.params);

  return (
    <>
      <PageHeader title={item.title} />
      <EmptyState
        icon={item.icon}
        title={`${item.title} is not built yet`}
        description={`This module is planned for Phase ${item.plannedPhase}.`}
      />
    </>
  );
}
