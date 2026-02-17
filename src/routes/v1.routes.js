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
  // Express Router suele ser function, pero algunos bundlers/devs exportan objeto con handle/stack
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

function safeUse(path, ...mws) {
  const final = [];

  for (const mw of mws) {
    // ✅ Acepta function o router-like object
    if (isRouterLike(mw)) {
      final.push(mw);
      continue;
    }

    const unwrapped = resolveFn(mw, ["middleware", "handler", "router"]);
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
const branchContext = resolveFn(branchContextMod, ["branchContext"]);
if (!branchContext) {
  // eslint-disable-next-line no-console
  console.error("❌ branchContext NO resolvió a function/router. keys:", Object.keys(branchContextMod || {}));
  throw new Error("BRANCH_CONTEXT_INVALID_EXPORT");
}

const rbacMod = require("../middlewares/rbac.middleware");
const attachAccessContext = resolveFn(rbacMod, ["attachAccessContext"]);
if (!attachAccessContext) {
  // eslint-disable-next-line no-console
  console.error("❌ attachAccessContext NO resolvió a function/router. keys:", Object.keys(rbacMod || {}));
  throw new Error("RBAC_INVALID_EXPORT");
}

// =========================
// Public
// =========================
const healthRoutes = require("./health.routes");
const authRoutes = require("./auth.routes");

const publicEcomRoutes = require("./public.routes");
const publicShopConfigRoutes = require("./public.shopConfig.routes");

// ✅ SHOP AUTH (Google + sesiones)
const publicShopAuthRoutes = require("./public.shopAuth.routes");

// ✅ MY ACCOUNT (historial)
const publicMyAccountRoutes = require("./public.myAccount.routes");

// ✅ videos públicos por producto (GET /public/products/:id/videos)
const publicProductVideosRoutes = require("./publicProductVideos.routes");

// ✅ videos feed global (GET /public/videos/feed)
let publicVideosFeedRoutes = null;
try {
  publicVideosFeedRoutes = require("./publicVideosFeed.routes");
} catch (e) {
  publicVideosFeedRoutes = null;
}

// ✅ THEME (public)
let publicThemeRoutes = null;
try {
  publicThemeRoutes = require("./publicTheme.routes");
} catch (e) {
  publicThemeRoutes = null;
}

// Ecommerce público
const ecomCheckoutRoutes = require("./ecomCheckout.routes");
const ecomPaymentsRoutes = require("./ecomPayments.routes");

// ✅ métodos de pago públicos (opcional)
let publicPaymentMethodsRoutes = null;
try {
  publicPaymentMethodsRoutes = require("./publicPaymentMethods.routes");
} catch (e) {
  // eslint-disable-next-line no-console
  console.log("⚠️ publicPaymentMethodsRoutes no cargado (no existe todavía)");
  publicPaymentMethodsRoutes = null;
}

// Links públicos (opcional)
let publicLinksRoutes = null;
try {
  publicLinksRoutes = require("./publicLinks.routes");
} catch (e) {
  // eslint-disable-next-line no-console
  console.log("⚠️ publicLinksRoutes no cargado (no existe todavía)");
  publicLinksRoutes = null;
}

// Instagram Graph (opcional)
let publicInstagramRoutes = null;
try {
  publicInstagramRoutes = require("./publicInstagram.routes");
} catch (e) {
  publicInstagramRoutes = null;
}

// =========================
// Protected (operación)
// =========================
const productsRoutes = require("./products.routes");
const categoriesRoutes = require("./categories.routes");
const subcategoriesRoutes = require("./subcategories.routes");
const branchesRoutes = require("./branches.routes");
const warehousesRoutes = require("./warehouses.routes");
const stockRoutes = require("./stock.routes");
const dashboardRoutes = require("./dashboard.routes");
const posRoutes = require("./pos.routes");
const meRoutes = require("./me.routes");

// =========================
// Admin
// =========================
const adminUsersRoutes = require("./adminUsers.routes");
const adminShopBrandingRoutes = require("./admin.shopBranding.routes");
const adminShopOrdersRoutes = require("./admin.shopOrders.routes");
const adminShopSettingsRoutes = require("./admin.shopSettings.routes");
const adminShopPaymentsRoutes = require("./admin.shopPayments.routes");

// ✅ THEME (admin)
let adminShopThemeRoutes = null;
try {
  adminShopThemeRoutes = require("./admin.shopTheme.routes");
} catch (e) {
  adminShopThemeRoutes = null;
}

// ✅ admin videos
const productVideosRoutes = require("./productVideos.routes");

// ✅ /admin/shop/branches (opcional)
let adminShopBranchesRoutes = null;
try {
  adminShopBranchesRoutes = require("./admin.shopBranches.routes");
} catch (e) {
  // eslint-disable-next-line no-console
  console.log("⚠️ adminShopBranchesRoutes no cargado (no existe todavía)");
  adminShopBranchesRoutes = null;
}

// Admin links (opcional)
let adminShopLinksRoutes = null;
try {
  adminShopLinksRoutes = require("./admin.shopLinks.routes");
} catch (e) {
  // eslint-disable-next-line no-console
  console.log("⚠️ adminShopLinksRoutes no cargado (no existe todavía)");
  adminShopLinksRoutes = null;
}

// Admin media (fallback por nombre)
let adminMediaRoutes = null;
try {
  adminMediaRoutes = require("./adminMedia.routes");
} catch (e1) {
  try {
    adminMediaRoutes = require("./admin.media.routes");
  } catch (e2) {
    adminMediaRoutes = null;
  }
}

// =========================
// Mount: Public
// =========================
safeUse("/health", healthRoutes);
safeUse("/auth", authRoutes);

safeUse("/public", publicEcomRoutes);
safeUse("/public", publicShopConfigRoutes);

safeUse("/public", publicShopAuthRoutes);
safeUse("/public", publicMyAccountRoutes);

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
