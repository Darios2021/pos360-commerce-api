// src/routes/v1.routes.js
const router = require("express").Router();

const { requireAuth } = require("../middlewares/auth");

// Rutas públicas
const authRoutes = require("./auth.routes");

// Rutas protegidas
const productsRoutes = require("./products.routes");
const categoriesRoutes = require("./categories.routes");
const subcategoriesRoutes = require("./subcategories.routes");
const branchesRoutes = require("./branches.routes");
const warehousesRoutes = require("./warehouses.routes");
const stockRoutes = require("./stock.routes");

// ✅ NUEVO: Dashboard KPIs
const dashboardRoutes = require("./dashboard.routes");

// POS
const posRoutes = require("../modules/pos/pos.routes");

// =====================
// Public
// =====================
router.use("/auth", authRoutes);

// =====================
// Protected (todo lo demás)
// =====================
router.use("/products", requireAuth, productsRoutes);
router.use("/categories", requireAuth, categoriesRoutes);
router.use("/subcategories", requireAuth, subcategoriesRoutes);
router.use("/branches", requireAuth, branchesRoutes);
router.use("/warehouses", requireAuth, warehousesRoutes);
router.use("/stock", requireAuth, stockRoutes);

// ✅ Dashboard protegido
router.use("/dashboard", requireAuth, dashboardRoutes);

// ✅ POS protegido
router.use("/pos", requireAuth, posRoutes);

module.exports = router;
