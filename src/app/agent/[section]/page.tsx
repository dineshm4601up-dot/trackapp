import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { agentNav, plannedSections } from "@/config/navigation";

// Temporary placeholder for agent screens not yet built. Each screen's real
// static route (e.g. app/agent/tasks/page.tsx) takes precedence over this one.
const sections = plannedSections(agentNav, "/agent");

export const dynamicParams = false;

export function generateStaticParams() {
  return sections.map(({ section }) => ({ section }));
}

async function getSection(params: PageProps<"/agent/[section]">["params"]) {
  const { section } = await params;
  const item = sections.find((s) => s.section === section);
  if (!item) notFound();
  return item;
}

export async function generateMetadata(props: PageProps<"/agent/[section]">): Promise<Metadata> {
  const item = await getSection(props.params);
  return { title: item.title };
}

export default async function AgentSectionPlaceholder(props: PageProps<"/agent/[section]">) {
  const item = await getSection(props.params);

  return (
    <>
      <PageHeader title={item.title} />
      <EmptyState
        icon={item.icon}
        title={`${item.title} is coming soon`}
        description={`This screen is planned for Phase ${item.plannedPhase}.`}
      />
    </>
  );
}
