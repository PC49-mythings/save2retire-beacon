// ─── Beacon — Fund Org Management Routes ─────────────────────────────────────
// Routes for org_admin to manage their own fund portal:
//   users (invite, role change, deactivate)
//   branding (logo, colours)
//   API keys
//   push export config
// ─────────────────────────────────────────────────────────────────────────────
const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const { query } = require("../db");
const {
  requireBeaconAuth,
  requireOrgRole,
  injectFundOrgScope,
} = require("../middleware/auth");

const router = express.Router();

router.use(requireBeaconAuth);
router.use(requireOrgRole("org_admin", "org_analyst", "org_reporter"));
router.use(injectFundOrgScope);

// ─── Org Profile ──────────────────────────────────────────────────────────────

// GET /api/org/profile — own fund org details
router.get("/profile", async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, display_name, short_name, logo_url, primary_color,
              is_active, access_level, contract_start, contract_end,
              apra_reporting_enabled, api_access_enabled, push_export_enabled,
              push_endpoint_url, push_frequency, min_population_threshold
       FROM beacon.fund_orgs WHERE id = $1`,
      [req.fundOrgId]
    );
    if (!rows.length) return res.status(404).json({ error: "Fund org not found" });
    res.json({ fund_org: rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Failed to load org profile" });
  }
});

// PUT /api/org/branding — update visual branding (org_admin only)
router.put("/branding", requireOrgRole("org_admin"), async (req, res) => {
  try {
    const { display_name, short_name, logo_url, primary_color } = req.body;
    const updates = {};
    if (display_name !== undefined) updates.display_name = display_name;
    if (short_name !== undefined)   updates.short_name = short_name;
    if (logo_url !== undefined)     updates.logo_url = logo_url;
    if (primary_color !== undefined) updates.primary_color = primary_color;

    if (!Object.keys(updates).length) return res.status(400).json({ error: "No fields to update" });

    const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`).join(", ");
    const { rows } = await query(
      `UPDATE beacon.fund_orgs SET ${setClauses}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [req.fundOrgId, ...Object.values(updates)]
    );

    await query(
      "INSERT INTO beacon.audit_log (user_id, fund_org_id, action, detail, ip_address) VALUES ($1,$2,$3,$4,$5)",
      [req.user.sub, req.fundOrgId, "org.branding_update", JSON.stringify(updates), req.ip]
    );

    res.json({ fund_org: rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Failed to update branding" });
  }
});

// PUT /api/org/push-config — update push export configuration (org_admin, if feature enabled)
router.put("/push-config", requireOrgRole("org_admin"), async (req, res) => {
  try {
    const { push_endpoint_url, push_frequency } = req.body;

    // Verify push_export_enabled for this org
    const { rows: orgRows } = await query(
      "SELECT push_export_enabled FROM beacon.fund_orgs WHERE id = $1",
      [req.fundOrgId]
    );
    if (!orgRows[0]?.push_export_enabled) {
      return res.status(403).json({ error: "Push export is not enabled for your organisation. Contact your account manager." });
    }

    const validFrequencies = ["daily", "weekly", "monthly"];
    if (push_frequency && !validFrequencies.includes(push_frequency)) {
      return res.status(400).json({ error: "Invalid push_frequency" });
    }

    const { rows } = await query(
      `UPDATE beacon.fund_orgs
       SET push_endpoint_url = COALESCE($2, push_endpoint_url),
           push_frequency = COALESCE($3, push_frequency),
           updated_at = NOW()
       WHERE id = $1 RETURNING push_endpoint_url, push_frequency`,
      [req.fundOrgId, push_endpoint_url || null, push_frequency || null]
    );

    res.json({ push_config: rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Failed to update push config" });
  }
});

// ─── Users ────────────────────────────────────────────────────────────────────

// GET /api/org/users — list users in this fund org
router.get("/users", async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT
        u.id, u.email, u.name, u.last_login, u.is_active AS user_active,
        fou.org_role, fou.invite_accepted_at, fou.is_active AS org_active,
        fou.created_at AS added_at,
        inv.name AS invited_by_name
      FROM beacon.fund_org_users fou
      JOIN beacon.users u ON u.id = fou.user_id
      LEFT JOIN beacon.users inv ON inv.id = fou.invited_by
      WHERE fou.fund_org_id = $1
      ORDER BY fou.org_role, u.name
    `, [req.fundOrgId]);
    res.json({ users: rows });
  } catch (err) {
    res.status(500).json({ error: "Failed to load users" });
  }
});

