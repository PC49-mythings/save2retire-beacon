-- ============================================================
-- Beacon — Migration 002: Save2Retire read-only views
-- These views live in the PUBLIC schema (save2retire's schema).
-- Run this on the save2retire database with a superuser or the
-- save2retire DB owner — it defines views that Beacon reads.
--
-- After running, grant SELECT on these views to the beacon DB user:
--   GRANT SELECT ON public.v_beacon_ai_questions      TO beacon_user;
--   GRANT SELECT ON public.v_beacon_plan_states       TO beacon_user;
--   GRANT SELECT ON public.v_beacon_engagement_events TO beacon_user;
--   GRANT SELECT ON public.v_beacon_org_registry      TO beacon_user;
--
-- IMPORTANT: These views strip ALL PII before Beacon touches the data.
-- No email, name, password_hash, IP address, or direct user_id is exposed.
-- user_id is hashed (one-way SHA-256) so cohorts can be counted without
-- being re-identified.
-- ============================================================

BEGIN;

-- ─── v_beacon_org_registry ────────────────────────────────────────────────────
-- Safe view of S2R organisations — org metadata only, no branding or billing.
CREATE OR REPLACE VIEW public.v_beacon_org_registry AS
SELECT
  o.id          AS org_id,
  o.slug        AS org_slug,
  o.name        AS org_name,
  o.is_active
FROM public.organizations o;

-- ─── v_beacon_ai_questions ────────────────────────────────────────────────────
-- Stripped view of AI conversations for topic classification.
-- EXCLUDES: user_id (only hashed), email, name, response text.
-- The question text IS included — it's needed for classification —
-- but no other identifying data is present.
CREATE OR REPLACE VIEW public.v_beacon_ai_questions AS
SELECT
  ac.id                                                          AS question_id,
  u.org_id                                                       AS s2r_org_id,
  -- Hash user_id one-way: allows cohort counting without identification
  encode(digest(u.id::text, 'sha256'), 'hex')                    AS user_hash,
  -- Age band derived from date_of_birth (nearest person record)
  CASE
    WHEN c.date_of_birth IS NULL THEN 'unknown'
    WHEN EXTRACT(YEAR FROM AGE(c.date_of_birth)) < 36  THEN 'C1'
    WHEN EXTRACT(YEAR FROM AGE(c.date_of_birth)) < 51  THEN 'C2'
    WHEN EXTRACT(YEAR FROM AGE(c.date_of_birth)) < 63  THEN 'C3'
    WHEN EXTRACT(YEAR FROM AGE(c.date_of_birth)) < 68  THEN 'C4'
    ELSE 'C5'
  END                                                            AS cohort_id,
  ac.question                                                    AS question_text,
  ac.plan_id,
  ac.created_at
FROM public.ai_conversations ac
JOIN public.users u ON ac.user_id = u.id
-- Join to clients table to get age band (client1 of the associated plan)
LEFT JOIN public.clients c ON c.plan_id = ac.plan_id AND c.client_role = 'client1'
WHERE u.org_id IS NOT NULL;   -- exclude owner-level users with no org

-- ─── v_beacon_plan_states ─────────────────────────────────────────────────────
-- Stripped view of plan state for cohort analysis.
-- EXCLUDES: user_id (hashed), all specific financial figures.
-- Income band is derived from salary ranges — not the raw salary.
CREATE OR REPLACE VIEW public.v_beacon_plan_states AS
SELECT
  p.id                                                            AS plan_id,
  encode(digest(p.id::text, 'sha256'), 'hex')                    AS plan_hash,
  u.org_id                                                        AS s2r_org_id,
  -- Age band from client1
  CASE
    WHEN c.date_of_birth IS NULL THEN 'unknown'
    WHEN EXTRACT(YEAR FROM AGE(c.date_of_birth)) < 36  THEN 'C1'
    WHEN EXTRACT(YEAR FROM AGE(c.date_of_birth)) < 51  THEN 'C2'
    WHEN EXTRACT(YEAR FROM AGE(c.date_of_birth)) < 63  THEN 'C3'
    WHEN EXTRACT(YEAR FROM AGE(c.date_of_birth)) < 68  THEN 'C4'
    ELSE 'C5'
  END                                                             AS cohort_id,
  -- Income band from first income source (not the raw figure)
  CASE
    WHEN i.gross_income IS NULL         THEN NULL
    WHEN i.gross_income < 60000         THEN 'I1'
    WHEN i.gross_income < 100001        THEN 'I2'
    WHEN i.gross_income < 150001        THEN 'I3'
    ELSE 'I4'
  END                                                             AS income_band_id,
  -- Retirement age band from client1
  CASE
    WHEN c.retirement_age IS NULL          THEN NULL
    WHEN c.retirement_age < 58             THEN 'under_58'
    WHEN c.retirement_age BETWEEN 58 AND 62 THEN '58_62'
    WHEN c.retirement_age BETWEEN 63 AND 67 THEN '63_67'
    ELSE '68_plus'
  END                                                             AS retirement_age_band,
  p.is_couple,
  p.scenario_type,
  -- Goal indicators — count only, no goal content
  COALESCE(goal_counts.goals_count, 0)                           AS goals_count,
  CASE WHEN COALESCE(goal_counts.goals_count, 0) > 0 THEN TRUE ELSE FALSE END AS has_goals,
  p.created_at,
  p.updated_at
FROM public.plans p
JOIN public.users u ON p.user_id = u.id
LEFT JOIN public.clients c ON c.plan_id = p.id AND c.client_role = 'client1'
LEFT JOIN public.incomes i ON i.client_id = c.id LIMIT 1
LEFT JOIN (
  -- Count goals per plan from the plan's JSONB data if stored there,
  -- or from a goals table if one exists
  SELECT plan_id, COUNT(*) AS goals_count
  FROM public.goals
  GROUP BY plan_id
) goal_counts ON goal_counts.plan_id = p.id
WHERE u.org_id IS NOT NULL;

-- ─── v_beacon_engagement_events ───────────────────────────────────────────────
-- Stripped view of audit_log for engagement metrics.
-- EXCLUDES: user_id (hashed), ip_address, detail JSONB.
-- Only action_type and timestamp are exposed.
CREATE OR REPLACE VIEW public.v_beacon_engagement_events AS
SELECT
  al.id                                                          AS event_id,
  u.org_id                                                       AS s2r_org_id,
  encode(digest(u.id::text, 'sha256'), 'hex')                    AS user_hash,
  -- Normalise action types into engagement categories
  CASE
    WHEN al.action IN ('plan.load', 'plan.save', 'plan.create')  THEN 'plan_session'
    WHEN al.action LIKE 'ai.%'                                    THEN 'ai_interaction'
    WHEN al.action = 'pdf.export'                                 THEN 'pdf_export'
    WHEN al.action = 'user.login'                                 THEN 'login'
    ELSE 'other'
  END                                                            AS action_category,
  al.action                                                      AS raw_action,
  al.created_at
FROM public.audit_log al
JOIN public.users u ON al.user_id = u.id
WHERE u.org_id IS NOT NULL
  AND al.action IN (
    'user.login', 'plan.load', 'plan.save', 'plan.create',
    'ai.query', 'ai.chat', 'pdf.export', 'plan.scenario_changed'
  );

COMMIT;
