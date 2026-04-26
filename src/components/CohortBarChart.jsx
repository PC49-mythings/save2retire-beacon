import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from "recharts";
import { COHORTS, COHORT_COLORS, COHORT_LABELS } from "../constants/cohorts";
import { fmtPct, periodLabel } from "../lib/format";
import ChartTooltip from "./ChartTooltip";

/**
 * Bar chart showing a single-period cohort snapshot.
 * Reads the last entry from `data` as the "latest period".
 *
 * @param {object[]} data     — array of { period, C1, C2, C3, C4, C5 }
 * @param {string}   title
 * @param {string}   subtitle
 * @param {function} fmtFn    — value formatter, defaults to fmtPct
 * @param {number}   height   — chart height in px, defaults to 200
 */
export default function CohortBarChart({
  data = [],
  title,
  subtitle,
  fmtFn = fmtPct,
  height = 200,
}) {
  const latest = data[data.length - 1] ?? {};

  // Short label: just the age range prefix e.g. "18–35"
  const barData = COHORTS.map(c => ({
    cohort: c,
    label:  COHORT_LABELS[c].split(" ")[0],
    value:  latest[c],
    fill:   COHORT_COLORS[c],
  }));

  return (
    <div className="chart-card">
      {title    && <div className="chart-title">{title}</div>}
      {subtitle && <div className="chart-subtitle">{subtitle}</div>}
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={barData} barSize={32}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(59,130,246,0.08)" />
          <XAxis
            dataKey="label"
            tick={{ fill: "var(--text-faint)", fontSize: 11, fontFamily: "var(--font-mono)" }}
            axisLine={false} tickLine={false}
          />
          <YAxis
            tickFormatter={fmtFn}
            tick={{ fill: "var(--text-faint)", fontSize: 11, fontFamily: "var(--font-mono)" }}
            axisLine={false} tickLine={false} width={44}
          />
          <Tooltip content={<ChartTooltip fmt={fmtFn} />} />
          <Bar dataKey="value" radius={[4, 4, 0, 0]}>
            {barData.map((d, i) => (
              <Cell key={i} fill={d.fill} fillOpacity={0.8} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
