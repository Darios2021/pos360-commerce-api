// src/routes/dashboard.routes.js
const router = require("express").Router();
const dashboardCtrl = require("../controllers/dashboard.controller");

// GET /api/v1/dashboard/inventory
router.get("/inventory", dashboardCtrl.inventory);

// GET /api/v1/dashboard/sales
router.get("/sales", dashboardCtrl.sales);

module.exports = router;
