// src/routes/pos.routes.js
const router = require("express").Router();
const { requireAuth } = require("../middlewares/auth");

const posController = require("../controllers/pos.controller");
const posSalesController = require("../controllers/posSales.controller");

// ===== CONTEXTO POS =====
router.get("/context", requireAuth, posController.getContext);

// ===== PRODUCTOS POS (por depósito) =====
router.get("/products", requireAuth, posController.listProductsForPos);

// ===== VENTAS =====
router.get("/sales", requireAuth, posSalesController.listSales);
router.get("/sales/stats", requireAuth, posSalesController.statsSales);

// ✅ desplegables
router.get("/sales/options/sellers", requireAuth, posSalesController.optionsSellers);
router.get("/sales/options/customers", requireAuth, posSalesController.optionsCustomers);
router.get("/sales/options/products", requireAuth, posSalesController.optionsProducts);

router.get("/sales/:id", requireAuth, posSalesController.getSaleById);

// ✅ CLAVE: crear venta usando el controller que descuenta stock
router.post("/sales", requireAuth, posController.createSale);

router.delete("/sales/:id", requireAuth, posSalesController.deleteSale);

module.exports = router;
