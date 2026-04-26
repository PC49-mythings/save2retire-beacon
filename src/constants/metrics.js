// Headline KPI metrics shown on the Overview page.
// Each entry drives both the KPI card and the delta direction logic.
export const HEADLINE_METRICS = [
  { key: "active_users",                       label: "Active Users",       unit: "count", goodDir: "up"   },
  { key: "ai_tool_usage_rate",                 label: "AI Tool Usage",      unit: "rate",  goodDir: "up"   },
  { key: "goal_declaration_rate",              label: "Goal Declaration",   unit: "rate",  goodDir: "up"   },
  { key: "projection_gap_rate",                label: "Projection Gap",     unit: "rate",  goodDir: "down" },
  { key: "salary_sacrifice_modelling_rate",    label: "SS Modelling",       unit: "rate",  goodDir: "up"   },
  { key: "return_visit_rate",                  label: "Return Visit Rate",  unit: "rate",  goodDir: "up"   },
];

// Keys fetched by the /intelligence/summary endpoint
export const SUMMARY_METRIC_KEYS = HEADLINE_METRICS.map(m => m.key);

// Metric groups used across dashboard pages
export const ENGAGEMENT_METRICS = [
  "return_visit_rate",
  "ai_tool_usage_rate",
  "goal_declaration_rate",
  "scenario_modelling_rate",
];

export const PREPAREDNESS_METRICS = [
  "projection_gap_rate",
  "salary_sacrifice_modelling_rate",
  "drawdown_strategy_modelling_rate",
  "voluntary_contribution_modelling_rate",
];

export const BEHAVIOUR_METRICS = [
  "multi_session_refinement_rate",
  "consolidation_signal_rate",
  "adviser_referral_trigger_rate",
];

// Platform roles (ordered by authority, ascending)
export const PLATFORM_ROLES = [
  "fund_user",
  "platform_analyst",
  "platform_admin",
  "platform_owner",
];

export const ORG_ROLES = [
  "org_reporter",
  "org_analyst",
  "org_admin",
  "org_api",
];
