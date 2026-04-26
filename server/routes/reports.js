// ─── Beacon — Reports Routes ──────────────────────────────────────────────────
// POST /api/reports/generate  — stream a PDF to the client
// GET  /api/reports/configs   — list saved report configurations
// POST /api/reports/configs   — save a report configuration
// DEL  /api/reports/configs/:id
// ─────────────────────────────────────────────────────────────────────────────
const express  = require("express");
const { query } = require("../db");
const {
  requireBeaconAuth,
  requireOrgRole,
  injectFundOrgScope,
} = require("../middleware/auth");
const BeaconPDFGenerator = require("../lib/pdf/generator");
const { SECTIONS, AUDIENCE_PRESETS, DETAIL_LEVELS } = require("../lib/pdf/reportDefinitions");

const router = express.Router();

router.use(requireBeaconAuth);
router.use(requireOrgRole("org_admin", "org_analyst", "org_reporter"));
router.use(injectFundOrgScope);

// ─── GET /api/reports/definitions ─────────────────────────────────────────────
// Return sections, presets, and detail levels for the UI to render
router.get("/definitions", (req, res) => {
  res.json({ sections: SECTIONS, audience_presets: AUDIENCE_PRESETS, detail_levels: DETAIL_LEVELS });
});

// ─── GET /api/reports/configs ─────────────────────────────────────────────────
router.get("/configs", async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT rc.id, rc.name, rc.report_type, rc.config, rc.is_shared, rc.created_at,
             u.name AS created_by_name
      FROM beacon.report_configurations rc
      JOIN beacon.users u ON u.id = rc.created_by
      WHERE rc.fund_org_id = $1
        AND (rc.is_shared = true OR rc.created_by = $2)
      ORDER BY rc.created_at DESC
    `, [req.fundOrgId, req.user.sub]);
    res.json({ configs: rows });
  } catch (err) {
    console.error("report configs list error:", err);
    res.status(500).json({ error: "Failed to load report configurations" });
  }
});

// ─── POST /api/reports/configs ────────────────────────────────────────────────
router.post("/configs", requireOrgRole("org_admin", "org_analyst"), async (req, res) => {
  try {
    const { name, config, is_shared = false } = req.body;
    if (!name || !config) return res.status(400).json({ error: "name and config required" });

    const { rows } = await query(`
      INSERT INTO beacon.report_configurations
        (fund_org_id, created_by, name, report_type, config, is_shared)
      VALUES ($1, $2, $3, 'custom', $4, $5)
      RETURNING *
    `, [req.fundOrgId, req.user.sub, name, JSON.stringify(config), is_shared]);

    res.status(201).json({ config: rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Failed to save configuration" });
  }
});

// ─── DELETE /api/reports/configs/:id ──────────────────────────────────────────
router.delete("/configs/:id", requireOrgRole("org_admin", "org_analyst"), async (req, res) => {
  try {
    await query(
      "DELETE FROM beacon.report_configurations WHERE id = $1 AND fund_org_id = $2 AND created_by = $3",
      [req.params.id, req.fundOrgId, req.user.sub]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete configuration" });
  }
});

// ─── POST /api/reports/generate ───────────────────────────────────────────────
// Body: { sections[], detail_level, period_start, period_end, audience_preset, report_name? }
// Streams a PDF directly to the response.
router.post("/generate", async (req, res) => {
  try {
    const {
      sections      = ["cover", "executive_summary"],
      detail_level  = "standard",
      period_start,
      period_end,
      audience_preset = "custom",
      report_name,
    } = req.body;

    if (!period_start) return res.status(400).json({ error: "period_start required" });
    const periodEnd = period_end ?? period_start;

    // ── Fetch fund org ──────────────────────────────────────────────────────
    const { rows: orgRows } = await query(
      "SELECT id, display_name, short_name, logo_url, primary_color FROM beacon.fund_orgs WHERE id = $1",
      [req.fundOrgId]
    );
    if (!orgRows.length) return res.status(404).json({ error: "Fund org not found" });
    const fund_org = orgRows[0];

    // ── Fetch all periods in range ──────────────────────────────────────────
    const { rows: periodRows } = await query(`
      SELECT DISTINCT period_label, period_start, period_end
      FROM beacon.intelligence_snapshots
      WHERE fund_org_id = $1
        AND period_label >= $2
        AND period_label <= $3
        AND cohort_id = 'ALL'
        AND income_band_id = 'ALL'
      ORDER BY period_label ASC
    `, [req.fundOrgId, period_start, periodEnd]);

    // ── Fetch all snapshot data for the range ───────────────────────────────
    const { rows: snapRows } = await query(`
      SELECT period_label, cohort_id, metric_name, metric_value, metric_unit, population_n, suppressed
      FROM beacon.intelligence_snapshots
      WHERE fund_org_id = $1
        AND period_label >= $2
        AND period_label <= $3
        AND income_band_id = 'ALL'
    `, [req.fundOrgId, period_start, periodEnd]);

    // Build a fast lookup map: "period|cohort|metric" → snapshot
    const snapshotMap = {};
    for (const snap of snapRows) {
      const key = `${snap.period_label}|${snap.cohort_id}|${snap.metric_name}`;
      snapshotMap[key] = snap;
    }

    // ── Fetch heatmap data (latest period) ──────────────────────────────────
    const { rows: heatmapRows } = await query(`
      SELECT cohort_id, metric_name, metric_value, suppressed
      FROM beacon.intelligence_snapshots
      WHERE fund_org_id = $1
        AND period_label = $2
        AND metric_name LIKE 'ai_topic_pct_%'
        AND income_band_id = 'ALL'
      ORDER BY metric_name, cohort_id
    `, [req.fundOrgId, periodRows[periodRows.length - 1]?.period_label ?? period_start]);

    // Pivot heatmap into { topic, C1, C2, C3, C4, C5, ALL }
    const heatmapMap = {};
    for (const row of heatmapRows) {
      const topicId = row.metric_name.replace("ai_topic_pct_", "");
      if (!heatmapMap[topicId]) heatmapMap[topicId] = { topic: topicId };
      heatmapMap[topicId][row.cohort_id] = row.suppressed ? null : row.metric_value;
    }
    const heatmap = Object.values(heatmapMap).sort((a, b) => a.topic.localeCompare(b.topic));

    // ── Assemble config and data ────────────────────────────────────────────
    const reportConfig = {
      sections,
      detail_level,
      period_start,
      period_end:     periodEnd,
      audience_preset,
      fund_org,
    };

    const reportData = {
      periods:     periodRows,
      snapshotMap,
      heatmap,
    };

    // ── Stream PDF ──────────────────────────────────────────────────────────
    const filename = report_name
      ? `${report_name.replace(/[^a-z0-9]/gi, "_")}.pdf`
      : `beacon_${fund_org.short_name ?? "report"}_${period_start}_${audience_preset}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    const generator = new BeaconPDFGenerator(reportConfig, reportData);
    generator.pipe(res);
    await generator.build();
    generator.end();

    // ── Audit log ───────────────────────────────────────────────────────────
    await query(
      `INSERT INTO beacon.report_exports
         (fund_org_id, exported_by, export_type, period_label, delivered, delivered_at)
       VALUES ($1, $2, 'pdf', $3, true, NOW())`,
      [req.fundOrgId, req.user.sub, period_start]
    ).catch(() => {}); // non-blocking

  } catch (err) {
    console.error("PDF generation error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to generate report" });
    }
  }
});

// ─── GET /api/reports/exports ─────────────────────────────────────────────────
router.get("/exports", async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT re.id, re.export_type, re.period_label, re.delivered, re.delivered_at, re.created_at,
             u.name AS exported_by_name
      FROM beacon.report_exports re
      LEFT JOIN beacon.users u ON u.id = re.exported_by
      WHERE re.fund_org_id = $1
      ORDER BY re.created_at DESC
      LIMIT 50
    `, [req.fundOrgId]);
    res.json({ exports: rows });
  } catch (err) {
    res.status(500).json({ error: "Failed to load export history" });
  }
});

module.exports = router;
