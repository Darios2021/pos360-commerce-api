// src/routes/reports.routes.js
const router = require("express").Router();
const controller = require("../controllers/reports.controller");

router.get("/sales", controller.getSalesReport);
router.get("/ganancia", controller.getGananciaReport);

module.exports = router;
