// ─── Beacon — Feed Routes ─────────────────────────────────────────────────────
// Programmatic data access for API key consumers (org_api role).
// Auth: X-Beacon-Key header (API key) or Bearer JWT for admin actions.
//
// All responses use camelCase keys and ISO timestamps for
// compatibility with standard BI tools (PowerBI, Tableau, etc).
// ─────────────────────────────────────────────────────────────────────────────
const express = require("express");
const crypto  = require("crypto");
const https   = require("https");
const http    = require("http");
const { URL } = require("url");
const { query } = require("../db");
const {
  requireApiKey,
  requireApiScope,
  requireBeaconAuth,
  requireOrgRole,
  injectFundOrgScope,
} = require("../middleware/auth");

const router = express.Router();

// ─── Scope constants ──────────────────────────────────────────────────────────
const SCOPES = {
  FEED_READ:   "feed.read",
  FEED_EXPORT: "feed.export",
};

// ─── Helper: format snapshot row for API consumers ───────────────────────────
function formatSnapshot(row) {
  return {
    periodLabel:   row.period_label,
    periodStart:   row.period_start,
    periodEnd:     row.period_end,
    cohortId:      row.cohort_id,
    incomeBandId:  row.income_band_id,
    metricName:    row.metric_name,
    metricValue:   row.metric_value != null ? parseFloat(row.metric_value) : null,
    metricUnit:    row.metric_unit,
    populationN:   row.population_n != null ? parseInt(row.population_n) : null,
    suppressed:    row.suppressed,
    dataSource:    row.data_source,
  };
}

// ─── GET /api/feed/meta ───────────────────────────────────────────────────────
// Returns available periods, org info, and API capabilities.
// Useful for initial integration setup and schema discovery.
router.get("/meta",
  requireApiKey,
  requireApiScope(SCOPES.FEED_READ),
  async (req, res) => {
    try {
      const { rows: orgRows } = await query(
        `SELECT display_name, short_name, access_level, api_access_enabled,
                push_export_enabled, min_population_threshold
         FROM fund_orgs WHERE id = $1`,
        [req.fundOrgId]
      );
      if (!orgRows.length) return res.status(404).json({ error: "Organisation not found" });

      const { rows: periodRows } = await query(
        `SELECT DISTINCT period_label, period_start, period_end,
                MAX(population_n) FILTER (WHERE cohort_id = 'ALL') AS total_active_users
         FROM intelligence_snapshots
         WHERE fund_org_id = $1 AND cohort_id = 'ALL' AND income_band_id = 'ALL'
         GROUP BY period_label, period_start, period_end
         ORDER BY period_label ASC`,
        [req.fundOrgId]
      );

      const { rows: metricRows } = await query(
        `SELECT DISTINCT metric_name, metric_unit
         FROM intelligence_snapshots
         WHERE fund_org_id = $1
         ORDER BY metric_name`,
        [req.fundOrgId]
      );

      res.json({
        organisation: {
          displayName:           orgRows[0].display_name,
          shortName:             orgRows[0].short_name,
          accessLevel:           orgRows[0].access_level,
          minPopulationThreshold: orgRows[0].min_population_threshold,
        },
        availablePeriods: periodRows.map(p => ({
          periodLabel:      p.period_label,
          periodStart:      p.period_start,
          periodEnd:        p.period_end,
          totalActiveUsers: p.total_active_users != null ? parseInt(p.total_active_users) : null,
        })),
        availableMetrics: metricRows.map(m => ({
          metricName: m.metric_name,
          metricUnit: m.metric_unit,
        })),
        availableCohorts: ["ALL", "C1", "C2", "C3", "C4", "C5"],
        scopes:           req.user.scopes || [],
        apiVersion:       "1.0",
        docsUrl:          "https://insights.save2retire.ai/api/feed/meta",
      });
    } catch (err) {
      console.error("feed/meta error:", err);
      res.status(500).json({ error: "Failed to load metadata" });
    }
  }
);

