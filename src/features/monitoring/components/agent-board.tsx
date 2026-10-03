import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { LocationAge } from "@/features/monitoring/components/live-time";
import { agentState } from "@/features/monitoring/config";
import type { AgentBoardRow } from "@/features/monitoring/queries";
import { businessToday } from "@/lib/format";
import { siteConfig } from "@/config/site";

const TONE_BADGE = { info: "info", success: "success", warning: "warning", muted: "secondary" } as const;

const dayFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: siteConfig.timeZone, year: "numeric", month: "2-digit", day: "2-digit" });

/** True when the instant falls on today's date in the business time zone. */
export function isBusinessToday(instant: string) {
  return dayFormatter.format(new Date(instant)) === businessToday();
}

/** Each active agent's operational status, derived from their tasks and last location time. */
export function AgentBoard({ agents }: { agents: AgentBoardRow[] }) {
  if (agents.length === 0) return <p className="text-sm text-muted-foreground">No active agents.</p>;
  return (
    <ul className="divide-y" aria-label="Agent status">
      {agents.map((agent) => {
        const state = agentState(agent, isBusinessToday);
        return (
          <li key={agent.id} className="flex items-start justify-between gap-3 py-2.5 text-sm first:pt-0 last:pb-0">
            <div className="min-w-0">
              <p className="truncate font-medium">{agent.full_name ?? agent.employee_code ?? "Agent"}</p>
              <p className="truncate text-xs text-muted-foreground">
                {agent.current_task_id ? (
                  <Link href={`/admin/tasks/${agent.current_task_id}`} className="font-mono hover:underline">
                    {agent.current_task_code}
                  </Link>
                ) : (
                  "No open task"
                )}
                {(agent.open_tasks ?? 0) > 1 && ` · +${(agent.open_tasks ?? 1) - 1} more`}
              </p>
              {state.tracked && (
                <p className="text-xs">
                  <LocationAge at={agent.last_location_at} />
                </p>
              )}
            </div>
            <Badge variant={TONE_BADGE[state.tone]}>{state.label}</Badge>
          </li>
        );
      })}
    </ul>
  );
}
