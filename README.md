# Beacon — Member Intelligence Platform

**URL:** `insights.save2retire.ai`
**Port:** 3002 (separate from save2retire at 3001)
**Phase:** 1 — Foundation (auth + schema + mock data)

---

## What Beacon Is

Beacon reads anonymised, aggregated member behaviour data from
save2retire's database and surfaces it to superannuation funds as
a secure, role-controlled intelligence portal.

Funds see: engagement trends, AI topic distributions, retirement
preparedness metrics, and APRA-ready reporting — all at cohort
level, no individual member data.

---

## Prerequisites

- Node.js 20+
- Access to the save2retire PostgreSQL database
- A separate DB user for Beacon (see Database Setup below)

---

## Setup

### 1. Install dependencies

```bash
cd beacon
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` — at minimum:
- `DATABASE_URL` — same PG instance as save2retire
- `BEACON_JWT_SECRET` — generate with:
  ```bash
  node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
  ```
- `SEED_OWNER_PASSWORD` — platform owner password

### 3. Database setup

**Option A: Same DB user as save2retire (development)**

If save2retire's DB user has CREATE SCHEMA privileges, Beacon can
run migrations as-is. This is fine for local development.

**Option B: Dedicated beacon DB user (recommended for production)**

```sql
-- Run as postgres superuser
CREATE USER beacon_user WITH PASSWORD 'strong_password';

-- Beacon needs read-write on its own schema
GRANT CREATE ON DATABASE save2retire TO beacon_user;

-- After running migration 001 (which creates the beacon schema):
GRANT ALL PRIVILEGES ON SCHEMA beacon TO beacon_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA beacon TO beacon_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA beacon TO beacon_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA beacon
  GRANT ALL ON TABLES TO beacon_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA beacon
  GRANT ALL ON SEQUENCES TO beacon_user;

-- Beacon needs read-only access to the S2R views (in public schema)
GRANT SELECT ON public.v_beacon_ai_questions      TO beacon_user;
GRANT SELECT ON public.v_beacon_plan_states       TO beacon_user;
GRANT SELECT ON public.v_beacon_engagement_events TO beacon_user;
GRANT SELECT ON public.v_beacon_org_registry      TO beacon_user;
```

### 4. Run migrations

```bash
# Run as the save2retire DB owner (needs CREATE SCHEMA and CREATE VIEW)

# Step 1: Create beacon schema and all beacon tables
psql -U postgres -d save2retire -f migrations/001_beacon_schema.sql

# Step 2: Create S2R read-only views (requires access to public schema)
psql -U postgres -d save2retire -f migrations/002_s2r_views.sql

# Step 3 (optional): Add s2r_org_slug as unique constraint if not present
# The seed script uses s2r_org_slug for upserts — verify fund_orgs table first
```

> **Note on 002_s2r_views.sql:** This migration creates views in the
> `public` schema that read from save2retire's own tables. It must be
> run by a user with access to those tables. If save2retire's tables
> use a different schema, adjust the FROM clauses accordingly.
> The view for `v_beacon_plan_states` assumes a `public.goals` table
> exists — if goals are stored in JSONB on the plans table, update
> the LEFT JOIN accordingly.

### 5. Seed the database

```bash
node seed/seed.js
```

This creates:
- Platform owner and analyst accounts
- Two demo fund orgs (Australian Super, REST)
- Fund org users with various roles
- 6 months of mock intelligence snapshots (720+ rows)

Credentials printed to console on completion.

### 6. Start the server

**Development:**
```bash
npm run dev  # starts both Express (3002) and Vite (5174) with hot reload
```

**Server only:**
```bash
npm run dev:server
```

**Frontend only (with proxy to existing server):**
```bash
npm run dev:frontend
```

### 7. Verify

Visit `http://localhost:5174` — you should see the Beacon login screen.

Visit `http://localhost:3002/api/health` — should return all checks passing.

---

## Demo Login Credentials

| Role | Email | Password |
|------|-------|----------|
| Platform Owner | admin@save2retire.ai | (from SEED_OWNER_PASSWORD) |
| Platform Analyst | analyst@save2retire.ai | demo1234 |
| AusSuper Admin | admin@aussuper-demo.beacon | demo1234 |
| AusSuper Analyst | analyst@aussuper-demo.beacon | demo1234 |
| AusSuper Reporter | reporter@aussuper-demo.beacon | demo1234 |
| REST Admin | admin@rest-demo.beacon | demo1234 |

⚠ Change all passwords before any external demo session.

---

## Deployment: insights.save2retire.ai

Beacon runs on port 3002. Configure your reverse proxy (nginx/ALB)
to route `insights.save2retire.ai` to `localhost:3002`.

**nginx example:**
```nginx
server {
    listen 443 ssl;
    server_name insights.save2retire.ai;

    location / {
        proxy_pass http://localhost:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Add `insights.save2retire.ai` to save2retire's CORS_ORIGIN if the
two apps need to call each other's APIs (not required for Phase 1).

---

## Project Structure

```
beacon/
├── server/
│   ├── index.js              # Express entry — port 3002
│   ├── db.js                 # PG pool — beacon schema default
│   ├── middleware/
│   │   └── auth.js           # JWT, platform roles, org scoping
│   └── routes/
│       ├── auth.js           # Login, logout, me, context, invites
│       └── health.js         # Health check
├── migrations/
│   ├── 001_beacon_schema.sql # beacon.* tables
│   └── 002_s2r_views.sql     # public.v_beacon_* read-only views
├── seed/
│   └── seed.js               # Platform users + mock intelligence data
├── src/
│   └── app.jsx               # React app (Phase 1: login + shell)
├── public/
│   └── app.html              # HTML shell
├── vite.config.js
├── package.json
└── .env.example
```

---

## Phase Roadmap

| Phase | Deliverable | Status |
|-------|-------------|--------|
| 1 | Foundation — schema, auth, mock data, login UI | ✅ Complete |
| 2 | Platform admin UI — fund org management, pipeline | 🔜 Next |
| 3 | Fund portal — dashboards (engagement, preparedness, topics) | 🔜 |
| 4 | APRA reporting pack + org user management | 🔜 |
| 5 | API access + push export | 🔜 |
| 6 | Live aggregation pipeline (replaces mock data) | 🔜 |
| 7 | Spin-off deployment package | 🔜 |

---

## Key Architecture Notes

**Two-level auth model:**
- Platform roles (`platform_owner`, `platform_admin`, `platform_analyst`, `fund_user`)
  are stored in `beacon.users.role`
- Org roles (`org_admin`, `org_analyst`, `org_reporter`, `org_api`)
  are stored in `beacon.fund_org_users.org_role` per fund
- JWT carries both: `role` (platform) + `active_fund_org_id` + `active_org_role`
- Fund users scoped to their org at middleware level — they cannot see other orgs' data

**Data isolation:**
- `intelligence_snapshots` has `fund_org_id` on every row
- All intelligence queries filtered by `req.fundOrgId` (set by `injectFundOrgScope` middleware)
- Platform users can pass `?fund_org_id=` to view any org (admin support)

**Mock vs live data:**
- `data_source` column: `'mock'` (seed), `'live'` (pipeline), `'pushed'` (in-house mode)
- Dashboard queries filter by `data_source` — switch mock to live by changing one constant
- Mock data and live data can coexist; dashboard shows live data preferentially

**S2R views:**
- Never touch raw S2R tables — only `public.v_beacon_*` views
- Views strip all PII before Beacon sees the data
- `user_id` is SHA-256 hashed in views — allows counting unique users per cohort without re-identification
