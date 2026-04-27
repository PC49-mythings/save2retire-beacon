import { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";

import "./styles/global.css";

import { api, getToken, setToken } from "./lib/api";

// Pages
import LoginScreen     from "./pages/LoginScreen";
import ContextSelector from "./pages/ContextSelector";
import FundOrgs        from "./pages/admin/FundOrgs";
import Pipeline        from "./pages/admin/Pipeline";
import Overview        from "./pages/portal/Overview";
import Engagement      from "./pages/portal/Engagement";
import Preparedness    from "./pages/portal/Preparedness";
import Topics          from "./pages/portal/Topics";
import Behaviour       from "./pages/portal/Behaviour";

// Shared components
import Sidebar from "./components/Sidebar";

// Icons for nav
import {
  HomeIcon, ActivityIcon, TargetIcon, BrainIcon, TrendIcon,
  SettingsIcon, BuildingIcon, UsersIcon, PipelineIcon, KeyIcon,
} from "./components/icons";

// ─── Nav definitions ──────────────────────────────────────────────────────────
const ADMIN_NAV = [
  { id: "fund-orgs", label: "Fund Orgs", icon: BuildingIcon },
  { id: "pipeline",  label: "Pipeline",  icon: PipelineIcon },
  { id: "users",     label: "Users",     icon: UsersIcon    },
];

const PORTAL_NAV_BASE = [
  { id: "overview",     label: "Overview",     icon: HomeIcon     },
  { id: "engagement",   label: "Engagement",   icon: ActivityIcon },
  { id: "preparedness", label: "Preparedness", icon: TargetIcon   },
  { id: "topics",       label: "AI Topics",    icon: BrainIcon    },
  { id: "behaviour",    label: "Behaviour",    icon: TrendIcon    },
  { id: "reports",      label: "Reports",      icon: KeyIcon      },
];

const SETTINGS_NAV = { id: "settings", label: "Settings", icon: SettingsIcon };

// ─── Helpers ──────────────────────────────────────────────────────────────────
const PLATFORM_ROLES = new Set(["platform_owner", "platform_admin", "platform_analyst"]);
const isPlatformUser = role => PLATFORM_ROLES.has(role);

// ─── App ──────────────────────────────────────────────────────────────────────
function App() {
  const [screen, setScreen]   = useState("loading");
  const [user, setUser]       = useState(null);
  const [fundOrg, setFundOrg] = useState(null);
  const [orgRole, setOrgRole] = useState(null);
  const [multiOrgs, setMultiOrgs] = useState([]);

  const [isPlatformPreview, setIsPlatformPreview] = useState(false);
  const [savedPlatformToken, setSavedPlatformToken] = useState(null);

  const [adminPage, setAdminPage]   = useState("fund-orgs");
  const [portalPage, setPortalPage] = useState("overview");

  // ── Session restore ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!getToken()) { setScreen("login"); return; }

    api("/auth/me")
      .then(data => {
        setUser(data.user);
        if (data.fund_org)        setFundOrg(data.fund_org);
        if (data.active_org_role) setOrgRole(data.active_org_role);
        setScreen(isPlatformUser(data.user.role) && !data.fund_org ? "platform" : "portal");
      })
      .catch(() => { setToken(null); setScreen("login"); });
  }, []);

  // ── Auth handlers ────────────────────────────────────────────────────────────
  function handleLogin(data) {
    setUser(data.user);
    if (data.requires_context_selection) {
      setMultiOrgs(data.fund_orgs ?? []);
      setScreen("context");
      return;
    }
    if (data.fund_orgs?.[0]) { setFundOrg(data.fund_orgs[0]); setOrgRole(data.active_org_role); }
    setScreen(isPlatformUser(data.user.role) && !data.fund_orgs?.length ? "platform" : "portal");
  }

  function handleContext(data) {
    setFundOrg(data.fund_org); setOrgRole(data.active_org_role); setScreen("portal");
  }

  function handleLogout() {
    api("/auth/logout", { method: "POST" }).catch(() => {});
    setToken(null);
    setUser(null); setFundOrg(null); setOrgRole(null);
    setIsPlatformPreview(false); setSavedPlatformToken(null);
    setScreen("login");
  }

  // ── Platform preview ─────────────────────────────────────────────────────────
  async function handleEnterFund(org) {
    try {
      const data = await api(`/admin/enter-fund-view/${org.id}`, { method: "POST" });
      setSavedPlatformToken(getToken());
      setToken(data.token);
      setFundOrg(data.fund_org); setOrgRole("org_admin");
      setIsPlatformPreview(true); setPortalPage("overview");
      setScreen("portal");
    } catch (err) {
      alert(err.message || "Failed to enter fund view");
    }
  }

  function handleExitPreview() {
    if (savedPlatformToken) setToken(savedPlatformToken);
    setFundOrg(null); setOrgRole(null);
    setIsPlatformPreview(false); setSavedPlatformToken(null);
    setScreen("platform");
  }

  // ── Nav ──────────────────────────────────────────────────────────────────────
  const portalNav = [
    ...PORTAL_NAV_BASE,
    ...(orgRole === "org_admin" ? [SETTINGS_NAV] : []),
  ];

  // ── Render ───────────────────────────────────────────────────────────────────
  if (screen === "loading") return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--navy-deep)" }}>
      <div style={{ color: "var(--text-faint)", fontFamily: "var(--font-mono)", fontSize: 13 }}>Loading Beacon…</div>
    </div>
  );

  if (screen === "login")   return <LoginScreen onLogin={handleLogin} />;
  if (screen === "context") return <ContextSelector fundOrgs={multiOrgs} onContext={handleContext} />;

  if (screen === "platform") return (
    <div className="app-layout">
      <Sidebar navItems={ADMIN_NAV} page={adminPage} setPage={setAdminPage}
        user={user} orgRole={null} fundOrg={null} orgColor={null} onLogout={handleLogout} />
      <main className="main-area">
        {adminPage === "fund-orgs" && <FundOrgs onEnterFund={handleEnterFund} />}
        {adminPage === "pipeline"  && <Pipeline />}
        {adminPage === "users"     && <div className="page-body" style={{ paddingTop: 48 }}><div className="empty-state"><p>Platform user management — Phase 4.</p></div></div>}
      </main>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      {isPlatformPreview && (
        <div className="preview-banner">
          ⚠ Platform preview — viewing as {fundOrg?.display_name}
          <button className="btn-sm" style={{ width: "auto", padding: "4px 14px", marginLeft: "auto" }} onClick={handleExitPreview}>
            Exit preview
          </button>
        </div>
      )}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <Sidebar navItems={portalNav} page={portalPage} setPage={setPortalPage}
          user={user} orgRole={orgRole} fundOrg={fundOrg}
          orgColor={fundOrg?.primary_color} onLogout={handleLogout} />
        <main className="main-area">
          {portalPage === "overview"     && <Overview />}
          {portalPage === "engagement"   && <Engagement />}
          {portalPage === "preparedness" && <Preparedness />}
          {portalPage === "topics"       && <Topics />}
          {portalPage === "behaviour"    && <Behaviour />}
          {portalPage === "reports"       && <Reports />}
          {portalPage === "settings"      && <Settings orgRole={orgRole} />}
          {portalPage === "settings"      && <Settings orgRole={orgRole} />}
        </main>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
