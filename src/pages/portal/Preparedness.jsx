import { useState, useEffect } from "react";
import { api, metricsQS } from "../../lib/api";
import { PREPAREDNESS_METRICS } from "../../constants/metrics";
import CohortLineChart from "../../components/CohortLineChart";
import CohortBarChart from "../../components/CohortBarChart";

export default function Preparedness() {
  const [data, setData]       = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");

  useEffect(() => {
    api(`/intelligence/multi-metric?${metricsQS(PREPAREDNESS_METRICS)}`)
      .then(d => setData(d.data ?? {}))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading-spinner">Loading preparedness data…</div>;
  if (error)   return <div className="page-body"><div className="alert alert-error">{error}</div></div>;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Retirement <em>Preparedness</em></div>
          <div className="page-subtitle">Adequacy indicators and planning behaviours by cohort</div>
        </div>
      </div>
      <div className="page-body">
        <div className="chart-grid">
          <CohortBarChart
            data={data.projection_gap_rate}
            title="Projection Gap Rate — Latest Period"
            subtitle="% of active users with a funded shortfall in base-case projection"
          />
          <CohortLineChart
            data={data.projection_gap_rate ?? []}
            title="Projection Gap — Trend"
            subtitle="Declining rate indicates improving member preparedness over time"
          />
          <CohortBarChart
            data={data.salary_sacrifice_modelling_rate}
            title="Salary Sacrifice Modelling — Latest"
            subtitle="% who have modelled salary sacrifice contributions above $0"
          />
          <CohortLineChart
            data={data.salary_sacrifice_modelling_rate ?? []}
            title="Salary Sacrifice — Trend"
            subtitle="Leading indicator of contribution behaviour change"
          />
          <CohortLineChart
            data={data.drawdown_strategy_modelling_rate ?? []}
            title="Drawdown Strategy Modelling"
            subtitle="% engaging with income sequencing options — key APRA Pulse Check focus area"
          />
          <CohortLineChart
            data={data.voluntary_contribution_modelling_rate ?? []}
            title="Voluntary Contribution Modelling"
            subtitle="% modelling any voluntary contribution scenario (SS, NCC, or spouse)"
          />
        </div>
      </div>
    </div>
  );
}
