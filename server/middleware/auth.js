// ─── Beacon Auth Middleware ───────────────────────────────────────────────────
// Beacon uses its own JWT secret (BEACON_JWT_SECRET), completely separate
// from save2retire's JWT. The token carries both platform role and,
// for fund users, the active fund_org context.
// ─────────────────────────────────────────────────────────────────────────────
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.BEACON_JWT_SECRET;
const JWT_EXPIRY = process.env.BEACON_JWT_EXPIRY || "8h";

if (!JWT_SECRET) {
  console.error("FATAL: BEACON_JWT_SECRET is not set. Beacon will not start.");
  process.exit(1);
}

// ── Token generation ─────────────────────────────────────────────────────────

function generateToken(user, activeFundOrgId = null, activeOrgRole = null) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,                    // platform role
      active_fund_org_id: activeFundOrgId,
      active_org_role: activeOrgRole,
      type: "beacon",                     // distinguishes from S2R tokens
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY, issuer: "beacon" }
  );
}

// ── Core auth middleware ──────────────────────────────────────────────────────

function requireBeaconAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authentication required" });
  }
  const token = header.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET, { issuer: "beacon" });
    if (decoded.type !== "beacon") {
      return res.status(401).json({ error: "Invalid token type" });
    }
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Session expired. Please log in again.", code: "TOKEN_EXPIRED" });
    }
    return res.status(401).json({ error: "Invalid token" });
  }
}

// ── Platform role checks ──────────────────────────────────────────────────────

const PLATFORM_ROLES = ["platform_owner", "platform_admin", "platform_analyst", "fund_user"];
const PLATFORM_HIERARCHY = {
  platform_owner: 3,
  platform_admin: 2,
  platform_analyst: 1,
  fund_user: 0,
};

// Require one of the specified platform roles (or higher)
function requirePlatformRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Authentication required" });
    if (roles.includes(req.user.role)) return next();
    // platform_owner can always do anything
    if (req.user.role === "platform_owner") return next();
    return res.status(403).json({ error: "Insufficient platform access" });
  };
}

// Convenience aliases
const requirePlatformOwner = requirePlatformRole("platform_owner");
const requirePlatformAdmin = requirePlatformRole("platform_owner", "platform_admin");
const requirePlatformAnalyst = requirePlatformRole("platform_owner", "platform_admin", "platform_analyst");

// ── Fund org role checks ──────────────────────────────────────────────────────

const ORG_ROLE_HIERARCHY = {
  org_admin: 3,
  org_analyst: 2,
  org_reporter: 1,
  org_api: 0,
};

// Require the user to have an active fund_org context AND one of the specified org roles.
// Platform-level users (non fund_user) always pass through — they can access any fund.
function requireOrgRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Authentication required" });

    // Platform-level users bypass org role checks
    if (req.user.role !== "fund_user") return next();

    // Fund users must have an active fund_org context
    if (!req.user.active_fund_org_id) {
      return res.status(403).json({
        error: "No fund context active. Please select your organisation.",
        code: "NO_FUND_CONTEXT",
      });
    }

    if (roles.includes(req.user.active_org_role)) return next();

    // org_admin can always do anything within their org
    if (req.user.active_org_role === "org_admin") return next();

    return res.status(403).json({ error: "Insufficient access within this organisation" });
  };
}

// ── Fund org scoping ──────────────────────────────────────────────────────────

// Middleware that injects the effective fund_org_id for data queries.
// Platform users can override via ?fund_org_id= query param.
// Fund users always use their token's active_fund_org_id.
function injectFundOrgScope(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Authentication required" });

  if (req.user.role !== "fund_user") {
    // Platform user: use query param override, or null (all orgs)
    req.fundOrgId = req.query.fund_org_id || null;
  } else {
    // Fund user: always scoped to their active org
    req.fundOrgId = req.user.active_fund_org_id;
    if (!req.fundOrgId) {
      return res.status(403).json({
        error: "No fund context active.",
        code: "NO_FUND_CONTEXT",
      });
    }
  }
  next();
}

// ── API key auth ──────────────────────────────────────────────────────────────

const crypto = require("crypto");
const { query } = require("../db");

async function requireApiKey(req, res, next) {
  const key = req.headers["x-beacon-key"];
  if (!key) return res.status(401).json({ error: "API key required" });

  // Extract prefix (first 12 chars after "bkn_")
  if (!key.startsWith("bkn_")) return res.status(401).json({ error: "Invalid API key format" });

  const prefix = key.substring(0, 12); // "bkn_" + 8 chars
  const keyHash = crypto.createHash("sha256").update(key).digest("hex");

  try {
    const { rows } = await query(
      `SELECT k.id, k.fund_org_id, k.scopes, k.expires_at, k.is_active,
              fo.s2r_org_id, fo.is_active AS org_active
       FROM api_keys k
       JOIN fund_orgs fo ON k.fund_org_id = fo.id
       WHERE k.key_prefix = $1 AND k.key_hash = $2`,
      [prefix, keyHash]
    );

    if (!rows.length) return res.status(401).json({ error: "Invalid API key" });
    const keyRecord = rows[0];

    if (!keyRecord.is_active) return res.status(401).json({ error: "API key is inactive" });
    if (!keyRecord.org_active) return res.status(403).json({ error: "Organisation access is inactive" });
    if (keyRecord.expires_at && new Date(keyRecord.expires_at) < new Date()) {
      return res.status(401).json({ error: "API key has expired" });
    }

    // Update last_used_at (fire and forget)
    query("UPDATE api_keys SET last_used_at = NOW() WHERE id = $1", [keyRecord.id]).catch(() => {});

    req.user = {
      role: "fund_user",
      active_fund_org_id: keyRecord.fund_org_id,
      active_org_role: "org_api",
      api_key_id: keyRecord.id,
      scopes: keyRecord.scopes || [],
    };
    req.fundOrgId = keyRecord.fund_org_id;
    next();
  } catch (err) {
    console.error("API key auth error:", err);
    res.status(500).json({ error: "Authentication error" });
  }
}

// Require a specific scope for API key access
function requireApiScope(scope) {
  return (req, res, next) => {
    if (!req.user?.api_key_id) return next(); // Not an API key request — skip scope check
    if (!req.user.scopes?.includes(scope)) {
      return res.status(403).json({ error: `API key does not have scope: ${scope}` });
    }
    next();
  };
}

module.exports = {
  generateToken,
  requireBeaconAuth,
  requirePlatformOwner,
  requirePlatformAdmin,
  requirePlatformAnalyst,
  requireOrgRole,
  injectFundOrgScope,
  requireApiKey,
  requireApiScope,
};
