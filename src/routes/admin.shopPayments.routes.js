// src/routes/admin.shopPayments.routes.js
// ✅ COPY-PASTE FINAL COMPLETO

const express = require("express");
const router = express.Router();

const {
  listAdminShopPayments,
  getAdminShopPayment,
  updateAdminShopPayment,
  markAdminShopPaymentPaid,
  markAdminShopPaymentUnpaid,
} = require("../controllers/admin.shopPayments.controller");

// ✅ mantenemos tu review transfer EXISTENTE
const { reviewTransferPayment } = require("../controllers/ecomPayments.controller");

// Base: /api/v1/admin/shop
router.get("/payments", listAdminShopPayments);
router.get("/payments/:paymentId", getAdminShopPayment);
router.patch("/payments/:paymentId", updateAdminShopPayment);

router.post("/payments/:paymentId/mark-paid", markAdminShopPaymentPaid);
router.post("/payments/:paymentId/mark-unpaid", markAdminShopPaymentUnpaid);

// ✅ compat: tu endpoint ya usado
router.post("/payments/:paymentId/review", reviewTransferPayment);

module.exports = router;
