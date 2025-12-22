// src/modules/pos/pos.routes.js
const express = require("express");
const router = express.Router();
const posController = require("../../controllers/pos.controller");

// Contexto (usuario/sucursal/depósito)
router.get("/context", posController.getContext);

// Productos disponibles para la sucursal (con stock del depósito)
router.get("/products", posController.listProductsForPos);

// Crear venta (usa req.user + req.ctx)
router.post("/sales", posController.createSale);

module.exports = router;
