// src/app.js
const express = require("express");
const cors = require("cors");

const v1Routes = require("./routes/v1.routes");
const { errorMiddleware } = require("./middlewares/error.middleware");

function createApp() {
  const app = express();

  // =====================
  // 1. CORS (CRÍTICO)
  // =====================
  const allowedOrigins = (process.env.CORS_ORIGINS || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  const corsOptions = {
    origin: (origin, callback) => {
      // Permitir requests sin origin (curl, postman)
      if (!origin) return callback(null, true);

      // Permitir localhost siempre (dev)
      if (origin.includes("localhost")) return callback(null, true);

      // Permitir si está en whitelist o wildcard
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
  // 3. Health / root
  // =====================
  app.get("/", (req, res) => {
    res.json({
      name: "pos360-api",
      status: "online",
      time: new Date().toISOString(),
    });
  });

  // =====================
  // 4. API v1
  // =====================
  app.use("/api/v1", v1Routes);

  // =====================
  // 5. Error handler (SIEMPRE AL FINAL)
  // =====================
  app.use(errorMiddleware);

  return app;
}

module.exports = { createApp };
