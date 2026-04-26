// ─── Beacon — Platform Admin Routes ──────────────────────────────────────────
// All routes require platform_admin or higher.
// These are internal save2retire-team-only routes — never exposed to fund users.
// ─────────────────────────────────────────────────────────────────────────────
const express = require("express");
const bcrypt = require("bcryptjs");
const { query } = require("../db");
const {
  requireBeaconAuth,
  requirePlatformAdmin,
  requirePlatformOwner,
  generateToken,
} = require("../middleware/auth");

const router = express.Router();

// All admin routes require auth + platform_admin minimum
router.use(requireBeaconAuth);
router.use(requirePlatformAdmin);

// ─── Fund Orgs ────────────────────────────────────────────────────────────────

// GET /api/admin/fund-orgs — list all fund orgs with summary stats
router.get("/fund-orgs", async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT
        fo.id, fo.display_name, fo.short_name, fo.s2r_org_slug,
        fo.is_active, fo.access_level, fo.contract_start, fo.contract_end,
        fo.apra_reporting_enabled, fo.api_access_enabled, fo.push_export_enabled,
        fo.primary_color, fo.logo_url, fo.min_population_threshold,
        fo.created_at,
        COUNT(DISTINCT fou.user_id) FILTER (WHERE fou.is_active)    AS user_count,
        COUNT(DISTINCT is2.period_label)                             AS data_periods,
        MAX(is2.created_at)                                         AS last_data_at
      FROM beacon.fund_orgs fo
      LEFT JOIN beacon.fund_org_users fou ON fou.fund_org_id = fo.id
      LEFT JOIN beacon.intelligence_snapshots is2 ON is2.fund_org_id = fo.id
      GROUP BY fo.id
      ORDER BY fo.display_name
    `);
    res.json({ fund_orgs: rows });
  } catch (err) {
    console.error("admin fund-orgs list error:", err);
    res.status(500).json({ error: "Failed to load fund orgs" });
  }
});

// POST /api/admin/fund-orgs — create a new fund org
router.post("/fund-orgs", async (req, res) => {
  try {
    const {
      display_name, short_name, s2r_org_id, s2r_org_slug,
      access_level = "demo", primary_color = "#1B3A6B",
      apra_reporting_enabled = false,
      api_access_enabled = false,
      push_export_enabled = false,
      contract_start, contract_end, notes,
    } = req.body;

    if (!display_name) return res.status(400).json({ error: "display_name required" });

    const { rows } = await query(`
      INSERT INTO beacon.fund_orgs
        (display_name, short_name, s2r_org_id, s2r_org_slug, access_level,
         primary_color, apra_reporting_enabled, api_access_enabled,
         push_export_enabled, contract_start, contract_end, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING *
    `, [display_name, short_name, s2r_org_id || null, s2r_org_slug || null,
        access_level, primary_color, apra_reporting_enabled,
        api_access_enabled, push_export_enabled,
        contract_start || null, contract_end || null, notes || null]);

    await query(
      "INSERT INTO beacon.audit_log (user_id, fund_org_id, action, detail, ip_address) VALUES ($1,$2,$3,$4,$5)",
      [req.user.sub, rows[0].id, "fund_org.create", JSON.stringify({ display_name }), req.ip]
    );

    res.status(201).json({ fund_org: rows[0] });
  } catch (err) {
    console.error("admin fund-org create error:", err);
    res.status(500).json({ error: "Failed to create fund org" });
  }
});

// GET /api/admin/fund-orgs/:id — get single fund org detail
router.get("/fund-orgs/:id", async (req, res) => {
  try {
    const { rows: orgRows } = await query(
      "SELECT * FROM beacon.fund_orgs WHERE id = $1",
      [req.params.id]
    );
    if (!orgRows.length) return res.status(404).json({ error: "Fund org not found" });

    const { rows: userRows } = await query(`
      SELECT
        u.id, u.email, u.name, u.last_login, u.is_active,
        fou.org_role, fou.invite_accepted_at, fou.is_active AS org_active,
        inv.email AS invited_by_email
      FROM beacon.fund_org_users fou
      JOIN beacon.users u ON u.id = fou.user_id
      LEFT JOIN beacon.users inv ON inv.id = fou.invited_by
      WHERE fou.fund_org_id = $1
      ORDER BY fou.org_role, u.name
    `, [req.params.id]);

    const { rows: snapRows } = await query(`
      SELECT DISTINCT period_label, MAX(created_at) AS period_at
      FROM beacon.intelligence_snapshots
      WHERE fund_org_id = $1
      GROUP BY period_label
      ORDER BY period_label DESC
      LIMIT 12
    `, [req.params.id]);

    res.json({ fund_org: orgRows[0], users: userRows, data_periods: snapRows });
  } catch (err) {
    console.error("admin fund-org detail error:", err);
    res.status(500).json({ error: "Failed to load fund org" });
  }
});

// PUT /api/admin/fund-orgs/:id — update fund org (platform admin can update all fields)
router.put("/fund-orgs/:id", async (req, res) => {
  try {
    const allowed = [
      "display_name","short_name","s2r_org_id","s2r_org_slug","is_active",
      "access_level","primary_color","logo_url","apra_reporting_enabled",
      "api_access_enabled","push_export_enabled","push_endpoint_url",
      "push_frequency","contract_start","contract_end",
      "min_population_threshold","notes",
    ];
    const updates = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) updates[k] = req.body[k];
    }
    if (!Object.keys(updates).length) return res.status(400).json({ error: "No fields to update" });

    const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`).join(", ");
    const values = [req.params.id, ...Object.values(updates)];

    const { rows } = await query(
      `UPDATE beacon.fund_orgs SET ${setClauses}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      values
    );
    if (!rows.length) return res.status(404).json({ error: "Fund org not found" });

    await query(
      "INSERT INTO beacon.audit_log (user_id, fund_org_id, action, detail, ip_address) VALUES ($1,$2,$3,$4,$5)",
      [req.user.sub, req.params.id, "fund_org.update", JSON.stringify(updates), req.ip]
    );

    res.json({ fund_org: rows[0] });
  } catch (err) {
    console.error("admin fund-org update error:", err);
    res.status(500).json({ error: "Failed to update fund org" });
  }
});

// ─── Platform Users ───────────────────────────────────────────────────────────

// GET /api/admin/users — all Beacon platform users
router.get("/users", async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT
        u.id, u.email, u.name, u.role, u.is_active, u.last_login, u.created_at,
        COALESCE(
          json_agg(
            json_build_object('fund_org_id', fo.id, 'display_name', fo.display_name,
                              'org_role', fou.org_role)
          ) FILTER (WHERE fo.id IS NOT NULL),
          '[]'
        ) AS fund_orgs
      FROM beacon.users u
      LEFT JOIN beacon.fund_org_users fou ON fou.user_id = u.id AND fou.is_active
      LEFT JOIN beacon.fund_orgs fo ON fo.id = fou.fund_org_id
      GROUP BY u.id
      ORDER BY u.role, u.name
    `);
    res.json({ users: rows });
  } catch (err) {
    console.error("admin users list error:", err);
    res.status(500).json({ error: "Failed to load users" });
  }
});

