// src/routes/v1.routes.js
// ✅ COPY-PASTE FINAL COMPLETO

const router = require("express").Router();
const { requireAuth } = require("../middlewares/auth");

// =========================
// Public
// =========================
const healthRoutes = require("./health.routes");
const authRoutes = require("./auth.routes");

// 🛒 Ecommerce Public
const publicEcomRoutes = require("./public.routes");

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

// POS
const posRoutes = require("./pos.routes");

// ✅ POS Refunds
const posRefundsRoutes = require("./posRefunds.routes");

// ✅ POS Exchanges
const posExchangesRoutes = require("./posExchanges.routes");

// ✅ ME (perfil)
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
// POS
// =========================

// Ventas POS (listado, detalle, stats, delete)
safeUse("/pos", requireAuth, posRoutes);

// Devoluciones POS -> /api/v1/pos/sales/:id/refunds
safeUse("/pos", requireAuth, posRefundsRoutes);

// Cambios POS -> /api/v1/pos/sales/:id/exchanges
safeUse("/pos", requireAuth, posExchangesRoutes);

// =========================
// Perfil
// =========================
safeUse("/me", requireAuth, meRoutes);

// =========================
// Admin
// =========================
safeUse("/admin/users", requireAuth, adminUsersRoutes);

// /api/v1/admin/shop/branding
safeUse("/admin/shop", requireAuth, adminShopBrandingRoutes);

module.exports = router;
