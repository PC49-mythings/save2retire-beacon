import { COHORT_LABELS } from "../constants/cohorts";
import { fmtPct, periodLabel } from "../lib/format";

/**
 * Drop-in replacement for Recharts' default tooltip.
 * Respects the dark Beacon theme.
 *
 * @param {function} fmt  — formatter for values, defaults to fmtPct
 */
export default function ChartTooltip({ active, payload, label, fmt = fmtPct }) {
  if (!active || !payload?.length) return null;

  return (
    <div style={{
      background: "var(--navy)",
      border: "1px solid var(--border)",
      borderRadius: 8,
      padding: "10px 14px",
      fontSize: 12,
    }}>
      <div style={{ color: "var(--text-faint)", fontFamily: "var(--font-mono)", marginBottom: 6 }}>
        {periodLabel(label)}
      </div>
      {payload
        .filter(p => p.value != null)
        .map(p => (
          <div key={p.dataKey} style={{ color: p.color, marginBottom: 2 }}>
            {COHORT_LABELS[p.dataKey] ?? p.name}: {fmt(p.value)}
          </div>
        ))
      }
    </div>
  );
}
