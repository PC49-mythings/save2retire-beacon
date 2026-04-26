import { useState, useEffect } from "react";
import { ResponsiveContainer, AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { api, metricsQS } from "../../lib/api";
import { fmtPct, fmtValue, periodLabel } from "../../lib/format";
import { HEADLINE_METRICS } from "../../constants/metrics";
import ChartTooltip from "../../components/ChartTooltip";
import KpiCard from "../../components/KpiCard";

const OVERVIEW_TREND_METRICS = [
  "ai_tool_usage_rate",
  "goal_declaration_rate",
  "projection_gap_rate",
];

export default function Overview() {
  const [summary, setSummary]               = useState(null);
  const [periods, setPeriods]               = useState([]);
  const [selectedPeriod, setSelectedPeriod] = useState(null);
  const [trends, setTrends]                 = useState({});
  const [loading, setLoading]               = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [error, setError]                   = useState("");

  // Initial load — periods and trend lines (span all periods, unaffected by selection)
  useEffect(() => {
    Promise.all([
      api("/intelligence/periods"),
      api(`/intelligence/multi-metric?${metricsQS(OVERVIEW_TREND_METRICS)}`),
    ])
      .then(([p, m]) => {
        const periodList = p.periods ?? [];
        setPeriods(periodList);
        setTrends(m.data ?? {});
        // Default to latest period
        if (periodList.length) {
          setSelectedPeriod(periodList[periodList.length - 1].period_label);
        }
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // Re-fetch KPI summary whenever selected period changes
  useEffect(() => {
    if (!selectedPeriod) return;
    setSummaryLoading(true);
    api(`/intelligence/summary?period=${selectedPeriod}`)
      .then(s => setSummary(s.summary))
      .catch(err => setError(err.message))
      .finally(() => setSummaryLoading(false));
  }, [selectedPeriod]);

  if (loading) return <div className="loading-spinner">Loading overview…</div>;
  if (error)   return <div className="page-body"><div className="alert alert-error">{error}</div></div>;

  // All-cohort trend arrays for the summary charts
  const allOf = key => (trends[key] ?? []).map(d => ({ period: d.period, value: d.ALL }));

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title"><em>Overview</em></div>
          <div className="page-subtitle">Platform intelligence summary · mock data · {periods.length} periods</div>
        </div>
        <div className="period-bar">
          {periods.map(p => (
            <button
              key={p.period_label}
              className={`period-chip${selectedPeriod === p.period_label ? " active" : ""}`}
              onClick={() => setSelectedPeriod(p.period_label)}
            >
              {periodLabel(p.period_label)}
            </button>
          ))}
        </div>
      </div>

      <div className="page-body">
        <div className="kpi-grid" style={{ opacity: summaryLoading ? 0.5 : 1, transition: "opacity 0.2s" }}>
          {HEADLINE_METRICS.map(def => (
            <KpiCard key={def.key} def={def} data={summary?.[def.key]} />
          ))}
        </div>

        <div className="chart-grid">
          {[
            { key: "ai_tool_usage_rate",    color: "#3b82f6", title: "AI Tool Usage",      subtitle: "% of active users engaging with the AI tool each period" },
            { key: "goal_declaration_rate",  color: "#10b981", title: "Goal Declaration",   subtitle: "% of active users with at least one financial goal declared" },
          ].map(({ key, color, title, subtitle }) => (
            <div className="chart-card" key={key}>
              <div className="chart-title">{title} — All Members</div>
              <div className="chart-subtitle">{subtitle}</div>
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={allOf(key)}>
                  <defs>
                    <linearGradient id={`grad-${key}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={color} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={color} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(59,130,246,0.08)" />
                  <XAxis dataKey="period" tickFormatter={periodLabel} tick={{ fill: "var(--text-faint)", fontSize: 11, fontFamily: "var(--font-mono)" }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={fmtPct} tick={{ fill: "var(--text-faint)", fontSize: 11, fontFamily: "var(--font-mono)" }} axisLine={false} tickLine={false} width={44} />
                  <Tooltip content={<ChartTooltip fmt={fmtPct} />} />
                  <Area type="monotone" dataKey="value" stroke={color} fill={`url(#grad-${key})`} strokeWidth={2} dot={{ fill: color, r: 3 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ))}
        </div>

        <div className="chart-card">
          <div className="chart-title">Projection Gap Rate — All Members</div>
          <div className="chart-subtitle">
            % of active users whose base-case projection shows a retirement shortfall.
            A declining rate reflects members taking action after modelling on the platform.
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={allOf("projection_gap_rate")}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(59,130,246,0.08)" />
              <XAxis dataKey="period" tickFormatter={periodLabel} tick={{ fill: "var(--text-faint)", fontSize: 11, fontFamily: "var(--font-mono)" }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={fmtPct} tick={{ fill: "var(--text-faint)", fontSize: 11, fontFamily: "var(--font-mono)" }} axisLine={false} tickLine={false} width={44} domain={[0.3, 0.75]} />
              <Tooltip content={<ChartTooltip fmt={fmtPct} />} />
              <Line type="monotone" dataKey="value" stroke="#f59e0b" strokeWidth={2.5} dot={{ fill: "#f59e0b", r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
