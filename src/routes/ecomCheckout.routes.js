// src/routes/ecomCheckout.routes.js
// ✅ Rutas públicas de ecommerce checkout

const express = require("express");
const router = express.Router();

const { checkout } = require("../controllers/ecomCheckout.controller");

// ✅ Health (para test rápido)
router.get("/health", (req, res) => {
  res.json({ ok: true, route: "ecom/checkout", ts: new Date().toISOString() });
});

// POST /api/v1/ecom/checkout
router.post("/checkout", checkout);

module.exports = router;
