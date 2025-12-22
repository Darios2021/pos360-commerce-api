// src/routes/pos.routes.js
const router = require("express").Router();

// ✅ Prevención: si falta auth.middleware, no crashea
function resolveRequireAuth() {
  try {
    const authMw = require("../middlewares/auth.middleware");
    return (
      authMw?.requireAuth ||
      authMw?.authenticate ||
      authMw?.auth ||
      ((req, res, next) => next())
    );
  } catch (e) {
    console.error("❌ Auth middleware missing:", e?.message || e);
    return function missingAuthMw(req, res) {
      return res.status(500).json({
        ok: false,
        code: "AUTH_MW_MISSING",
        message: "Auth middleware missing: ../middlewares/auth.middleware",
      });
    };
  }
}

const requireAuth = resolveRequireAuth();

// ✅ branchContext robusto (export default function)
const branchContext = require("../middlewares/branchContext.middleware");

const {
  listSales,
  getSaleById,
  createSale,
  deleteSale,
} = require("../controllers/posSales.controller");

// ⛳ Importante: requireAuth → branchContext → handlers
router.get("/sales", requireAuth, branchContext, listSales);
router.get("/sales/:id", requireAuth, branchContext, getSaleById);
router.post("/sales", requireAuth, branchContext, createSale);
router.delete("/sales/:id", requireAuth, branchContext, deleteSale);

module.exports = router;
