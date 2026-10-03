import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

// Feature flags have two layers, and a feature runs only if both allow it:
//  * environment (deployment-level kill switch; default on) — AI_FEATURES_ENABLED,
//    AI_TASK_RISK_ENABLED, AI_ETA_ENABLED, AI_FORECAST_ENABLED,
//    AI_ANOMALIES_ENABLED, AI_RECOMMENDATIONS_ENABLED, AI_SUMMARY_ENABLED
//  * ai_settings (admin-controlled at /admin/settings/ai)
// With everything off, the rest of the application is unaffected.

export const AI_FEATURES = [
  { key: "task_risk", label: "Task risk", env: "AI_TASK_RISK_ENABLED" },
  { key: "eta", label: "Estimated completion", env: "AI_ETA_ENABLED" },
  { key: "forecast", label: "Workload forecast", env: "AI_FORECAST_ENABLED" },
  { key: "anomalies", label: "Anomaly detection", env: "AI_ANOMALIES_ENABLED" },
  { key: "recommendations", label: "Recommendations", env: "AI_RECOMMENDATIONS_ENABLED" },
  { key: "summary", label: "Operational summary", env: "AI_SUMMARY_ENABLED" },
] as const;
export type AiFeatureKey = (typeof AI_FEATURES)[number]["key"];

const envOn = (name: string) => !["false", "0", "off", "no"].includes((process.env[name] ?? "true").trim().toLowerCase());

export type AiFlags = {
  /** Master switch (environment and settings). */
  enabled: boolean;
  /** Why the master switch is off, if it is. */
  disabledBy: "environment" | "settings" | null;
  features: Record<AiFeatureKey, { enabled: boolean; setting: boolean; environment: boolean }>;
  master: { setting: boolean; environment: boolean };
};

export async function getAiFlags(supabase: SupabaseClient<Database>): Promise<AiFlags> {
  const { data } = await supabase.from("ai_settings").select("key, enabled");
  const setting = (key: string) => data?.find((row) => row.key === key)?.enabled ?? false;
  const master = { setting: setting("ai_enabled"), environment: envOn("AI_FEATURES_ENABLED") };
  const enabled = master.setting && master.environment;
  const features = Object.fromEntries(
    AI_FEATURES.map((feature) => {
      const state = { setting: setting(feature.key), environment: envOn(feature.env) };
      return [feature.key, { ...state, enabled: enabled && state.setting && state.environment }];
    }),
  ) as AiFlags["features"];
  return { enabled, disabledBy: master.environment ? (master.setting ? null : "settings") : "environment", features, master };
}
