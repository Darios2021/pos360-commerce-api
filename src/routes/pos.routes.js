// src/routes/pos.routes.js
// ✅ COPY-PASTE FINAL (POS routes robustas, sin requireAuth externo)
// - Evita crash "Route.get requires callback" (destructure de funciones)
// - Evita "Cannot find module ../middlewares/requireAuth" (auth local)
// - Expone endpoints que tu frontend está llamando:
//    GET /api/v1/pos/context
//    GET /api/v1/pos/sales
//    GET /api/v1/pos/filters/users
//    GET /api/v1/pos/filters/customers
//    GET /api/v1/pos/filters/products
//    GET /api/v1/pos/filters/payment-methods

const express = require("express");
const router = express.Router();

const {
  getContext,
  listSales,
  getFilterUsers,
  getFilterCustomers,
  getFilterProducts,
  getFilterPaymentMethods,
} = require("../controllers/posSales.controller");

// =======================
// Auth local (req.user ya viene seteado por tu middleware global)
// =======================
function requireAuth(req, res, next) {
  if (req.user && (req.user.id || req.user.userId)) return next();
  return res.status(401).json({ ok: false, message: "No autenticado" });
}

// =======================
// Routes
// =======================
router.get("/context", requireAuth, getContext);
router.get("/sales", requireAuth, listSales);

// Dropdowns reales (para tus filtros)
router.get("/filters/users", requireAuth, getFilterUsers);
router.get("/filters/customers", requireAuth, getFilterCustomers);
router.get("/filters/products", requireAuth, getFilterProducts);
router.get("/filters/payment-methods", requireAuth, getFilterPaymentMethods);

module.exports = router;