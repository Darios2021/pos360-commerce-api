// src/routes/v1.routes.js
const router = require("express").Router();

// 👇 importar routes
const authRoutes = require("./auth.routes");
const productsRoutes = require("./products.routes");
const categoriesRoutes = require("./categories.routes");
const branchesRoutes = require("./branches.routes");
const warehousesRoutes = require("./warehouses.routes");
const stockRoutes = require("./stock.routes");

// 👇 montar
router.use("/auth", authRoutes);
router.use("/products", productsRoutes);
router.use("/categories", categoriesRoutes);
router.use("/branches", branchesRoutes);
router.use("/warehouses", warehousesRoutes);
router.use("/stock", stockRoutes);

module.exports = router;
