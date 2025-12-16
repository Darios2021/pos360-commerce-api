// src/server.js
const express = require("express");
const cors = require("cors");

const env = require("./config/env");
const { sequelize } = require("./models");

const app = express();
app.use(express.json({ limit: "2mb" }));

// =====================
// CORS (BLINDADO DEV + PROD)
// =====================
const CORS_ORIGINS =
  process.env.CORS_ORIGINS ??
  env.CORS_ORIGINS ??
  "http://localhost:5173";

const allowedOrigins = String(CORS_ORIGINS)
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

// ✅ helpers: permitir localhost/127 en cualquier puerto (dev)
function isLocalDevOrigin(origin) {
  if (!origin) return true;
  return (
    /^http:\/\/localhost:\d+$/.test(origin) ||
    /^http:\/\/127\.0\.0\.1:\d+$/.test(origin)
  );
}

const corsOptions = {
  origin: (origin, cb) => {
    // curl/postman/server-to-server
    if (!origin) return cb(null, true);

    // dev local (cualquier puerto)
    if (isLocalDevOrigin(origin)) return cb(null, true);

    // wildcard explícito
    if (allowedOrigins.includes("*")) return cb(null, true);

    // lista explícita (prod)
    if (allowedOrigins.includes(origin)) return cb(null, true);

    return cb(new Error(`Not allowed by CORS: ${origin}`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "Accept",
    "Origin",
  ],
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions)); // ✅ preflight con la misma config

// =====================
// Middlewares
// =====================
const authMw = require("./middlewares/auth.middleware");
const rbacMw = require("./middlewares/rbac.middleware");

const requireAuth =
  authMw.requireAuth ||
  authMw.authenticate ||
  authMw.auth ||
  ((req, res, next) => next());

const requireRole =
  rbacMw.requireRole ||
  rbacMw.allowRole ||
  rbacMw.rbac ||
  (() => (req, res, next) => next());

// =====================
// Rutas API
// =====================
const routes = require("./routes");
app.use("/api/v1", routes);

// =====================
// Health
// =====================
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "pos360-commerce-api",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// =====================
// Start
// =====================
async function start() {
  try {
    await sequelize.authenticate();
    console.log("✅ DB connected");
  } catch (err) {
    console.error("❌ DB connection failed");
    console.error(err);
    process.exit(1);
  }

  app.listen(env.PORT, () => {
    console.log(`🚀 API listening on :${env.PORT}`);
    console.log("🌐 CORS_ORIGINS =", allowedOrigins);
  });
}

start();
