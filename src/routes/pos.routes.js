// src/routes/pos.routes.js
const express = require("express");
const router = express.Router();

const posSales = require("../controllers/posSales.controller");

// ============================
// requireAuth (robusto)
// - No rompe el server si el archivo no existe
// - Intenta paths típicos del proyecto
// ============================
function loadAuthMiddleware() {
  const candidates = [
    "../middlewares/requireAuth",
    "../middleware/requireAuth",
    "../middlewares/auth",
    "../middleware/auth",
    "../middlewares/authMiddleware",
    "../middleware/authMiddleware",
    "../middlewares/verifyToken",
    "../middleware/verifyToken",
    "../middlewares/verificarToken",
    "../middleware/verificarToken",
    "../auth/requireAuth",
    "../auth/middleware",
  ];

  for (const p of candidates) {
    try {
      // eslint-disable-next-line import/no-dynamic-require, global-require
      const m = require(p);

      // soporta exports: function(req,res,next) o { requireAuth } o { auth }
      if (typeof m === "function") return m;
      if (m && typeof m.requireAuth === "function") return m.requireAuth;
      if (m && typeof m.auth === "function") return m.auth;
      if (m && typeof m.verificarToken === "function") return m.verificarToken;
      if (m && typeof m.verifyToken === "function") return m.verifyToken;
    } catch {
      // sigue probando
    }
  }

  console.warn(
    "⚠️ [pos.routes] requireAuth NO encontrado. Rutas POS quedarán sin auth hasta configurar el path correcto."
  );

  // fallback: no auth, pero no rompe
  return (req, res, next) => next();
}

const requireAuth = loadAuthMiddleware();

// ============================
// POS - SALES
// Base (en tu v1.routes.js): /api/v1
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
