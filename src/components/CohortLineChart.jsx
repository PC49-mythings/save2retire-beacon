import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { COHORTS, COHORT_COLORS, COHORT_LABELS } from "../constants/cohorts";
import { fmtPct, periodLabel } from "../lib/format";
import ChartTooltip from "./ChartTooltip";

/**
 * Renders all five cohort lines for a single metric over time.
 *
 * @param {object[]} data     — array of { period, C1, C2, C3, C4, C5 }
 * @param {string}   title
 * @param {string}   subtitle
 * @param {function} fmtFn    — value formatter, defaults to fmtPct
 * @param {number}   height   — chart height in px, defaults to 200
 * @param {string[]} cohorts  — subset of cohorts to render, defaults to all five
 */
export default function CohortLineChart({
  data = [],
  title,
  subtitle,
  fmtFn = fmtPct,
  height = 200,
  cohorts = COHORTS,
}) {
  return (
    <div className="chart-card">
      {title    && <div className="chart-title">{title}</div>}
      {subtitle && <div className="chart-subtitle">{subtitle}</div>}
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(59,130,246,0.08)" />
          <XAxis
            dataKey="period"
            tickFormatter={periodLabel}
            tick={{ fill: "var(--text-faint)", fontSize: 11, fontFamily: "var(--font-mono)" }}
            axisLine={false} tickLine={false}
          />
          <YAxis
            tickFormatter={fmtFn}
            tick={{ fill: "var(--text-faint)", fontSize: 11, fontFamily: "var(--font-mono)" }}
            axisLine={false} tickLine={false} width={44}
          />
          <Tooltip content={<ChartTooltip fmt={fmtFn} />} />
          <Legend
            formatter={k => COHORT_LABELS[k] ?? k}
            wrapperStyle={{ fontSize: 11, color: "var(--text-dim)" }}
          />
          {cohorts.map(c => (
            <Line
              key={c}
              type="monotone"
              dataKey={c}
              stroke={COHORT_COLORS[c]}
              strokeWidth={2}
              dot={false}
              connectNulls
              activeDot={{ r: 4 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
