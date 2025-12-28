// src/routes/v1.routes.js
const router = require("express").Router();
const { requireAuth } = require("../middlewares/auth");

// Public
const healthRoutes = require("./health.routes");
const authRoutes = require("./auth.routes");

// Protected
const productsRoutes = require("./products.routes");
const categoriesRoutes = require("./categories.routes");
const subcategoriesRoutes = require("./subcategories.routes");
const branchesRoutes = require("./branches.routes");
const warehousesRoutes = require("./warehouses.routes");
const stockRoutes = require("./stock.routes");
const dashboardRoutes = require("./dashboard.routes");

// POS
const posRoutes = require("./pos.routes");

// ✅ ME (perfil)
const meRoutes = require("./me.routes");

// ✅ ADMIN USERS
const adminUsersRoutes = require("./adminUsers.routes");

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

// Public primero
safeUse("/health", healthRoutes);
safeUse("/auth", authRoutes);

// Protected
safeUse("/products", requireAuth, productsRoutes);
safeUse("/categories", requireAuth, categoriesRoutes);
safeUse("/subcategories", requireAuth, subcategoriesRoutes);
safeUse("/branches", requireAuth, branchesRoutes);
safeUse("/warehouses", requireAuth, warehousesRoutes);
safeUse("/stock", requireAuth, stockRoutes);
safeUse("/dashboard", requireAuth, dashboardRoutes);
safeUse("/pos", requireAuth, posRoutes);

// ✅ Perfil
safeUse("/me", requireAuth, meRoutes);

// ✅ Admin Users (NO rompe nada existente, solo agrega ruta)
safeUse("/admin/users", requireAuth, adminUsersRoutes);

module.exports = router;
