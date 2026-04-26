-- ============================================================
-- Beacon — Migration 001: beacon schema
-- Run AFTER save2retire's master_migration.sql has been applied.
-- Assumes: uuid-ossp and pgcrypto extensions already exist (from S2R).
-- ============================================================
-- psql -U postgres -d save2retire -f migrations/001_beacon_schema.sql
-- ============================================================

BEGIN;

-- ─── Create beacon schema ─────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS beacon;

-- Set search path for this migration
SET search_path TO beacon, public;

-- ─── USERS ───────────────────────────────────────────────────────────────────
-- Beacon's own user accounts — completely separate from save2retire users.
-- A person may have accounts in both systems but they are distinct records.
CREATE TABLE IF NOT EXISTS beacon.users (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email          VARCHAR(255) NOT NULL UNIQUE,
  name           VARCHAR(255) NOT NULL,
  password_hash  VARCHAR(255) NOT NULL,
  role           VARCHAR(30) NOT NULL DEFAULT 'fund_user'
                   CHECK (role IN ('platform_owner', 'platform_admin', 'platform_analyst', 'fund_user')),
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  last_login     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_beacon_users_email ON beacon.users (email);
CREATE INDEX IF NOT EXISTS idx_beacon_users_role  ON beacon.users (role);

-- ─── FUND ORGS ───────────────────────────────────────────────────────────────
-- One row per superannuation fund (or other organisation) accessing Beacon.
-- Maps to a save2retire organizations.id via s2r_org_id.
CREATE TABLE IF NOT EXISTS beacon.fund_orgs (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  s2r_org_id               UUID,                            -- FK into public.organizations (nullable — may not have S2R org)
  s2r_org_slug             VARCHAR(100),                    -- denormalised for quick lookups
  display_name             VARCHAR(255) NOT NULL,
  short_name               VARCHAR(100),                    -- used in labels/chips e.g. "AusSuper"
  logo_url                 VARCHAR(500),
  primary_color            VARCHAR(7) DEFAULT '#1B3A6B',    -- hex
  is_active                BOOLEAN NOT NULL DEFAULT TRUE,
  access_level             VARCHAR(20) NOT NULL DEFAULT 'demo'
                             CHECK (access_level IN ('demo', 'standard', 'premium')),
  contract_start           DATE,
  contract_end             DATE,                             -- null = ongoing
  apra_reporting_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
  api_access_enabled       BOOLEAN NOT NULL DEFAULT FALSE,
  push_export_enabled      BOOLEAN NOT NULL DEFAULT FALSE,
  push_endpoint_url        VARCHAR(500),
  push_secret_hash         VARCHAR(128),                    -- SHA-256 of the HMAC signing key
  push_frequency           VARCHAR(10) DEFAULT 'weekly'
                             CHECK (push_frequency IN ('daily', 'weekly', 'monthly')),
  min_population_threshold INTEGER NOT NULL DEFAULT 500,    -- cells below this are suppressed
  notes                    TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_beacon_fund_orgs_s2r ON beacon.fund_orgs (s2r_org_id);
CREATE INDEX IF NOT EXISTS idx_beacon_fund_orgs_slug ON beacon.fund_orgs (s2r_org_slug);

-- ─── FUND ORG USERS ──────────────────────────────────────────────────────────
-- Junction table: maps beacon users to fund orgs with org-scoped role.
-- A user can belong to multiple fund orgs with different roles at each.
CREATE TABLE IF NOT EXISTS beacon.fund_org_users (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id              UUID NOT NULL REFERENCES beacon.users (id) ON DELETE CASCADE,
  fund_org_id          UUID NOT NULL REFERENCES beacon.fund_orgs (id) ON DELETE CASCADE,
  org_role             VARCHAR(20) NOT NULL
                         CHECK (org_role IN ('org_admin', 'org_analyst', 'org_reporter', 'org_api')),
  invited_by           UUID REFERENCES beacon.users (id),
  invite_accepted_at   TIMESTAMPTZ,
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, fund_org_id)
);

CREATE INDEX IF NOT EXISTS idx_beacon_fou_user   ON beacon.fund_org_users (user_id);
CREATE INDEX IF NOT EXISTS idx_beacon_fou_org    ON beacon.fund_org_users (fund_org_id);
CREATE INDEX IF NOT EXISTS idx_beacon_fou_active ON beacon.fund_org_users (is_active);

-- ─── API KEYS ─────────────────────────────────────────────────────────────────
-- Programmatic API access scoped to a fund_org.
-- The actual key is shown once on creation and never stored — only the hash.
CREATE TABLE IF NOT EXISTS beacon.api_keys (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  fund_org_id   UUID NOT NULL REFERENCES beacon.fund_orgs (id) ON DELETE CASCADE,
  created_by    UUID NOT NULL REFERENCES beacon.users (id),
  key_hash      VARCHAR(128) NOT NULL UNIQUE,  -- SHA-256 of full key
  key_prefix    VARCHAR(12) NOT NULL,          -- "bkn_" + 8 chars — displayed to users
  label         VARCHAR(255) NOT NULL,         -- e.g. "PowerBI connection"
  scopes        JSONB NOT NULL DEFAULT '[]',   -- permitted endpoint scopes
  last_used_at  TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ,                   -- null = no expiry
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_beacon_api_keys_org    ON beacon.api_keys (fund_org_id);
CREATE INDEX IF NOT EXISTS idx_beacon_api_keys_prefix ON beacon.api_keys (key_prefix);
CREATE INDEX IF NOT EXISTS idx_beacon_api_keys_hash   ON beacon.api_keys (key_hash);

-- ─── PIPELINE RUNS ───────────────────────────────────────────────────────────
-- Audit trail for every aggregation pipeline run.
CREATE TABLE IF NOT EXISTS beacon.pipeline_runs (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_type               VARCHAR(30) NOT NULL
                           CHECK (run_type IN ('classification', 'aggregation', 'full', 'mock_load')),
  status                 VARCHAR(20) NOT NULL DEFAULT 'running'
                           CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  orgs_processed         INTEGER DEFAULT 0,
  snapshots_written      INTEGER DEFAULT 0,
  snapshots_suppressed   INTEGER DEFAULT 0,
  questions_classified   INTEGER DEFAULT 0,
  errors                 JSONB DEFAULT '[]',
  started_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at           TIMESTAMPTZ,
  triggered_by           VARCHAR(20) NOT NULL DEFAULT 'schedule'
                           CHECK (triggered_by IN ('schedule', 'manual', 'api', 'seed'))
);

-- ─── INTELLIGENCE SNAPSHOTS ──────────────────────────────────────────────────
-- Core output table. One row per metric per cohort per period per fund_org.
-- Written by the aggregation pipeline; read by the dashboard.
CREATE TABLE IF NOT EXISTS beacon.intelligence_snapshots (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  fund_org_id      UUID NOT NULL REFERENCES beacon.fund_orgs (id) ON DELETE CASCADE,
  s2r_org_id       UUID,                -- denormalised from fund_orgs for query convenience
  period_label     VARCHAR(10) NOT NULL,  -- e.g. "2026-M01"
  period_start     DATE NOT NULL,
  period_end       DATE NOT NULL,
  cohort_id        VARCHAR(5) NOT NULL,   -- "ALL", "C1"–"C5"
  income_band_id   VARCHAR(5) NOT NULL DEFAULT 'ALL',  -- "ALL", "I1"–"I4"
  metric_name      VARCHAR(80) NOT NULL,
  metric_value     NUMERIC(12, 6),       -- rate as 0.000–1.000, count as integer, index 0–100
  metric_unit      VARCHAR(20) NOT NULL
                     CHECK (metric_unit IN ('rate', 'count', 'index', 'pct', 'sessions_per_1k')),
  population_n     INTEGER NOT NULL DEFAULT 0,
  suppressed       BOOLEAN NOT NULL DEFAULT FALSE,
  pipeline_run_id  UUID REFERENCES beacon.pipeline_runs (id),
  data_source      VARCHAR(20) NOT NULL DEFAULT 'mock'
                     CHECK (data_source IN ('live', 'mock', 'pushed', 'manual')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_beacon_snapshots_unique
  ON beacon.intelligence_snapshots (fund_org_id, period_label, cohort_id, income_band_id, metric_name);

CREATE INDEX IF NOT EXISTS idx_beacon_snapshots_org_period
  ON beacon.intelligence_snapshots (fund_org_id, period_label);

CREATE INDEX IF NOT EXISTS idx_beacon_snapshots_metric
  ON beacon.intelligence_snapshots (fund_org_id, metric_name, cohort_id);

-- ─── AI QUESTION CLASSIFICATIONS ─────────────────────────────────────────────
-- Output of the classification pipeline.
-- Only the classification result is stored — question text stays in S2R.
CREATE TABLE IF NOT EXISTS beacon.ai_question_classifications (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  s2r_question_id     UUID NOT NULL UNIQUE, -- maps to public.ai_conversations.id
  s2r_org_id          UUID NOT NULL,
  topic_id            VARCHAR(5) NOT NULL,  -- "T01"–"T12"
  topic_confidence    NUMERIC(4, 3),        -- 0.000–1.000
  classified_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pipeline_run_id     UUID REFERENCES beacon.pipeline_runs (id)
);

CREATE INDEX IF NOT EXISTS idx_beacon_classifications_org   ON beacon.ai_question_classifications (s2r_org_id);
CREATE INDEX IF NOT EXISTS idx_beacon_classifications_topic ON beacon.ai_question_classifications (topic_id, s2r_org_id);

-- ─── PLAN STATE STAGING ──────────────────────────────────────────────────────
-- Non-identifiable plan state records for aggregation.
-- No user_id, no plan_id — only derived cohort/outcome fields.
CREATE TABLE IF NOT EXISTS beacon.plan_state_staging (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  s2r_org_id         UUID NOT NULL,
  s2r_plan_hash      VARCHAR(64) NOT NULL UNIQUE, -- SHA-256 of plan_id — one-way, non-reversible
  cohort_id          VARCHAR(5) NOT NULL,    -- derived from age band
  income_band_id     VARCHAR(5),             -- derived from salary range (nullable if no salary data)
  retirement_age_band VARCHAR(10),           -- e.g. "60-62", "63-65", "66+"
  is_couple          BOOLEAN,
  has_goals          BOOLEAN NOT NULL DEFAULT FALSE,
  goals_count        INTEGER NOT NULL DEFAULT 0,
  projection_outcome VARCHAR(20)             -- "funded", "gap", "unknown"
                       CHECK (projection_outcome IN ('funded', 'gap', 'unknown')),
  scenario_type      VARCHAR(20),
  recorded_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  period_label       VARCHAR(10) NOT NULL    -- which period this snapshot belongs to
);

CREATE INDEX IF NOT EXISTS idx_beacon_staging_org    ON beacon.plan_state_staging (s2r_org_id, period_label);
CREATE INDEX IF NOT EXISTS idx_beacon_staging_cohort ON beacon.plan_state_staging (cohort_id, s2r_org_id);

-- ─── REPORT CONFIGURATIONS ────────────────────────────────────────────────────
-- Saved report configurations per fund org.
CREATE TABLE IF NOT EXISTS beacon.report_configurations (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  fund_org_id   UUID NOT NULL REFERENCES beacon.fund_orgs (id) ON DELETE CASCADE,
  created_by    UUID NOT NULL REFERENCES beacon.users (id),
  name          VARCHAR(255) NOT NULL,
  report_type   VARCHAR(30) NOT NULL DEFAULT 'dashboard'
                  CHECK (report_type IN ('dashboard', 'apra_pack', 'custom', 'cohort_deep_dive')),
  config        JSONB NOT NULL DEFAULT '{}', -- period range, cohorts, metrics, filters
  is_shared     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_beacon_report_configs_org ON beacon.report_configurations (fund_org_id);

-- ─── REPORT EXPORTS ──────────────────────────────────────────────────────────
-- Audit trail of every export — download, push, or API retrieval.
CREATE TABLE IF NOT EXISTS beacon.report_exports (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  fund_org_id          UUID NOT NULL REFERENCES beacon.fund_orgs (id) ON DELETE CASCADE,
  exported_by          UUID REFERENCES beacon.users (id),   -- null for API/push exports
  api_key_id           UUID REFERENCES beacon.api_keys (id),
  export_type          VARCHAR(10) NOT NULL
                         CHECK (export_type IN ('csv', 'json', 'pdf', 'push', 'api')),
  report_config_id     UUID REFERENCES beacon.report_configurations (id),
  period_label         VARCHAR(20),
  s3_key               VARCHAR(500),          -- for PDF storage
  recipient_endpoint   VARCHAR(500),          -- for push exports
  delivered            BOOLEAN NOT NULL DEFAULT FALSE,
  delivered_at         TIMESTAMPTZ,
  payload_rows         INTEGER,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_beacon_exports_org ON beacon.report_exports (fund_org_id);

-- ─── INVITE TOKENS ────────────────────────────────────────────────────────────
-- Single-use invite links for org user onboarding.
CREATE TABLE IF NOT EXISTS beacon.invite_tokens (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  token_hash   VARCHAR(128) NOT NULL UNIQUE,
  email        VARCHAR(255) NOT NULL,
  fund_org_id  UUID NOT NULL REFERENCES beacon.fund_orgs (id) ON DELETE CASCADE,
  org_role     VARCHAR(20) NOT NULL,
  invited_by   UUID NOT NULL REFERENCES beacon.users (id),
  user_id      UUID REFERENCES beacon.users (id),   -- set if user already exists
  used         BOOLEAN NOT NULL DEFAULT FALSE,
  used_at      TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_beacon_invites_email ON beacon.invite_tokens (email);
CREATE INDEX IF NOT EXISTS idx_beacon_invites_org   ON beacon.invite_tokens (fund_org_id);

-- ─── PASSWORD RESET TOKENS ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS beacon.password_reset_tokens (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES beacon.users (id) ON DELETE CASCADE,
  token_hash   VARCHAR(128) NOT NULL UNIQUE,
  used         BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── AUDIT LOG ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS beacon.audit_log (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID REFERENCES beacon.users (id),
  api_key_id   UUID REFERENCES beacon.api_keys (id),
  fund_org_id  UUID REFERENCES beacon.fund_orgs (id),
  action       VARCHAR(80) NOT NULL,
  detail       JSONB DEFAULT '{}',
  ip_address   VARCHAR(50),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_beacon_audit_user   ON beacon.audit_log (user_id);
CREATE INDEX IF NOT EXISTS idx_beacon_audit_org    ON beacon.audit_log (fund_org_id);
CREATE INDEX IF NOT EXISTS idx_beacon_audit_action ON beacon.audit_log (action, created_at DESC);

-- ─── SYSTEM SETTINGS ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS beacon.system_settings (
  key          VARCHAR(100) PRIMARY KEY,
  value        TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by   UUID REFERENCES beacon.users (id)
);

-- Default settings
INSERT INTO beacon.system_settings (key, value) VALUES
  ('classification_model',      'claude-sonnet-4-20250514'),
  ('min_population_threshold',  '500'),
  ('pipeline_schedule',         '0 2 * * *'),
  ('mock_data_enabled',         'true'),
  ('app_version',               '0.1.0')
ON CONFLICT (key) DO NOTHING;

COMMIT;
