// src/modules/pos/pos.routes.js
const express = require("express");
const router = express.Router();
const posController = require("./pos.controller");

// Ventas
router.get("/sales", posController.listSales);
router.get("/sales/:id", posController.getSaleById);
router.post("/sales", posController.createSale);

module.exports = router;
