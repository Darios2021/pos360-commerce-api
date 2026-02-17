// src/routes/ecomCheckout.routes.js
// ✅ COPY-PASTE FINAL COMPLETO (ANTI-CRASH)
// Se monta bajo /api/v1/ecom
//
// Endpoints:
// GET  /api/v1/ecom/health
// POST /api/v1/ecom/checkout
//
// ✅ IMPORTANTE:
// - El webhook de MercadoPago se monta SOLO en ecomPayments.routes.js
//   POST /api/v1/ecom/webhooks/mercadopago
//
// ✅ NUEVO (SIN ROMPER LO QUE YA FUNCIONA):
// - Si existe cookie de sesión del shop, hidrata req.customer ANTES del checkout
//   (NO exige login; si no hay sesión, sigue igual)

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
// (Opcional) Hydrate shop customer (NO 401)
// =========================
let hydrateShopCustomer = (req, res, next) => next();

try {
  const authMod = require("../middlewares/shopCustomerAuth.middleware");
  const resolved = resolveFn(authMod, ["hydrateShopCustomer", "hydrate", "optionalAuth", "middleware"]);
  if (typeof resolved === "function") hydrateShopCustomer = resolved;
} catch (e) {
  // opcional: si no existe, no rompe
  // console.log("ℹ️ [ecomCheckout.routes] hydrateShopCustomer no disponible (ok).");
}

// =========================
// Controller checkout (robusto)
// =========================
const checkoutMod = require("../controllers/ecomCheckout.controller");
const checkout = mustFn(resolveFn(checkoutMod, ["checkout"]), "checkout");

// =========================
// Health
// =========================
router.get("/health", (req, res) => {
  res.json({ ok: true, route: "ecom", ts: new Date().toISOString() });
});

// =========================
// Checkout
// =========================
router.post("/checkout", hydrateShopCustomer, express.json({ limit: "2mb" }), checkout);

module.exports = router;
