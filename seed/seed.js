// ============================================================
// Beacon — Seed Script
// Creates: platform users, fund orgs, org users, and 6 months
// of mock intelligence snapshots per the mock data specification.
// Run: node seed/seed.js
// ============================================================
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  options: "-c search_path=beacon,public",
  ssl: process.env.DATABASE_URL?.includes("rds.amazonaws.com")
    ? { rejectUnauthorized: false }
    : false,
});

async function q(text, params) {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function lerp(start, end, t) {
  return start + (end - start) * t;
}

// Interpolate a value over 6 periods (0-indexed).
// Applies a slight dip in period 2 (month 3) as per spec.
function periodValue(start, end, periodIdx, applyDip = true) {
  const t = periodIdx / 5;
  let v = lerp(start, end, t);
  if (applyDip && periodIdx === 2) v *= 0.97;
  return v;
}

function round4(n) { return Math.round(n * 10000) / 10000; }
function roundN(n) { return Math.round(n); }

// ─── Config ───────────────────────────────────────────────────────────────────

const PERIODS = [
  { label: "2026-M01", start: "2026-01-01", end: "2026-01-31" },
  { label: "2026-M02", start: "2026-02-01", end: "2026-02-28" },
  { label: "2026-M03", start: "2026-03-01", end: "2026-03-31" },
  { label: "2026-M04", start: "2026-04-01", end: "2026-04-30" },
  { label: "2026-M05", start: "2026-05-01", end: "2026-05-31" },
  { label: "2026-M06", start: "2026-06-01", end: "2026-06-30" },
];

const TOTAL_ACTIVE_USERS = [41000, 47500, 98000, 107000, 172000, 189000];

// Cohort splits: [C1, C2, C3, C4, C5] — interpolated between M1 and M6
const COHORT_SPLITS_M1 = [0.28, 0.34, 0.26, 0.08, 0.04];
const COHORT_SPLITS_M6 = [0.31, 0.32, 0.24, 0.09, 0.04];

function getCohortSplit(cohortIdx, periodIdx) {
  const t = periodIdx / 5;
  return lerp(COHORT_SPLITS_M1[cohortIdx], COHORT_SPLITS_M6[cohortIdx], t);
}

// ─── Metric definitions ───────────────────────────────────────────────────────
// Each metric: { name, unit, byPeriod: [[c1,c2,c3,c4,c5]_start, [c1,c2,c3,c4,c5]_end] }
// ALL cohort is population-weighted average of C1-C5.

const METRICS = [
  {
    name: "return_visit_rate", unit: "rate",
    start: [0.31, 0.44, 0.61, 0.52, 0.28],
    end:   [0.42, 0.54, 0.71, 0.59, 0.33],
  },
  {
    name: "ai_tool_usage_rate", unit: "rate",
    start: [0.34, 0.46, 0.62, 0.54, 0.29],
    end:   [0.48, 0.58, 0.74, 0.63, 0.35],
  },
  {
    name: "goal_declaration_rate", unit: "rate",
    start: [0.19, 0.28, 0.41, 0.35, 0.22],
    end:   [0.34, 0.44, 0.57, 0.48, 0.29],
    // Accelerate in M4-M5 (fund in-app prompt campaign)
    accelerate: true,
  },
  {
    name: "scenario_modelling_rate", unit: "rate",
    start: [0.22, 0.38, 0.54, 0.46, 0.18],
    end:   [0.33, 0.49, 0.65, 0.56, 0.24],
  },
  {
    name: "projection_gap_rate", unit: "rate",
    start: [0.71, 0.54, 0.38, 0.29, 0.22],
    end:   [0.68, 0.50, 0.33, 0.26, 0.21],
  },
  {
    name: "salary_sacrifice_modelling_rate", unit: "rate",
    start: [0.08, 0.22, 0.41, 0.28, 0.04],
    end:   [0.16, 0.34, 0.56, 0.35, 0.05],
  },
  {
    name: "drawdown_strategy_modelling_rate", unit: "rate",
    start: [0.03, 0.11, 0.34, 0.52, 0.41],
    end:   [0.05, 0.18, 0.48, 0.63, 0.49],
  },
  {
    name: "voluntary_contribution_modelling_rate", unit: "rate",
    start: [0.14, 0.31, 0.53, 0.34, 0.06],
    end:   [0.26, 0.46, 0.66, 0.42, 0.07],
  },
  {
    name: "multi_session_refinement_rate", unit: "rate",
    start: [0.18, 0.31, 0.44, 0.38, 0.22],
    end:   [0.29, 0.43, 0.57, 0.47, 0.28],
  },
  {
    name: "consolidation_signal_rate", unit: "rate",
    start: [0.14, 0.09, 0.06, 0.04, 0.03],
    end:   [0.19, 0.11, 0.07, 0.05, 0.03],
  },
  {
    name: "adviser_referral_trigger_rate", unit: "rate",
    start: [0.12, 0.24, 0.38, 0.31, 0.19],
    end:   [0.15, 0.28, 0.42, 0.34, 0.21],
  },
  {
    name: "retirement_confidence_proxy_index", unit: "index",
    start: [34, 43, 56, 61, 58],
    end:   [41, 51, 64, 67, 62],
  },
  // AI topic percentages — per cohort, 12 topics, must sum to 100 per cohort
  // We generate these separately below
];

// Topic distributions by cohort: [C1, C2, C3, C4, C5]
// Row = topic T01-T12, columns = C1 value start, C1 value end (etc)
// These are % of AI questions within cohort
const TOPIC_DISTRIBUTIONS = {
  // M1 values per cohort [C1, C2, C3, C4, C5]
  start: {
    T01: [6,  20, 28, 16,  2],
    T02: [8,  11, 21, 30, 33],
    T03: [11, 18, 24, 20,  9],
    T04: [16, 15, 11, 13, 18],
    T05: [30, 16,  7,  5,  3],
    T06: [1,   4, 10, 17, 23],
    T07: [4,   8,  8,  7,  2],
    T08: [20,  9,  4,  2,  1],
    T09: [9,   7,  4,  2,  1],
    T10: [1,   2,  3,  6, 10],
    T11: [1,   3,  4,  5,  2],
    T12: [13,  7,  6,  3,  4],  // totals should be ~100 per column
  },
  // M6 values per cohort
  end: {
    T01: [8,  24, 31, 14,  2],
    T02: [6,   9, 19, 28, 31],
    T03: [9,  16, 22, 18,  8],
    T04: [14, 13,  9, 11, 16],
    T05: [28, 14,  5,  3,  2],
    T06: [2,   6, 11, 19, 24],
    T07: [5,   9, 10,  6,  2],
    T08: [18,  8,  3,  2,  1],
    T09: [8,   6,  3,  1,  1],
    T10: [1,   3,  4,  7, 12],
    T11: [1,   4,  5,  4,  2],
    T12: [10,  8,  5,  2,  3],
  },
};

// Platform sessions per 1,000 active users by cohort
const SESSIONS_PER_1K = {
  start: [200, 280, 410, 310, 160],
  end:   [230, 310, 450, 345, 180],
};

// ─── Seed users ───────────────────────────────────────────────────────────────

const USERS_TO_SEED = [
  {
    email: process.env.SEED_OWNER_EMAIL || "admin@save2retire.ai",
    name:  process.env.SEED_OWNER_NAME  || "Beacon Admin",
    pw:    process.env.SEED_OWNER_PASSWORD || "changeme123",
    role:  "platform_owner",
  },
  {
    email: "analyst@save2retire.ai",
    name:  "Platform Analyst",
    pw:    "demo1234",
    role:  "platform_analyst",
  },
  // Fund users — Australian Super demo
  {
    email: "admin@aussuper-demo.beacon",
    name:  "AusSuper Admin",
    pw:    "demo1234",
    role:  "fund_user",
    fund_org: "aussuper",
    org_role: "org_admin",
  },
  {
    email: "analyst@aussuper-demo.beacon",
    name:  "AusSuper Analyst",
    pw:    "demo1234",
    role:  "fund_user",
    fund_org: "aussuper",
    org_role: "org_analyst",
  },
  {
    email: "reporter@aussuper-demo.beacon",
    name:  "AusSuper Reporter",
    pw:    "demo1234",
    role:  "fund_user",
    fund_org: "aussuper",
    org_role: "org_reporter",
  },
  // Fund users — REST Super demo
  {
    email: "admin@rest-demo.beacon",
    name:  "REST Admin",
    pw:    "demo1234",
    role:  "fund_user",
    fund_org: "rest",
    org_role: "org_admin",
  },
];

const FUND_ORGS_TO_SEED = [
  {
    slug: "aussuper",
    display_name: "Australian Super",
    short_name: "AusSuper",
    primary_color: "#00A3E0",
    access_level: "demo",
    apra_reporting_enabled: true,
    api_access_enabled: true,
  },
  {
    slug: "rest",
    display_name: "REST Industry Super",
    short_name: "REST",
    primary_color: "#E4002B",
    access_level: "demo",
    apra_reporting_enabled: false,
    api_access_enabled: false,
  },
];

// ─── Main seed function ────────────────────────────────────────────────────────

async function seed() {
  console.log("🌱 Beacon seed starting...\n");

  // ── Create pipeline run record ──────────────────────────────────────────────
  const pipelineRunId = uuidv4();
  await q(
    `INSERT INTO beacon.pipeline_runs (id, run_type, status, triggered_by, started_at)
     VALUES ($1, 'mock_load', 'running', 'seed', NOW())`,
    [pipelineRunId]
  );

  // ── Seed fund orgs ──────────────────────────────────────────────────────────
  const fundOrgIds = {};
  for (const fo of FUND_ORGS_TO_SEED) {
    const { rows } = await q(
      `INSERT INTO beacon.fund_orgs
         (s2r_org_slug, display_name, short_name, primary_color, access_level,
          apra_reporting_enabled, api_access_enabled, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
       ON CONFLICT (s2r_org_slug) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         short_name = EXCLUDED.short_name,
         primary_color = EXCLUDED.primary_color,
         updated_at = NOW()
       RETURNING id`,
      [fo.slug, fo.display_name, fo.short_name, fo.primary_color,
       fo.access_level, fo.apra_reporting_enabled, fo.api_access_enabled]
    );
    fundOrgIds[fo.slug] = rows[0].id;
    console.log(`  ✓ Fund org: ${fo.display_name} (${rows[0].id})`);
  }

  // ── Seed users ──────────────────────────────────────────────────────────────
  const userIds = {};
  for (const u of USERS_TO_SEED) {
    const hash = await bcrypt.hash(u.pw, 10);
    const { rows } = await q(
      `INSERT INTO beacon.users (email, name, password_hash, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role, updated_at = NOW()
       RETURNING id`,
      [u.email, u.name, hash, u.role]
    );
    const userId = rows[0].id;
    userIds[u.email] = userId;
    console.log(`  ✓ User: ${u.email} [${u.role}]`);

    // Create fund_org_users membership if applicable
    if (u.fund_org && fundOrgIds[u.fund_org]) {
      await q(
        `INSERT INTO beacon.fund_org_users (user_id, fund_org_id, org_role, invite_accepted_at, is_active)
         VALUES ($1, $2, $3, NOW(), TRUE)
         ON CONFLICT (user_id, fund_org_id) DO UPDATE SET org_role = EXCLUDED.org_role`,
        [userId, fundOrgIds[u.fund_org], u.org_role]
      );
      console.log(`     → org membership: ${u.fund_org} / ${u.org_role}`);
    }
  }

  // ── Generate mock intelligence snapshots ───────────────────────────────────
  console.log("\n📊 Generating mock intelligence snapshots...");

  // We generate snapshots for the Australian Super demo org only.
  // REST gets a smaller, simpler dataset.
  const ausSuperOrgId = fundOrgIds["aussuper"];
  const restOrgId     = fundOrgIds["rest"];

  let snapshotCount = 0;

  for (let pIdx = 0; pIdx < PERIODS.length; pIdx++) {
    const period = PERIODS[pIdx];
    const totalUsers = TOTAL_ACTIVE_USERS[pIdx];

    // ── Cohort populations ────────────────────────────────────────────────────
    const cohortPops = [1, 2, 3, 4, 5].map(ci => {
      const split = getCohortSplit(ci - 1, pIdx);
      return Math.round(totalUsers * split);
    });

    // ── Helper: insert snapshot ───────────────────────────────────────────────
    async function insertSnapshot(fundOrgId, cohortId, metricName, metricValue, metricUnit, populationN, suppressed = false) {
      await q(
        `INSERT INTO beacon.intelligence_snapshots
           (fund_org_id, period_label, period_start, period_end, cohort_id, income_band_id,
            metric_name, metric_value, metric_unit, population_n, suppressed,
            pipeline_run_id, data_source)
         VALUES ($1,$2,$3,$4,$5,'ALL',$6,$7,$8,$9,$10,$11,'mock')
         ON CONFLICT (fund_org_id, period_label, cohort_id, income_band_id, metric_name)
         DO UPDATE SET metric_value = EXCLUDED.metric_value,
                       population_n = EXCLUDED.population_n,
                       suppressed   = EXCLUDED.suppressed`,
        [fundOrgId, period.label, period.start, period.end, cohortId,
         metricName, metricValue, metricUnit, populationN, suppressed, pipelineRunId]
      );
      snapshotCount++;
    }

    // ── ALL cohort active users count ─────────────────────────────────────────
    await insertSnapshot(ausSuperOrgId, "ALL", "active_users", totalUsers, "count", totalUsers);

    // ── Per-cohort metrics ────────────────────────────────────────────────────
    const cohortWeightedAccum = {};  // for computing ALL cohort weighted averages

    for (let ci = 0; ci < 5; ci++) {
      const cohortId = `C${ci + 1}`;
      const pop = cohortPops[ci];
      const suppressed = pop < 500;

      // Active users for this cohort
      await insertSnapshot(ausSuperOrgId, cohortId, "active_users", pop, "count", pop, suppressed);

      // Sessions per 1k
      const sessionsVal = periodValue(SESSIONS_PER_1K.start[ci], SESSIONS_PER_1K.end[ci], pIdx);
      await insertSnapshot(ausSuperOrgId, cohortId, "platform_sessions_per_1k", round4(sessionsVal), "sessions_per_1k", pop, suppressed);

      // Rate and index metrics
      for (const metric of METRICS) {
        let val;
        if (metric.accelerate && pIdx >= 3) {
          // Goal declaration rate accelerates in M4-M6: extra +2% per period above linear
          const baseVal = periodValue(metric.start[ci], metric.end[ci], pIdx, false);
          val = baseVal + (pIdx - 2) * 0.01; // extra kick from M4
          val = Math.min(val, 0.95); // cap at 95%
        } else {
          val = periodValue(metric.start[ci], metric.end[ci], pIdx);
        }
        val = suppressed ? null : round4(val);
        await insertSnapshot(ausSuperOrgId, cohortId, metric.name, val, metric.unit, pop, suppressed);

        // Accumulate for ALL cohort calculation
        if (!suppressed && val !== null) {
          if (!cohortWeightedAccum[metric.name]) cohortWeightedAccum[metric.name] = { sum: 0, totalPop: 0, unit: metric.unit };
          cohortWeightedAccum[metric.name].sum += val * pop;
          cohortWeightedAccum[metric.name].totalPop += pop;
        }
      }

      // Topic distributions T01-T12
      let topicTotal = 0;
      for (const [tId, cohortVals] of Object.entries(TOPIC_DISTRIBUTIONS.start)) {
        const startVal = cohortVals[ci];
        const endVal = TOPIC_DISTRIBUTIONS.end[tId][ci];
        const val = suppressed ? null : round4(periodValue(startVal / 100, endVal / 100, pIdx));
        await insertSnapshot(ausSuperOrgId, cohortId, `ai_topic_pct_${tId}`, val, "pct", pop, suppressed);
        if (val !== null) topicTotal += val;
      }
    }

    // ── ALL cohort: weighted averages across C1-C5 ────────────────────────────
    const allPop = totalUsers;
    await insertSnapshot(ausSuperOrgId, "ALL", "active_users", totalUsers, "count", allPop);

    // Weighted sessions per 1k for ALL
    const weightedSessions = cohortPops.reduce((sum, pop, ci) => {
      return sum + periodValue(SESSIONS_PER_1K.start[ci], SESSIONS_PER_1K.end[ci], pIdx) * pop;
    }, 0) / totalUsers;
    await insertSnapshot(ausSuperOrgId, "ALL", "platform_sessions_per_1k", round4(weightedSessions), "sessions_per_1k", allPop);

    for (const [metricName, acc] of Object.entries(cohortWeightedAccum)) {
      const weightedVal = acc.totalPop > 0 ? round4(acc.sum / acc.totalPop) : null;
      await insertSnapshot(ausSuperOrgId, "ALL", metricName, weightedVal, acc.unit, allPop);
    }

    // ALL cohort topic percentages: weighted average
    for (const tId of Object.keys(TOPIC_DISTRIBUTIONS.start)) {
      let weightedTopic = 0;
      let totalValidPop = 0;
      for (let ci = 0; ci < 5; ci++) {
        const pop = cohortPops[ci];
        if (pop >= 500) {
          const startVal = TOPIC_DISTRIBUTIONS.start[tId][ci] / 100;
          const endVal = TOPIC_DISTRIBUTIONS.end[tId][ci] / 100;
          weightedTopic += periodValue(startVal, endVal, pIdx) * pop;
          totalValidPop += pop;
        }
      }
      const val = totalValidPop > 0 ? round4(weightedTopic / totalValidPop) : null;
      await insertSnapshot(ausSuperOrgId, "ALL", `ai_topic_pct_${tId}`, val, "pct", allPop);
    }

    console.log(`  ✓ Period ${period.label}: ${totalUsers.toLocaleString()} users, 5 cohorts`);
  }

  // ── REST Super: minimal dataset (3 periods, ALL cohort only) ─────────────
  console.log("\n  Generating REST demo data (minimal)...");
  const restUsers = [8200, 9400, 11000];
  for (let pi = 0; pi < 3; pi++) {
    const period = PERIODS[pi];
    await q(
      `INSERT INTO beacon.intelligence_snapshots
         (fund_org_id, period_label, period_start, period_end, cohort_id, income_band_id,
          metric_name, metric_value, metric_unit, population_n, suppressed, pipeline_run_id, data_source)
       VALUES ($1,$2,$3,$4,'ALL','ALL','active_users',$5,'count',$6,FALSE,$7,'mock')
       ON CONFLICT (fund_org_id, period_label, cohort_id, income_band_id, metric_name)
       DO UPDATE SET metric_value = EXCLUDED.metric_value`,
      [restOrgId, period.label, period.start, period.end, restUsers[pi], restUsers[pi], pipelineRunId]
    );
    snapshotCount++;
  }

  // ── Mark pipeline run complete ──────────────────────────────────────────────
  await q(
    `UPDATE beacon.pipeline_runs
     SET status = 'completed', snapshots_written = $1, completed_at = NOW()
     WHERE id = $2`,
    [snapshotCount, pipelineRunId]
  );

  console.log(`\n✅ Seed complete!`);
  console.log(`   Users:              ${USERS_TO_SEED.length}`);
  console.log(`   Fund orgs:          ${FUND_ORGS_TO_SEED.length}`);
  console.log(`   Intelligence rows:  ${snapshotCount}`);
  console.log(`\n📋 Demo credentials:`);
  console.log(`   Platform owner:  admin@save2retire.ai / (from .env SEED_OWNER_PASSWORD)`);
  console.log(`   AusSuper admin:  admin@aussuper-demo.beacon / demo1234`);
  console.log(`   AusSuper analyst: analyst@aussuper-demo.beacon / demo1234`);
  console.log(`   REST admin:      admin@rest-demo.beacon / demo1234`);
  console.log(`\n   ⚠  Change all passwords before any external demo.\n`);

  await pool.end();
}

seed().catch(err => {
  console.error("Seed failed:", err.message);
  console.error(err.stack);
  pool.end();
  process.exit(1);
});
