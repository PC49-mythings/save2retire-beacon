// ─── Beacon Health Route ──────────────────────────────────────────────────────
const express = require("express");
const { pool, query } = require("../db");

const router = express.Router();

// GET /api/health
router.get("/", async (req, res) => {
  const checks = {};
  let allOk = true;

  // ── DB connectivity ────────────────────────────────────────────────────────
  try {
    await pool.query("SELECT 1");
    checks.db = { status: "ok" };
  } catch (err) {
    checks.db = { status: "error", message: err.message };
    allOk = false;
  }

  // ── Beacon schema tables ───────────────────────────────────────────────────
  const requiredTables = [
    "users", "fund_orgs", "fund_org_users", "api_keys",
    "intelligence_snapshots", "pipeline_runs", "audit_log", "system_settings",
  ];
  try {
    const { rows } = await query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'beacon' AND table_name = ANY($1)`,
      [requiredTables]
    );
    const found = rows.map(r => r.table_name);
    const missing = requiredTables.filter(t => !found.includes(t));
    checks.schema = missing.length === 0
      ? { status: "ok", tables: found.length }
      : { status: "error", missing };
    if (missing.length > 0) allOk = false;
  } catch (err) {
    checks.schema = { status: "error", message: err.message };
    allOk = false;
  }

  // ── S2R views ──────────────────────────────────────────────────────────────
  try {
    const { rows } = await query(
      `SELECT viewname FROM pg_views
       WHERE schemaname = 'public' AND viewname LIKE 'v_beacon_%'`
    );
    checks.s2r_views = { status: rows.length >= 4 ? "ok" : "warning", count: rows.length, views: rows.map(r => r.viewname) };
    if (rows.length === 0) allOk = false;
  } catch (err) {
    checks.s2r_views = { status: "error", message: err.message };
    allOk = false;
  }

  // ── Platform users ─────────────────────────────────────────────────────────
  try {
    const { rows } = await query(
      "SELECT COUNT(*) AS n FROM users WHERE role = 'platform_owner' AND is_active = TRUE"
    );
    const n = parseInt(rows[0].n);
    checks.platform_users = n > 0
      ? { status: "ok", platform_owners: n }
      : { status: "warning", message: "No active platform_owner users found. Run seed script." };
  } catch (err) {
    checks.platform_users = { status: "error", message: err.message };
  }

  // ── Mock data ──────────────────────────────────────────────────────────────
  try {
    const { rows } = await query(
      "SELECT COUNT(*) AS n FROM intelligence_snapshots WHERE data_source = 'mock'"
    );
    const n = parseInt(rows[0].n);
    checks.mock_data = { status: n > 0 ? "ok" : "warning", rows: n };
  } catch (err) {
    checks.mock_data = { status: "error", message: err.message };
  }

  // ── Last pipeline run ──────────────────────────────────────────────────────
  try {
    const { rows } = await query(
      "SELECT status, run_type, completed_at FROM pipeline_runs ORDER BY started_at DESC LIMIT 1"
    );
    checks.pipeline = rows.length > 0
      ? { status: "ok", last_run: rows[0] }
      : { status: "warning", message: "No pipeline runs found. Mock data is in use." };
  } catch (err) {
    checks.pipeline = { status: "error", message: err.message };
  }

  res.status(allOk ? 200 : 503).json({
    status: allOk ? "ok" : "degraded",
    app: "beacon",
    version: "0.1.0",
    time: new Date().toISOString(),
    checks,
  });
});

module.exports = router;
