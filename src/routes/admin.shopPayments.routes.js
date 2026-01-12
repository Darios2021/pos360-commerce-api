// src/routes/admin.shopPayments.routes.js
// ✅ COPY-PASTE FINAL COMPLETO
//
// Se monta en v1.routes.js así:
// safeUse("/admin/shop", requireAuth, adminShopPaymentsRoutes);
//
// Endpoints reales:
// GET   /api/v1/admin/shop/payments
// GET   /api/v1/admin/shop/payments/:paymentId
// PATCH /api/v1/admin/shop/payments/:paymentId
// POST  /api/v1/admin/shop/payments/:paymentId/mark-paid
// POST  /api/v1/admin/shop/payments/:paymentId/mark-unpaid
//
// (Compat legacy)
// POST  /api/v1/admin/shop/payments/:paymentId/review
// -> lo manejás en v1.routes.js con reviewTransferPayment (ecomPayments.controller)
// o lo podés enchufar acá si querés.

const router = require("express").Router();

const {
  listPayments,
  getPaymentById,
  patchPayment,
  markPaid,
  markUnpaid,
} = require("../controllers/admin.shopPayments.controller");

// 🔎 Lista (filtros: q, provider, status, page, limit)
router.get("/payments", listPayments);

// 📄 Detalle
router.get("/payments/:paymentId", getPaymentById);

// ✏️ Edit manual
router.patch("/payments/:paymentId", patchPayment);

// ✅ Marcar pagado / no pagado
router.post("/payments/:paymentId/mark-paid", markPaid);
router.post("/payments/:paymentId/mark-unpaid", markUnpaid);

module.exports = router;
