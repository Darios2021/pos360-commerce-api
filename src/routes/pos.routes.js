// src/routes/pos.routes.js
const router = require("express").Router();

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

const {
  listSales,
  getSaleById,
  deleteSale,
} = require("../controllers/posSales.controller");

// Listado
router.get("/sales", requireAuth, listSales);

// Detalle
router.get("/sales/:id", requireAuth, getSaleById);

// Borrar (si querés: después lo protegemos por rol admin)
router.delete("/sales/:id", requireAuth, deleteSale);

module.exports = router;
