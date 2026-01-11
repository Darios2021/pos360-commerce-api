// src/routes/posRefunds.routes.js
// ✅ COPY-PASTE FINAL COMPLETO

const router = require("express").Router();
const { createRefund } = require("../controllers/posRefunds.controller");

// OJO: este router se monta en v1.routes.js bajo "/pos"
// Queda: /api/v1/pos/sales/:id/refunds
router.post("/sales/:id/refunds", createRefund);

module.exports = router;
