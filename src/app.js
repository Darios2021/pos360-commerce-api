// src/app.js
const express = require("express");
const cors = require("cors");

const v1Routes = require("./routes/v1.routes");

function createApp() {
  const app = express();

  // =====================
  // 1. CORS (CRÍTICO)
  // =====================
  const allowedOrigins = (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const corsOptions = {
    origin: (origin, callback) => {
      // Requests sin origin (curl, server-to-server)
      if (!origin) return callback(null, true);

      // Dev local
      if (origin.includes("localhost") || origin.includes("127.0.0.1")) {
        return callback(null, true);
      }

      if (
        allowedOrigins.includes("*") ||
        allowedOrigins.includes(origin) ||
        allowedOrigins.length === 0
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
  // 2. Body parsers
  // =====================
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true }));

  // =====================
  // 3. Root / Health
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
  // 4. API v1
  // =====================
  app.use("/api/v1", v1Routes);

  // =====================
  // 5. 404 handler
  // =====================
  app.use((req, res) => {
    res.status(404).json({
      ok: false,
      code: "NOT_FOUND",
      message: `Ruta no encontrada: ${req.method} ${req.originalUrl}`,
    });
  });

  // =====================
  // 6. ERROR HANDLER FINAL (CLAVE)
  // =====================
  app.use((err, req, res, next) => {
    console.error("❌ [API ERROR]", {
      method: req.method,
      url: req.originalUrl,
      message: err?.message,
      code: err?.code,
      stack: err?.stack,
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
