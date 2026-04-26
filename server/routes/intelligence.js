// ─── Beacon — Intelligence Data Routes ───────────────────────────────────────
// Serves aggregated intelligence data from beacon.intelligence_snapshots.
// All routes are fund-org-scoped: fund_users see only their org's data.
// Platform users can access any org via ?fund_org_id= query param.
// ─────────────────────────────────────────────────────────────────────────────
const express = require("express");
const { query } = require("../db");
const {
  requireBeaconAuth,
  requireOrgRole,
  injectFundOrgScope,
} = require("../middleware/auth");

const router = express.Router();

// All intelligence routes require auth + fund context
router.use(requireBeaconAuth);
router.use(requireOrgRole("org_admin", "org_analyst", "org_reporter"));
router.use(injectFundOrgScope);

// ─── Helper: get org population threshold ─────────────────────────────────────
async function getThreshold(fundOrgId) {
  const { rows } = await query(
    "SELECT min_population_threshold FROM beacon.fund_orgs WHERE id = $1",
    [fundOrgId]
  );
  return rows[0]?.min_population_threshold || 500;
}

// ─── GET /api/intelligence/periods ────────────────────────────────────────────
// List all available data periods for this fund org, with metadata.
router.get("/periods", async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT DISTINCT
        period_label, period_start, period_end,
        MAX(population_n) FILTER (WHERE cohort_id = 'ALL') AS total_active_users,
        COUNT(DISTINCT metric_name) AS metric_count,
        MAX(created_at) AS data_refreshed_at
      FROM beacon.intelligence_snapshots
      WHERE fund_org_id = $1 AND cohort_id = 'ALL'
      GROUP BY period_label, period_start, period_end
      ORDER BY period_label ASC
    `, [req.fundOrgId]);

    res.json({ periods: rows });
  } catch (err) {
    console.error("periods error:", err);
    res.status(500).json({ error: "Failed to load periods" });
  }
});

// ─── GET /api/intelligence/summary ────────────────────────────────────────────
// Latest period headline metrics for the ALL cohort.
// Optional ?period= to get a specific period.
router.get("/summary", async (req, res) => {
  try {
    const HEADLINE_METRICS = [
      "active_users",
      "ai_tool_usage_rate",
      "goal_declaration_rate",
      "projection_gap_rate",
      "salary_sacrifice_modelling_rate",
      "retirement_confidence_proxy_index",
      "return_visit_rate",
      "adviser_referral_trigger_rate",
    ];

    let periodLabel = req.query.period;

    // If no period specified, get the latest
    if (!periodLabel) {
      const { rows: pRows } = await query(
        "SELECT period_label FROM beacon.intelligence_snapshots WHERE fund_org_id = $1 AND cohort_id = 'ALL' ORDER BY period_label DESC LIMIT 1",
        [req.fundOrgId]
      );
      if (!pRows.length) return res.json({ summary: {}, period: null });
      periodLabel = pRows[0].period_label;
    }

    // Current period metrics
    const { rows: currentRows } = await query(`
      SELECT metric_name, metric_value, metric_unit, population_n, suppressed
      FROM beacon.intelligence_snapshots
      WHERE fund_org_id = $1
        AND period_label = $2
        AND cohort_id = 'ALL'
        AND metric_name = ANY($3::text[])
    `, [req.fundOrgId, periodLabel, HEADLINE_METRICS]);

    // Previous period for deltas
    const { rows: prevRows } = await query(`
      SELECT metric_name, metric_value
      FROM beacon.intelligence_snapshots
      WHERE fund_org_id = $1
        AND period_label < $2
        AND cohort_id = 'ALL'
        AND metric_name = ANY($3::text[])
      ORDER BY period_label DESC
      LIMIT $4
    `, [req.fundOrgId, periodLabel, HEADLINE_METRICS, HEADLINE_METRICS.length]);

    const prevMap = Object.fromEntries(prevRows.map(r => [r.metric_name, r.metric_value]));

    const summary = {};
    for (const row of currentRows) {
      const prev = prevMap[row.metric_name];
      summary[row.metric_name] = {
        value: row.metric_value,
        unit: row.metric_unit,
        population_n: row.population_n,
        suppressed: row.suppressed,
        delta: prev != null && row.metric_value != null
          ? parseFloat((row.metric_value - prev).toFixed(4))
          : null,
      };
    }

    res.json({ summary, period: periodLabel });
  } catch (err) {
    console.error("summary error:", err);
    res.status(500).json({ error: "Failed to load summary" });
  }
});

// ─── GET /api/intelligence/snapshots ──────────────────────────────────────────
// Flexible query for snapshot data.
// Query params: period (required), metrics[] (optional), cohorts[] (optional)
router.get("/snapshots", async (req, res) => {
  try {
    const { period, cohort } = req.query;
    const metrics = req.query.metrics
      ? (Array.isArray(req.query.metrics) ? req.query.metrics : [req.query.metrics])
      : null;
    const cohorts = req.query.cohorts
      ? (Array.isArray(req.query.cohorts) ? req.query.cohorts : [req.query.cohorts])
      : null;

    let sql = `
      SELECT period_label, cohort_id, income_band_id, metric_name,
             metric_value, metric_unit, population_n, suppressed
      FROM beacon.intelligence_snapshots
      WHERE fund_org_id = $1
    `;
    const params = [req.fundOrgId];

    if (period) {
      params.push(period);
      sql += ` AND period_label = $${params.length}`;
    }
    if (metrics) {
      params.push(metrics);
      sql += ` AND metric_name = ANY($${params.length}::text[])`;
    }
    if (cohorts) {
      params.push(cohorts);
      sql += ` AND cohort_id = ANY($${params.length}::text[])`;
    }
    if (cohort) {
      params.push(cohort);
      sql += ` AND cohort_id = $${params.length}`;
    }

    sql += " ORDER BY period_label, cohort_id, metric_name";

    const { rows } = await query(sql, params);
    res.json({ snapshots: rows });
  } catch (err) {
    console.error("snapshots error:", err);
    res.status(500).json({ error: "Failed to load snapshots" });
  }
});

// ─── GET /api/intelligence/trends/:metric ─────────────────────────────────────
// All periods for a single metric, broken down by cohort.
// Returns data shaped for Recharts: [{period, C1, C2, C3, C4, C5, ALL}]
router.get("/trends/:metric", async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT period_label, cohort_id, metric_value, population_n, suppressed
      FROM beacon.intelligence_snapshots
      WHERE fund_org_id = $1
        AND metric_name = $2
        AND income_band_id = 'ALL'
      ORDER BY period_label, cohort_id
    `, [req.fundOrgId, req.params.metric]);

    // Pivot into chart-friendly format
    const periodMap = {};
    for (const row of rows) {
      if (!periodMap[row.period_label]) {
        periodMap[row.period_label] = { period: row.period_label };
      }
      periodMap[row.period_label][row.cohort_id] = row.suppressed ? null : row.metric_value;
    }

    res.json({
      metric: req.params.metric,
      data: Object.values(periodMap),
    });
  } catch (err) {
    console.error("trends error:", err);
    res.status(500).json({ error: "Failed to load trend data" });
  }
});

