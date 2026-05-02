// ✅ COPY-PASTE FINAL COMPLETO
// src/routes/v1.routes.js
//
// ✅ ANTI-CRASH + alineado a tu esquema actual
// ✅ FIX: soporta routers exportados como function O como "router-like object" (handle/stack)
// ✅ FIX: no rompe si NO existe publicLinks.routes / admin.shopLinks.routes
// ✅ FIX: carga publicInstagram.routes (si existe)
// ✅ FIX: monta /ecom (checkout + payments/webhooks)
// ✅ NUEVO: monta /public/payment-methods (DB-first)
// ✅ NUEVO: monta /pos/payment-methods
// ✅ NUEVO: monta /admin/payment-methods
// ✅ NUEVO: monta /admin/shop/branches (opcional)
// ✅ NUEVO: SHOP AUTH (Google + sesiones)
//    - PUBLIC: POST /api/v1/public/auth/google
//    - PUBLIC: GET  /api/v1/public/auth/me
//    - PUBLIC: POST /api/v1/public/auth/logout
// ✅ NUEVO: MY ACCOUNT (Mis compras + Favoritos)
//    - PUBLIC: GET    /api/v1/public/account/orders
//    - PUBLIC: GET    /api/v1/public/account/orders/:id
//    - PUBLIC: GET    /api/v1/public/account/favorites
//    - PUBLIC: POST   /api/v1/public/account/favorites
//    - PUBLIC: DELETE /api/v1/public/account/favorites/:product_id
// ✅ NUEVO: THEME
//    - PUBLIC: GET  /api/v1/public/theme
//    - ADMIN:  GET  /api/v1/admin/shop/theme
//             PUT  /api/v1/admin/shop/theme
// ✅ VIDEOS (FINAL):
//    - PUBLIC:  GET /public/products/:id/videos     (sin auth)
//    - PUBLIC:  GET /public/videos/feed             (sin auth)
//    - ADMIN:   GET/POST/DELETE/UPLOAD en /admin/products/:id/videos/* (con auth)
// ✅ OPCIONAL (compat): GET /products/:id/videos (sin auth) como ALIAS al public
// ✅ NUEVO: CAJA POS
//    - GET  /api/v1/pos/cash-registers/current
//    - POST /api/v1/pos/cash-registers/open
//    - GET  /api/v1/pos/cash-registers/:id/summary
//    - POST /api/v1/pos/cash-registers/:id/movements
//    - POST /api/v1/pos/cash-registers/:id/close
// ✅ NUEVO: FISCAL ADMIN
//    - GET  /api/v1/admin/fiscal/config
//    - PUT  /api/v1/admin/fiscal/config
//    - GET  /api/v1/admin/fiscal/certificates
//    - POST /api/v1/admin/fiscal/certificates
//    - POST /api/v1/admin/fiscal/test-connection

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

// ✅ MY ACCOUNT (Mis compras + Favoritos)
// Archivo recomendado: src/routes/public.account.routes.js
// Si todavía no existe, lo dejamos optional:true para no romper
const publicAccountRoutes = loadRoute("./public.account.routes", { optional: true });

// ✅ videos públicos por producto (GET /public/products/:id/videos)
const publicProductVideosRoutes = loadRoute("./publicProductVideos.routes", { optional: false });

// ✅ Q&A + Reviews del shop público (GET/POST /public/products/:id/questions y /reviews)
const publicProductSocialRoutes = loadRoute("./public.productSocial.routes", { optional: true });

// ✅ videos feed global (GET /public/videos/feed)
const publicVideosFeedRoutes = loadRoute("./publicVideosFeed.routes", { optional: true });

// ✅ Notificaciones del cliente (centro de notificaciones in-app)
const publicNotificationsRoutes = loadRoute("./public.notifications.routes", { optional: true });

// ✅ THEME (public)
const publicThemeRoutes = loadRoute("./publicTheme.routes", { optional: true });

// Ecommerce público
const ecomCheckoutRoutes = loadRoute("./ecomCheckout.routes", { optional: false });
const ecomPaymentsRoutes = loadRoute("./ecomPayments.routes", { optional: false });

