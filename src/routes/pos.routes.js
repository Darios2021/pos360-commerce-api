// src/routes/pos.routes.js
const express = require("express");
const router = express.Router();

// ⚠️ Ajustá el path si tu middleware está en otro lado.
// En tu proyecto ya existe porque aparece [AUTH] AUTH_OK en logs.
const requireAuth = require("../middlewares/requireAuth");

const posSales = require("../controllers/posSales.controller");

// ============================
// POS - SALES
// Base: /api/v1
// ============================

// Listado + stats
router.get("/pos/sales", requireAuth, posSales.listSales);
router.get("/pos/sales/stats", requireAuth, posSales.statsSales);

// Options para desplegables REALES
router.get("/pos/sales/options/sellers", requireAuth, posSales.optionsSellers);
router.get("/pos/sales/options/customers", requireAuth, posSales.optionsCustomers);
router.get("/pos/sales/options/products", requireAuth, posSales.optionsProducts);
router.get("/pos/sales/options/pay-methods", requireAuth, posSales.optionsPayMethods);

// CRUD
router.get("/pos/sales/:id", requireAuth, posSales.getSaleById);
router.post("/pos/sales", requireAuth, posSales.createSale);
router.delete("/pos/sales/:id", requireAuth, posSales.deleteSale);

module.exports = router;
