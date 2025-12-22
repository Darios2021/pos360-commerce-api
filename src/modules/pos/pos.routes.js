// src/modules/pos/pos.routes.js
const express = require("express");
const router = express.Router();

const posController = require("../../controllers/pos.controller");
const { branchContext } = require("../../middlewares/branchContext.middleware");

// Contexto de sucursal/depósito del usuario logueado
router.get("/context", branchContext, posController.getContext);

// Productos para POS (con stock del depósito)
router.get("/products", branchContext, posController.listProductsForPos);

// Crear venta (descuenta stock + crea movimientos)
router.post("/sales", branchContext, posController.createSale);

module.exports = router;
