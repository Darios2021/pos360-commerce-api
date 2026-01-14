// src/routes/v1.routes.js
// ✅ COPY-PASTE FINAL COMPLETO
// - ✅ GET /api/v1/_version
// - ✅ (opcional) GET /api/v1/_whoami
// - ✅ Ecommerce Checkout público: POST /api/v1/ecom/checkout
// - ✅ Ecommerce Payments: preference MP + webhook + transfer proof
// - ✅ Admin Ecommerce Orders/Payments/Settings (con RBAC por permisos)
// - ✅ Public shop config
//
// 🔒 RBAC:
// - Solo se aplica a /admin/users y /admin/shop (para no romper operación).
//
// 🧭 Branch Context:
// - Solo se aplica a /products por ahora (paso quirúrgico).

const router = require("express").Router();
const { requireAuth } = require("../middlewares/auth");
const branchContext = require("../middlewares/branchContext.middleware");
const { attachAccessContext } = require("../middlewares/rbac.middleware");

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
// Public
// =========================
const healthRoutes = require("./health.routes");
const authRoutes = require("./auth.routes");

// 🛒 Ecommerce público (catálogo, producto, etc.)
const publicEcomRoutes = require("./public.routes");

// ✅ Public shop config (payment-config, etc.)
const publicShopConfigRoutes = require("./public.shopConfig.routes");

// 🧾 Ecommerce Checkout (SIN AUTH)
const ecomCheckoutRoutes = require("./ecomCheckout.routes");

// 💳 Ecommerce Payments (SIN AUTH)
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

// POS (UNIFICADO)
const posRoutes = require("./pos.routes");

// ✅ ME
const meRoutes = require("./me.routes");

// ✅ ADMIN USERS
const adminUsersRoutes = require("./adminUsers.routes");

// ✅ ADMIN SHOP BRANDING
const adminShopBrandingRoutes = require("./admin.shopBranding.routes");

// ✅ ADMIN SHOP ORDERS
const adminShopOrdersRoutes = require("./admin.shopOrders.routes");

// ✅ ADMIN SHOP SETTINGS
const adminShopSettingsRoutes = require("./admin.shopSettings.routes");

// ✅ ADMIN SHOP PAYMENTS
const adminShopPaymentsRoutes = require("./admin.shopPayments.routes");

function safeUse(path, ...mws) {
  for (const mw of mws) {
    if (typeof mw !== "function") {
      const keys = mw && typeof mw === "object" ? Object.keys(mw) : null;
      console.error("❌ [v1.routes] Middleware inválido en router.use()");
      console.error("   path:", path);
      console.error("   typeof:", typeof mw);
      console.error("   keys:", keys);
      throw new Error(`INVALID_MIDDLEWARE_FOR_${path}`);
    }
  }
  router.use(path, ...mws);
}

// =========================
// Public primero
// =========================
safeUse("/health", healthRoutes);
safeUse("/auth", authRoutes);

// 🛒 Ecommerce público (SIN AUTH)
safeUse("/public", publicEcomRoutes);

// ✅ Public shop config (SIN AUTH)
safeUse("/public", publicShopConfigRoutes);

// ✅ Checkout público (SIN AUTH)
safeUse("/ecom", ecomCheckoutRoutes);

// ✅ Payments público (SIN AUTH)
safeUse("/ecom", ecomPaymentsRoutes);

// =========================
// Protected (operación)
// =========================
// ✅ PASO QUIRÚRGICO: products con branchContext (scope por sucursal + warehouse)
safeUse("/products", requireAuth, branchContext, productsRoutes);

// resto protegido SIN branchContext (todavía)
safeUse("/categories", requireAuth, categoriesRoutes);
safeUse("/subcategories", requireAuth, subcategoriesRoutes);
safeUse("/branches", requireAuth, branchesRoutes);
safeUse("/warehouses", requireAuth, warehousesRoutes);
safeUse("/stock", requireAuth, stockRoutes);
safeUse("/dashboard", requireAuth, dashboardRoutes);

// ✅ POS (UNIFICADO)
safeUse("/pos", requireAuth, posRoutes);

// Perfil
safeUse("/me", requireAuth, meRoutes);

// =========================
// Admin (RBAC REAL)
// =========================
// ✅ RBAC: primero requireAuth, después attachAccessContext
safeUse("/admin/users", requireAuth, attachAccessContext, adminUsersRoutes);

// Branding / Orders / Settings / Payments con RBAC
safeUse("/admin/shop", requireAuth, attachAccessContext, adminShopBrandingRoutes);
safeUse("/admin/shop", requireAuth, attachAccessContext, adminShopOrdersRoutes);
safeUse("/admin/shop", requireAuth, attachAccessContext, adminShopSettingsRoutes);
safeUse("/admin/shop", requireAuth, attachAccessContext, adminShopPaymentsRoutes);

module.exports = router;
