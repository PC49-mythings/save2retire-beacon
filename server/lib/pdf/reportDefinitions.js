// ─── Beacon Report Definitions ───────────────────────────────────────────────
// Single source of truth for sections, audience presets, and detail levels.
// Used by both the server-side generator and the client-side UI.
// ─────────────────────────────────────────────────────────────────────────────

const SECTIONS = [
  {
    id:          "cover",
    label:       "Cover Page",
    description: "Fund name, period, prepared by/for, confidentiality notice",
    required:    true,
  },
  {
    id:          "executive_summary",
    label:       "Executive Summary",
    description: "Headline KPIs with period-on-period deltas and key findings",
    required:    false,
  },
  {
    id:          "engagement",
    label:       "Member Engagement",
    description: "Platform usage, AI tool adoption, goal declaration rates by cohort",
    required:    false,
  },
  {
    id:          "preparedness",
    label:       "Retirement Preparedness",
    description: "Projection gap rates, salary sacrifice and drawdown modelling rates",
    required:    false,
  },
  {
    id:          "topics",
    label:       "AI Topic Intelligence",
    description: "What members are asking about — topic distribution and cohort heatmap",
    required:    false,
  },
  {
    id:          "behaviour",
    label:       "Behavioural Change",
    description: "Multi-session refinement, consolidation signals, adviser referral rates",
    required:    false,
  },
  {
    id:          "methodology",
    label:       "Methodology Appendix",
    description: "Metric definitions, cohort boundaries, anonymisation approach, APRA alignment",
    required:    false,
  },
];

// Detail levels control how much cohort breakdown is shown per section
const DETAIL_LEVELS = [
  {
    id:          "summary",
    label:       "Summary",
    description: "All-cohort totals only — suitable for board and executive audiences",
  },
  {
    id:          "standard",
    label:       "Standard",
    description: "All-cohort plus C1–C5 cohort breakdown — suitable for APRA submissions",
  },
  {
    id:          "detailed",
    label:       "Detailed",
    description: "Full cohort breakdown including suppressed cell notes — for internal analysts",
  },
];

// Audience presets — pre-select sections and detail level
const AUDIENCE_PRESETS = [
  {
    id:          "board",
    label:       "Board Pack",
    description: "High-level overview for board and executive audiences. Plain language, no technical appendix.",
    detail_level: "summary",
    sections:    ["cover", "executive_summary", "preparedness", "behaviour"],
    color:       "#8b5cf6",
  },
  {
    id:          "apra",
    label:       "APRA Submission",
    description: "Full evidence pack aligned to the retirement income covenant and APRA Pulse Check expectations.",
    detail_level: "standard",
    sections:    ["cover", "executive_summary", "engagement", "preparedness", "topics", "behaviour", "methodology"],
    color:       "#3b82f6",
  },
  {
    id:          "analyst",
    label:       "Internal Analyst",
    description: "Complete data pack for internal strategy and data teams.",
    detail_level: "detailed",
    sections:    ["cover", "executive_summary", "engagement", "preparedness", "topics", "behaviour", "methodology"],
    color:       "#10b981",
  },
  {
    id:          "custom",
    label:       "Custom",
    description: "Choose your own sections and detail level.",
    detail_level: "standard",
    sections:    ["cover", "executive_summary"],
    color:       "#f59e0b",
  },
];

// Metric display config for the PDF — what to show in each section
const PDF_METRICS = {
  executive_summary: [
    { key: "active_users",                    label: "Active Users",                unit: "count" },
    { key: "ai_tool_usage_rate",              label: "AI Tool Usage Rate",          unit: "rate"  },
    { key: "goal_declaration_rate",           label: "Goal Declaration Rate",       unit: "rate"  },
    { key: "projection_gap_rate",             label: "Projection Gap Rate",         unit: "rate", goodDir: "down" },
    { key: "salary_sacrifice_modelling_rate", label: "Salary Sacrifice Modelling",  unit: "rate"  },
    { key: "return_visit_rate",               label: "Return Visit Rate",           unit: "rate"  },
  ],
  engagement: [
    { key: "return_visit_rate",               label: "Return Visit Rate",           unit: "rate"  },
    { key: "ai_tool_usage_rate",              label: "AI Tool Usage Rate",          unit: "rate"  },
    { key: "goal_declaration_rate",           label: "Goal Declaration Rate",       unit: "rate"  },
    { key: "scenario_modelling_rate",         label: "Scenario Modelling Rate",     unit: "rate"  },
  ],
  preparedness: [
    { key: "projection_gap_rate",             label: "Projection Gap Rate",         unit: "rate", goodDir: "down" },
    { key: "salary_sacrifice_modelling_rate", label: "Salary Sacrifice Modelling",  unit: "rate"  },
    { key: "drawdown_strategy_modelling_rate",label: "Drawdown Strategy Modelling", unit: "rate"  },
    { key: "voluntary_contribution_modelling_rate", label: "Voluntary Contribution Modelling", unit: "rate" },
  ],
  behaviour: [
    { key: "multi_session_refinement_rate",   label: "Multi-Session Refinement",    unit: "rate"  },
    { key: "consolidation_signal_rate",       label: "Consolidation Signal Rate",   unit: "rate"  },
    { key: "adviser_referral_trigger_rate",   label: "Adviser Referral Trigger",    unit: "rate"  },
  ],
};

// Topic labels for the PDF heatmap table
const PDF_TOPIC_LABELS = {
  T01: "Salary sacrifice & contributions",
  T02: "Age Pension eligibility",
  T03: "Retirement timing & adequacy",
  T04: "Market risk & longevity anxiety",
  T05: "Property & major life events",
  T06: "Drawdown strategies",
  T07: "Tax strategies (Div 293)",
  T08: "Family & life event planning",
  T09: "Insurance (life, TPD)",
  T10: "Estate planning & beneficiaries",
  T11: "SMSF & investment strategy",
  T12: "General super education",
};

const COHORT_LABELS = {
  C1:  "18–35",
  C2:  "36–50",
  C3:  "51–62",
  C4:  "63–67",
  C5:  "68+",
  ALL: "All Members",
};

module.exports = {
  SECTIONS,
  DETAIL_LEVELS,
  AUDIENCE_PRESETS,
  PDF_METRICS,
  PDF_TOPIC_LABELS,
  COHORT_LABELS,
};