// POST /api/admin/users — create a platform-level user (owner/admin/analyst)
router.post("/users", requirePlatformOwner, async (req, res) => {
  try {
    const { email, name, password, role } = req.body;
    const platformRoles = ["platform_owner", "platform_admin", "platform_analyst"];
    if (!email || !name || !password) return res.status(400).json({ error: "email, name, password required" });
    if (!platformRoles.includes(role)) return res.status(400).json({ error: "Invalid platform role" });

    const existing = await query("SELECT id FROM beacon.users WHERE email = $1", [email.toLowerCase()]);
    if (existing.rows.length) return res.status(409).json({ error: "Email already registered" });

    const hash = await bcrypt.hash(password, 12);
    const { rows } = await query(
      "INSERT INTO beacon.users (email, name, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id, email, name, role, is_active, created_at",
      [email.toLowerCase(), name, hash, role]
    );
    res.status(201).json({ user: rows[0] });
  } catch (err) {
    console.error("admin user create error:", err);
    res.status(500).json({ error: "Failed to create user" });
  }
});

// ─── Pipeline ─────────────────────────────────────────────────────────────────

// GET /api/admin/pipeline/runs — pipeline run history
router.get("/pipeline/runs", async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT id, run_type, status, orgs_processed, snapshots_written,
             questions_classified, errors, started_at, completed_at, triggered_by
      FROM beacon.pipeline_runs
      ORDER BY started_at DESC
      LIMIT 50
    `);
    res.json({ runs: rows });
  } catch (err) {
    console.error("pipeline runs error:", err);
    res.status(500).json({ error: "Failed to load pipeline runs" });
  }
});

// GET /api/admin/pipeline/runs/:id
router.get("/pipeline/runs/:id", async (req, res) => {
  try {
    const { rows } = await query(
      "SELECT * FROM beacon.pipeline_runs WHERE id = $1",
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Run not found" });
    res.json({ run: rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Failed to load run" });
  }
});

// POST /api/admin/pipeline/run — manual trigger (phase 6 — stub returns mock response for now)
router.post("/pipeline/run", async (req, res) => {
  try {
    const { run_type = "full" } = req.body;
    const { rows } = await query(`
      INSERT INTO beacon.pipeline_runs
        (run_type, status, triggered_by, started_at)
      VALUES ($1, 'running', 'manual', NOW())
      RETURNING *
    `, [run_type]);

    await query(
      "INSERT INTO beacon.audit_log (user_id, action, detail, ip_address) VALUES ($1,$2,$3,$4)",
      [req.user.sub, "pipeline.trigger", JSON.stringify({ run_type }), req.ip]
    );

    // Phase 6: this would kick off the real pipeline worker
    // For now, immediately mark as completed (mock)
    setTimeout(async () => {
      try {
        await query(
          "UPDATE beacon.pipeline_runs SET status='completed', completed_at=NOW(), snapshots_written=0, questions_classified=0, orgs_processed=0 WHERE id=$1",
          [rows[0].id]
        );
      } catch {}
    }, 2000);

    res.json({ run: rows[0], message: "Pipeline triggered. Check /api/admin/pipeline/runs for status." });
  } catch (err) {
    console.error("pipeline trigger error:", err);
    res.status(500).json({ error: "Failed to trigger pipeline" });
  }
});

// ─── Platform Settings ────────────────────────────────────────────────────────

// GET /api/admin/settings
router.get("/settings", requirePlatformOwner, async (req, res) => {
  try {
    const { rows } = await query(
      "SELECT key, value, updated_at FROM beacon.system_settings ORDER BY key"
    );
    const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));
    res.json({ settings });
  } catch (err) {
    res.status(500).json({ error: "Failed to load settings" });
  }
});

// PUT /api/admin/settings
router.put("/settings", requirePlatformOwner, async (req, res) => {
  try {
    const { settings } = req.body;
    for (const [key, value] of Object.entries(settings || {})) {
      await query(
        `INSERT INTO beacon.system_settings (key, value, updated_at, updated_by)
         VALUES ($1, $2, NOW(), $3)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW(), updated_by = EXCLUDED.updated_by`,
        [key, String(value), req.user.sub]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to update settings" });
  }
});

// ─── Enter fund view (platform admin previewing as a fund) ────────────────────

// POST /api/admin/enter-fund-view/:id — issue a scoped fund-view token
router.post("/enter-fund-view/:id", async (req, res) => {
  try {
    const { rows } = await query(
      "SELECT * FROM beacon.fund_orgs WHERE id = $1 AND is_active",
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Fund org not found or inactive" });

    const org = rows[0];
    // Issue a modified token that includes fund context but preserves platform role
    const scopedToken = generateToken(
      { id: req.user.sub, email: req.user.email, name: req.user.name, role: req.user.role },
      org.id,
      "org_admin"  // platform user gets highest org role for preview
    );

    await query(
      "INSERT INTO beacon.audit_log (user_id, fund_org_id, action, ip_address) VALUES ($1,$2,$3,$4)",
      [req.user.sub, org.id, "platform.enter_fund_view", req.ip]
    );

    res.json({
      token: scopedToken,
      fund_org: org,
      is_platform_preview: true,
    });
  } catch (err) {
    console.error("enter fund view error:", err);
    res.status(500).json({ error: "Failed to enter fund view" });
  }
});

module.exports = router;
