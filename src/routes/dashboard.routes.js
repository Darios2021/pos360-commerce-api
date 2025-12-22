// src/routes/dashboard.routes.js
const router = require("express").Router();
const dashboardController = require("../controllers/dashboard.controller");

// KPIs de inventario
// GET /api/v1/dashboard/inventory
router.get("/inventory", dashboardController.inventory);

// KPIs de ventas
// GET /api/v1/dashboard/sales
router.get("/sales", dashboardController.sales);

module.exports = router;
