// src/modules/pos/pos.routes.js
const express = require("express");
const router = express.Router();
const posController = require("./pos.controller");
// const auth = require("../../middlewares/auth"); // Si tienes auth, ponlo aquí

// POST /api/v1/pos/sales
router.post("/sales", posController.createSale);

module.exports = router;