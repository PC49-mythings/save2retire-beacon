import { useState, useEffect } from "react";
import { api } from "../../lib/api";

export default function Settings({ orgRole }) {
  const [tab, setTab] = useState("users");

  const tabs = [
    { id: "users",   label: "Users" },
    { id: "branding", label: "Branding" },
    { id: "api",     label: "API Keys" },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Portal <em>Settings</em></div>
          <div className="page-subtitle">User management, branding, and API access</div>
        </div>
      </div>
      <div className="page-body">
        {/* Tab bar */}
        <div style={{ display: "flex", gap: 4, marginBottom: 24, borderBottom: "1px solid var(--border)", paddingBottom: 0 }}>
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                background: "transparent", border: "none", cursor: "pointer",
                padding: "10px 18px", fontSize: 13, fontFamily: "var(--font-sans)",
                color: tab === t.id ? "var(--electric)" : "var(--text-dim)",
                borderBottom: `2px solid ${tab === t.id ? "var(--electric)" : "transparent"}`,
                marginBottom: -1, transition: "all 0.15s", fontWeight: tab === t.id ? 500 : 400,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "users"   && <UsersTab orgRole={orgRole} />}
        {tab === "branding" && <ComingSoonTab
          title="White-label Branding"
          description="Customise Beacon to match your fund's visual identity — logo, brand colours, and custom domain."
          features={["Fund logo upload","Primary brand colour","Custom portal domain (e.g. insights.yourfund.com.au)","Custom email sender domain","PDF report header and footer branding"]}
        />}
        {tab === "api" && <ComingSoonTab
          title="API Access & Push Export"
          description="Connect your data warehouse, PowerBI, or reporting tools directly to Beacon intelligence data."
          features={["Generate scoped API keys","Query intelligence snapshots via REST","Schedule automated push exports","HMAC-signed payloads for secure delivery","PowerBI and Tableau connector support"]}
        />}
      </div>
    </div>
  );
}

