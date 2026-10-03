# AI decision support (Phase 12)

The AI layer turns the operational data of Phases 1–11 into estimates and recommendations for administrators. It is **advisory**: it explains what it estimates, says how well-supported the estimate is, and never changes a task, an assignment, a schedule, a payment, a quantity or a check-in. An administrator decides.

**Status of every model: experimental.** Version 1 uses transparent statistics over your own history, not trained machine-learning models, because that is the simplest method that is honest at the current data volume. No accuracy is claimed anywhere until enough predictions have known outcomes.

## Architecture

```text
Operational tables
      ↓
report_task_facts()  (Phase 11)
      ↓
ai_task_features() · ai_agent_workload() · ai_volume_history() · ai_detect_anomalies()      ← features, in SQL
      ↓
src/lib/ai/models.ts        pure functions: features in → prediction, confidence, reasons   ← models
      ↓
ai_store_predictions() · ai_store_recommendations() · ai_store_summary()                    ← storage
      ↓
/admin/ai · task page · /admin/ai/recommendations · /admin/settings/ai                      ← admin UI
      ↓
Human decision (accept / reject / feedback) — recorded, never executed
```

| Layer | Where |
|---|---|
| Feature definitions | `src/lib/ai/features.ts` (the one list; computed by the SQL functions above) |
| Models | `src/lib/ai/models.ts` |
| Orchestration | `src/lib/ai/service.ts` (`runPredictions`, `generateSummary`) |
| Summary and language model | `src/lib/ai/summary.ts` |
| Flags | `src/lib/ai/flags.ts`, table `ai_settings` |
| Screens, actions, queries | `src/features/ai/`, `src/app/admin/ai/`, `src/app/admin/settings/ai/` |
| Scheduler entry | `src/app/api/cron/ai/route.ts` |

Core task code does not import anything from the AI layer. If AI is off or fails, tasks, monitoring, notifications and reports are unaffected.

## Which method for which feature

| Feature | Method | Why |
|---|---|---|
| Counts, rates, totals | SQL (Phase 11 reports) | Exact; no model needed |
| Delay risk | Statistical baseline | Compares time left with how long similar tasks took from the same stage |
| Failure risk | Smoothed historical frequency | A frequency is the honest statement the data supports |
| ETA | Median and quartiles of past durations | Gives a range instead of false precision |
| Workload forecast | Same-weekday moving average (8 weeks) | Transparent baseline; labelled as such |
| Anomalies | Rules against each figure's own baseline | Explainable: observed vs. usual |
| Attention recommendations | Rules over the results above | Deterministic and auditable |
| Operational summary | Template, or optionally a language model | Only the wording benefits from a language model; every figure comes from SQL |

A trained model is not used yet. When there is enough evaluated history, a model can replace a baseline behind the same interface; the registry and the stored `model_version` make the change traceable.

## Predictions

Every stored prediction has: type, entity, value, confidence, `model_name`, `model_version`, `feature_version`, the reasons (`explanation.factors`), `generated_at` and `expires_at`.

### Delay risk (`TASK_DELAY_RISK`, model `task-delay-risk` 1.0)

For each open task with a schedule:

- **Already past its scheduled time** → High (a fact; no history needed).
- Otherwise, *expected remaining time* = the median time similar finished tasks took from the task's current stage to completion, minus the time already spent in the stage (never less than a quarter of the median).
- **High** if the expected remaining time is at least the time left. **Medium** if the slower quarter of similar tasks would not make it, or the expected time is 70% or more of the time left. Otherwise **Low**.
- Low is raised to Medium when half or more of that task type's scheduled tasks finished late (at least 5 such tasks).
- "Similar" means the same task type; if fewer than 5 of that type have finished, all types are used (and confidence is reduced).

### Failure risk (`TASK_FAILURE_RISK`, model `task-failure-risk` 1.0)

- Estimated rate = failed ÷ closed tasks of the same type in the last 180 days, smoothed towards the overall rate (five pseudo-tasks). When the location has at least 5 closed tasks, its smoothed rate is averaged in.
- Low under 10%, Medium 10–30%, High 30% and above.
- Shown as "Estimated failure risk: 27% (how often similar tasks failed)". It is a historical frequency, not a calibrated probability, and never "this task will fail".
- Rejected check-ins on the task are listed as a noted factor but do not change the number.

### Estimated completion (`TASK_ETA`, model `task-eta` 1.0)

- For tasks that are on the way, arrived, checked in or in progress.
- ETA = now + expected remaining time; the range uses the 25th and 75th percentiles.
- Labelled **Operational ETA**: it comes from past task durations only. No traffic or location data is used.

