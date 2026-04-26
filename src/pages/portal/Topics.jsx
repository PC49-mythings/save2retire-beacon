import { useState, useEffect, useMemo } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { api, metricsQS } from "../../lib/api";
import { fmtPct, periodLabel, heatColor } from "../../lib/format";
import { COHORTS, COHORT_COLORS, COHORT_LABELS } from "../../constants/cohorts";
import { TOPIC_LABELS, TOPIC_KEYS, ANXIETY_TOPICS, OPTIMISATION_TOPICS } from "../../constants/topics";
import ChartTooltip from "../../components/ChartTooltip";

// All topic metric keys for the multi-metric query
const TOPIC_METRIC_KEYS = TOPIC_KEYS.map(t => `ai_topic_pct_${t}`);

export default function Topics() {
  const [heatmap, setHeatmap] = useState([]);
  const [trends, setTrends]   = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");

  useEffect(() => {
    Promise.all([
      api("/intelligence/cohort-heatmap"),
      api(`/intelligence/multi-metric?${metricsQS(TOPIC_METRIC_KEYS)}`),
    ])
      .then(([h, m]) => {
        setHeatmap(h.heatmap ?? []);
        setTrends(m.data ?? {});
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // Collapse anxiety and optimisation topic groups into a single trend line each
  // Debug — log the trend data to confirm what's in the response
  useEffect(() => {
    if (Object.keys(trends).length > 0) {
      const t01 = trends["ai_topic_pct_T01"];
      const t06 = trends["ai_topic_pct_T06"];
      const t07 = trends["ai_topic_pct_T07"];
      const t04 = trends["ai_topic_pct_T04"];
      console.log("T04 (anxiety) ALL values:", t04?.map(p => ({ period: p.period, ALL: p.ALL })));
      console.log("T01 (salary sac) ALL values:", t01?.map(p => ({ period: p.period, ALL: p.ALL })));
      console.log("T06 (drawdown) ALL values:", t06?.map(p => ({ period: p.period, ALL: p.ALL })));
      console.log("T07 (tax) ALL values:", t07?.map(p => ({ period: p.period, ALL: p.ALL })));
    }
  }, [trends]);

  const anxOptTrend = useMemo(() => {
    const pMap = {};

    for (const [metricKey, arr] of Object.entries(trends)) {
      const topicId = metricKey.replace("ai_topic_pct_", "");
      for (const point of arr) {
        if (!pMap[point.period]) pMap[point.period] = { period: point.period, anxiety: 0, optimisation: 0 };
        const allVal = point.ALL != null ? parseFloat(point.ALL) : null;
        if (ANXIETY_TOPICS.includes(topicId) && allVal != null && !isNaN(allVal))       pMap[point.period].anxiety      += allVal;
        if (OPTIMISATION_TOPICS.includes(topicId) && allVal != null && !isNaN(allVal))  pMap[point.period].optimisation += allVal;
      }
    }

    return Object.values(pMap).sort((a, b) => a.period.localeCompare(b.period));
  }, [trends]);

  if (loading) return <div className="loading-spinner">Loading topic intelligence…</div>;
  if (error)   return <div className="page-body"><div className="alert alert-error">{error}</div></div>;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">AI Question <em>Intelligence</em></div>
          <div className="page-subtitle">What members are actually thinking about — classified at population scale</div>
        </div>
      </div>
      <div className="page-body">

        {/* Anxiety → optimisation shift */}
        <div className="chart-section">
          <div className="chart-card">
            <div className="chart-title">Anxiety → Optimisation Shift</div>
            <div className="chart-subtitle">
              T04 (longevity/market anxiety) declining as T01+T06+T07 (salary sacrifice, drawdown, tax) grow — the retirement confidence signal in topic data
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={anxOptTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(59,130,246,0.08)" />
                <XAxis dataKey="period" tickFormatter={periodLabel} tick={{ fill: "var(--text-faint)", fontSize: 11, fontFamily: "var(--font-mono)" }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={fmtPct} tick={{ fill: "var(--text-faint)", fontSize: 11, fontFamily: "var(--font-mono)" }} axisLine={false} tickLine={false} width={44} domain={[0, "auto"]} />
                <Tooltip content={<ChartTooltip fmt={fmtPct} />} />
                <Legend wrapperStyle={{ fontSize: 12, color: "var(--text-dim)" }} />
                <Line type="monotone" dataKey="anxiety"      name="Anxiety (T04)"                stroke="#ef4444" strokeWidth={2.5} dot={{ r: 4, fill: "#ef4444" }} connectNulls />
                <Line type="monotone" dataKey="optimisation" name="Optimisation (T01+T06+T07)"   stroke="#10b981" strokeWidth={2.5} dot={{ r: 4, fill: "#10b981" }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Cohort heatmap */}
        <div className="chart-card">
          <div className="chart-title">Topic Distribution by Cohort — Latest Period</div>
          <div className="chart-subtitle">
            Cell intensity reflects share of AI questions in that topic. Each column sums to ~100% within the cohort.
          </div>
          <div className="heatmap-wrap">
            <table className="heatmap-table">
              <thead>
                <tr>
                  <th>Topic</th>
                  {COHORTS.map(c => <th key={c} title={COHORT_LABELS[c]}>{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {heatmap.map(row => (
                  <tr key={row.topic}>
                    <td title={TOPIC_LABELS[row.topic]}>
                      <strong>{row.topic}</strong> — {TOPIC_LABELS[row.topic]}
                    </td>
                    {COHORTS.map(c => (
                      <td
                        key={c}
                        style={{
                          background: heatColor(row[c]),
                          color: row[c] != null ? "var(--text)" : "var(--text-faint)",
                        }}
                      >
                        {row[c] != null ? fmtPct(row[c]) : "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 14, fontSize: 11, color: "var(--text-faint)", fontFamily: "var(--font-mono)" }}>
            — cells suppressed where cohort n &lt; population threshold
          </div>
        </div>
      </div>
    </div>
  );
}
