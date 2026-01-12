// src/routes/admin.shopPayments.routes.js
// ✅ COPY-PASTE FINAL COMPLETO
//
// Base: /api/v1/admin/shop
// Endpoints:
// - GET    /payments                       listAdminPayments
// - GET    /payments/:paymentId            getAdminPaymentById
// - PATCH  /payments/:paymentId            updateAdminPayment
// - POST   /payments/:paymentId/mark-paid  markPaymentPaid
// - POST   /payments/:paymentId/mark-unpaid markPaymentUnpaid
// - POST   /payments/:paymentId/review     reviewTransferPayment (compat)

const router = require("express").Router();

const {
  listAdminPayments,
  getAdminPaymentById,
  updateAdminPayment,
  markPaymentPaid,
  markPaymentUnpaid,
  reviewTransferPayment,
} = require("../controllers/admin.shopPayments.controller");

// =========================
// Helpers (anti-undefined)
// =========================
function mustFn(name, fn) {
  if (typeof fn !== "function") {
    console.error(`❌ [admin.shopPayments.routes] Handler inválido: ${name}`, typeof fn);
    throw new Error(`INVALID_HANDLER_${name}`);
  }
  return fn;
}

// =========================
// Routes
// =========================
router.get("/payments", mustFn("listAdminPayments", listAdminPayments));
router.get("/payments/:paymentId", mustFn("getAdminPaymentById", getAdminPaymentById));
router.patch("/payments/:paymentId", mustFn("updateAdminPayment", updateAdminPayment));

router.post("/payments/:paymentId/mark-paid", mustFn("markPaymentPaid", markPaymentPaid));
router.post("/payments/:paymentId/mark-unpaid", mustFn("markPaymentUnpaid", markPaymentUnpaid));

router.post("/payments/:paymentId/review", mustFn("reviewTransferPayment", reviewTransferPayment));

module.exports = router;
