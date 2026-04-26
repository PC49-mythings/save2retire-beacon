import { useState } from "react";
import { api, setToken } from "../lib/api";

export default function ContextSelector({ fundOrgs, onContext }) {
  const [loading, setLoading] = useState(null);

  async function selectOrg(org) {
    setLoading(org.fund_org_id);
    try {
      const data = await api("/auth/select-context", {
        method: "POST",
        body: { fund_org_id: org.fund_org_id },
      });
      setToken(data.token);
      onContext(data);
    } catch {
      // TODO: surface error
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="login-page">
      <div className="beacon-orb" />
      <div className="login-card">
        <div className="wordmark" style={{ marginBottom: 20 }}>
          <div className="wordmark-dot" />
          <div className="wordmark-text">Be<em>a</em>con</div>
        </div>

        <p style={{ fontSize: 14, color: "var(--text-dim)", marginBottom: 16 }}>
          Select your organisation to continue.
        </p>

        {fundOrgs.map(org => (
          <div
            key={org.fund_org_id}
            className="context-item"
            onClick={() => selectOrg(org)}
            style={{ opacity: loading && loading !== org.fund_org_id ? 0.5 : 1 }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, color: "var(--text)", fontWeight: 500 }}>
                {org.display_name}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 2 }}>
                {org.short_name}
              </div>
            </div>
            <span className="context-badge">
              {org.org_role?.replace("org_", "")}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
