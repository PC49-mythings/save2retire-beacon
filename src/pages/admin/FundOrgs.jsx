import { useState, useEffect } from "react";
import { api } from "../../lib/api";

export default function FundOrgs({ onEnterFund }) {
  const [orgs, setOrgs]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");

  useEffect(() => {
    api("/admin/fund-orgs")
      .then(d => setOrgs(d.fund_orgs ?? []))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading-spinner">Loading fund organisations…</div>;
  if (error)   return <div className="page-body"><div className="alert alert-error">{error}</div></div>;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Fund Org<em>anisations</em></div>
          <div className="page-subtitle">{orgs.length} organisation{orgs.length !== 1 ? "s" : ""} configured</div>
        </div>
        <button className="btn-action">+ New fund org</button>
      </div>

      <div className="page-body">
        <div style={{ background: "var(--navy)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Organisation</th>
                <th>Status</th>
                <th>Access</th>
                <th>Features</th>
                <th>Users</th>
                <th>Periods</th>
                <th>Last data</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {orgs.map(org => {
                const lastData = org.last_data_at
                  ? new Date(org.last_data_at).toLocaleDateString("en-AU", { day: "numeric", month: "short" })
                  : "—";
                return (
                  <tr key={org.id}>
                    <td>
                      <div style={{ fontWeight: 500, color: "var(--text)" }}>{org.display_name}</div>
                      <div style={{ fontSize: 11, color: "var(--text-faint)", fontFamily: "var(--font-mono)", marginTop: 2 }}>
                        {org.s2r_org_slug ?? "—"}
                      </div>
                    </td>
                    <td>
                      <span className={`status-pill ${org.is_active ? "active" : "inactive"}`}>
                        {org.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td>
                      <span className={`access-badge ${org.access_level}`}>{org.access_level}</span>
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <span title="APRA Reporting"><span className={`feature-dot ${org.apra_reporting_enabled ? "on" : "off"}`} />APRA</span>
                      {" · "}
                      <span title="API Access"><span className={`feature-dot ${org.api_access_enabled ? "on" : "off"}`} />API</span>
                      {" · "}
                      <span title="Push Export"><span className={`feature-dot ${org.push_export_enabled ? "on" : "off"}`} />Push</span>
                    </td>
                    <td style={{ color: "var(--text)" }}>{org.user_count}</td>
                    <td style={{ color: "var(--text)", fontFamily: "var(--font-mono)" }}>{org.data_periods}</td>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{lastData}</td>
                    <td>
                      <button className="btn-action" onClick={() => onEnterFund(org)}>
                        View portal →
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!orgs.length && (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", color: "var(--text-faint)", padding: "48px 0" }}>
                    No fund organisations configured yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
