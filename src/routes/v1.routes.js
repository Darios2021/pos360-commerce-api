// src/routes/v1.routes.js
const router = require("express").Router();

const { requireAuth } = require("../middlewares/auth");

// Public
const healthRoutes = require("./health.routes");
const authRoutes = require("./auth.routes");

// Protected
const protectedRoutes = require("./protected.routes"); // ✅ /me
const productsRoutes = require("./products.routes");
const categoriesRoutes = require("./categories.routes");
const subcategoriesRoutes = require("./subcategories.routes");
const branchesRoutes = require("./branches.routes");
const warehousesRoutes = require("./warehouses.routes");
const stockRoutes = require("./stock.routes");
const dashboardRoutes = require("./dashboard.routes");

// POS
const posRoutes = require("./pos.routes");

// =====================
// Public primero
// =====================
router.use("/health", healthRoutes);
router.use("/auth", authRoutes);

// =====================
// Protected (me / perfil)
// =====================
router.use("/", requireAuth, protectedRoutes); // ✅ expone GET /api/v1/me

// =====================
// Protected módulos
// =====================
router.use("/products", requireAuth, productsRoutes);
router.use("/categories", requireAuth, categoriesRoutes);
router.use("/subcategories", requireAuth, subcategoriesRoutes);
router.use("/branches", requireAuth, branchesRoutes);
router.use("/warehouses", requireAuth, warehousesRoutes);
router.use("/stock", requireAuth, stockRoutes);

router.use("/dashboard", requireAuth, dashboardRoutes);
router.use("/pos", requireAuth, posRoutes);

module.exports = router;
