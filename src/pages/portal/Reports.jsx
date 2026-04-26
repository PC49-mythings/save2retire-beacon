import { useState, useEffect } from "react";
import { api } from "../../lib/api";
import { periodLabel } from "../../lib/format";

// ─── Report builder UI ────────────────────────────────────────────────────────
export default function Reports() {
  const [definitions, setDefinitions] = useState(null);
  const [periods, setPeriods]         = useState([]);
  const [exports, setExports]         = useState([]);
  const [loading, setLoading]         = useState(true);
  const [generating, setGenerating]   = useState(false);
  const [error, setError]             = useState("");
  const [success, setSuccess]         = useState("");

  // Report configuration state
  const [selectedPreset, setSelectedPreset]   = useState("apra");
  const [selectedSections, setSelectedSections] = useState([]);
  const [detailLevel, setDetailLevel]         = useState("standard");
  const [periodStart, setPeriodStart]         = useState("");
  const [periodEnd, setPeriodEnd]             = useState("");
  const [reportName, setReportName]           = useState("");
  const [customising, setCustomising]         = useState(false);

  useEffect(() => {
    Promise.all([
      api("/reports/definitions"),
      api("/intelligence/periods"),
      api("/reports/exports"),
    ])
      .then(([d, p, e]) => {
        setDefinitions(d);
        const periodList = p.periods ?? [];
        setPeriods(periodList);
        setExports(e.exports ?? []);

        // Default to latest period for both start and end
        if (periodList.length) {
          const latest = periodList[periodList.length - 1].period_label;
          const earliest = periodList[0].period_label;
          setPeriodStart(earliest);
          setPeriodEnd(latest);
        }

        // Apply default preset
        const defaultPreset = d.audience_presets?.find(p => p.id === "apra");
        if (defaultPreset) {
          setSelectedSections(defaultPreset.sections);
          setDetailLevel(defaultPreset.detail_level);
        }
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // Apply a preset
  function applyPreset(preset) {
    setSelectedPreset(preset.id);
    setDetailLevel(preset.detail_level);
    if (preset.id !== "custom") {
      setSelectedSections([...preset.sections]);
      setCustomising(false);
    } else {
      setCustomising(true);
    }
  }

  function toggleSection(sectionId, required) {
    if (required) return;
    setSelectedSections(prev =>
      prev.includes(sectionId)
        ? prev.filter(s => s !== sectionId)
        : [...prev, sectionId]
    );
  }

  async function generatePDF() {
    setError(""); setSuccess(""); setGenerating(true);
    try {
      const res = await fetch("/api/reports/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("beacon_token")}`,
        },
        body: JSON.stringify({
          sections:        selectedSections,
          detail_level:    detailLevel,
          period_start:    periodStart,
          period_end:      periodEnd,
          audience_preset: selectedPreset,
          report_name:     reportName || undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Generation failed");
      }

      // Trigger download
      const blob    = await res.blob();
      const url     = URL.createObjectURL(blob);
      const a       = document.createElement("a");
      const cd      = res.headers.get("Content-Disposition") ?? "";
      const fnMatch = cd.match(/filename="([^"]+)"/);
      a.href        = url;
      a.download    = fnMatch?.[1] ?? "beacon_report.pdf";
      a.click();
      URL.revokeObjectURL(url);

      setSuccess("Report downloaded successfully.");
      // Refresh export history
      api("/reports/exports").then(e => setExports(e.exports ?? [])).catch(() => {});
    } catch (err) {
      setError(err.message || "Failed to generate report");
    } finally {
      setGenerating(false);
    }
  }

  if (loading) return <div className="loading-spinner">Loading report builder…</div>;

  const { audience_presets = [], sections = [], detail_levels = [] } = definitions ?? {};
  const activePreset = audience_presets.find(p => p.id === selectedPreset);

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Intelligence <em>Reports</em></div>
          <div className="page-subtitle">Generate PDF intelligence packs for board, regulators, and internal teams</div>
        </div>
      </div>

      <div className="page-body" style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 24, alignItems: "start" }}>

        {/* ── Left: Configuration ── */}
        <div>
          {error   && <div className="alert alert-error"   style={{ marginBottom: 20 }}>{error}</div>}
          {success && <div className="alert alert-success" style={{ marginBottom: 20 }}>{success}</div>}

          {/* Audience preset selector */}
          <div className="chart-card" style={{ marginBottom: 20 }}>
            <div className="chart-title">Audience Preset</div>
            <div className="chart-subtitle">Choose a preset or customise your own selection</div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 4 }}>
              {audience_presets.map(preset => (
                <div
                  key={preset.id}
                  onClick={() => applyPreset(preset)}
                  style={{
                    padding: "14px 16px", borderRadius: 10, cursor: "pointer",
                    border: `2px solid ${selectedPreset === preset.id ? preset.color : "var(--border)"}`,
                    background: selectedPreset === preset.id ? `${preset.color}14` : "var(--navy-deep)",
                    transition: "all 0.15s",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: preset.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: selectedPreset === preset.id ? preset.color : "var(--text)" }}>
                      {preset.label}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-faint)", lineHeight: 1.4, paddingLeft: 16 }}>
                    {preset.description}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Period range */}
          <div className="chart-card" style={{ marginBottom: 20 }}>
            <div className="chart-title">Period Range</div>
            <div className="chart-subtitle">Select the start and end periods to include in the report</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 8 }}>
              <div>
                <label style={{ display: "block", fontSize: 11, color: "var(--text-faint)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>From</label>
                <select
                  value={periodStart}
                  onChange={e => setPeriodStart(e.target.value)}
                  style={{ width: "100%", background: "var(--navy-deep)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: 13, padding: "10px 12px", outline: "none" }}
                >
                  {periods.map(p => (
                    <option key={p.period_label} value={p.period_label}>{periodLabel(p.period_label)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ display: "block", fontSize: 11, color: "var(--text-faint)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>To</label>
                <select
                  value={periodEnd}
                  onChange={e => setPeriodEnd(e.target.value)}
                  style={{ width: "100%", background: "var(--navy-deep)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: 13, padding: "10px 12px", outline: "none" }}
                >
                  {periods.filter(p => p.period_label >= periodStart).map(p => (
                    <option key={p.period_label} value={p.period_label}>{periodLabel(p.period_label)}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Sections */}
          <div className="chart-card" style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <div className="chart-title">Sections</div>
              <button
                className="btn-action"
                onClick={() => setCustomising(!customising)}
                style={{ fontSize: 11 }}
              >
                {customising ? "Lock to preset" : "Customise"}
              </button>
            </div>
            <div className="chart-subtitle">
              {customising ? "Select which sections to include" : `${activePreset?.label} includes ${selectedSections.length} section${selectedSections.length !== 1 ? "s" : ""}`}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
              {sections.map(section => {
                const included = selectedSections.includes(section.id);
                const disabled = section.required || !customising;
                return (
                  <div
                    key={section.id}
                    onClick={() => customising && toggleSection(section.id, section.required)}
                    style={{
                      display: "flex", alignItems: "center", gap: 12, padding: "10px 14px",
                      borderRadius: 8, cursor: customising && !section.required ? "pointer" : "default",
                      background: included ? "rgba(59,130,246,0.08)" : "var(--navy-deep)",
                      border: `1px solid ${included ? "rgba(59,130,246,0.3)" : "var(--border)"}`,
                      transition: "all 0.15s", opacity: disabled && !included ? 0.45 : 1,
                    }}
                  >
                    <div style={{
                      width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                      background: included ? "var(--electric)" : "transparent",
                      border: `2px solid ${included ? "var(--electric)" : "var(--border)"}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 11, color: "white", fontWeight: 700,
                    }}>
                      {included ? "✓" : ""}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, color: included ? "var(--text)" : "var(--text-dim)", fontWeight: included ? 500 : 400 }}>
                        {section.label}
                        {section.required && <span style={{ fontSize: 10, color: "var(--text-faint)", marginLeft: 6, fontFamily: "var(--font-mono)" }}>always on</span>}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 1 }}>{section.description}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Detail level */}
          <div className="chart-card" style={{ marginBottom: 20 }}>
            <div className="chart-title">Detail Level</div>
            <div className="chart-subtitle">Controls how much cohort breakdown is shown in each section</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
              {detail_levels.map(level => (
                <div
                  key={level.id}
                  onClick={() => setDetailLevel(level.id)}
                  style={{
                    display: "flex", alignItems: "center", gap: 12, padding: "10px 14px",
                    borderRadius: 8, cursor: "pointer",
                    background: detailLevel === level.id ? "rgba(59,130,246,0.08)" : "var(--navy-deep)",
                    border: `1px solid ${detailLevel === level.id ? "rgba(59,130,246,0.3)" : "var(--border)"}`,
                    transition: "all 0.15s",
                  }}
                >
                  <div style={{
                    width: 16, height: 16, borderRadius: "50%", flexShrink: 0,
                    background: detailLevel === level.id ? "var(--electric)" : "transparent",
                    border: `2px solid ${detailLevel === level.id ? "var(--electric)" : "var(--border)"}`,
                  }} />
                  <div>
                    <div style={{ fontSize: 13, color: detailLevel === level.id ? "var(--text)" : "var(--text-dim)", fontWeight: detailLevel === level.id ? 500 : 400 }}>
                      {level.label}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 1 }}>{level.description}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Optional file name */}
          <div className="chart-card">
            <div className="chart-title">Report Name <span style={{ fontWeight: 400, color: "var(--text-faint)", fontSize: 12 }}>(optional)</span></div>
            <input
              type="text"
              placeholder={`Beacon_${activePreset?.label ?? "Report"}_${periodLabel(periodEnd)}`}
              value={reportName}
              onChange={e => setReportName(e.target.value)}
              style={{ width: "100%", marginTop: 12, background: "var(--navy-deep)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)", fontFamily: "var(--font-sans)", fontSize: 14, padding: "10px 14px", outline: "none" }}
            />
          </div>
        </div>

        {/* ── Right: Summary + Generate ── */}
        <div style={{ position: "sticky", top: 28 }}>
          <div className="chart-card" style={{ marginBottom: 16 }}>
            <div className="chart-title" style={{ marginBottom: 16 }}>Report Summary</div>

            <div style={{ fontSize: 12, color: "var(--text-faint)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Audience</div>
            <div style={{ fontSize: 14, color: "var(--text)", marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: activePreset?.color ?? "var(--electric)" }} />
              {activePreset?.label ?? "Custom"}
            </div>

            <div style={{ fontSize: 12, color: "var(--text-faint)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Period</div>
            <div style={{ fontSize: 14, color: "var(--text)", marginBottom: 14 }}>
              {periodStart === periodEnd
                ? periodLabel(periodStart)
                : `${periodLabel(periodStart)} – ${periodLabel(periodEnd)}`}
            </div>

            <div style={{ fontSize: 12, color: "var(--text-faint)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Sections ({selectedSections.length})</div>
            {selectedSections.map(id => {
              const s = sections.find(x => x.id === id);
              return s ? (
                <div key={id} style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ color: "var(--success)" }}>✓</span> {s.label}
                </div>
              ) : null;
            })}

            <div style={{ height: 1, background: "var(--border)", margin: "16px 0" }} />

            <div style={{ fontSize: 12, color: "var(--text-faint)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Detail Level</div>
            <div style={{ fontSize: 14, color: "var(--text)", marginBottom: 16 }}>
              {detail_levels.find(d => d.id === detailLevel)?.label ?? detailLevel}
            </div>

            <button
              className="btn-primary"
              onClick={generatePDF}
              disabled={generating || selectedSections.length === 0 || !periodStart}
              style={{ marginTop: 0 }}
            >
              {generating ? "Generating PDF…" : "⬇ Download PDF"}
            </button>
          </div>

          {/* Export history */}
          {exports.length > 0 && (
            <div className="chart-card">
              <div className="chart-title" style={{ marginBottom: 12 }}>Recent Exports</div>
              {exports.slice(0, 6).map(ex => (
                <div key={ex.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                  <div>
                    <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{periodLabel(ex.period_label)}</div>
                    <div style={{ fontSize: 11, color: "var(--text-faint)" }}>{ex.exported_by_name}</div>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-faint)", fontFamily: "var(--font-mono)" }}>
                    {new Date(ex.created_at).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
