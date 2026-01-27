// src/routes/ecomCheckout.routes.js
// ✅ COPY-PASTE FINAL COMPLETO
// Rutas públicas de ecommerce checkout + MP webhook
// Se monta bajo /api/v1/ecom
//
// Endpoints:
// GET  /api/v1/ecom/health
// POST /api/v1/ecom/checkout
// POST /api/v1/ecom/mp/webhook
// GET  /api/v1/ecom/mp/webhook   (health/ping)

const express = require("express");
const router = express.Router();

const { checkout } = require("../controllers/ecomCheckout.controller");
const {
  mpWebhook,
  mpWebhookHealth,
} = require("../controllers/mpWebhook.controller");

// ✅ Health (para test rápido)
router.get("/health", (req, res) => {
  res.json({ ok: true, route: "ecom", ts: new Date().toISOString() });
});

// ✅ Checkout público
router.post("/checkout", checkout);

// ✅ Mercado Pago Webhook (público)
// Configurá tu MP_NOTIFICATION_URL apuntando a:
// https://sanjuantecnologia.com/api/v1/ecom/mp/webhook
router.post("/mp/webhook", mpWebhook);

// ✅ Health/ping del webhook (opcional)
router.get("/mp/webhook", mpWebhookHealth);

module.exports = router;
