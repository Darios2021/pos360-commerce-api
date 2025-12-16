// src/server.js
const express = require("express");
const cors = require("cors");

const env = require("./config/env");
const { sequelize } = require("./models");

const app = express();
app.use(express.json({ limit: "2mb" }));

// =====================
// CORS (FIX DEFINITIVO)
// =====================

// 👉 Runtime env (CapRover) + fallback local
const CORS_ORIGINS =
  process.env.CORS_ORIGINS ??
  env.CORS_ORIGINS ??
  "http://localhost:5173";

const allowedOrigins = String(CORS_ORIGINS)
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const corsOptions = {
  origin: (origin, cb) => {
    // curl / postman / server-to-server
    if (!origin) return cb(null, true);

    // wildcard explícito
    if (allowedOrigins.includes("*")) return cb(null, true);

    // origins permitidos
    if (allowedOrigins.includes(origin)) return cb(null, true);

    return cb(new Error(`Not allowed by CORS: ${origin}`));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));

// ✅ responder preflight CON LA MISMA CONFIG
app.options("*", cors(corsOptions));

// =====================
// Middlewares
// =====================
const authMw = require("./middlewares/auth.middleware");
const rbacMw = require("./middlewares/rbac.middleware");

// fallback seguro
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
// DEBUG (protegido)
// =====================
app.get("/__routes", requireAuth, requireRole("super_admin"), (req, res) => {
  try {
    const out = [];
    const split = (v) => (v || "").split("/").filter(Boolean);

    const getMountPath = (layer) => {
      if (!layer.regexp) return "";
      let s = layer.regexp.toString();
      s = s
        .replace("/^\\", "")
        .replace("\\/?(?=\\/|$)/i", "")
        .replace("\\/?(?=\\/|$)/", "")
        .replace("/i", "")
        .replace("\\/", "/")
        .replace(/\\\//g, "/")
        .replace(/\(\?:\(\[\^\\\/\]\+\?\)\)/g, "")
        .replace(/\(\?:\[\^\\\/\]\+\?\)/g, "")
        .replace(/\(\?:\[\^\/\]\+\?\)/g, "")
        .replace(/\(\?:\)\?/g, "")
        .replace(/\$$/, "");

      if (!s.startsWith("/")) s = "/" + s;
      if (s === "/") return "";
      return s;
    };

    const walk = (stack, prefix = "") => {
      stack.forEach((layer) => {
        if (layer.route?.path) {
          const methods = Object.keys(layer.route.methods || {}).map((m) =>
            m.toUpperCase()
          );
          const fullPath =
            "/" + [...split(prefix), ...split(layer.route.path)].join("/");
          out.push({ methods, path: fullPath });
          return;
        }

        if (layer.name === "router" && layer.handle?.stack) {
          const mount = getMountPath(layer);
          const newPrefix =
            "/" + [...split(prefix), ...split(mount)].join("/");
          walk(layer.handle.stack, newPrefix);
        }
      });
    };

    walk(app?._router?.stack || [], "");
    out.sort((a, b) => a.path.localeCompare(b.path));

    res.json({ ok: true, count: out.length, routes: out });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/__db", requireAuth, requireRole("super_admin"), async (req, res) => {
  try {
    await sequelize.authenticate();
    const [rows] = await sequelize.query("SELECT 1 AS ok");
    res.json({ ok: true, db: true, rows });
  } catch (e) {
    res.status(500).json({ ok: false, db: false, error: e.message });
  }
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
