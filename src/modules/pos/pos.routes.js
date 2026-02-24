// ✅ COPY-PASTE FINAL COMPLETO
// src/modules/pos/pos.routes.js
const express = require("express");
const router = express.Router();

// ✅ usar el controller del módulo POS (no el global)
const posController = require("./pos.controller");

// GET /api/v1/pos/sales
router.get("/sales", posController.listSales);

// GET /api/v1/pos/sales/:id
router.get("/sales/:id", posController.getSale);

// POST /api/v1/pos/sales
router.post("/sales", posController.createSale);

// DELETE /api/v1/pos/sales/:id
router.delete("/sales/:id", posController.deleteSale);

module.exports = router;