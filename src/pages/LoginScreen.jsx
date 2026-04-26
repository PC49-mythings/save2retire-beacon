import { useState } from "react";
import { api, setToken } from "../lib/api";

export default function LoginScreen({ onLogin }) {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");
  const [mode, setMode]         = useState("login"); // "login" | "forgot" | "forgot_sent"

  async function handleLogin(e) {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const data = await api("/auth/login", { method: "POST", body: { email, password } });
      setToken(data.token);
      onLogin(data);
    } catch (err) {
      setError(err.message || "Login failed. Please try again.");
    } finally { setLoading(false); }
  }

  async function handleForgot(e) {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      await api("/auth/forgot-password/request", { method: "POST", body: { email } });
      setMode("forgot_sent");
    } catch (err) {
      setError(err.message || "Request failed.");
    } finally { setLoading(false); }
  }

  return (
    <div className="login-page">
      <div className="beacon-orb" />
      <div className="beacon-ring" />
      <div className="beacon-ring" />
      <div className="beacon-ring" />

      <div className="login-card">
        <div className="wordmark">
          <div className="wordmark-dot" />
          <div className="wordmark-text">Be<em>a</em>con</div>
        </div>
        <div className="login-subtitle">Member Intelligence Platform</div>

        {mode === "login" && (
          <form onSubmit={handleLogin}>
            {error && <div className="alert alert-error">{error}</div>}
            <div className="field">
              <label>Email</label>
              <input type="email" placeholder="you@fund.com.au" value={email}
                onChange={e => setEmail(e.target.value)} required autoFocus />
            </div>
            <div className="field">
              <label>Password</label>
              <input type="password" placeholder="••••••••" value={password}
                onChange={e => setPassword(e.target.value)} required />
            </div>
            <span className="forgot-link" onClick={() => { setMode("forgot"); setError(""); }}>
              Forgot password?
            </span>
            <button
              type="submit"
              className={`btn-primary${loading ? " loading" : ""}`}
              disabled={loading || !email || !password}
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
        )}

        {mode === "forgot" && (
          <form onSubmit={handleForgot}>
            <div className="alert alert-info">Enter your email — we'll send a reset link.</div>
            {error && <div className="alert alert-error">{error}</div>}
            <div className="field">
              <label>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
            </div>
            <button
              type="submit"
              className={`btn-primary${loading ? " loading" : ""}`}
              disabled={loading || !email}
            >
              {loading ? "Sending…" : "Send reset link"}
            </button>
            <span className="forgot-link" onClick={() => { setMode("login"); setError(""); }}>
              Back to sign in
            </span>
          </form>
        )}

        {mode === "forgot_sent" && (
          <div>
            <div className="alert alert-success">
              Reset link sent if that account exists. Check your inbox.
            </div>
            <button className="btn-primary" onClick={() => setMode("login")}>
              Back to sign in
            </button>
          </div>
        )}

        <div className="login-footer">
          insights.save2retire.ai · Confidential · save2retire Pty Ltd
        </div>
      </div>
    </div>
  );
}
