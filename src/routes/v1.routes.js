// ✅ COPY-PASTE FINAL COMPLETO
// src/routes/v1.routes.js
//
// ✅ ANTI-CRASH + alineado a tu esquema actual
// ✅ FIX: soporta routers exportados como function O como "router-like object" (handle/stack)
// ✅ FIX: no rompe si NO existe publicLinks.routes / admin.shopLinks.routes
// ✅ FIX: carga publicInstagram.routes (si existe)
// ✅ FIX: monta /ecom (checkout + payments/webhooks)
// ✅ NUEVO: monta /public/payment-methods (DB-first)
// ✅ NUEVO: monta /admin/shop/branches (opcional)
// ✅ NUEVO: SHOP AUTH (Google + sesiones)
//    - PUBLIC: POST /api/v1/public/auth/google
//    - PUBLIC: GET  /api/v1/public/auth/me
//    - PUBLIC: POST /api/v1/public/auth/logout
// ✅ NUEVO: MY ACCOUNT (historial)
//    - PUBLIC: GET  /api/v1/public/my/orders
//    - PUBLIC: GET  /api/v1/public/my/orders/:id
// ✅ NUEVO: THEME
//    - PUBLIC: GET  /api/v1/public/theme
//    - ADMIN:  GET  /api/v1/admin/shop/theme
//             PUT  /api/v1/admin/shop/theme
// ✅ VIDEOS (FINAL):
//    - PUBLIC:  GET /public/products/:id/videos     (sin auth)
//    - PUBLIC:  GET /public/videos/feed             (sin auth)
//    - ADMIN:   GET/POST/DELETE/UPLOAD en /admin/products/:id/videos/* (con auth)
// ✅ OPCIONAL (compat): GET /products/:id/videos (sin auth) como ALIAS al public

const router = require("express").Router();
const { requireAuth } = require("../middlewares/auth");

// =========================
// Helpers: Router-like + resolve exports
// =========================
function isRouterLike(mw) {
  if (!mw) return false;
  if (typeof mw === "function") return true;
  if (typeof mw === "object" && typeof mw.handle === "function" && Array.isArray(mw.stack)) return true;
  return false;
}

function resolveFn(mod, candidates = []) {
  if (typeof mod === "function") return mod;
  if (!mod || typeof mod !== "object") return null;

  // Router-like object directo
  if (isRouterLike(mod)) return mod;

  // ESM default
  if (mod.default && (typeof mod.default === "function" || isRouterLike(mod.default))) return mod.default;

  // named candidates
  for (const k of candidates) {
    const v = mod[k];
    if (typeof v === "function" || isRouterLike(v)) return v;
  }

  // único export function/router-like
  const keys = Object.keys(mod);
  const usable = keys.filter((k) => typeof mod[k] === "function" || isRouterLike(mod[k]));
  if (usable.length === 1) return mod[usable[0]];

  return null;
}

/**
 * ✅ Loader fuerte: si un routes file exporta mal ({}), te dice exactamente cuál.
 * - optional: si true, no rompe; solo loggea.
 */
function loadRoute(modulePath, { optional = false, candidates = ["middleware", "handler", "router", "default"] } = {}) {
  let mod = null;

  try {
    mod = require(modulePath);
  } catch (e) {
    if (optional) {
      // eslint-disable-next-line no-console
      console.log(`⚠️ [v1.routes] opcional NO existe o falló require: ${modulePath}`);
      return null;
    }
    // eslint-disable-next-line no-console
    console.error(`❌ [v1.routes] REQUIRE FALLÓ: ${modulePath}`);
    throw e;
  }

  const resolved = resolveFn(mod, candidates);

  if (!resolved || !isRouterLike(resolved)) {
    const keys = mod && typeof mod === "object" ? Object.keys(mod) : null;

    // eslint-disable-next-line no-console
    console.error("❌ [v1.routes] EXPORT INVÁLIDO en:", modulePath);
    // eslint-disable-next-line no-console
    console.error("   typeof:", typeof mod);
    // eslint-disable-next-line no-console
    console.error("   keys:", keys);
    // eslint-disable-next-line no-console
    console.error("   TIP: en ese archivo, al final poné: module.exports = router");

    if (optional) return null;
    throw new Error(`INVALID_ROUTE_EXPORT:${modulePath}`);
  }

  return resolved;
}

