// src/routes/pos.routes.js
const router = require("express").Router();
const { requireAuth } = require("../middlewares/auth");

// ✅ POS controller (context + products + createSale con stock)
const posController = require("../controllers/pos.controller");

// ✅ POS Sales controller (list/get/delete)
const posSalesController = require("../controllers/posSales.controller");

// ===== CONTEXTO POS =====
router.get("/context", requireAuth, posController.getContext);

// ===== PRODUCTOS POS (por depósito) =====
router.get("/products", requireAuth, posController.listProductsForPos);

// ===== VENTAS =====
router.get("/sales", requireAuth, posSalesController.listSales);
router.get("/sales/:id", requireAuth, posSalesController.getSaleById);

// ✅ CLAVE: crear venta usando el controller que descuenta stock
router.post("/sales", requireAuth, posController.createSale);

router.delete("/sales/:id", requireAuth, posSalesController.deleteSale);

module.exports = router;
