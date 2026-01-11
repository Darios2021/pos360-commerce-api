// src/routes/posRefunds.routes.js
// ✅ COPY-PASTE FINAL COMPLETO
//
// Rutas:
// - POST /api/v1/pos/sales/:id/refunds
// - GET  /api/v1/pos/sales/:id/refunds

const router = require("express").Router();
const { createRefund, listRefundsBySale } = require("../controllers/posRefunds.controller");

// ✅ Crear devolución
router.post("/sales/:id/refunds", createRefund);

// ✅ Listar devoluciones de una venta
router.get("/sales/:id/refunds", listRefundsBySale);

module.exports = router;