// ─── GET /api/intelligence/cohort-heatmap ─────────────────────────────────────
// Topic distribution for each cohort for a given period.
// Returns 12×5 matrix (topics × cohorts).
// Optional ?period= param; defaults to latest.
router.get("/cohort-heatmap", async (req, res) => {
  try {
    let periodLabel = req.query.period;

    if (!periodLabel) {
      const { rows: pRows } = await query(
        "SELECT period_label FROM beacon.intelligence_snapshots WHERE fund_org_id = $1 AND cohort_id = 'ALL' ORDER BY period_label DESC LIMIT 1",
        [req.fundOrgId]
      );
      if (!pRows.length) return res.json({ heatmap: [], period: null });
      periodLabel = pRows[0].period_label;
    }

    const { rows } = await query(`
      SELECT cohort_id, metric_name, metric_value, suppressed
      FROM beacon.intelligence_snapshots
      WHERE fund_org_id = $1
        AND period_label = $2
        AND metric_name LIKE 'ai_topic_pct_%'
        AND cohort_id != 'ALL'
        AND income_band_id = 'ALL'
      ORDER BY cohort_id, metric_name
    `, [req.fundOrgId, periodLabel]);

    // Build heatmap matrix: topic → {C1, C2, C3, C4, C5}
    const topicMap = {};
    for (const row of rows) {
      const topicId = row.metric_name.replace("ai_topic_pct_", "");
      if (!topicMap[topicId]) topicMap[topicId] = { topic: topicId };
      topicMap[topicId][row.cohort_id] = row.suppressed ? null : row.metric_value;
    }

    res.json({
      heatmap: Object.values(topicMap).sort((a, b) => a.topic.localeCompare(b.topic)),
      period: periodLabel,
    });
  } catch (err) {
    console.error("cohort-heatmap error:", err);
    res.status(500).json({ error: "Failed to load heatmap" });
  }
});

// ─── GET /api/intelligence/multi-metric ───────────────────────────────────────
// Fetch multiple metrics × all periods × all cohorts in one call.
// Used by the Overview page to load all chart data in one round-trip.
router.get("/multi-metric", async (req, res) => {
  try {
    const metrics = req.query.metrics
      ? (Array.isArray(req.query.metrics) ? req.query.metrics : [req.query.metrics])
      : [];

    if (!metrics.length) return res.status(400).json({ error: "metrics[] required" });

    const { rows } = await query(`
      SELECT period_label, cohort_id, metric_name, metric_value, population_n, suppressed
      FROM beacon.intelligence_snapshots
      WHERE fund_org_id = $1
        AND metric_name = ANY($2::text[])
        AND income_band_id = 'ALL'
      ORDER BY period_label, cohort_id, metric_name
    `, [req.fundOrgId, metrics]);

    // Group by metric_name → array of {period, ...cohorts}
    // Note: pg returns numeric columns as strings — coerce to float
    const result = {};
    for (const row of rows) {
      if (!result[row.metric_name]) result[row.metric_name] = {};
      const pd = row.period_label;
      if (!result[row.metric_name][pd]) result[row.metric_name][pd] = { period: pd };
      result[row.metric_name][pd][row.cohort_id] = row.suppressed ? null : parseFloat(row.metric_value);
    }

    // Convert nested objects to arrays
    const data = {};
    for (const [metric, periods] of Object.entries(result)) {
      data[metric] = Object.values(periods);
    }

    res.json({ data });
  } catch (err) {
    console.error("multi-metric error:", err);
    res.status(500).json({ error: "Failed to load metrics" });
  }
});

module.exports = router;
