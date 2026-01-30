// src/routes/v1.routes.js
// ✅ COPY-PASTE FINAL COMPLETO (ANTI-CRASH + alineado a tu esquema actual)
// ✅ FIX: no rompe si NO existe publicLinks.routes / admin.shopLinks.routes
// ✅ FIX: carga publicInstagram.routes (si existe)
// ✅ FIX: monta /ecom (checkout + payments/webhooks)
// ✅ NUEVO: monta /public/payment-methods (DB-first)
// ✅ NUEVO: monta /admin/shop/branches (reusa branches.controller.js)
// ✅ NUEVO: monta /products/:id/videos (productVideos.routes.js)

const router = require("express").Router();
const { requireAuth } = require("../middlewares/auth");

// =========================
// Helpers: resolve function exports (default/named/module.exports)
// =========================
function resolveFn(mod, candidates = []) {
  if (typeof mod === "function") return mod;
  if (!mod || typeof mod !== "object") return null;

  if (typeof mod.default === "function") return mod.default;

  for (const k of candidates) {
    if (typeof mod[k] === "function") return mod[k];
  }

  const fnKeys = Object.keys(mod).filter((k) => typeof mod[k] === "function");
  if (fnKeys.length === 1) return mod[fnKeys[0]];

  return null;
}

function safeUse(path, ...mws) {
  const final = [];

  for (const mw of mws) {
    if (typeof mw === "function") {
      final.push(mw);
      continue;
    }

    const unwrapped = resolveFn(mw, ["middleware", "handler"]);
    if (typeof unwrapped === "function") {
      final.push(unwrapped);
      continue;
    }

    const keys = mw && typeof mw === "object" ? Object.keys(mw) : null;
    console.error("❌ [v1.routes] Middleware inválido en router.use()");
    console.error("   path:", path);
    console.error("   typeof:", typeof mw);
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
  console.error("❌ branchContext NO resolvió a function. keys:", Object.keys(branchContextMod || {}));
  throw new Error("BRANCH_CONTEXT_INVALID_EXPORT");
}

const rbacMod = require("../middlewares/rbac.middleware");
const attachAccessContext = resolveFn(rbacMod, ["attachAccessContext"]);
if (!attachAccessContext) {
  console.error("❌ attachAccessContext NO resolvió a function. keys:", Object.keys(rbacMod || {}));
  throw new Error("RBAC_INVALID_EXPORT");
}

// =========================
// Public
// =========================
const healthRoutes = require("./health.routes");
const authRoutes = require("./auth.routes");

const publicEcomRoutes = require("./public.routes");
const publicShopConfigRoutes = require("./public.shopConfig.routes");

// ✅ métodos de pago públicos (opcional)
let publicPaymentMethodsRoutes = null;
try {
  publicPaymentMethodsRoutes = require("./publicPaymentMethods.routes");
} catch (e) {
  console.log("⚠️ publicPaymentMethodsRoutes no cargado (routes/publicPaymentMethods.routes.js no existe todavía)");
  publicPaymentMethodsRoutes = null;
}

// Links públicos (opcional)
let publicLinksRoutes = null;
try {
  publicLinksRoutes = require("./publicLinks.routes");
} catch (e) {
  console.log("⚠️ publicLinksRoutes no cargado (routes/publicLinks.routes.js no existe todavía)");
  publicLinksRoutes = null;
}

// Instagram Graph (opcional)
let publicInstagramRoutes = null;
try {
  publicInstagramRoutes = require("./publicInstagram.routes");
} catch (e) {
  publicInstagramRoutes = null;
}

// Ecommerce público
const ecomCheckoutRoutes = require("./ecomCheckout.routes");
const ecomPaymentsRoutes = require("./ecomPayments.routes");

// =========================
// Protected (operación)
// =========================
const productsRoutes = require("./products.routes");
const productVideosRoutes = require("./productVideos.routes"); // ✅ NUEVO
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

// ✅ NUEVO: /admin/shop/branches (si existe)
let adminShopBranchesRoutes = null;
try {
  adminShopBranchesRoutes = require("./admin.shopBranches.routes");
} catch (e) {
  console.log("⚠️ adminShopBranchesRoutes no cargado (routes/admin.shopBranches.routes.js no existe todavía)");
  adminShopBranchesRoutes = null;
}

// Admin links (opcional)
let adminShopLinksRoutes = null;
try {
  adminShopLinksRoutes = require("./admin.shopLinks.routes");
} catch (e) {
  console.log("⚠️ adminShopLinksRoutes no cargado (routes/admin.shopLinks.routes.js no existe todavía)");
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

if (publicPaymentMethodsRoutes) safeUse("/public", publicPaymentMethodsRoutes);
if (publicLinksRoutes) safeUse("/public", publicLinksRoutes);
if (publicInstagramRoutes) safeUse("/public", publicInstagramRoutes);

// ✅ Ecommerce
safeUse("/ecom", ecomCheckoutRoutes);
safeUse("/ecom", ecomPaymentsRoutes);

// =========================
// Mount: Protected
// =========================
safeUse("/products", requireAuth, attachAccessContext, branchContext, productsRoutes);
safeUse("/products", requireAuth, attachAccessContext, branchContext, productVideosRoutes); // ✅ NUEVO

safeUse("/categories", requireAuth, categoriesRoutes);
safeUse("/subcategories", requireAuth, subcategoriesRoutes);
safeUse("/branches", requireAuth, branchesRoutes);
safeUse("/warehouses", requireAuth, warehousesRoutes);
safeUse("/stock", requireAuth, stockRoutes);
safeUse("/dashboard", requireAuth, dashboardRoutes);

safeUse("/pos", requireAuth, posRoutes);
safeUse("/me", requireAuth, meRoutes);

// =========================
// Mount: Admin (RBAC)
// =========================
safeUse("/admin/users", requireAuth, attachAccessContext, adminUsersRoutes);

safeUse("/admin/shop", requireAuth, attachAccessContext, adminShopBrandingRoutes);
safeUse("/admin/shop", requireAuth, attachAccessContext, adminShopOrdersRoutes);
safeUse("/admin/shop", requireAuth, attachAccessContext, adminShopSettingsRoutes);
safeUse("/admin/shop", requireAuth, attachAccessContext, adminShopPaymentsRoutes);

if (adminShopBranchesRoutes) {
  safeUse("/admin/shop", requireAuth, attachAccessContext, adminShopBranchesRoutes);
}

if (adminShopLinksRoutes) {
  safeUse("/admin/shop", requireAuth, attachAccessContext, adminShopLinksRoutes);
}

// Admin media
if (adminMediaRoutes) {
  safeUse("/admin/media", requireAuth, attachAccessContext, adminMediaRoutes);
} else {
  console.log("⚠️ adminMediaRoutes no cargado (no existe adminMedia.routes.js ni admin.media.routes.js)");
}

module.exports = router;
