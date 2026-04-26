import { useState, useEffect } from "react";
import { api } from "../../lib/api";

export default function Pipeline() {
  const [runs, setRuns]           = useState([]);
  const [loading, setLoading]     = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [error, setError]         = useState("");

  useEffect(() => {
    api("/admin/pipeline/runs")
      .then(d => setRuns(d.runs ?? []))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  async function triggerRun() {
    setTriggering(true);
    try {
      const data = await api("/admin/pipeline/run", { method: "POST", body: { run_type: "full" } });
      setRuns(prev => [data.run, ...prev]);
    } catch (err) {
      setError(err.message);
    } finally {
      setTriggering(false);
    }
  }

  function duration(run) {
    if (!run.completed_at || !run.started_at) return "—";
    return `${Math.round((new Date(run.completed_at) - new Date(run.started_at)) / 1000)}s`;
  }

  if (loading) return <div className="loading-spinner">Loading pipeline history…</div>;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Intelligence <em>Pipeline</em></div>
          <div className="page-subtitle">Classification and aggregation job history</div>
        </div>
        <button className="btn-action" onClick={triggerRun} disabled={triggering}>
          {triggering ? "Triggering…" : "▶ Run pipeline"}
        </button>
      </div>

      <div className="page-body">
        {error && <div className="alert alert-error" style={{ marginBottom: 20 }}>{error}</div>}

        {!runs.length ? (
          <div className="empty-state">
            <p>No runs recorded yet. Phase 6 connects the live pipeline to save2retire data.</p>
          </div>
        ) : (
          <div style={{ background: "var(--navy)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Orgs</th>
                  <th>Snapshots</th>
                  <th>Questions</th>
                  <th>Triggered by</th>
                  <th>Duration</th>
                </tr>
              </thead>
              <tbody>
                {runs.map(run => (
                  <tr key={run.id}>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-faint)" }}>
                      {run.id.slice(0, 8)}…
                    </td>
                    <td style={{ fontFamily: "var(--font-mono)" }}>{run.run_type}</td>
                    <td>
                      <span className={`status-pill ${run.status === "completed" ? "active" : run.status === "running" ? "running" : "inactive"}`}>
                        {run.status}
                      </span>
                    </td>
                    <td style={{ color: "var(--text)" }}>{run.orgs_processed ?? "—"}</td>
                    <td style={{ color: "var(--text)" }}>{run.snapshots_written ?? "—"}</td>
                    <td style={{ color: "var(--text)" }}>{run.questions_classified ?? "—"}</td>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-faint)" }}>
                      {run.triggered_by}
                    </td>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{duration(run)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
