// src/routes/posExchanges.routes.js
// ✅ COPY-PASTE FINAL COMPLETO

const express = require("express");
const router = express.Router();

const { createExchange } = require("../controllers/posExchanges.controller");

// POST /api/v1/pos/sales/:id/exchanges
router.post("/sales/:id/exchanges", createExchange);

module.exports = router;
