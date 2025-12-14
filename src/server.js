// src/server.js
const express = require("express");
const env = require("./config/env");
const { sequelize } = require("./models");

const app = express();

app.use(express.json());

// =====================
// Rutas API (habilitadas)
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
// DEBUG (temporal) - lista TODAS las rutas, incluyendo routers montados
// =====================
app.get("/__routes", (req, res) => {
  try {
    const out = [];

    const split = (thing) => (thing || "").split("/").filter(Boolean);

    // Convierte layer.regexp a un "path" lo más humano posible
    const getMountPath = (layer) => {
      if (!layer.regexp) return "";
      let s = layer.regexp.toString(); // ej: "/^\\/api\\/v1\\/?(?=\\/|$)/i"
      s = s
        .replace("/^\\", "")
        .replace("\\/?(?=\\/|$)/i", "")
        .replace("\\/?(?=\\/|$)/", "")
        .replace("/i", "")
        .replace("\\/", "/")
        .replace(/\\\//g, "/");

      // Limpia restos comunes
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
        // Ruta directa
        if (layer.route?.path) {
          const methods = Object.keys(layer.route.methods || {}).map((m) => m.toUpperCase());
          const fullPath = "/" + [...split(prefix), ...split(layer.route.path)].join("/");
          out.push({ methods, path: fullPath });
          return;
        }

        // Router montado
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

// =====================
// DEBUG (temporal) - ping DB
// =====================
app.get("/__db", async (req, res) => {
  try {
    await sequelize.authenticate();
    const [rows] = await sequelize.query("SELECT 1 AS ok");
    res.json({ ok: true, db: true, rows });
  } catch (e) {
    res.status(500).json({ ok: false, db: false, error: e.message });
  }
});

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
