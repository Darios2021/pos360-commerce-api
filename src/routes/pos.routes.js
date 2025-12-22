// src/routes/pos.routes.js
const router = require("express").Router();

// ✅ IMPORT CORRECTO: destructuring (porque auth.js exporta un objeto)
const { requireAuth } = require("../middlewares/auth");

const {
  listSales,
  getSaleById,
  createSale,
  deleteSale,
} = require("../controllers/posSales.controller");

// Listado
router.get("/sales", requireAuth, listSales);

// Detalle
router.get("/sales/:id", requireAuth, getSaleById);

// Crear
router.post("/sales", requireAuth, createSale);

// Borrar
router.delete("/sales/:id", requireAuth, deleteSale);

module.exports = router;