// POST /api/org/users/invite — invite a new user by email
router.post("/users/invite", requireOrgRole("org_admin"), async (req, res) => {
  try {
    const { email, name, org_role } = req.body;
    const validRoles = ["org_admin", "org_analyst", "org_reporter"];

    if (!email || !name) return res.status(400).json({ error: "email and name required" });
    if (!validRoles.includes(org_role)) return res.status(400).json({ error: "Invalid org_role" });

    const normalised = email.toLowerCase().trim();

    // Check if user already exists in Beacon
    let userId;
    const { rows: existingUser } = await query(
      "SELECT id FROM beacon.users WHERE email = $1",
      [normalised]
    );

    if (existingUser.length) {
      userId = existingUser[0].id;

      // Check if already in this org
      const { rows: existingMembership } = await query(
        "SELECT id, is_active FROM beacon.fund_org_users WHERE user_id = $1 AND fund_org_id = $2",
        [userId, req.fundOrgId]
      );
      if (existingMembership.length) {
        if (existingMembership[0].is_active) {
          return res.status(409).json({ error: "User is already a member of this organisation" });
        } else {
          // Reactivate
          await query(
            "UPDATE beacon.fund_org_users SET is_active = true, org_role = $1, invited_by = $2 WHERE id = $3",
            [org_role, req.user.sub, existingMembership[0].id]
          );
          return res.json({ message: "User reactivated", user_id: userId });
        }
      }
    } else {
      // Create a placeholder user (they set password on invite acceptance)
      const tempHash = await bcrypt.hash(uuidv4(), 10); // placeholder — overwritten on accept
      const { rows: newUser } = await query(
        "INSERT INTO beacon.users (email, name, password_hash, role) VALUES ($1,$2,$3,'fund_user') RETURNING id",
        [normalised, name, tempHash]
      );
      userId = newUser[0].id;
    }

    // Create fund_org_users row (not yet accepted)
    await query(
      `INSERT INTO beacon.fund_org_users (user_id, fund_org_id, org_role, invited_by)
       VALUES ($1, $2, $3, $4)`,
      [userId, req.fundOrgId, org_role, req.user.sub]
    );

    // Create invite token
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    await query(
      `INSERT INTO beacon.invite_tokens (user_id, fund_org_id, token_hash, expires_at)
       VALUES ($1, $2, $3, NOW() + INTERVAL '7 days')`,
      [userId, req.fundOrgId, tokenHash]
    );

    // In production: send invite email here
    // For now: return the token so platform can share it
    await query(
      "INSERT INTO beacon.audit_log (user_id, fund_org_id, action, detail, ip_address) VALUES ($1,$2,$3,$4,$5)",
      [req.user.sub, req.fundOrgId, "org.user_invite", JSON.stringify({ email: normalised, org_role }), req.ip]
    );

    res.status(201).json({
      message: "Invite created",
      user_id: userId,
      invite_token: token,  // In prod: sent via email, not returned here
      invite_url: `/invite/${token}`,
    });
  } catch (err) {
    console.error("invite error:", err);
    res.status(500).json({ error: "Failed to create invite" });
  }
});

