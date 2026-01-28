// src/routes/admin.shopPayments.routes.js
// ✅ COPY-PASTE FINAL (ANTI-CRASH)
// Montado bajo: /api/v1/admin/shop  (desde v1.routes.js)
//
// Endpoints finales:
// GET    /payments
// GET    /payments/:paymentId
// PATCH  /payments/:paymentId
// POST   /payments/:paymentId/mark-paid
// POST   /payments/:paymentId/mark-unpaid
//
// 🔥 Anti-crash:
// - Soporta controllers con nombres "nuevos" (listAdminShopPayments, getAdminShopPayment, ...)
//   o "viejos" (listPayments, getPaymentById, patchPayment, markPaid, markUnpaid).
// - Valida handlers antes de registrar rutas.

const router = require("express").Router();
const ctrl = require("../controllers/admin.shopPayments.controller");

function pickFn(...candidates) {
  for (const name of candidates) {
    const fn = ctrl?.[name];
    if (typeof fn === "function") return fn;
  }
  return null;
}

function mustFn(fn, name) {
  if (typeof fn !== "function") {
    const keys = ctrl && typeof ctrl === "object" ? Object.keys(ctrl) : [];
    console.error(`❌ admin.shopPayments.routes: handler inválido "${name}" ->`, typeof fn);
    console.error("   exports disponibles:", keys);
    throw new Error(`INVALID_HANDLER_${name}`);
  }
}

// ✅ Resolver handlers (nuevo o viejo)
const listPayments = pickFn("listAdminShopPayments", "listPayments");
const getPaymentById = pickFn("getAdminShopPayment", "getPaymentById");
const patchPayment = pickFn("updateAdminShopPayment", "patchPayment");
const markPaid = pickFn("markAdminShopPaymentPaid", "markPaid");
const markUnpaid = pickFn("markAdminShopPaymentUnpaid", "markUnpaid");

// ✅ Validaciones (si falla acá, falla claro al boot con logs)
mustFn(listPayments, "listPayments");
mustFn(getPaymentById, "getPaymentById");
mustFn(patchPayment, "patchPayment");
mustFn(markPaid, "markPaid");
mustFn(markUnpaid, "markUnpaid");

// ✅ Rutas
router.get("/payments", listPayments);
router.get("/payments/:paymentId", getPaymentById);
router.patch("/payments/:paymentId", patchPayment);
router.post("/payments/:paymentId/mark-paid", markPaid);
router.post("/payments/:paymentId/mark-unpaid", markUnpaid);

module.exports = router;
