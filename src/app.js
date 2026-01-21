// src/app.js
// ✅ COPY-PASTE FINAL COMPLETO
// - Mantiene: module.exports = { createApp }
// - CORS robusto (incluye cache-control/pragma para DevTools + WebViews)
// - Request logger
// - Root
// - ✅ /api/v1 (routes)
// - 404
// - ✅ Error handler con sqlMessage real (db)
// - ✅ Headers globales: X-Service-Name / X-Build-Id
// - ✅ FIX: desactiva ETag + fuerza no-store para evitar 304 con body vacío

const express = require("express");
const cors = require("cors");

const v1Routes = require("./routes/v1.routes");

function isMiddleware(fn) {
  return typeof fn === "function";
}

function createApp() {
  const app = express();

  // =====================
  // ✅ FIX CLAVE: desactivar ETag (evita 304 Not Modified)
  // =====================
  app.set("etag", false);

  // =====================
  // CORS
  // =====================
  const allowedOriginsRaw = (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const allowNullOrigin = allowedOriginsRaw.includes("null");
  const allowedOrigins = allowedOriginsRaw.filter((o) => o !== "null");

  const corsOptions = {
    origin: (origin, callback) => {
      // server-to-server / curl (sin Origin)
      if (!origin) return callback(null, true);

      // algunos WebViews / file:// envían origin = "null"
      if (origin === "null") return callback(null, !!allowNullOrigin);

      // dev local
      if (origin.includes("localhost") || origin.includes("127.0.0.1")) return callback(null, true);

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

    // ✅ permitir headers que Chrome/IG WebView mandan en preflight
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Branch-Id",
      "X-Requested-With",
      "Accept",
      "Origin",
      "Cache-Control",
      "Pragma",
      "Expires",
      "If-None-Match",
      "If-Modified-Since",
    ],

    optionsSuccessStatus: 204,
  };

  app.use(cors(corsOptions));
  app.options("*", cors(corsOptions));

  // =====================
  // Parsers
  // =====================
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));

  // =====================
  // ✅ Headers globales (verificación deploy) + Anti-cache para API
  // =====================
  app.use((req, res, next) => {
    const serviceName = process.env.SERVICE_NAME || "pos360-commerce-api";
    const buildId = process.env.BUILD_ID || "dev";
    res.setHeader("X-Service-Name", serviceName);
    res.setHeader("X-Build-Id", buildId);

    // ✅ FIX: no-cache/no-store en TODO lo que sea API (y también para admin media)
    // Esto mata 304/ETag/caches intermedios.
    if (req.originalUrl.startsWith("/api/")) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      res.setHeader("Surrogate-Control", "no-store");

      // por si algún middleware/proxy lo setea igual
      res.removeHeader("ETag");
    }

    next();
  });

  // =====================
  // ✅ Request logger (DEBUG)
  // =====================
  app.use((req, res, next) => {
    const started = Date.now();

    const q = req.query && Object.keys(req.query).length ? req.query : null;
    const b = req.body && Object.keys(req.body).length ? req.body : null;

    console.log(`➡️ ${req.method} ${req.originalUrl}`);
    if (q) console.log("   query:", q);
    if (b) console.log("   body:", b);

    res.on("finish", () => {
      const ms = Date.now() - started;
      console.log(`✅ ${req.method} ${req.originalUrl} -> ${res.statusCode} (${ms}ms)`);
    });

    next();
  });

  // =====================
  // Root
  // =====================
  app.get("/", (req, res) => {
    res.json({
      name: process.env.SERVICE_NAME || "pos360-commerce-api",
      status: "online",
      env: process.env.NODE_ENV || "unknown",
      build: process.env.BUILD_ID || "dev",
      time: new Date().toISOString(),
    });
  });

  // =====================
  // API v1
  // =====================
  if (!isMiddleware(v1Routes)) {
    console.error("❌ v1Routes inválido. Debe exportar un router middleware.");
    console.error("   typeof:", typeof v1Routes);
    console.error("   keys:", v1Routes && typeof v1Routes === "object" ? Object.keys(v1Routes) : null);
    throw new Error("INVALID_V1_ROUTES_EXPORT");
  }

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
  // Error handler FINAL
  // =====================
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const dbCode = err?.original?.code || err?.parent?.code || err?.code || null;
    const sqlMessage = err?.original?.sqlMessage || err?.parent?.sqlMessage || null;
    const status = err?.httpStatus || err?.statusCode || err?.status || 500;

    console.error("❌ [API ERROR]", {
      method: req.method,
      url: req.originalUrl,
      message: err?.message,
      name: err?.name,
      code: dbCode,
      sqlMessage,
      stack: process.env.NODE_ENV === "production" ? undefined : err?.stack,
    });

    return res.status(status).json({
      ok: false,
      code: dbCode || "INTERNAL_ERROR",
      message: err?.message || "Internal Server Error",
      db: sqlMessage,
      stack: process.env.NODE_ENV === "production" ? undefined : err?.stack,
    });
  });

  return app;
}

module.exports = { createApp };
