// src/routes/ecomPayments.routes.js
// ✅ COPY-PASTE FINAL COMPLETO (Ecommerce Payments + Webhook MP SELLADO)
// Se monta bajo /api/v1/ecom
//
// Rutas:
// GET  /api/v1/ecom/payments/health
// POST /api/v1/ecom/webhooks/mercadopago            (webhook MP)
// POST /api/v1/ecom/payments/:paymentId/transfer/proof  (si lo usás)

const express = require("express");
const router = express.Router();

// -----------
// Controller: Webhook MercadoPago
// (si no existe todavía, te lo pasé como mpWebhook.controller.js)
// -----------
let mpWebhookHandler = null;
try {
  const mpWebhookMod = require("../controllers/mpWebhook.controller");
  mpWebhookHandler =
    (mpWebhookMod && typeof mpWebhookMod.mercadopagoWebhook === "function" && mpWebhookMod.mercadopagoWebhook) ||
    (typeof mpWebhookMod === "function" ? mpWebhookMod : null);
} catch (e) {
  mpWebhookHandler = null;
}

// -----------
// Controller: Transfer proof upload (opcional)
// -----------
let transferProofMiddleware = null;
let uploadTransferProof = null;

try {
  const ctrl = require("../controllers/ecomPayments.controller");
  transferProofMiddleware =
    (ctrl && typeof ctrl.transferProofMiddleware === "function" && ctrl.transferProofMiddleware) || null;
  uploadTransferProof =
    (ctrl && typeof ctrl.uploadTransferProof === "function" && ctrl.uploadTransferProof) || null;
} catch (e) {
  transferProofMiddleware = null;
  uploadTransferProof = null;
}

// Health
router.get("/payments/health", (req, res) => {
  res.json({ ok: true, route: "ecom/payments", ts: new Date().toISOString() });
});

// Webhook MercadoPago (SELLADO)
// MP manda JSON. Aceptamos 2mb.
// Si el controller no existe todavía => 501 claro (no crashea deploy).
router.post("/webhooks/mercadopago", express.json({ limit: "2mb" }), (req, res, next) => {
  if (!mpWebhookHandler) {
    return res.status(501).json({
      ok: false,
      code: "MP_WEBHOOK_NOT_IMPLEMENTED",
      message: "Webhook Mercado Pago no implementado (falta src/controllers/mpWebhook.controller.js).",
    });
  }
  return mpWebhookHandler(req, res, next);
});

// Transfer proof upload (multipart) — solo si lo tenés implementado
// POST /api/v1/ecom/payments/:paymentId/transfer/proof
if (transferProofMiddleware && uploadTransferProof) {
  router.post("/payments/:paymentId/transfer/proof", transferProofMiddleware, uploadTransferProof);
} else {
  // no montamos nada si no existe, para evitar crashes
}

module.exports = router;
