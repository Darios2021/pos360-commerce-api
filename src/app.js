// src/app.js
const express = require("express");
const cors = require("cors");

const v1Routes = require("./routes/v1.routes");

function createApp() {
  const app = express();

  // =====================
  // 1) CORS
  // =====================
  const allowedOrigins = (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const corsOptions = {
    origin: (origin, callback) => {
      // sin origin: curl/postman/healthchecks
      if (!origin) return callback(null, true);

      // dev local
      if (origin.includes("localhost") || origin.includes("127.0.0.1")) {
        return callback(null, true);
      }

      if (
        allowedOrigins.length === 0 ||
        allowedOrigins.includes("*") ||
        allowedOrigins.includes(origin)
      ) {
        return callback(null, true);
      }

      return callback(new Error(`CORS blocked by pos360: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  };

  app.use(cors(corsOptions));
  app.options("*", cors(corsOptions));

  // =====================
  // 2) Parsers
  // =====================
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true }));

  // =====================
  // 3) Root
  // =====================
  app.get("/", (req, res) => {
    res.json({
      name: "pos360-api",
      status: "online",
      env: process.env.NODE_ENV || "unknown",
      time: new Date().toISOString(),
    });
  });

  // =====================
  // 4) API v1
  // =====================
  app.use("/api/v1", v1Routes);

  // =====================
  // 5) 404
  // =====================
  app.use((req, res) => {
    res.status(404).json({
      ok: false,
      code: "NOT_FOUND",
      message: `Ruta no encontrada: ${req.method} ${req.originalUrl}`,
    });
  });

  // =====================
  // 6) Error handler FINAL
  // =====================
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error("❌ [API ERROR]", {
      method: req.method,
      url: req.originalUrl,
      message: err?.message,
      code: err?.code,
    });

    const status = err?.httpStatus || 500;

    return res.status(status).json({
      ok: false,
      code: err?.code || "INTERNAL_ERROR",
      message: err?.message || "Internal Server Error",
    });
  });

  return app;
}

module.exports = { createApp };
