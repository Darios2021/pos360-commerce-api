// src/routes/dashboard.routes.js
const router = require("express").Router();
const dashboard = require("../controllers/dashboard.controller");

router.get("/overview", dashboard.overview);
router.get("/inventory", dashboard.inventory);
router.get("/sales", dashboard.sales);
router.get("/stock", dashboard.stock); // ✅ FIX 404

module.exports = router;
