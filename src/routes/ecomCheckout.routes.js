// src/routes/ecomCheckout.routes.js
// ✅ Rutas públicas de ecommerce checkout
const express = require("express");
const router = express.Router();

const { checkout } = require("../controllers/ecomCheckout.controller");

// POST /api/v1/ecom/checkout
router.post("/checkout", checkout);

module.exports = router;