function safeUse(path, ...mws) {
  const final = [];

  for (const mw of mws) {
    // ✅ Acepta function o router-like object
    if (isRouterLike(mw)) {
      final.push(mw);
      continue;
    }

    const unwrapped = resolveFn(mw, ["middleware", "handler", "router", "default"]);
    if (isRouterLike(unwrapped)) {
      final.push(unwrapped);
      continue;
    }

    const keys = mw && typeof mw === "object" ? Object.keys(mw) : null;
    // eslint-disable-next-line no-console
    console.error("❌ [v1.routes] Middleware inválido en router.use()");
    // eslint-disable-next-line no-console
    console.error("   path:", path);
    // eslint-disable-next-line no-console
    console.error("   typeof:", typeof mw);
    // eslint-disable-next-line no-console
    console.error("   keys:", keys);
    throw new Error(`INVALID_MIDDLEWARE_FOR_${path}`);
  }

  router.use(path, ...final);
}

// =========================
// ✅ VERSION (SIN AUTH)
// =========================
router.get("/_version", (req, res) => {
  res.json({
    ok: true,
    service: process.env.SERVICE_NAME || "pos360-commerce-api",
    build: process.env.BUILD_ID || "dev",
    env: process.env.NODE_ENV || "unknown",
    time: new Date().toISOString(),
  });
});

// ✅ PING (debug deploy)
router.get("/__ping_v1", (req, res) => {
  res.json({ ok: true, ping: "v1", ts: new Date().toISOString() });
});

// (opcional) debug auth rápido
router.get("/_whoami", requireAuth, (req, res) => {
  res.json({
    ok: true,
    usuario: req.usuario || req.user || req.auth || null,
  });
});

// =========================
// Middlewares “resueltos” (blindado)
// =========================
const branchContextMod = require("../middlewares/branchContext.middleware");
const branchContext = resolveFn(branchContextMod, ["branchContext", "middleware", "handler", "default"]);
if (!branchContext) {
  // eslint-disable-next-line no-console
  console.error("❌ branchContext NO resolvió a function/router. keys:", Object.keys(branchContextMod || {}));
  throw new Error("BRANCH_CONTEXT_INVALID_EXPORT");
}

const rbacMod = require("../middlewares/rbac.middleware");
const attachAccessContext = resolveFn(rbacMod, ["attachAccessContext", "middleware", "handler", "default"]);
if (!attachAccessContext) {
  // eslint-disable-next-line no-console
  console.error("❌ attachAccessContext NO resolvió a function/router. keys:", Object.keys(rbacMod || {}));
  throw new Error("RBAC_INVALID_EXPORT");
}

// =========================
// Public
// =========================
const healthRoutes = loadRoute("./health.routes", { optional: false });
const authRoutes = loadRoute("./auth.routes", { optional: false });

const publicEcomRoutes = loadRoute("./public.routes", { optional: false });
const publicShopConfigRoutes = loadRoute("./public.shopConfig.routes", { optional: false });

// ✅ SHOP AUTH (Google + sesiones)
const publicShopAuthRoutes = loadRoute("./public.shopAuth.routes", { optional: false });

// ✅ MY ACCOUNT (historial) (si todavía no existe, ponelo optional:true)
const publicMyAccountRoutes = loadRoute("./public.myAccount.routes", { optional: true });

// ✅ videos públicos por producto (GET /public/products/:id/videos)
const publicProductVideosRoutes = loadRoute("./publicProductVideos.routes", { optional: false });

// ✅ videos feed global (GET /public/videos/feed)
const publicVideosFeedRoutes = loadRoute("./publicVideosFeed.routes", { optional: true });

// ✅ THEME (public)
const publicThemeRoutes = loadRoute("./publicTheme.routes", { optional: true });

// Ecommerce público
const ecomCheckoutRoutes = loadRoute("./ecomCheckout.routes", { optional: false });
const ecomPaymentsRoutes = loadRoute("./ecomPayments.routes", { optional: false });

// ✅ métodos de pago públicos (opcional)
const publicPaymentMethodsRoutes = loadRoute("./publicPaymentMethods.routes", { optional: true });

// Links públicos (opcional)
const publicLinksRoutes = loadRoute("./publicLinks.routes", { optional: true });

// Instagram Graph (opcional)
const publicInstagramRoutes = loadRoute("./publicInstagram.routes", { optional: true });

// =========================
// Protected (operación)
// =========================
const productsRoutes = loadRoute("./products.routes", { optional: false });
const categoriesRoutes = loadRoute("./categories.routes", { optional: false });
const subcategoriesRoutes = loadRoute("./subcategories.routes", { optional: false });
const branchesRoutes = loadRoute("./branches.routes", { optional: false });
const warehousesRoutes = loadRoute("./warehouses.routes", { optional: false });
const stockRoutes = loadRoute("./stock.routes", { optional: false });
const dashboardRoutes = loadRoute("./dashboard.routes", { optional: false });
const posRoutes = loadRoute("./pos.routes", { optional: false });
const meRoutes = loadRoute("./me.routes", { optional: false });

