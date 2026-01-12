// src/routes/admin.shopOrders.routes.js
// ✅ COPY-PASTE FINAL
const express = require("express");
const router = express.Router();

const Ctrl = require("../controllers/admin.shopOrders.controller");

// Lista (datatable)
router.get("/orders", Ctrl.listOrders);

// Detalle
router.get("/orders/:id", Ctrl.getOrderById);

module.exports = router;
