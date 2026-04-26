export const TOPIC_LABELS = {
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

export const TOPIC_KEYS = Object.keys(TOPIC_LABELS);

// Topics that signal anxiety / reactivity
export const ANXIETY_TOPICS = ["T04"];

// Topics that signal active optimisation behaviour
export const OPTIMISATION_TOPICS = ["T01", "T06", "T07"];
