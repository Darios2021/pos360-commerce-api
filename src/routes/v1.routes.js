// src/routes/v1.routes.js
// ✅ COPY-PASTE FINAL COMPLETO
// + ✅ GET /api/v1/_version
// + (opcional) GET /api/v1/_whoami
// + ✅ Ecommerce Checkout público: POST /api/v1/ecom/checkout
//
// FIX FINAL:
// - Ya NO montamos posRefundsRoutes / posExchangesRoutes
// - Todo refunds/exchanges vive en posRoutes (que llama posSales.controller.js)

const router = require("express").Router();
const { requireAuth } = require("../middlewares/auth");

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

// 🛒 Ecommerce Public (catálogo, producto, etc.)
const publicEcomRoutes = require("./public.routes");

// 🧾 Ecommerce Checkout (SIN AUTH)
const ecomCheckoutRoutes = require("./ecomCheckout.routes");

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

// ✅ Checkout público (SIN AUTH)
// POST /api/v1/ecom/checkout
safeUse("/ecom", ecomCheckoutRoutes);

// =========================
// Protected
// =========================
safeUse("/products", requireAuth, productsRoutes);
safeUse("/categories", requireAuth, categoriesRoutes);
safeUse("/subcategories", requireAuth, subcategoriesRoutes);
safeUse("/branches", requireAuth, branchesRoutes);
safeUse("/warehouses", requireAuth, warehousesRoutes);
safeUse("/stock", requireAuth, stockRoutes);
safeUse("/dashboard", requireAuth, dashboardRoutes);

// =========================
// ✅ POS (UNIFICADO)
// =========================
safeUse("/pos", requireAuth, posRoutes);

// =========================
// Perfil
// =========================
safeUse("/me", requireAuth, meRoutes);

// =========================
// Admin
// =========================
safeUse("/admin/users", requireAuth, adminUsersRoutes);
safeUse("/admin/shop", requireAuth, adminShopBrandingRoutes);

module.exports = router;
