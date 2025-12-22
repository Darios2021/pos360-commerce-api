// src/routes/dashboard.routes.js
const router = require("express").Router();
const ctrl = require("../controllers/dashboard.controller");

router.get("/inventory", ctrl.inventory);
router.get("/sales", ctrl.sales);

module.exports = router;
