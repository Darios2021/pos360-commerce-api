// src/routes/ecomPayments.routes.js
// ✅ COPY-PASTE FINAL COMPLETO (Ecommerce Payments + Webhook MP SELLADO)
// Se monta bajo /api/v1/ecom
//
// Rutas:
// GET  /api/v1/ecom/payments/health
// POST /api/v1/ecom/webhooks/mercadopago                 (webhook MP ✅ ÚNICO AQUÍ)
// POST /api/v1/ecom/payments/:paymentId/transfer/proof   (si existe controller)

const express = require("express");
const router = express.Router();

// =========================
// Helpers
// =========================
function resolveFn(mod, candidates = []) {
  if (typeof mod === "function") return mod;
  if (!mod || typeof mod !== "object") return null;

  if (typeof mod.default === "function") return mod.default;

  for (const k of candidates) {
    if (typeof mod[k] === "function") return mod[k];
  }

  const fnKeys = Object.keys(mod).filter((k) => typeof mod[k] === "function");
  if (fnKeys.length === 1) return mod[fnKeys[0]];

  return null;
}

// =========================
// Controller: Webhook MercadoPago (tu nuevo mpWebhook.controller.js)
// Export esperado: { mercadopagoWebhook }
// =========================
let mpWebhookHandler = null;
try {
  const mpWebhookMod = require("../controllers/mpWebhook.controller");
  mpWebhookHandler = resolveFn(mpWebhookMod, ["mercadopagoWebhook", "webhook", "handle"]);
} catch (e) {
  mpWebhookHandler = null;
}

// =========================
// Controller: Transfer proof upload (opcional)
// Export esperado en ecomPayments.controller.js:
// - transferProofMiddleware
// - uploadTransferProof
// =========================
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

// =========================
// Health
// =========================
router.get("/payments/health", (req, res) => {
  res.json({ ok: true, route: "ecom/payments", ts: new Date().toISOString() });
});

// =========================
// Webhook MercadoPago (SELLADO)
// =========================
// MP manda JSON. Aceptamos 2mb.
// Si el controller no existe todavía => 501 claro (no crashea deploy).
router.post("/webhooks/mercadopago", express.json({ limit: "2mb" }), (req, res, next) => {
  if (typeof mpWebhookHandler !== "function") {
    return res.status(501).json({
      ok: false,
      code: "MP_WEBHOOK_NOT_IMPLEMENTED",
      message: "Webhook Mercado Pago no implementado (falta src/controllers/mpWebhook.controller.js).",
    });
  }
  return mpWebhookHandler(req, res, next);
});

// =========================
// Transfer proof upload (multipart) — solo si existe
// POST /api/v1/ecom/payments/:paymentId/transfer/proof
// =========================
if (transferProofMiddleware && uploadTransferProof) {
  router.post("/payments/:paymentId/transfer/proof", transferProofMiddleware, uploadTransferProof);
}

module.exports = router;
