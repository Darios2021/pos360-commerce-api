// src/routes/dashboard.routes.js
const router = require("express").Router();
const dashboardCtrl = require("../controllers/dashboard.controller");

router.get("/inventory", dashboardCtrl.inventory);
router.get("/sales", dashboardCtrl.sales);

module.exports = router;
