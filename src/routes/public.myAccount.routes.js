// ✅ COPY-PASTE FINAL COMPLETO
// src/routes/public.myAccount.routes.js

const router = require("express").Router();
const { listMyOrders, getMyOrderDetail } = require("../controllers/public.myAccount.controller");

// Mis compras
router.get("/my/orders", listMyOrders);
router.get("/my/orders/:id", getMyOrderDetail);

module.exports = router;