// ✅ métodos de pago unificados
const paymentMethodRoutes = loadRoute("./paymentMethod.routes", { optional: true });

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
const stockTransferRoutes = loadRoute("./stockTransfer.routes", { optional: false });
const dashboardRoutes = loadRoute("./dashboard.routes", { optional: false });
const analyticsRoutes = loadRoute("./analytics.routes", { optional: true });
const customersRoutes = loadRoute("./customers.routes", { optional: true });
const messagingRoutes = loadRoute("./messaging.routes", { optional: true });
const posRoutes = loadRoute("./pos.routes", { optional: false });
const meRoutes = loadRoute("./me.routes", { optional: false });

// ✅ NUEVO: caja POS
const cashRegistersRoutes = loadRoute("./cashRegisters.routes", { optional: true });

// ✅ NUEVO: reportes (franquicia)
const reportsRoutes = loadRoute("./reports.routes", { optional: true });

// =========================
// Admin
// =========================
const adminUsersRoutes = loadRoute("./adminUsers.routes", { optional: false });
const adminShopBrandingRoutes = loadRoute("./admin.shopBranding.routes", { optional: false });
const adminShopOrdersRoutes = loadRoute("./admin.shopOrders.routes", { optional: false });
const adminShopSettingsRoutes = loadRoute("./admin.shopSettings.routes", { optional: false });
const adminShopPaymentsRoutes = loadRoute("./admin.shopPayments.routes", { optional: false });
const adminShopQARoutes = loadRoute("./admin.shopQA.routes", { optional: true });

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

// ✅ NUEVO: fiscal admin
const adminFiscalRoutes = loadRoute("./admin.fiscal.routes", { optional: true });

// ✅ NUEVO: telegram admin (notificaciones)
const adminTelegramRoutes = loadRoute("./admin.telegram.routes", { optional: true });

// ✅ NUEVO: bloques promocionales del CRM email
const adminEmailPromoBlocksRoutes = loadRoute("./admin.emailPromoBlocks.routes", { optional: true });

// =========================
// Mount: Public
// =========================
safeUse("/health", healthRoutes);
safeUse("/auth", authRoutes);

safeUse("/public", publicEcomRoutes);
safeUse("/public", publicShopConfigRoutes);

safeUse("/public", publicShopAuthRoutes);

// ✅ MY ACCOUNT
// Monta /api/v1/public/account/* (orders + favorites)
if (publicAccountRoutes) safeUse("/public/account", publicAccountRoutes);

// ✅ NOTIFICATIONS — centro de notificaciones del cliente
if (publicNotificationsRoutes) safeUse("/public", publicNotificationsRoutes);

// Videos públicos por producto
safeUse("/public", publicProductVideosRoutes);

// ✅ Q&A + Reviews del shop público (montado bajo /public/products/:id/...)
if (publicProductSocialRoutes) safeUse("/public/products", publicProductSocialRoutes);

// Videos feed global para Home
if (publicVideosFeedRoutes) safeUse("/public", publicVideosFeedRoutes);

// Compat alias opcional
safeUse("/", publicProductVideosRoutes);

// Theme
if (publicThemeRoutes) safeUse("/public", publicThemeRoutes);

// ✅ payment methods público
if (paymentMethodRoutes) safeUse("/public", paymentMethodRoutes);

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
safeUse("/warehouses", requireAuth, attachAccessContext, branchContext, warehousesRoutes);
safeUse("/stock",      requireAuth, attachAccessContext, branchContext, stockRoutes);
safeUse("/stock/transfers", requireAuth, attachAccessContext, branchContext, stockTransferRoutes);
safeUse("/dashboard",  requireAuth, attachAccessContext, branchContext, dashboardRoutes);
if (analyticsRoutes) safeUse("/analytics", requireAuth, attachAccessContext, branchContext, analyticsRoutes);

safeUse("/pos", requireAuth, attachAccessContext, branchContext, posRoutes);
// `/me` ahora pasa por `attachAccessContext` para que devuelva los roles
// FRESCOS de la DB (no los del JWT viejo). Sin esto el frontend mostraba
// privilegios cacheados después de revocarlos.
safeUse("/me", requireAuth, attachAccessContext, meRoutes);

// ✅ payment methods POS
if (paymentMethodRoutes) {
  safeUse("/pos", requireAuth, attachAccessContext, branchContext, paymentMethodRoutes);
}

// ✅ NUEVO: CAJA (POS)
if (cashRegistersRoutes) {
  safeUse("/pos/cash-registers", requireAuth, attachAccessContext, branchContext, cashRegistersRoutes);
}

