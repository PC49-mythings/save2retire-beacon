// ============================================================
// Beacon — Member Intelligence Platform
// API Server · Port 3002 (separate from save2retire :3001)
// Subdomain: insights.save2retire.ai
// ============================================================
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const path = require("path");
const { pool } = require("./db");

const app = express();
const PORT = process.env.PORT || 3002;
const isDev = process.env.NODE_ENV !== "production";

// ─── Static assets ────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, "..", "dist")));
app.use(express.static(path.join(__dirname, "..", "public")));

// ─── Serve the React app ───────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "dist", "index.html"));
});

// ─── Security & Middleware ─────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "fonts.googleapis.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "fonts.googleapis.com", "fonts.gstatic.com"],
      fontSrc: ["'self'", "fonts.gstatic.com", "fonts.googleapis.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
    },
  },
}));
app.use(express.json({ limit: "2mb" }));
app.use(morgan(isDev ? "dev" : "combined"));

// Disable ETags on API — prevents stale 304s
app.use("/api", (req, res, next) => { res.set("Cache-Control", "no-store"); next(); });

// ─── CORS ──────────────────────────────────────────────────────────────────────
const allowedOrigins = isDev
  ? true
  : (process.env.CORS_ORIGIN || "").split(",").map(s => s.trim()).filter(Boolean);

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Beacon-Key"],
}));

// ─── Rate Limiting ─────────────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "900000"),
  max: parseInt(process.env.RATE_LIMIT_MAX || "300"),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});
const authLimiter = rateLimit({
  windowMs: 900000,
  max: parseInt(process.env.AUTH_RATE_LIMIT_MAX || "20"),
  message: { error: "Too many auth attempts, please try again later" },
});

app.use("/api/", globalLimiter);
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/forgot-password", authLimiter);

// ─── Routes ────────────────────────────────────────────────────────────────────
app.use("/api/auth",         require("./routes/auth"));
app.use("/api/health",       require("./routes/health"));

app.use("/api/admin",        require("./routes/admin"));
app.use("/api/org",          require("./routes/org"));
app.use("/api/intelligence", require("./routes/intelligence"));
app.use("/api/reports",      require("./routes/reports"));
// app.use("/api/feed",         require("./routes/feed"));

// ─── SPA fallback ─────────────────────────────────────────────────────────────
// All non-API GET requests serve the React app (client-side routing)
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  res.sendFile(path.join(__dirname, "..", "dist", "index.html"));
});

// ─── 404 & Error handlers ──────────────────────────────────────────────────────
app.use("/api/*", (req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
});

app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: isDev ? err.message : "Internal server error" });
});

// ─── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  // Verify DB connection on startup
  try {
    await pool.query("SELECT 1");
    console.log(`
╔═══════════════════════════════════════════════════╗
║  Beacon — Member Intelligence Platform            ║
║  Port : ${String(PORT).padEnd(42)}║
║  Env  : ${String(process.env.NODE_ENV || "development").padEnd(42)}║
║  DB   : connected (beacon schema)                 ║
╚═══════════════════════════════════════════════════╝
    `);
  } catch (err) {
    console.error("DB connection failed on startup:", err.message);
    console.log(`
╔═══════════════════════════════════════════════════╗
║  Beacon — Member Intelligence Platform            ║
║  Port : ${String(PORT).padEnd(42)}║
║  DB   : ⚠ CONNECTION FAILED                       ║
╚═══════════════════════════════════════════════════╝
    `);
  }
});

module.exports = app;
