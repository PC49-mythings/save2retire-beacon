import { useState, useEffect } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { api, metricsQS } from "../../lib/api";
import { fmtPct, periodLabel } from "../../lib/format";
import { COHORTS, COHORT_COLORS, COHORT_LABELS } from "../../constants/cohorts";
import { BEHAVIOUR_METRICS } from "../../constants/metrics";
import CohortLineChart from "../../components/CohortLineChart";
import ChartTooltip from "../../components/ChartTooltip";

export default function Behaviour() {
  const [data, setData]       = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");

  useEffect(() => {
    api(`/intelligence/multi-metric?${metricsQS(BEHAVIOUR_METRICS)}`)
      .then(d => setData(d.data ?? {}))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading-spinner">Loading behavioural change data…</div>;
  if (error)   return <div className="page-body"><div className="alert alert-error">{error}</div></div>;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Behavioural <em>Change</em></div>
          <div className="page-subtitle">Evidence of sustained member behaviour change — APRA retirement income covenant indicators</div>
        </div>
      </div>
      <div className="page-body">
        <div className="apra-callout">
          <strong>APRA alignment:</strong> These metrics directly address the retirement income covenant requirement to demonstrate member behaviour change over time. The multi-session refinement rate evidences that save2retire functions as an ongoing planning tool, not a one-time calculator. The adviser referral rate demonstrates the platform's triage layer function as envisioned in the DBFO framework.
        </div>

        <div className="chart-grid">
          <CohortLineChart
            data={data.multi_session_refinement_rate ?? []}
            title="Multi-Session Plan Refinement Rate"
            subtitle="% of users returning and updating their plan across sessions — evidence of sustained engagement"
          />
          <CohortLineChart
            data={data.consolidation_signal_rate ?? []}
            title="Consolidation Signal Rate"
            subtitle="% of users with multiple super fund signal — identifies consolidation opportunity pipeline"
          />
        </div>

        {/* Adviser referral — full width as it's the APRA headline indicator */}
        <div className="chart-card">
          <div className="chart-title">Adviser Referral Trigger Rate</div>
          <div className="chart-subtitle">
            % of AI sessions where the compliance pipeline triggered an adviser referral prompt.
            Demonstrates the platform as a regulated triage layer — not general advice.
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={data.adviser_referral_trigger_rate ?? []}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(59,130,246,0.08)" />
              <XAxis dataKey="period" tickFormatter={periodLabel} tick={{ fill: "var(--text-faint)", fontSize: 11, fontFamily: "var(--font-mono)" }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={fmtPct} tick={{ fill: "var(--text-faint)", fontSize: 11, fontFamily: "var(--font-mono)" }} axisLine={false} tickLine={false} width={44} />
              <Tooltip content={<ChartTooltip fmt={fmtPct} />} />
              <Legend formatter={k => COHORT_LABELS[k] ?? k} wrapperStyle={{ fontSize: 11, color: "var(--text-dim)" }} />
              {COHORTS.map(c => (
                <Line key={c} type="monotone" dataKey={c} stroke={COHORT_COLORS[c]} strokeWidth={2} dot={false} connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
