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
// DEBUG (temporal)
// =====================
app.get("/__routes", (req, res) => {
  try {
    const out = [];
    const stack = app?._router?.stack || [];

    stack.forEach((layer) => {
      if (layer.route?.path) {
        const methods = Object.keys(layer.route.methods || {}).map((m) => m.toUpperCase());
        out.push({ methods, path: layer.route.path });
      }
    });

    res.json({ ok: true, count: out.length, routes: out });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

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
