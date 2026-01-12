// src/routes/ecomPayments.routes.js
// ✅ Ecommerce Payments (público)
// Se monta bajo /api/v1/ecom

const express = require("express");
const router = express.Router();

const Ctrl = require("../controllers/ecomPayments.controller");

// Health
router.get("/payments/health", (req, res) => {
  res.json({ ok: true, route: "ecom/payments", ts: new Date().toISOString() });
});

// MercadoPago preference
// POST /api/v1/ecom/payments/:paymentId/mercadopago/preference
router.post("/payments/:paymentId/mercadopago/preference", Ctrl.createMercadoPagoPreference);

// Webhook MercadoPago
// POST /api/v1/ecom/webhooks/mercadopago
router.post("/webhooks/mercadopago", express.json({ limit: "2mb" }), Ctrl.mercadopagoWebhook);

// Transfer proof upload (multipart)
// POST /api/v1/ecom/payments/:paymentId/transfer/proof
router.post("/payments/:paymentId/transfer/proof", Ctrl.transferProofMiddleware, Ctrl.uploadTransferProof);

module.exports = router;
