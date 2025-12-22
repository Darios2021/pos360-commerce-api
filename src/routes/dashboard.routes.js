// src/routes/dashboard.routes.js
const router = require("express").Router();
const dashboard = require("../controllers/dashboard.controller");

// KPIs
router.get("/inventory", dashboard.inventory);
router.get("/sales", dashboard.sales);

// ping opcional
router.get("/", (req, res) => res.json({ ok: true, service: "dashboard" }));

module.exports = router;