// =========================
// Admin
// =========================
const adminUsersRoutes = loadRoute("./adminUsers.routes", { optional: false });
const adminShopBrandingRoutes = loadRoute("./admin.shopBranding.routes", { optional: false });
const adminShopOrdersRoutes = loadRoute("./admin.shopOrders.routes", { optional: false });
const adminShopSettingsRoutes = loadRoute("./admin.shopSettings.routes", { optional: false });
const adminShopPaymentsRoutes = loadRoute("./admin.shopPayments.routes", { optional: false });

// ✅ THEME (admin)
const adminShopThemeRoutes = loadRoute("./admin.shopTheme.routes", { optional: true });

// ✅ admin videos
const productVideosRoutes = loadRoute("./productVideos.routes", { optional: false });

// ✅ /admin/shop/branches (opcional)
const adminShopBranchesRoutes = loadRoute("./admin.shopBranches.routes", { optional: true });

// Admin links (opcional)
const adminShopLinksRoutes = loadRoute("./admin.shopLinks.routes", { optional: true });

// Admin media (fallback por nombre)
const adminMediaRoutes =
  loadRoute("./adminMedia.routes", { optional: true }) || loadRoute("./admin.media.routes", { optional: true });

// =========================
// Mount: Public
// =========================
safeUse("/health", healthRoutes);
safeUse("/auth", authRoutes);

safeUse("/public", publicEcomRoutes);
safeUse("/public", publicShopConfigRoutes);

safeUse("/public", publicShopAuthRoutes);
if (publicMyAccountRoutes) safeUse("/public", publicMyAccountRoutes);

// Videos públicos por producto
safeUse("/public", publicProductVideosRoutes);

// Videos feed global para Home
if (publicVideosFeedRoutes) safeUse("/public", publicVideosFeedRoutes);

// Compat alias
safeUse("/", publicProductVideosRoutes);

// Theme
if (publicThemeRoutes) safeUse("/public", publicThemeRoutes);

if (publicPaymentMethodsRoutes) safeUse("/public", publicPaymentMethodsRoutes);
if (publicLinksRoutes) safeUse("/public", publicLinksRoutes);
if (publicInstagramRoutes) safeUse("/public", publicInstagramRoutes);

// Ecommerce
safeUse("/ecom", ecomCheckoutRoutes);
safeUse("/ecom", ecomPaymentsRoutes);

// =========================
// Mount: Protected
// =========================
safeUse("/products", requireAuth, attachAccessContext, branchContext, productsRoutes);

safeUse("/categories", requireAuth, categoriesRoutes);
safeUse("/subcategories", requireAuth, subcategoriesRoutes);
safeUse("/branches", requireAuth, branchesRoutes);
safeUse("/warehouses", requireAuth, warehousesRoutes);
safeUse("/stock", requireAuth, stockRoutes);
safeUse("/dashboard", requireAuth, dashboardRoutes);

safeUse("/pos", requireAuth, posRoutes);
safeUse("/me", requireAuth, meRoutes);

// =========================
// Mount: Admin
// =========================
safeUse("/admin/users", requireAuth, attachAccessContext, adminUsersRoutes);

safeUse("/admin/shop", requireAuth, attachAccessContext, adminShopBrandingRoutes);
safeUse("/admin/shop", requireAuth, attachAccessContext, adminShopOrdersRoutes);
safeUse("/admin/shop", requireAuth, attachAccessContext, adminShopSettingsRoutes);
safeUse("/admin/shop", requireAuth, attachAccessContext, adminShopPaymentsRoutes);

if (adminShopThemeRoutes) {
  safeUse("/admin/shop", requireAuth, attachAccessContext, adminShopThemeRoutes);
}

if (adminShopBranchesRoutes) {
  safeUse("/admin/shop", requireAuth, attachAccessContext, adminShopBranchesRoutes);
}

if (adminShopLinksRoutes) {
  safeUse("/admin/shop", requireAuth, attachAccessContext, adminShopLinksRoutes);
}

// Admin videos: /api/v1/admin/products/:id/videos
safeUse("/admin/products", requireAuth, attachAccessContext, branchContext, productVideosRoutes);

// Admin media
if (adminMediaRoutes) {
  safeUse("/admin/media", requireAuth, attachAccessContext, adminMediaRoutes);
} else {
  // eslint-disable-next-line no-console
  console.log("⚠️ adminMediaRoutes no cargado (no existe adminMedia.routes.js ni admin.media.routes.js)");
}

module.exports = router;
