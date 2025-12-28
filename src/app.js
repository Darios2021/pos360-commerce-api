// src/app.js
const express = require("express");
const cors = require("cors");

const v1Routes = require("./routes/v1.routes");

function isMiddleware(fn) {
  return typeof fn === "function";
}

function normOrigin(v) {
  return String(v || "")
    .trim()
    .replace(/\/$/, ""); // quita "/" final
}

function createApp() {
  const app = express();

  // ✅ Evita 304/ETag que a veces “pierden” headers CORS detrás de proxy
  app.disable("etag");

  // =====================
  // Parsers
  // =====================
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true }));

  // =====================
  // CORS
  // =====================
  const allowedOrigins = (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((s) => normOrigin(s))
    .filter(Boolean);

  const corsOptions = {
    origin: (origin, callback) => {
      // requests sin origin (curl/postman) => ok
      if (!origin) return callback(null, true);

      const o = normOrigin(origin);

      // ✅ permitir localhost SIEMPRE (como vos ya venías haciendo)
      if (o.includes("localhost") || o.includes("127.0.0.1")) {
        return callback(null, true);
      }

      // ✅ allowlist explícita
      if (allowedOrigins.includes("*") || allowedOrigins.includes(o)) {
        return callback(null, true);
      }

      return callback(new Error(`CORS blocked by pos360: ${o}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    optionsSuccessStatus: 204,
  };

  // ✅ CORS headers en todas las respuestas
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) res.setHeader("Vary", "Origin");
    next();
  });

  app.use(cors(corsOptions));

  // ✅ Preflight: responder rápido y bien
  app.options("*", cors(corsOptions));

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
      name: "pos360-api",
      status: "online",
      env: process.env.NODE_ENV || "unknown",
      time: new Date().toISOString(),
    });
  });

  // =====================
  // API v1 (validación)
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
  // ✅ Error handler FINAL
  // =====================
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error("❌ [API ERROR]", {
      method: req.method,
      url: req.originalUrl,
      message: err?.message,
      code: err?.code,
      stack: process.env.NODE_ENV === "production" ? undefined : err?.stack,
    });

    const status = err?.httpStatus || err?.statusCode || 500;

    return res.status(status).json({
      ok: false,
      code: err?.code || "INTERNAL_ERROR",
      message: err?.message || "Internal Server Error",
      stack: process.env.NODE_ENV === "production" ? undefined : err?.stack,
    });
  });

  return app;
}

module.exports = { createApp };
