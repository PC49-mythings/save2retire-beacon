// ─── Beacon Auth Routes ────────────────────────────────────────────────────────
const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { query, withTransaction } = require("../db");
const { generateToken, requireBeaconAuth } = require("../middleware/auth");

const router = express.Router();
const isDev = process.env.NODE_ENV !== "production";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/login
// ─────────────────────────────────────────────────────────────────────────────
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    const { rows } = await query(
      `SELECT id, email, name, password_hash, role, is_active, last_login
       FROM users WHERE email = $1`,
      [email.toLowerCase().trim()]
    );

    if (!rows.length) return res.status(401).json({ error: "Invalid email or password" });
    const user = rows[0];
    if (!user.is_active) return res.status(403).json({ error: "Account is disabled. Contact your administrator." });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: "Invalid email or password" });

    // Update last login
    await query("UPDATE users SET last_login = NOW(), updated_at = NOW() WHERE id = $1", [user.id]);
    await query(
      "INSERT INTO audit_log (user_id, action, ip_address) VALUES ($1, $2, $3)",
      [user.id, "auth.login", req.ip]
    );

    // For fund users: look up their fund org memberships
    let activeFundOrgId = null;
    let activeOrgRole = null;
    let fundOrgs = [];

    if (user.role === "fund_user") {
      const { rows: memberships } = await query(
        `SELECT fou.fund_org_id, fou.org_role, fou.is_active,
                fo.display_name, fo.short_name, fo.logo_url, fo.primary_color,
                fo.is_active AS org_active
         FROM fund_org_users fou
         JOIN fund_orgs fo ON fou.fund_org_id = fo.id
         WHERE fou.user_id = $1 AND fou.is_active = TRUE AND fo.is_active = TRUE
         ORDER BY fo.display_name`,
        [user.id]
      );

      fundOrgs = memberships;

      if (memberships.length === 0) {
        return res.status(403).json({ error: "Your account has no active organisation access. Contact your administrator." });
      }

      if (memberships.length === 1) {
        // Single org: set context automatically
        activeFundOrgId = memberships[0].fund_org_id;
        activeOrgRole = memberships[0].org_role;
      }
      // Multiple orgs: user must call /select-context after login
    }

    const token = generateToken(user, activeFundOrgId, activeOrgRole);

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
      active_fund_org_id: activeFundOrgId,
      active_org_role: activeOrgRole,
      fund_orgs: fundOrgs.map(fo => ({
        fund_org_id: fo.fund_org_id,
        org_role: fo.org_role,
        display_name: fo.display_name,
        short_name: fo.short_name,
        logo_url: fo.logo_url,
        primary_color: fo.primary_color,
      })),
      // If multiple orgs, client must call /select-context
      requires_context_selection: user.role === "fund_user" && fundOrgs.length > 1,
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/select-context
// For fund users with multiple org memberships — exchanges partial token
// for a scoped token with active fund_org context set.
// ─────────────────────────────────────────────────────────────────────────────
router.post("/select-context", requireBeaconAuth, async (req, res) => {
  try {
    const { fund_org_id } = req.body;
    if (!fund_org_id) return res.status(400).json({ error: "fund_org_id required" });

    // Verify user has access to this org
    const { rows } = await query(
      `SELECT fou.org_role, fo.display_name, fo.short_name, fo.logo_url, fo.primary_color
       FROM fund_org_users fou
       JOIN fund_orgs fo ON fou.fund_org_id = fo.id
       WHERE fou.user_id = $1 AND fou.fund_org_id = $2
         AND fou.is_active = TRUE AND fo.is_active = TRUE`,
      [req.user.sub, fund_org_id]
    );

    if (!rows.length) {
      return res.status(403).json({ error: "No access to this organisation" });
    }

    const membership = rows[0];
    const userRow = { id: req.user.sub, email: req.user.email, name: req.user.name, role: req.user.role };
    const token = generateToken(userRow, fund_org_id, membership.org_role);

    await query(
      "INSERT INTO audit_log (user_id, fund_org_id, action, ip_address) VALUES ($1, $2, $3, $4)",
      [req.user.sub, fund_org_id, "auth.context_selected", req.ip]
    );

    res.json({
      token,
      active_fund_org_id: fund_org_id,
      active_org_role: membership.org_role,
      fund_org: {
        display_name: membership.display_name,
        short_name: membership.short_name,
        logo_url: membership.logo_url,
        primary_color: membership.primary_color,
      },
    });
  } catch (err) {
    console.error("Select context error:", err);
    res.status(500).json({ error: "Failed to set organisation context" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/auth/me
// ─────────────────────────────────────────────────────────────────────────────
router.get("/me", requireBeaconAuth, async (req, res) => {
  try {
    const { rows } = await query(
      "SELECT id, email, name, role, is_active, last_login FROM users WHERE id = $1",
      [req.user.sub]
    );
    if (!rows.length) return res.status(401).json({ error: "User not found" });
    const user = rows[0];
    if (!user.is_active) return res.status(403).json({ error: "Account is disabled" });

    // If fund user with active org context, fetch org branding
    let fundOrg = null;
    if (req.user.active_fund_org_id) {
      const { rows: orgRows } = await query(
        `SELECT fo.id, fo.display_name, fo.short_name, fo.logo_url, fo.primary_color,
                fo.access_level, fo.apra_reporting_enabled, fo.api_access_enabled,
                fou.org_role
         FROM fund_orgs fo
         JOIN fund_org_users fou ON fou.fund_org_id = fo.id
         WHERE fo.id = $1 AND fou.user_id = $2 AND fo.is_active = TRUE`,
        [req.user.active_fund_org_id, user.id]
      );
      if (orgRows.length) fundOrg = orgRows[0];
    }

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        last_login: user.last_login,
      },
      active_fund_org_id: req.user.active_fund_org_id,
      active_org_role: req.user.active_org_role,
      fund_org: fundOrg,
    });
  } catch (err) {
    console.error("Me error:", err);
    res.status(500).json({ error: "Failed to load user" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/logout
// ─────────────────────────────────────────────────────────────────────────────
router.post("/logout", requireBeaconAuth, async (req, res) => {
  await query(
    "INSERT INTO audit_log (user_id, action, ip_address) VALUES ($1, $2, $3)",
    [req.user.sub, "auth.logout", req.ip]
  ).catch(() => {});
  res.json({ success: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/invite/accept
// Accepts an invite token, sets password, activates fund_org_users record.
// ─────────────────────────────────────────────────────────────────────────────
router.post("/invite/accept", async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: "Token and password required" });
    if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });

    const { rows: tokenRows } = await query(
      `SELECT it.id, it.user_id, it.fund_org_id, it.org_role, it.email, it.expires_at, it.used
       FROM invite_tokens it
       WHERE it.token_hash = $1`,
      [crypto.createHash("sha256").update(token).digest("hex")]
    );

    if (!tokenRows.length) return res.status(400).json({ error: "Invalid or expired invitation" });
    const invite = tokenRows[0];
    if (invite.used) return res.status(400).json({ error: "This invitation has already been used" });
    if (new Date(invite.expires_at) < new Date()) {
      return res.status(400).json({ error: "This invitation has expired. Ask your administrator to resend it." });
    }

    await withTransaction(async (client) => {
      const passwordHash = await bcrypt.hash(password, 12);

      // Create or update user
      let userId = invite.user_id;
      if (!userId) {
        // New user
        const { rows: newUser } = await client.query(
          `INSERT INTO users (email, name, password_hash, role)
           VALUES ($1, $2, $3, 'fund_user')
           ON CONFLICT (email) DO UPDATE SET password_hash = $3, updated_at = NOW()
           RETURNING id`,
          [invite.email, invite.email.split("@")[0], passwordHash]
        );
        userId = newUser[0].id;
      } else {
        await client.query(
          "UPDATE users SET password_hash = $1, is_active = TRUE, updated_at = NOW() WHERE id = $2",
          [passwordHash, userId]
        );
      }

      // Activate the fund_org_users membership
      await client.query(
        `INSERT INTO fund_org_users (user_id, fund_org_id, org_role, invited_by, invite_accepted_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (user_id, fund_org_id) DO UPDATE
           SET org_role = $3, is_active = TRUE, invite_accepted_at = NOW()`,
        [userId, invite.fund_org_id, invite.org_role, invite.invited_by]
      );

      // Mark invite as used
      await client.query(
        "UPDATE invite_tokens SET used = TRUE, used_at = NOW() WHERE id = $1",
        [invite.id]
      );

      await client.query(
        "INSERT INTO audit_log (user_id, fund_org_id, action) VALUES ($1, $2, $3)",
        [userId, invite.fund_org_id, "auth.invite_accepted"]
      );
    });

    res.json({ success: true, message: "Invitation accepted. You can now log in." });
  } catch (err) {
    console.error("Invite accept error:", err);
    res.status(500).json({ error: "Failed to accept invitation" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Forgot password
// ─────────────────────────────────────────────────────────────────────────────
router.post("/forgot-password/request", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email required" });

    const emailLower = email.toLowerCase().trim();
    const { rows } = await query(
      "SELECT id, name, is_active FROM users WHERE email = $1",
      [emailLower]
    );

    // Always return success to prevent email enumeration
    if (!rows.length || !rows[0].is_active) {
      return res.json({ success: true, message: "If an account exists with that email, a reset link has been sent." });
    }

    const user = rows[0];
    const resetToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(resetToken).digest("hex");

    // Invalidate existing tokens
    await query(
      "UPDATE password_reset_tokens SET used = TRUE WHERE user_id = $1 AND used = FALSE",
      [user.id]
    );

    await query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
      [user.id, tokenHash]
    );

    const resetUrl = `${process.env.APP_URL}/reset-password?token=${resetToken}`;

    if (isDev) {
      // Print to console in dev — no email required
      console.log(`\n[BEACON DEV] Password reset for ${emailLower}:\n  ${resetUrl}\n`);
    } else {
      // TODO: send email via SES
      // await sendPasswordReset({ to: emailLower, name: user.name, resetUrl });
    }

    res.json({ success: true, message: "If an account exists with that email, a reset link has been sent." });
  } catch (err) {
    console.error("Forgot password error:", err);
    res.status(500).json({ error: "Request failed" });
  }
});

router.post("/forgot-password/confirm", async (req, res) => {
  try {
    const { token, new_password } = req.body;
    if (!token || !new_password) return res.status(400).json({ error: "Token and new password required" });
    if (new_password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const { rows } = await query(
      `SELECT prt.id, prt.user_id
       FROM password_reset_tokens prt
       WHERE prt.token_hash = $1 AND prt.used = FALSE AND prt.expires_at > NOW()`,
      [tokenHash]
    );

    if (!rows.length) return res.status(400).json({ error: "Invalid or expired reset link. Please request a new one." });

    const passwordHash = await bcrypt.hash(new_password, 12);
    await query("UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2", [passwordHash, rows[0].user_id]);
    await query("UPDATE password_reset_tokens SET used = TRUE WHERE id = $1", [rows[0].id]);
    await query(
      "INSERT INTO audit_log (user_id, action) VALUES ($1, $2)",
      [rows[0].user_id, "auth.password_reset"]
    );

    res.json({ success: true, message: "Password reset successfully. You can now log in." });
  } catch (err) {
    console.error("Password reset error:", err);
    res.status(500).json({ error: "Reset failed" });
  }
});

module.exports = router;
