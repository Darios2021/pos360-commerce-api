// src/routes/stock.routes.js
const router = require("express").Router();
const stock = require("../controllers/stock.controller");

// OJO: acá NO va "/stock" porque ya lo monta v1.routes con "/stock"

// GET /api/v1/stock?warehouse_id=...
router.get("/", stock.getStock);

// POST /api/v1/stock/movements
router.post("/movements", stock.createMovement);

// GET /api/v1/stock/movements
router.get("/movements", stock.listMovements);

// ✅ POST /api/v1/stock/init  (ESTE ES EL QUE TU FRONT LLAMA)
router.post("/init", stock.initStock);

module.exports = router;
