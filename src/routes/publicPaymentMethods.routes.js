// src/routes/publicPaymentMethods.routes.js
// ✅ COPY-PASTE FINAL
//
// Public: Métodos de pago del ecommerce (DB-first)
// GET /api/v1/public/payment-methods

const router = require("express").Router();

// soporta export default / named / module.exports
const ctrlMod = require("../controllers/public.paymentMethods.controller");
const ctrl =
  (ctrlMod && typeof ctrlMod === "function" && { listPaymentMethods: ctrlMod }) ||
  ctrlMod;

function mustFn(fn, name) {
  if (typeof fn !== "function") {
    console.error(`❌ publicPaymentMethods: handler inválido "${name}" ->`, typeof fn);
    throw new Error(`INVALID_HANDLER_${name}`);
  }
}

mustFn(ctrl.listPaymentMethods, "listPaymentMethods");

router.get("/payment-methods", ctrl.listPaymentMethods);

module.exports = router;