### Workload forecast (`WORKLOAD_FORECAST`, model `workload-forecast` 1.0)

- For each of the next 7 days: the average number of tasks on the same weekday over the previous 8 weeks, with the lowest and highest of those weeks as the range, next to what is already scheduled.
- Also shows the usual mix by task type and the busiest locations (last 4 weeks).
- Needs at least 20 tasks in the last 56 days and 4 weeks of history; otherwise N/A. Trends, holidays and one-off events are not modelled.

### Anomalies (`ANOMALY`, model `operational-anomalies` 1.0)

| Anomaly | Flagged when |
|---|---|
| Unusually long task duration | A task finished in the last 7 days took 2.5× (high: 4×) the median of its type (at least 5 earlier tasks) |
| Repeated rejected check-ins at a location | 3 or more rejected attempts at one location in 7 days (high: 6) |
| Unusually high failure rate at a location | At least 4 closed tasks in 30 days, half or more failed, and at least twice the overall rate |
| Cash outstanding above the recent average | This week's outstanding is at least twice the weekly average of the previous 8 weeks (at least 10 closed cash tasks) |
| Unusual task volume today | Today is at least twice the same-weekday average (4+ weeks, average 3+) |
| Several messages could not be delivered | 3 or more failed outgoing messages in 24 hours |

Each shows what was observed, the historical baseline, the severity and when it was detected. Anomalies are about tasks, places and the organisation — never about a person.

### Agent workload

Open tasks, tasks due today and overdue tasks per agent give a workload-pressure level (High: 2+ overdue, 8+ due today or 12+ open; Medium: 1 overdue, 5+ due today or 7+ open). It describes the schedule and reassigns nothing.

## Confidence

"Prediction confidence" is **how much history supports the estimate** (it grows with the number of similar finished tasks, and is lower when other task types had to be used). It is not the probability of the outcome, and the UI labels it accordingly. The only percentage about an outcome is the failure estimate, which is described as a historical frequency.

## When there is not enough data

A prediction is refused rather than invented:

| Reason | When |
|---|---|
| `INSUFFICIENT_DATA` | Fewer than 5 similar finished tasks (durations), fewer than 5 of the type and fewer than 10 overall (failure), or fewer than 20 tasks in 8 weeks (forecast) |
| `NO_SCHEDULE` | The task has no scheduled date, so it cannot be late |
| `DATA_QUALITY` | No agent, no location, or the time the task entered its stage is missing |

These are stored and shown as **N/A** with the reason.

## Features and leakage

`src/lib/ai/features.ts` lists every feature with its source, calculation, when it is available and what happens when it is missing; the settings page shows the same list.

- Every feature is known at the moment of prediction.
- Baselines use only tasks that are already **closed**, and never the task being predicted.
- `completed_at` of the task being predicted is never an input.
- **Never used:** agent location history, and any personal attribute (name, phone, e-mail, age, gender).

## Recommendations

`/admin/ai/recommendations` lists advice created by the attention rules: a task with high delay or failure risk, an overdue task, repeated rejected check-ins without an accepted one, high workload pressure on an agent's schedule, and high-severity anomalies.

- Each has a title, the reasons, a confidence where one exists, and a status: `PENDING`, `ACCEPTED`, `REJECTED` or `EXPIRED`.
- **Accept means acknowledge.** It records who decided, when, and an optional note. It does not change the task, its stored priority, its agent or its schedule; the attention level lives only in the recommendation (`recommended_attention`).
- A pending recommendation expires after 3 days, or when its task is closed.
- The same event is not recommended twice (one per task per day).

## Feedback and evaluation

- On each prediction an administrator can say **Useful**, **Not useful** or **Incorrect** (one rating per admin per prediction). Feedback is stored and audited; it never retrains or changes a model.
- When a task is closed, its real outcome (status, late or not, ETA error in minutes) is stored next to every prediction that was made for it. An evaluated prediction is never overwritten.
- The `ai_evaluation` view counts, per model version, how predictions compare with outcomes (for example high-risk and late, high-risk and not late; mean absolute ETA error). The settings page shows these counts only once 30 predictions of a model have a known outcome; until then it says there is not enough to judge. From these counts precision, recall, accuracy, MAE and calibration can be calculated later.

## Operational summary and the language model

`/admin/ai` → **Generate summary**.

```text
Database → report_overview() and AI counts → SummaryFacts (JSON) → template or language model → validation → page
```

