// src/middlewares/cors.middleware.js
// ✅ COPY-PASTE FINAL COMPLETO
// CORS robusto (incluye Cache-Control/Pragma para DevTools + WebViews como Instagram)

const cors = require("cors");

function parseOrigins() {
  const raw = String(process.env.CORS_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const allowNull = raw.includes("null");
  const set = new Set(raw.filter((o) => o !== "null"));

  return { set, allowNull };
}

function corsMiddleware() {
  const { set, allowNull } = parseOrigins();

  return cors({
    origin(origin, cb) {
      // server-to-server / curl
      if (!origin) return cb(null, true);

      // algunos WebView / file:// -> origin "null"
      if (origin === "null") return cb(null, !!allowNull);

      if (set.has(origin)) return cb(null, true);

      console.warn("[CORS] Bloqueado origin:", origin);
      return cb(new Error("Not allowed by CORS"), false);
    },

    credentials: true,

    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],

    // ✅ FIX CLAVE: permitir cache-control/pragma (Chrome DevTools "Disable cache")
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "Accept",
      "Origin",
      "Cache-Control",
      "Pragma",
      "Expires",
    ],

    exposedHeaders: ["Content-Length", "Content-Type"],

    maxAge: 86400,
  });
}

module.exports = {
  corsMiddleware,
};