// ─── Users tab ────────────────────────────────────────────────────────────────
function UsersTab({ orgRole }) {
  const [users, setUsers]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState("");
  const [showInvite, setShowInvite] = useState(false);

  const isAdmin = orgRole === "org_admin";

  useEffect(() => {
    api("/org/users")
      .then(d => setUsers(d.users ?? []))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  async function deactivateUser(userId) {
    if (!confirm("Remove this user's access? They can be re-invited later.")) return;
    try {
      await api(`/org/users/${userId}`, { method: "PUT", body: { is_active: false } });
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, org_active: false } : u));
    } catch (err) {
      setError(err.message);
    }
  }

  async function changeRole(userId, org_role) {
    try {
      await api(`/org/users/${userId}`, { method: "PUT", body: { org_role } });
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, org_role } : u));
    } catch (err) {
      setError(err.message);
    }
  }

  function onInvited(newUser) {
    setUsers(prev => [...prev, newUser]);
    setShowInvite(false);
  }

  if (loading) return <div className="loading-spinner">Loading users…</div>;

  const activeUsers   = users.filter(u => u.org_active);
  const inactiveUsers = users.filter(u => !u.org_active);

  const roleColors = {
    org_admin:    "#3b82f6",
    org_analyst:  "#10b981",
    org_reporter: "#f59e0b",
  };

  return (
    <div>
      {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: "var(--text-dim)" }}>
          {activeUsers.length} active user{activeUsers.length !== 1 ? "s" : ""}
          {inactiveUsers.length > 0 && ` · ${inactiveUsers.length} inactive`}
        </div>
        {isAdmin && (
          <button className="btn-action" onClick={() => setShowInvite(true)}>+ Invite user</button>
        )}
      </div>

      {showInvite && (
        <InviteForm onInvited={onInvited} onCancel={() => setShowInvite(false)} />
      )}

      <div style={{ background: "var(--navy)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Last Login</th>
              <th>Invited by</th>
              {isAdmin && <th></th>}
            </tr>
          </thead>
          <tbody>
            {activeUsers.map(user => (
              <tr key={user.id}>
                <td style={{ color: "var(--text)", fontWeight: 500 }}>{user.name}</td>
                <td style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{user.email}</td>
                <td>
                  {isAdmin ? (
                    <select
                      value={user.org_role}
                      onChange={e => changeRole(user.id, e.target.value)}
                      style={{
                        background: "transparent", border: `1px solid ${roleColors[user.org_role] ?? "var(--border)"}`,
                        borderRadius: 6, color: roleColors[user.org_role] ?? "var(--text-dim)",
                        fontFamily: "var(--font-mono)", fontSize: 11, padding: "3px 8px",
                        textTransform: "uppercase", letterSpacing: "0.05em", cursor: "pointer",
                      }}
                    >
                      <option value="org_admin">Admin</option>
                      <option value="org_analyst">Analyst</option>
                      <option value="org_reporter">Reporter</option>
                    </select>
                  ) : (
                    <span style={{
                      fontSize: 11, fontFamily: "var(--font-mono)", textTransform: "uppercase",
                      letterSpacing: "0.05em", color: roleColors[user.org_role] ?? "var(--text-faint)",
                      border: `1px solid ${roleColors[user.org_role] ?? "var(--border)"}`,
                      borderRadius: 6, padding: "2px 8px",
                    }}>
                      {user.org_role?.replace("org_", "")}
                    </span>
                  )}
                </td>
                <td>
                  {user.invite_accepted_at
                    ? <span className="status-pill active">Active</span>
                    : <span className="status-pill running">Pending invite</span>}
                </td>
                <td style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-faint)" }}>
                  {user.last_login
                    ? new Date(user.last_login).toLocaleDateString("en-AU", { day: "numeric", month: "short" })
                    : "Never"}
                </td>
                <td style={{ fontSize: 12, color: "var(--text-faint)" }}>{user.invited_by_name ?? "—"}</td>
                {isAdmin && (
                  <td>
                    <button
                      className="btn-sm"
                      style={{ width: "auto", padding: "4px 12px", color: "var(--error)", borderColor: "rgba(239,68,68,0.3)" }}
                      onClick={() => deactivateUser(user.id)}
                    >
                      Remove
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {activeUsers.length === 0 && (
              <tr><td colSpan={isAdmin ? 7 : 6} style={{ textAlign: "center", color: "var(--text-faint)", padding: "32px 0" }}>No active users.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {inactiveUsers.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div style={{ fontSize: 12, color: "var(--text-faint)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10 }}>
            Inactive / Removed
          </div>
          <div style={{ background: "var(--navy)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", opacity: 0.6 }}>
            <table className="data-table">
              <thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead>
              <tbody>
                {inactiveUsers.map(user => (
                  <tr key={user.id}>
                    <td>{user.name}</td>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{user.email}</td>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-faint)" }}>{user.org_role?.replace("org_","")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Invite form ──────────────────────────────────────────────────────────────
function InviteForm({ onInvited, onCancel }) {
  const [name, setName]     = useState("");
  const [email, setEmail]   = useState("");
  const [role, setRole]     = useState("org_analyst");
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState("");
  const [inviteUrl, setInviteUrl] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const data = await api("/org/users/invite", {
        method: "POST",
        body: { name, email, org_role: role },
      });
      setInviteUrl(data.invite_url);
      onInvited({ id: data.user_id, name, email, org_role: role, org_active: true, invite_accepted_at: null });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (inviteUrl) {
    return (
      <div className="chart-card" style={{ marginBottom: 20, border: "1px solid rgba(16,185,129,0.3)" }}>
        <div className="alert alert-success" style={{ marginBottom: 12 }}>
          Invite created for {email}. Share the link below — it expires in 7 days.
        </div>
        <div style={{ background: "var(--navy-deep)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 14px", fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-dim)", wordBreak: "break-all" }}>
          {window.location.origin}{inviteUrl}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 8 }}>
          In production this link is sent by email. For now, copy and share it manually.
        </div>
      </div>
    );
  }

  return (
    <div className="chart-card" style={{ marginBottom: 20, border: "1px solid rgba(59,130,246,0.25)" }}>
      <div className="chart-title" style={{ marginBottom: 16 }}>Invite New User</div>
      {error && <div className="alert alert-error">{error}</div>}
      <form onSubmit={handleSubmit}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 12, alignItems: "end" }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Full Name</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Jane Smith" required />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="jane@fund.com.au" required />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Role</label>
            <select
              value={role}
              onChange={e => setRole(e.target.value)}
              style={{ width: "100%", background: "rgba(5,13,26,0.6)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)", fontFamily: "var(--font-sans)", fontSize: 15, padding: "12px 16px", outline: "none" }}
            >
              <option value="org_admin">Admin</option>
              <option value="org_analyst">Analyst</option>
              <option value="org_reporter">Reporter</option>
            </select>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" className="btn-action" disabled={loading} style={{ padding: "12px 18px" }}>
              {loading ? "Inviting…" : "Send invite"}
            </button>
            <button type="button" className="btn-sm" style={{ width: "auto", padding: "12px 16px" }} onClick={onCancel}>
              Cancel
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

// ─── Coming soon tab ──────────────────────────────────────────────────────────
function ComingSoonTab({ title, description, features = [] }) {
  return (
    <div style={{ maxWidth: 580 }}>
      {/* Header card */}
      <div style={{
        background: "var(--navy)", border: "1px solid var(--border)",
        borderRadius: 12, padding: "28px 32px", marginBottom: 16,
        position: "relative", overflow: "hidden",
      }}>
        {/* Glow */}
        <div style={{
          position: "absolute", top: 0, right: 0, width: 180, height: 180,
          background: "radial-gradient(circle at top right, rgba(59,130,246,0.08), transparent 70%)",
          pointerEvents: "none",
        }} />
        {/* Badge */}
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.25)",
          borderRadius: 20, padding: "4px 12px", marginBottom: 14,
        }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--electric)", boxShadow: "0 0 6px var(--electric)" }} />
          <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--electric)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
            Coming soon
          </span>
        </div>
        <div style={{ fontSize: 18, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.6 }}>{description}</div>
      </div>

      {/* Features list */}
      <div style={{
        background: "var(--navy)", border: "1px solid var(--border)",
        borderRadius: 12, padding: "20px 24px",
      }}>
        <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 14 }}>
          What's included
        </div>
        {features.map((f, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: i < features.length - 1 ? "1px solid var(--border)" : "none" }}>
            <div style={{ width: 18, height: 18, borderRadius: 4, background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--electric)", opacity: 0.7 }} />
            </div>
            <span style={{ fontSize: 13, color: "var(--text-dim)" }}>{f}</span>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 14, fontSize: 12, color: "var(--text-faint)", lineHeight: 1.6 }}>
        Contact your account manager to discuss access or timeline.
      </div>
    </div>
  );
}