- **Default: a built-in template.** No language model is called unless one is configured.
- **Optional: Claude through the Anthropic API**, with structured output. It receives one JSON object of today's figures: task counts, cash totals, check-in counts, AI counts and anomaly kinds. **No names, phone numbers, e-mail addresses, coordinates, task codes, payment references or ids are sent.** The model has no tools and no database access.
- **Validation before display:** the output must match the schema (`summary`, `observations`, `attention_items`, with length limits), and every number in it must be one of the figures it was given. If the model refuses, fails, returns malformed output or mentions a figure that is not in the data, the template is shown instead and the reason is recorded.
- The text is rendered as plain text, and the page always adds "No automatic task changes were made."
- Counts and totals are always computed in SQL; the model only words them.

### Provider configuration (server-only)

```env
AI_SUMMARY_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
# optional; default claude-opus-5. A smaller model such as claude-haiku-4-5 is cheaper for this short task.
AI_SUMMARY_MODEL=claude-opus-5
```

None of these may be prefixed with `NEXT_PUBLIC_`. Without them the template is used.

## Feature flags

A feature runs only if both layers allow it:

| Layer | How |
|---|---|
| Deployment | `AI_FEATURES_ENABLED`, `AI_TASK_RISK_ENABLED`, `AI_ETA_ENABLED`, `AI_FORECAST_ENABLED`, `AI_ANOMALIES_ENABLED`, `AI_RECOMMENDATIONS_ENABLED`, `AI_SUMMARY_ENABLED` — default on; set to `false` to switch off |
| Administrator | `/admin/settings/ai` (table `ai_settings`); changes are audited |

With AI off, `/admin/ai` shows a notice, the task page has no AI panel, the scheduler reports "disabled", and stored results of a switched-off feature are not shown.

## Freshness, caching and cost

- Pages never run a model while rendering: they show stored results with the time they were generated and the model version.
- Freshness limits: delay risk and ETA 30 minutes, failure risk 6 hours, forecast and anomalies 24 hours. Past the limit a prediction is marked **Out of date**; the AI page also says when the last refresh is more than an hour old.
- An unchanged prediction is refreshed in place rather than stored again, so history grows only when an estimate changes.
- Rate limits (enforced in the database): a manual refresh at most every 20 seconds, a scheduled one every 60 seconds, a language-model summary every 5 minutes.
- The scheduler never calls the language model; a summary is generated only when an administrator asks.
- Runs, failures, duration, predictions without enough data, language-model calls and tokens are recorded in `ai_runs` and shown on the settings page. API keys and request contents are never logged.

## Scheduled job

`GET /api/cron/ai` with `Authorization: Bearer $CRON_SECRET` refreshes predictions, the forecast, anomalies and recommendations, and records outcomes of finished tasks. Call it every 15–30 minutes (Vercel Cron or any external scheduler — the same mechanism as `/api/cron/notifications`). Without a scheduler, predictions are refreshed when an administrator presses **Refresh predictions**.

## Security and privacy

- Every AI screen and action requires an active admin, verified on the server.
- The `ai_*` tables are readable by admins only (RLS) and writable by nobody directly; writes go through functions that require an admin or the server's service role.
- Agents have no access: the tables return nothing to them, and the feature functions return no rows — not even about their own tasks.
- No AI function writes to an operational table (checked by the test suite).
- API keys are server-only and never reach the browser.
- Location history is not an input to any model. There is no movement scoring or behaviour profiling.

## Audit

`AI_PREDICTION_GENERATED` (one per run), `AI_RECOMMENDATION_CREATED`, `AI_RECOMMENDATION_ACCEPTED`, `AI_RECOMMENDATION_REJECTED`, `AI_FEEDBACK_SUBMITTED`, `AI_SETTINGS_CHANGED`.

## Retention

Predictions are kept because they are needed for evaluation; the table grows only when an estimate changes. Recommendations and their reviews are kept as a record of decisions. No automatic deletion is implemented. A reasonable policy is to delete unevaluated predictions and run logs older than 12 months.

## Limitations

- All models are experimental baselines. With little history most estimates are N/A, by design.
- The ETA ignores traffic, distance and anything happening on the road.
- The forecast does not model trends, holidays or seasonality.
- The failure estimate is a historical frequency for similar tasks, not a prediction about one specific task's circumstances.
- A scheduled summary is not generated automatically; an administrator requests it.
- There is no AI chat assistant and no AI feature for agents.
- If the language model declines a request, the template is used; server-side model fallbacks are not configured.
