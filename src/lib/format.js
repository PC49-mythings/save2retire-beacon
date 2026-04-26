// ─── Value formatters ─────────────────────────────────────────────────────────

export const fmtPct   = v => v == null ? "—" : `${(v * 100).toFixed(1)}%`;
export const fmtCount = v => v == null ? "—" : Number(v).toLocaleString();
export const fmtIndex = v => v == null ? "—" : Number(v).toFixed(0);

export function fmtValue(v, unit) {
  if (unit === "rate" || unit === "pct") return fmtPct(v);
  if (unit === "count")  return fmtCount(v);
  if (unit === "index")  return fmtIndex(v);
  return v == null ? "—" : String(v);
}

// ─── Period label ─────────────────────────────────────────────────────────────
// Converts "2026-M04" or "2026-M4" → "Apr 2026"
// Works for any year — no hardcoded year references.
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export function periodLabel(p) {
  if (!p) return "";
  const match = p.match(/^(\d{4})-M(\d{1,2})$/);
  if (match) {
    const year  = match[1];
    const month = parseInt(match[2], 10);
    return `${MONTHS[month - 1] ?? "?"} ${year}`;
  }
  // Fallback: return as-is
  return p;
}

// ─── Delta formatting ─────────────────────────────────────────────────────────
// Returns { label: "+2.1pp", cls: "up" | "down" | "down-good" | "neutral" }
// goodDir: which direction is considered positive for this metric
export function fmtDelta(v, unit, goodDir = "up") {
  if (v == null) return { label: "—", cls: "neutral" };
  if (v === 0)   return { label: "—", cls: "neutral" };

  const abs = Math.abs(v);
  const sign = v > 0 ? "+" : "−";

  let label;
  if (unit === "rate" || unit === "pct") {
    label = `${sign}${(abs * 100).toFixed(1)}pp`;
  } else if (unit === "count") {
    label = `${sign}${fmtCount(abs)}`;
  } else {
    label = `${sign}${abs.toFixed(1)}`;
  }

  const isGood = (goodDir === "up" && v > 0) || (goodDir === "down" && v < 0);
  let cls;
  if (isGood) {
    cls = v > 0 ? "up" : "down-good";
  } else {
    cls = v > 0 ? "down" : "up";
  }

  return { label, cls };
}

// ─── Heat colour for heatmap cells ────────────────────────────────────────────
// Maps 0–35%+ → blue intensity. Cap chosen so cells are distinguishable.
export function heatColor(v) {
  if (v == null) return "transparent";
  const intensity = Math.min((v * 100) / 35, 1);
  const alpha = 0.08 + intensity * 0.45;
  return `rgba(59,130,246,${alpha.toFixed(2)})`;
}
