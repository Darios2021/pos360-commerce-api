// src/modules/pos/pos.routes.js
const express = require("express");
const router = express.Router();

const posController = require("./pos.controller");

// POST /api/v1/pos/sales
router.post("/sales", posController.createSale);

module.exports = router;