// ─── GET /api/feed/summary ────────────────────────────────────────────────────
// Latest period summary for all headline metrics, ALL cohort.
// Optional ?period= to request a specific period.
router.get("/summary",
  requireApiKey,
  requireApiScope(SCOPES.FEED_READ),
  async (req, res) => {
    try {
      let periodLabel = req.query.period;

      if (!periodLabel) {
        const { rows } = await query(
          `SELECT period_label FROM intelligence_snapshots
           WHERE fund_org_id = $1 AND cohort_id = 'ALL'
           ORDER BY period_label DESC LIMIT 1`,
          [req.fundOrgId]
        );
        if (!rows.length) return res.json({ summary: [], period: null });
        periodLabel = rows[0].period_label;
      }

      const { rows } = await query(
        `SELECT period_label, period_start, period_end,
                cohort_id, income_band_id, metric_name,
                metric_value, metric_unit, population_n, suppressed, data_source
         FROM intelligence_snapshots
         WHERE fund_org_id = $1
           AND period_label = $2
           AND cohort_id = 'ALL'
           AND income_band_id = 'ALL'
         ORDER BY metric_name`,
        [req.fundOrgId, periodLabel]
      );

      res.json({
        period:  periodLabel,
        summary: rows.map(formatSnapshot),
      });
    } catch (err) {
      console.error("feed/summary error:", err);
      res.status(500).json({ error: "Failed to load summary" });
    }
  }
);