// ✅ NUEVO: REPORTES (franquicia — ventas, stock, cajas)
if (reportsRoutes) {
  safeUse("/reports", requireAuth, attachAccessContext, branchContext, reportsRoutes);
} else {
  // eslint-disable-next-line no-console
  console.log("⚠️ reportsRoutes no cargado (no existe reports.routes.js o exporta mal)");
}

// =========================
// Mount: Admin
// =========================
safeUse("/admin/users", requireAuth, attachAccessContext, adminUsersRoutes);
if (customersRoutes) {
  safeUse("/admin/customers", requireAuth, attachAccessContext, customersRoutes);
}
if (messagingRoutes) {
  safeUse("/admin/messaging", requireAuth, attachAccessContext, messagingRoutes);
}

safeUse("/admin/shop", requireAuth, attachAccessContext, adminShopBrandingRoutes);
safeUse("/admin/shop", requireAuth, attachAccessContext, adminShopOrdersRoutes);
safeUse("/admin/shop", requireAuth, attachAccessContext, adminShopSettingsRoutes);
safeUse("/admin/shop", requireAuth, attachAccessContext, adminShopPaymentsRoutes);

// ✅ Q&A + Reviews admin (consultas web)
if (adminShopQARoutes) safeUse("/admin/shop", requireAuth, attachAccessContext, adminShopQARoutes);

if (adminShopThemeRoutes) {
  safeUse("/admin/shop", requireAuth, attachAccessContext, adminShopThemeRoutes);
}

if (adminShopBranchesRoutes) {
  safeUse("/admin/shop", requireAuth, attachAccessContext, adminShopBranchesRoutes);
}

if (adminShopLinksRoutes) {
  safeUse("/admin/shop", requireAuth, attachAccessContext, adminShopLinksRoutes);
}

// ✅ NUEVO: telegram admin
if (adminTelegramRoutes) {
  safeUse("/admin/telegram", requireAuth, attachAccessContext, adminTelegramRoutes);
}

// ✅ NUEVO: bloques promocionales CRM
if (adminEmailPromoBlocksRoutes) {
  safeUse("/admin/email-promo-blocks", requireAuth, attachAccessContext, adminEmailPromoBlocksRoutes);
}

// ✅ NUEVO: fiscal admin
if (adminFiscalRoutes) {
  safeUse("/admin/fiscal", requireAuth, attachAccessContext, adminFiscalRoutes);
} else {
  // eslint-disable-next-line no-console
  console.log("⚠️ adminFiscalRoutes no cargado (no existe admin.fiscal.routes.js o exporta mal)");
}

// ✅ payment methods admin
if (paymentMethodRoutes) {
  safeUse("/admin", requireAuth, attachAccessContext, paymentMethodRoutes);
} else {
  // eslint-disable-next-line no-console
  console.log("⚠️ paymentMethodRoutes no cargado (no existe paymentMethod.routes.js o exporta mal)");
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

// ─── Meilisearch endpoints ─────────────────────────────────────────────────
// Rutas bajo /sys/ para evitar el guard global de /admin/*
// Protegidas por x-reindex-key = MEILISEARCH_MASTER_KEY
{
  const searchService = require("../services/search.service");

  function requireMasterKey(req, res, next) {
    const masterKey = process.env.MEILISEARCH_MASTER_KEY || "";
    const provided  = req.headers["x-reindex-key"] || req.query.key || "";
    if (!masterKey || provided !== masterKey) {
      return res.status(401).json({ ok: false, code: "UNAUTHORIZED", message: "x-reindex-key inválida" });
    }
    next();
  }

  // GET  /api/v1/sys/search/health  (público — solo muestra si está configurado)
  router.get("/sys/search/health", async (req, res) => {
    try {
      const status = await searchService.healthCheck();
      // No exponer la master key, solo si está configurado
      res.json({ ok: true, data: status });
    } catch (e) {
      res.status(500).json({ ok: false, message: e.message });
    }
  });

  // POST /api/v1/sys/search/reindex  (protegido por master key)
  router.post("/sys/search/reindex", requireMasterKey, (req, res) => {
    res.json({ ok: true, message: "Reindex iniciado en background" });
    searchService.triggerFullReindex().catch((e) =>
      console.error("❌ [Meilisearch] reindex error:", e.message)
    );
  });

  // También con JWT para el panel admin futuro
  router.get("/admin/search/health", requireAuth, async (req, res) => {
    try {
      const status = await searchService.healthCheck();
      res.json({ ok: true, data: status });
    } catch (e) {
      res.status(500).json({ ok: false, message: e.message });
    }
  });
}

module.exports = router;