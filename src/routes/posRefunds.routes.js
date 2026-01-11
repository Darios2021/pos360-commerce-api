// src/routes/posRefunds.routes.js
// ✅ COPY-PASTE FINAL COMPLETO
//
// Endpoints:
// POST   /pos/sales/:saleId/refunds
// GET    /pos/sales/:saleId/refunds
//
// Se monta en v1.routes como:
// safeUse("/pos", requireAuth, posRefundsRoutes);

const router = require("express").Router();
const { createRefund, listRefundsBySale } = require("../controllers/posRefunds.controller");

// POST /api/v1/pos/sales/:saleId/refunds
router.post("/sales/:saleId/refunds", createRefund);

// GET /api/v1/pos/sales/:saleId/refunds
router.get("/sales/:saleId/refunds", listRefundsBySale);

module.exports = router;
