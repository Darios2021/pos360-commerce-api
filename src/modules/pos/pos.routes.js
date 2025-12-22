// src/modules/pos/pos.routes.js
const express = require("express");
const router = express.Router();

const posController = require("./pos.controller");
const { requireRole } = require("../../middlewares/auth");

// Ventas
router.get("/sales", posController.listSales);
router.get("/sales/:id", posController.getSale);
router.post("/sales", posController.createSale);

// ✅ Borrar SOLO admin/super_admin
router.delete("/sales/:id", requireRole("admin", "super_admin"), posController.deleteSale);

module.exports = router;