// ─── GET /api/feed/snapshots ──────────────────────────────────────────────────
// Queryable snapshot feed. Supports filtering by period, cohort, metric.
// Designed for direct import into PowerBI, Tableau, or data warehouses.
//
// Query params (all optional):
//   period        — specific period label e.g. "2026-M04"
//   period_from   — inclusive start of period range
//   period_to     — inclusive end of period range
//   cohort        — cohort ID or "ALL" (default: all cohorts)
//   metrics       — comma-separated metric names
//   include_suppressed — "true" to include suppressed cells (default: false)
//   limit         — max rows (default: 1000, max: 5000)
//   offset        — for pagination (default: 0)
router.get("/snapshots",
  requireApiKey,
  requireApiScope(SCOPES.FEED_READ),
  async (req, res) => {
    try {
      const {
        period,
        period_from,
        period_to,
        cohort,
        metrics,
        include_suppressed = "false",
        limit  = "1000",
        offset = "0",
      } = req.query;

      const params  = [req.fundOrgId];
      const clauses = ["fund_org_id = $1", "income_band_id = 'ALL'"];

      if (period) {
        params.push(period);
        clauses.push(`period_label = $${params.length}`);
      } else {
        if (period_from) { params.push(period_from); clauses.push(`period_label >= $${params.length}`); }
        if (period_to)   { params.push(period_to);   clauses.push(`period_label <= $${params.length}`); }
      }

      if (cohort) {
        params.push(cohort);
        clauses.push(`cohort_id = $${params.length}`);
      }

      if (metrics) {
        const metricList = metrics.split(",").map(m => m.trim()).filter(Boolean);
        if (metricList.length) {
          params.push(metricList);
          clauses.push(`metric_name = ANY($${params.length}::text[])`);
        }
      }

      if (include_suppressed !== "true") {
        clauses.push("suppressed = FALSE");
      }

      const rowLimit  = Math.min(parseInt(limit)  || 1000, 5000);
      const rowOffset = Math.max(parseInt(offset) || 0,    0);

      params.push(rowLimit, rowOffset);

      const { rows } = await query(
        `SELECT period_label, period_start, period_end,
                cohort_id, income_band_id, metric_name,
                metric_value, metric_unit, population_n, suppressed, data_source
         FROM intelligence_snapshots
         WHERE ${clauses.join(" AND ")}
         ORDER BY period_label, cohort_id, metric_name
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );

      // Count for pagination
      const { rows: countRows } = await query(
        `SELECT COUNT(*) AS total FROM intelligence_snapshots
         WHERE ${clauses.slice(0, -0).join(" AND ")}`,
        params.slice(0, -2)
      );

      res.json({
        data:       rows.map(formatSnapshot),
        pagination: {
          total:  parseInt(countRows[0]?.total || 0),
          limit:  rowLimit,
          offset: rowOffset,
        },
      });
    } catch (err) {
      console.error("feed/snapshots error:", err);
      res.status(500).json({ error: "Failed to load snapshots" });
    }
  }
);

// ─── POST /api/feed/push-test ─────────────────────────────────────────────────
// Sends a test push payload to the configured endpoint.
// Requires JWT auth (org_admin) — not API key auth.
// This is an admin action, not a data feed action.
router.post("/push-test",
  requireBeaconAuth,
  requireOrgRole("org_admin"),
  injectFundOrgScope,
  async (req, res) => {
    try {
      const { rows: orgRows } = await query(
        `SELECT display_name, push_endpoint_url, push_export_enabled, push_secret_hash
         FROM fund_orgs WHERE id = $1`,
        [req.fundOrgId]
      );

      const org = orgRows[0];
      if (!org?.push_export_enabled) {
        return res.status(403).json({ error: "Push export is not enabled for your organisation." });
      }
      if (!org.push_endpoint_url) {
        return res.status(400).json({ error: "No push endpoint URL configured. Add one in Push Export settings." });
      }

      // Build a minimal test payload
      const payload = JSON.stringify({
        pushId:       crypto.randomUUID(),
        type:         "test",
        organisation: org.display_name,
        generatedAt:  new Date().toISOString(),
        message:      "This is a test push from Beacon. Your endpoint is correctly configured.",
        apiVersion:   "1.0",
      });

      // Sign with HMAC-SHA256 if a secret is configured
      const signature = org.push_secret_hash
        ? crypto.createHmac("sha256", org.push_secret_hash).update(payload).digest("hex")
        : null;

      // Fire the HTTP/HTTPS request
      const targetUrl = new URL(org.push_endpoint_url);
      const lib       = targetUrl.protocol === "https:" ? https : http;

      const headers = {
        "Content-Type":    "application/json",
        "Content-Length":  Buffer.byteLength(payload),
        "X-Beacon-Push":   "1",
        "X-Beacon-Org":    req.fundOrgId,
        ...(signature ? { "X-Beacon-Signature": `sha256=${signature}` } : {}),
      };

      const result = await new Promise((resolve) => {
        const reqOptions = {
          hostname: targetUrl.hostname,
          port:     targetUrl.port || (targetUrl.protocol === "https:" ? 443 : 80),
          path:     targetUrl.pathname + targetUrl.search,
          method:   "POST",
          headers,
          timeout:  10000,
        };

        const pushReq = lib.request(reqOptions, (pushRes) => {
          let body = "";
          pushRes.on("data", chunk => { body += chunk; });
          pushRes.on("end", () => resolve({ status: pushRes.statusCode, body: body.slice(0, 500) }));
        });

        pushReq.on("error",   err => resolve({ status: null, error: err.message }));
        pushReq.on("timeout", ()  => { pushReq.destroy(); resolve({ status: null, error: "Request timed out after 10s" }); });

        pushReq.write(payload);
        pushReq.end();
      });

      // Log the push attempt
      await query(
        `INSERT INTO report_exports
           (fund_org_id, exported_by, export_type, period_label, delivered, delivered_at)
         VALUES ($1, $2, 'push', 'test', $3, $4)`,
        [req.fundOrgId, req.user.sub, result.status === 200, result.status === 200 ? new Date() : null]
      );

      const success = result.status >= 200 && result.status < 300;
      res.json({
        success,
        statusCode:  result.status,
        error:       result.error || null,
        endpoint:    org.push_endpoint_url,
        signedWith:  signature ? "HMAC-SHA256" : "none",
        message:     success
          ? "Push delivered successfully. Check your endpoint received the payload."
          : `Push failed: ${result.error || `HTTP ${result.status}`}`,
      });
    } catch (err) {
      console.error("push-test error:", err);
      res.status(500).json({ error: "Failed to send test push" });
    }
  }
);

module.exports = router;
module.exports.SCOPES = SCOPES;
