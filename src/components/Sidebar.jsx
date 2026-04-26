import { COHORT_LABELS } from "../constants/cohorts";

export default function Sidebar({ navItems, page, setPage, user, orgRole, fundOrg, orgColor, onLogout }) {
  const dotStyle = orgColor
    ? { background: orgColor, boxShadow: `0 0 8px ${orgColor}` }
    : {};

  const roleLabel = fundOrg
    ? (orgRole?.replace("org_", "") ?? "user")
    : (user?.role?.replace("platform_", "") ?? "");

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div className="sidebar-dot" style={dotStyle} />
        <div className="sidebar-wordmark">Be<em>a</em>con</div>
      </div>

      {fundOrg && (
        <div style={{ padding: "10px 20px 12px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontSize: 10, color: "var(--text-faint)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>
            Fund
          </div>
          <div style={{ fontSize: 13, color: "var(--text)", fontWeight: 500 }}>
            {fundOrg.display_name}
          </div>
        </div>
      )}

      <div className="sidebar-section">
        <div className="sidebar-section-label">
          {fundOrg ? "Intelligence" : "Platform"}
        </div>
        {navItems.map(item => (
          <div
            key={item.id}
            className={`nav-item${page === item.id ? " active" : ""}`}
            onClick={() => setPage(item.id)}
          >
            <item.icon />
            {item.label}
          </div>
        ))}
      </div>

      <div className="sidebar-bottom">
        <div className="sidebar-user">{user?.name}</div>
        <div className="sidebar-role">{roleLabel}</div>
        <button className="btn-sm" onClick={onLogout}>Sign out</button>
      </div>
    </aside>
  );
}
