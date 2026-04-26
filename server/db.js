// ─── Beacon — Database Connection ────────────────────────────────────────────
// Connects to the same PostgreSQL instance as save2retire.
// search_path is set to 'beacon, public' so that:
//   - Unqualified table names (e.g. "users") resolve to beacon.users
//   - Views prefixed v_beacon_* resolve to public.v_beacon_* (S2R read-only views)
// ─────────────────────────────────────────────────────────────────────────────
require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Set search_path so beacon.* tables are the default
  // and public.v_beacon_* views are accessible without schema prefix
  options: "-c search_path=beacon,public",
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  // AWS RDS uses a self-signed certificate chain — disable verification
  // for RDS connections. Safe because traffic is within AWS VPC in production.
  ssl: process.env.DATABASE_URL?.includes("rds.amazonaws.com")
    ? { rejectUnauthorized: false }
    : false,
});

pool.on("connect", (client) => {
  // Belt-and-suspenders: ensure search_path is set per connection
  client.query("SET search_path TO beacon, public").catch(() => {});
});

pool.on("error", (err) => {
  console.error("Beacon DB pool error:", err.message);
});

// Promisified query helper — mirrors save2retire's db.js interface
async function query(text, params) {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

// Transaction helper
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET search_path TO beacon, public");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withTransaction };
