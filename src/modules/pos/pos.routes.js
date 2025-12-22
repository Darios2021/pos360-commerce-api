// src/modules/pos/pos.routes.js
const express = require("express");
const router = express.Router();
const posController = require("../../controllers/pos.controller");

// GET /api/v1/pos/context
router.get("/context", posController.getContext);

// GET /api/v1/pos/products
router.get("/products", posController.listProductsForPos);

// POST /api/v1/pos/sales
router.post("/sales", posController.createSale);

module.exports = router;
