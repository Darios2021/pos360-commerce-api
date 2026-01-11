// src/routes/posRefunds.routes.js
// ✅ COPY-PASTE FINAL COMPLETO

const express = require("express");
const router = express.Router();

const { createRefund } = require("../controllers/posRefunds.controller");

// POST /api/v1/pos/sales/:id/refunds
router.post("/sales/:id/refunds", createRefund);

module.exports = router;