// PUT /api/org/users/:userId — update user's org_role
router.put("/users/:userId", requireOrgRole("org_admin"), async (req, res) => {
  try {
    const { org_role, is_active } = req.body;
    const validRoles = ["org_admin", "org_analyst", "org_reporter"];

    if (org_role && !validRoles.includes(org_role)) {
      return res.status(400).json({ error: "Invalid org_role" });
    }

    const updates = {};
    if (org_role !== undefined) updates.org_role = org_role;
    if (is_active !== undefined) updates.is_active = is_active;

    const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 3}`).join(", ");
    const { rows } = await query(
      `UPDATE beacon.fund_org_users SET ${setClauses}
       WHERE user_id = $1 AND fund_org_id = $2 RETURNING *`,
      [req.params.userId, req.fundOrgId, ...Object.values(updates)]
    );
    if (!rows.length) return res.status(404).json({ error: "User not found in this organisation" });

    res.json({ membership: rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Failed to update user" });
  }
});

// ─── API Keys ─────────────────────────────────────────────────────────────────

// GET /api/org/api-keys
router.get("/api-keys", requireOrgRole("org_admin", "org_analyst"), async (req, res) => {
  try {
    // Verify API access is enabled
    const { rows: orgRows } = await query(
      "SELECT api_access_enabled FROM beacon.fund_orgs WHERE id = $1",
      [req.fundOrgId]
    );
    if (!orgRows[0]?.api_access_enabled) {
      return res.status(403).json({ error: "API access is not enabled for your organisation." });
    }

    const { rows } = await query(`
      SELECT k.id, k.key_prefix, k.label, k.scopes, k.last_used_at,
             k.expires_at, k.is_active, k.created_at, u.name AS created_by_name
      FROM beacon.api_keys k
      JOIN beacon.users u ON u.id = k.created_by
      WHERE k.fund_org_id = $1
      ORDER BY k.created_at DESC
    `, [req.fundOrgId]);

    res.json({ api_keys: rows });
  } catch (err) {
    res.status(500).json({ error: "Failed to load API keys" });
  }
});

// POST /api/org/api-keys — generate new API key
router.post("/api-keys", requireOrgRole("org_admin"), async (req, res) => {
  try {
    const { label, scopes = ["feed.read"], expires_at } = req.body;
    if (!label) return res.status(400).json({ error: "label required" });

    const { rows: orgRows } = await query(
      "SELECT api_access_enabled FROM beacon.fund_orgs WHERE id = $1",
      [req.fundOrgId]
    );
    if (!orgRows[0]?.api_access_enabled) {
      return res.status(403).json({ error: "API access is not enabled for your organisation." });
    }

    // Generate key: bkn_ + 32 random chars
    const rawKey = "bkn_" + crypto.randomBytes(16).toString("hex");
    const keyPrefix = rawKey.substring(0, 12); // "bkn_" + 8 chars
    const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");

    const { rows } = await query(`
      INSERT INTO beacon.api_keys
        (fund_org_id, created_by, key_hash, key_prefix, label, scopes, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, key_prefix, label, scopes, expires_at, created_at
    `, [req.fundOrgId, req.user.sub, keyHash, keyPrefix, label,
        JSON.stringify(scopes), expires_at || null]);

    await query(
      "INSERT INTO beacon.audit_log (user_id, fund_org_id, action, detail, ip_address) VALUES ($1,$2,$3,$4,$5)",
      [req.user.sub, req.fundOrgId, "api_key.create", JSON.stringify({ label }), req.ip]
    );

    // Return the full key ONCE — never stored in plaintext
    res.status(201).json({
      api_key: rows[0],
      key: rawKey,  // ← shown to user once, then gone
      warning: "Copy this key now. It will not be shown again.",
    });
  } catch (err) {
    console.error("api key create error:", err);
    res.status(500).json({ error: "Failed to create API key" });
  }
});

// DELETE /api/org/api-keys/:id — revoke API key
router.delete("/api-keys/:id", requireOrgRole("org_admin"), async (req, res) => {
  try {
    const { rows } = await query(
      "UPDATE beacon.api_keys SET is_active = false WHERE id = $1 AND fund_org_id = $2 RETURNING id, label",
      [req.params.id, req.fundOrgId]
    );
    if (!rows.length) return res.status(404).json({ error: "API key not found" });

    await query(
      "INSERT INTO beacon.audit_log (user_id, fund_org_id, action, detail, ip_address) VALUES ($1,$2,$3,$4,$5)",
      [req.user.sub, req.fundOrgId, "api_key.revoke", JSON.stringify({ label: rows[0].label }), req.ip]
    );

    res.json({ message: "API key revoked", key_id: rows[0].id });
  } catch (err) {
    res.status(500).json({ error: "Failed to revoke API key" });
  }
});

module.exports = router;
