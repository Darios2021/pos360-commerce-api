// src/app.js
const express = require("express");
const cors = require("cors");

const v1Routes = require("./routes/v1.routes");

function createApp() {
  const app = express();

  // =====================
  // Parsers
  // =====================
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true }));

  // =====================
  // CORS (ROBUSTO / PROD READY)
  // =====================
  const allowed = (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const allowAll = allowed.includes("*") || allowed.length === 0;

  const corsOptions = {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // curl / healthcheck
      if (allowAll) return cb(null, true);

      if (origin.includes("localhost") || origin.includes("127.0.0.1")) {
        return cb(null, true);
      }

      if (allowed.includes(origin)) return cb(null, true);

      return cb(new Error(`CORS blocked by pos360: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  };

  app.use(cors(corsOptions));
  app.options("*", cors(corsOptions));

  // =====================
  // Logger DEBUG
  // =====================
  app.use((req, res, next) => {
    const start = Date.now();
    console.log(`➡️ ${req.method} ${req.originalUrl}`);

    res.on("finish", () => {
      console.log(
        `✅ ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - start}ms)`
      );
    });

    next();
  });

  // =====================
  // Root
  // =====================
  app.get("/", (req, res) => {
    res.json({
      name: "pos360-api",
      status: "online",
      env: process.env.NODE_ENV,
      time: new Date().toISOString(),
    });
  });

  // =====================
  // API v1
  // =====================
  app.use("/api/v1", v1Routes);

  // =====================
  // 404
  // =====================
  app.use((req, res) => {
    res.status(404).json({
      ok: false,
      code: "NOT_FOUND",
      message: `Ruta no encontrada: ${req.method} ${req.originalUrl}`,
    });
  });

  // =====================
  // Error handler final
  // =====================
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error("❌ API ERROR:", err?.message || err);
    res.status(err?.statusCode || 500).json({
      ok: false,
      code: err?.code || "INTERNAL_ERROR",
      message: err?.message || "Internal Server Error",
    });
  });

  return app;
}

module.exports = { createApp };
