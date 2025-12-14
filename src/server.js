// src/server.js
const express = require("express");
const env = require("./config/env");
const { sequelize } = require("./models");

const app = express();
app.use(express.json());

// =====================
// Middlewares (usar los tuyos)
// =====================
const authMw = require("./middlewares/auth.middleware");
const rbacMw = require("./middlewares/rbac.middleware");

// Fallbacks por si tus exports tienen nombres distintos
const requireAuth =
  authMw.requireAuth || authMw.authenticate || authMw.auth || authMw;

const requireRole =
  rbacMw.requireRole || rbacMw.allowRole || rbacMw.rbac || ((role) => (req, res, next) => next());

// =====================
// Rutas API
// =====================
const routes = require("./routes");
app.use("/api/v1", routes);

// =====================
// Health
// =====================
app.get("/health", (req, res) => {
  res.json({ ok: true, service: "pos360-commerce-api" });
});

// =====================
// DEBUG (protegidos)
// =====================
app.get("/__routes", requireAuth, requireRole("super_admin"), (req, res) => {
  try {
    const out = [];
    const split = (thing) => (thing || "").split("/").filter(Boolean);

    const getMountPath = (layer) => {
      if (!layer.regexp) return "";
      let s = layer.regexp.toString();
      s = s
        .replace("/^\\", "")
        .replace("\\/?(?=\\/|$)/i", "")
        .replace("\\/?(?=\\/|$)/", "")
        .replace("/i", "")
        .replace("\\/", "/")
        .replace(/\\\//g, "/");

      s = s.replace(/\(\?:\(\[\^\\\/\]\+\?\)\)/g, "");
      s = s.replace(/\(\?:\[\^\\\/\]\+\?\)/g, "");
      s = s.replace(/\(\?:\[\^\/\]\+\?\)/g, "");
      s = s.replace(/\(\?:\)\?/g, "");
      s = s.replace(/\$$/, "");

      if (!s.startsWith("/")) s = "/" + s;
      if (s === "/") return "";
      return s;
    };

    const walk = (stack, prefix = "") => {
      stack.forEach((layer) => {
        if (layer.route?.path) {
          const methods = Object.keys(layer.route.methods || {}).map((m) => m.toUpperCase());
          const fullPath = "/" + [...split(prefix), ...split(layer.route.path)].join("/");
          out.push({ methods, path: fullPath });
          return;
        }

        if (layer.name === "router" && layer.handle?.stack) {
          const mount = getMountPath(layer);
          const newPrefix = "/" + [...split(prefix), ...split(mount)].join("/");
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
    console.error("❌ DB connection failed. Exiting.");
    console.error(err);
    process.exit(1);
  }

  app.listen(env.PORT, () => {
    console.log(`🚀 API listening on :${env.PORT}`);
  });
}

start();
