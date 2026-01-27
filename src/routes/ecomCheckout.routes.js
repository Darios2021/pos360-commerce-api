// src/routes/ecomCheckout.routes.js
// ✅ COPY-PASTE FINAL COMPLETO (ANTI-CRASH)
// Se monta bajo /api/v1/ecom
//
// Endpoints:
// GET  /api/v1/ecom/health
// POST /api/v1/ecom/checkout
// POST /api/v1/ecom/webhooks/mercadopago

const express = require("express");
const router = express.Router();

// =========================
// Helpers: resolver exports (default / named / module.exports)
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

function mustFn(fn, name) {
  if (typeof fn !== "function") {
    const keys = fn && typeof fn === "object" ? Object.keys(fn) : null;
    console.error(`❌ [ecomCheckout.routes] Handler inválido: ${name}`);
    console.error("   typeof:", typeof fn);
    console.error("   keys:", keys);
    throw new Error(`INVALID_HANDLER_${name}`);
  }
  return fn;
}

// =========================
// Controllers (robusto)
// =========================
const checkoutMod = require("../controllers/ecomCheckout.controller");
const checkout = mustFn(resolveFn(checkoutMod, ["checkout"]), "checkout");

let mpWebhook = null;
try {
  const mpMod = require("../controllers/mpWebhook.controller");
  mpWebhook = resolveFn(mpMod, ["mercadopagoWebhook", "webhook", "handle"]);
} catch (e) {
  mpWebhook = null;
}

// =========================
// Health
// =========================
router.get("/health", (req, res) => {
  res.json({ ok: true, route: "ecom", ts: new Date().toISOString() });
});

// =========================
// Checkout
// =========================
router.post("/checkout", express.json({ limit: "2mb" }), checkout);

// =========================
// Webhook MercadoPago (si existe controller)
// =========================
if (typeof mpWebhook === "function") {
  router.post("/webhooks/mercadopago", express.json({ limit: "2mb" }), mpWebhook);
} else {
  console.log("⚠️ mpWebhook.controller no cargado o sin export mercadopagoWebhook (se omite /webhooks/mercadopago)");
}

module.exports = router;
