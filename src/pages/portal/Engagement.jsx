import { useState, useEffect } from "react";
import { api, metricsQS } from "../../lib/api";
import { ENGAGEMENT_METRICS } from "../../constants/metrics";
import CohortLineChart from "../../components/CohortLineChart";

const CHART_DEFS = [
  { key: "return_visit_rate",        title: "Return Visit Rate",        subtitle: "% of active users logging in more than once per period" },
  { key: "ai_tool_usage_rate",       title: "AI Tool Usage Rate",       subtitle: "% of active users engaging with the AI information tool at least once" },
  { key: "goal_declaration_rate",    title: "Goal Declaration Rate",    subtitle: "% with at least one financial goal declared. Accelerates in M4 following fund prompt campaign." },
  { key: "scenario_modelling_rate",  title: "Scenario Modelling Rate",  subtitle: "% running a pessimistic, optimistic, or custom scenario beyond the base case" },
];

export default function Engagement() {
  const [data, setData]       = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");

  useEffect(() => {
    api(`/intelligence/multi-metric?${metricsQS(ENGAGEMENT_METRICS)}`)
      .then(d => setData(d.data ?? {}))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading-spinner">Loading engagement data…</div>;
  if (error)   return <div className="page-body"><div className="alert alert-error">{error}</div></div>;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Member <em>Engagement</em></div>
          <div className="page-subtitle">Platform usage trends by cohort across all periods</div>
        </div>
      </div>
      <div className="page-body">
        <div className="chart-grid">
          {CHART_DEFS.map(def => (
            <CohortLineChart
              key={def.key}
              data={data[def.key] ?? []}
              title={def.title}
              subtitle={def.subtitle}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
