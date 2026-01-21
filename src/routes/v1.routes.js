// src/routes/v1.routes.js
// ✅ COPY-PASTE FINAL COMPLETO (ANTI-CRASH + alineado al esquema actual)
// ✅ FIX: no rompe si NO existe publicLinks.routes / adminShopLinks.routes
// ✅ FIX: carga bien publicInstagram.routes (tu archivo actual)

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

// ✅ CAMINO B: Links públicos (Instagram posts, etc.) — NO ROMPER SI NO EXISTE
let publicLinksRoutes = null;
try {
  // 👉 si tu archivo se llama distinto, cambiá SOLO este string
  publicLinksRoutes = require("./publicLinks.routes");
} catch (e) {
  console.log("⚠️ publicLinksRoutes no cargado (src/routes/publicLinks.routes.js no existe todavía)");
  publicLinksRoutes = null;
}

// ✅ (opcional) IG Graph (tu archivo actual)
let publicInstagramRoutes = null;
try {
  // 👉 este existe: src/routes/publicInstagram.routes.js
  publicInstagramRoutes = require("./publicInstagram.routes");
} catch (e) {
  publicInstagramRoutes = null;
}

const ecomCheckoutRoutes = require("./ecomCheckout.routes");
const ecomPaymentsRoutes = require("./ecomPayments.routes");

// =========================
// Protected
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

// Admin
const adminUsersRoutes = require("./adminUsers.routes");
const adminShopBrandingRoutes = require("./admin.shopBranding.routes");
const adminShopOrdersRoutes = require("./admin.shopOrders.routes");
const adminShopSettingsRoutes = require("./admin.shopSettings.routes");
const adminShopPaymentsRoutes = require("./admin.shopPayments.routes");

// ✅ CAMINO B: Admin links — NO ROMPER SI NO EXISTE
let adminShopLinksRoutes = null;
try {
  // ✅ IMPORTANTE:
  // si tu archivo se llama "admin.shopLinks.routes.js" entonces tiene que ser:
  //   require("./admin.shopLinks.routes")
  // si se llama "adminShopLinks.routes.js" entonces:
  //   require("./adminShopLinks.routes")
  // 👉 dejé el nombre más común del backend que venimos usando:
  adminShopLinksRoutes = require("./admin.shopLinks.routes");
} catch (e) {
  console.log("⚠️ adminShopLinksRoutes no cargado (routes/admin.shopLinks.routes.js no existe todavía)");
  adminShopLinksRoutes = null;
}

// ✅ Admin Media (Galería multimedia)
let adminMediaRoutes;
try {
  adminMediaRoutes = require("./adminMedia.routes");
} catch (e1) {
  adminMediaRoutes = require("./admin.media.routes");
}

// =========================
// Mount: Public primero
// =========================
safeUse("/health", healthRoutes);
safeUse("/auth", authRoutes);

safeUse("/public", publicEcomRoutes);
safeUse("/public", publicShopConfigRoutes);

// ✅ CAMINO B: /api/v1/public/links
if (publicLinksRoutes) safeUse("/public", publicLinksRoutes);

// ✅ (opcional) /api/v1/public/instagram/latest
if (publicInstagramRoutes) safeUse("/public", publicInstagramRoutes);

safeUse("/ecom", ecomCheckoutRoutes);
safeUse("/ecom", ecomPaymentsRoutes);

// =========================
// Mount: Protected (operación)
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
// Mount: Admin (RBAC context)
// =========================
safeUse("/admin/users", requireAuth, attachAccessContext, adminUsersRoutes);

safeUse("/admin/shop", requireAuth, attachAccessContext, adminShopBrandingRoutes);
safeUse("/admin/shop", requireAuth, attachAccessContext, adminShopOrdersRoutes);
safeUse("/admin/shop", requireAuth, attachAccessContext, adminShopSettingsRoutes);
safeUse("/admin/shop", requireAuth, attachAccessContext, adminShopPaymentsRoutes);

// ✅ CAMINO B: /api/v1/admin/shop/links  (si existe el archivo)
if (adminShopLinksRoutes) safeUse("/admin/shop", requireAuth, attachAccessContext, adminShopLinksRoutes);

// ✅ /admin/media (galería)
safeUse("/admin/media", requireAuth, attachAccessContext, adminMediaRoutes);

module.exports = router;
