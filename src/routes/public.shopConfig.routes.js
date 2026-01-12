// src/routes/public.shopConfig.routes.js
// ✅ COPY-PASTE FINAL COMPLETO
// Se monta en /api/v1/public/shop/...

const router = require("express").Router();
const ctrl = require("../controllers/public.shopConfig.controller");

function mustFn(fn, name) {
  if (typeof fn !== "function") {
    console.error(`❌ public.shopConfig: handler inválido "${name}" ->`, typeof fn);
    throw new Error(`INVALID_HANDLER_${name}`);
  }
}

mustFn(ctrl.getPaymentsConfig, "getPaymentsConfig");

router.get("/shop/payment-config", ctrl.getPaymentsConfig);

module.exports = router;
