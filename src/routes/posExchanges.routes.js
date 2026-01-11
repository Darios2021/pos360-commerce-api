// src/routes/posExchanges.routes.js
// ✅ COPY-PASTE FINAL COMPLETO
//
// Rutas:
// - POST /api/v1/pos/sales/:id/exchanges
// - GET  /api/v1/pos/sales/:id/exchanges (si lo implementás)

const router = require("express").Router();
const {
  createExchange,
  listExchangesBySale,
} = require("../controllers/posExchanges.controller");

// Crear cambio
router.post("/sales/:id/exchanges", createExchange);

// Listar cambios de una venta (si existe en tu controller)
router.get("/sales/:id/exchanges", listExchangesBySale);

module.exports = router;
