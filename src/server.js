// src/server.js
const express = require("express");
const cors = require("cors");

const env = require("./config/env");
const { sequelize } = require("./models");

// 🔹 MinIO / S3
const { checkBucketAccess } = require("./services/s3.service");

const app = express();
app.use(express.json({ limit: "25mb" }));

// =====================
// CORS (PROD + LOCAL)
// =====================
const CORS_ORIGINS =
  process.env.CORS_ORIGINS ??
  env.CORS_ORIGINS ??
  "http://localhost:5173,http://127.0.0.1:5173";

const allowedOrigins = String(CORS_ORIGINS)
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const corsMw = cors({
  origin: (origin, cb) => {
    // curl/postman/server-to-server
    if (!origin) return cb(null, true);

    if (allowedOrigins.includes("*")) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);

    return cb(new Error(`Not allowed by CORS: ${origin}`));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
});

app.use(corsMw);
app.options("*", corsMw);

// =====================
// Routes
// =====================
const routes = require("./routes");
app.use("/api/v1", routes);

// =====================
// Health
// =====================
app.get("/api/v1/health", (req, res) => {
  res.json({
    ok: true,
    service: "pos360-commerce-api",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// =====================
// Global error handler
// =====================
app.use((err, req, res, next) => {
  const msg = err?.message || "Internal error";
  const isCors = msg.includes("Not allowed by CORS");

  if (isCors) {
    return res.status(403).json({
      ok: false,
      code: "CORS_BLOCKED",
      message: msg,
    });
  }

  console.error("❌ SERVER ERROR:", err);
  res.status(500).json({
    ok: false,
    code: "SERVER_ERROR",
    message: msg,
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

  // 🔹 Chequeo MinIO / S3 al arranque
  try {
    await checkBucketAccess();
    console.log("✅ MinIO / S3 bucket access OK");
  } catch (err) {
    console.error("❌ MinIO / S3 bucket access FAILED");
    console.error(err?.message || err);
  }

  const port = process.env.PORT ?? env.PORT ?? 3000;
  app.listen(port, () => {
    console.log(`🚀 API listening on :${port}`);
    console.log("🌐 CORS_ORIGINS =", allowedOrigins);
  });
}

start();
