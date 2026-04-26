import { fmtValue, fmtDelta } from "../lib/format";

/**
 * @param {{ key, label, unit, goodDir }} def  — metric definition from HEADLINE_METRICS
 * @param {{ value, unit, delta }}        data — from /intelligence/summary response
 */
export default function KpiCard({ def, data }) {
  const delta = data?.delta != null
    ? fmtDelta(data.delta, def.unit, def.goodDir)
    : null;

  return (
    <div className="kpi-card">
      <div className="kpi-label">{def.label}</div>
      <div className="kpi-value">
        {data ? fmtValue(data.value, def.unit) : "—"}
      </div>
      {delta && (
        <div className={`kpi-delta ${delta.cls}`}>
          {delta.label} vs prev
        </div>
      )}
    </div>
  );
}
