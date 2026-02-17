// ✅ COPY-PASTE FINAL COMPLETO
// src/app.js
//
// - ✅ Mantiene: module.exports = { createApp }
// - ✅ API en /api/v1
// - ✅ FIX CLAVE: soporta reverse-proxy que “strippea” /api/v1 (monta también en "/")
// - ✅ SHOP en / (sirve dist estático + inyección de <head> desde DB) (si ENABLE_SHOP=true y hay dist)
// - ✅ /api health en /api (para no pisar el home)
// - ✅ FIX: desactiva ETag global + no-store para /api
// - ✅ /favicon.ico dinámico (branding)
// - ✅ No interfiere assets (/assets/*) del shop
// - ✅ NUEVO: cookies httpOnly para Shop Auth (Google) con cookie-parser + trust proxy

const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser"); // ✅ NUEVO
const path = require("path");
const fs = require("fs");

const v1Routes = require("./routes/v1.routes");

// ✅ Tu middleware ya existe en /middlewares/shopHeadInjector.js
const { createShopHeadInjector } = require("./middlewares/shopHeadInjector");

// ✅ DB (para favicon dinámico)
const db = require("./models"); // normalmente exporta sequelize + modelos

function isMiddleware(fn) {
  return typeof fn === "function";
}

function safeStr(v) {
  return String(v ?? "").trim();
}

function envBool(name, fallback = false) {
  const v = process.env[name];
  if (v === undefined || v === null || v === "") return fallback;
  return String(v).toLowerCase() === "true";
}

/**
 * Detecta si hay un dist válido del shop para servirlo.
 * Podés forzar ruta con SHOP_DIST_DIR.
 */
function resolveShopDistDir() {
  const fromEnv = safeStr(process.env.SHOP_DIST_DIR);
  if (fromEnv) return fromEnv;

  // intentos razonables (ajustá si tu estructura es distinta)
  // /src/app.js  -> projectRoot/...
  const projectRoot = path.resolve(__dirname, "..");
  const try1 = path.join(projectRoot, "shop", "dist");
  const try2 = path.join(projectRoot, "dist");
  const try3 = path.join(projectRoot, "public", "shop");

  if (fs.existsSync(path.join(try1, "index.html"))) return try1;
  if (fs.existsSync(path.join(try2, "index.html"))) return try2;
  if (fs.existsSync(path.join(try3, "index.html"))) return try3;

  return "";
}

async function getBrandingRow() {
  // Adaptable: si tu modelo se llama distinto, lo detectamos por keys comunes
  const candidates = [
    db.ShopBranding,
    db.shop_branding,
    db.ShopSetting,
    db.ShopSettings,
    db.Settings,
    db.Setting,
  ].filter(Boolean);

  for (const m of candidates) {
    if (typeof m.findOne === "function") {
      const row = await m.findOne({ order: [["updated_at", "DESC"]] }).catch(() => null);
      if (row) return row;
    }
  }

  return null;
}

function createApp() {
  const app = express();

  // =====================
  // ✅ FIX CLAVE: desactivar ETag (evita 304 Not Modified raros)
  // =====================
  app.set("etag", false);

  // =====================
  // ✅ NUEVO: trust proxy (CapRover / reverse proxy) -> cookies secure + ip real
  // =====================
  app.set("trust proxy", 1);

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
      if (!origin) return callback(null, true);
      if (origin === "null") return callback(null, !!allowNullOrigin);
      if (origin.includes("localhost") || origin.includes("127.0.0.1")) return callback(null, true);

      if (allowedOrigins.length === 0 || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`CORS blocked by pos360: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
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

  // ✅ NUEVO: cookies (para sesiones SHOP httpOnly)
  app.use(cookieParser());

  // =====================
  // ✅ Headers globales + Anti-cache para API
  // =====================
  app.use((req, res, next) => {
    const serviceName = process.env.SERVICE_NAME || "pos360-commerce-api";
    const buildId = process.env.BUILD_ID || "dev";
    res.setHeader("X-Service-Name", serviceName);
    res.setHeader("X-Build-Id", buildId);

    if (req.originalUrl.startsWith("/api/")) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      res.setHeader("Surrogate-Control", "no-store");
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
  // ✅ HEALTH de la API (no pisar el home del shop)
  // =====================
  app.get("/api", (req, res) => {
    res.json({
      name: process.env.SERVICE_NAME || "pos360-commerce-api",
      status: "online",
      env: process.env.NODE_ENV || "unknown",
      build: process.env.BUILD_ID || "dev",
      time: new Date().toISOString(),
    });
  });

  // =========================================================
  // ✅ SHOP (WordPress-like): HEAD server-side + dist estático
  // =========================================================
  const enableShop = envBool("ENABLE_SHOP", true); // default true (si hay dist)
  const shopDistDir = resolveShopDistDir();

  // Base pública del dominio (para canonical/og:url y abs de assets)
  const shopPublicBase =
    safeStr(process.env.SHOP_PUBLIC_BASE_URL) ||
    safeStr(process.env.PUBLIC_BASE_URL) ||
    "https://sanjuantecnologia.com";

  if (enableShop && shopDistDir && fs.existsSync(path.join(shopDistDir, "index.html"))) {
    console.log("🛍️ SHOP habilitado:", shopDistDir);

    // ✅ favicon.ico dinámico desde branding (como WP)
    app.get("/favicon.ico", async (req, res) => {
      try {
        const row = await getBrandingRow();
        const fav = safeStr(row?.favicon_url);
        if (!fav) return res.status(204).end();

        // absoluto
        if (/^https?:\/\//i.test(fav)) return res.redirect(302, fav);

        // relativo
        const base = shopPublicBase.replace(/\/+$/, "");
        const abs = `${base}${fav.startsWith("/") ? "" : "/"}${fav}`;
        return res.redirect(302, abs);
      } catch (e) {
        return res.status(204).end();
      }
    });

    // ✅ Inyector del <head> (OG + title + favicon) desde DB
    // IMPORTANTE: va ANTES de express.static
    app.use(
      createShopHeadInjector({
        distDir: shopDistDir,
        models: db,
        publicBaseUrl: shopPublicBase,
        cacheSeconds: 30, // cambios del admin se reflejan rápido
      })
    );

    // ✅ assets del dist (JS/CSS/img)
    app.use(express.static(shopDistDir, { maxAge: "1h", etag: true }));
  } else {
    console.log("ℹ️ SHOP no montado (falta dist o está deshabilitado).", {
      enableShop,
      shopDistDir,
    });
  }

  // =====================
  // API v1
  // =====================
  if (!isMiddleware(v1Routes)) {
    console.error("❌ v1Routes inválido. Debe exportar un router middleware.");
    console.error("   typeof:", typeof v1Routes);
    console.error("   keys:", v1Routes && typeof v1Routes === "object" ? Object.keys(v1Routes) : null);
    throw new Error("INVALID_V1_ROUTES_EXPORT");
  }

  // ✅ Montamos v1 en DOS lugares:
  // 1) /api/v1  -> cuando llega completo (sin strip)
  // 2) /        -> cuando el reverse proxy (CapRover path routing) strippea /api/v1
  app.use("/api/v1", v1Routes);
  app.use("/", v1Routes);

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
