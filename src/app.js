// src/app.js
const express = require("express");
const cors = require("cors");
const v1Routes = require("./routes/v1.routes");
const { errorMiddleware } = require("./middlewares/error.middleware");

function createApp() {
  const app = express();

  // =====================
  // CORS
  // =====================
  const allowedOrigins = (process.env.CORS_ORIGINS || "")
    .split(",")
    .map(o => o.trim())
    .filter(Boolean);

  app.use(cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes("*")) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error(`CORS blocked: ${origin}`));
    },
    credentials: true,
  }));

  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true }));

  // Root
  app.get("/", (req, res) => {
    res.json({
      name: "pos360-api",
      status: "online",
      env: process.env.NODE_ENV,
      time: new Date().toISOString(),
    });
  });

  // API v1
  app.use("/api/v1", v1Routes);

  // Errors
  app.use(errorMiddleware);

  return app;
}

module.exports = { createApp };
