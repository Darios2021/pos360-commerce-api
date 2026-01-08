// src/routes/pos.routes.js
const express = require("express");
const router = express.Router();

const {
  sequelize,
  User,
  Branch,
  Warehouse,
  UserBranch,
} = require("../models");

const posSales = require("../controllers/posSales.controller");

// ============================
// ✅ requireAuth robusto (evita MODULE_NOT_FOUND)
// ============================
function loadRequireAuth() {
  const candidates = [
    "../middlewares/requireAuth",
    "../middleware/requireAuth",
    "../middlewares/require-auth",
    "../middlewares/auth",
    "../middlewares/authMiddleware",
    "../middlewares/auth.middleware",
    "../middlewares/verifyToken",
    "../middlewares/authJwt",
  ];

  for (const p of candidates) {
    try {
      // eslint-disable-next-line import/no-dynamic-require, global-require
      const mod = require(p);
      return mod?.default || mod;
    } catch (_) {}
  }

  console.warn("[POS ROUTES] ⚠️ requireAuth no encontrado. Revisá tu carpeta middlewares.");
  // Fallback NO rompe el server (pero ojo seguridad si lo dejás así)
  return (req, res, next) => next();
}

const requireAuth = loadRequireAuth();

// ============================
// ✅ /pos/context (para que NO sea 404)
// - devuelve branch, warehouses y user mínimo
// ============================
router.get("/context", requireAuth, async (req, res, next) => {
  try {
    const adminEmail = String(req?.user?.email || req?.auth?.email || "").toLowerCase();
    const isAdmin =
      adminEmail === "admin@360pos.local" ||
      adminEmail.includes("admin@360pos.local") ||
      req?.user?.is_admin === true ||
      req?.auth?.is_admin === true ||
      req?.user?.isAdmin === true ||
      req?.auth?.isAdmin === true;

    const branchIdFromToken =
      Number(req?.user?.branch_id || req?.user?.branchId || req?.auth?.branch_id || req?.auth?.branchId || 0) || 0;

    const requested = Number(req.query.branch_id || req.query.branchId || 0) || 0;
    const branch_id = isAdmin && requested > 0 ? requested : branchIdFromToken;

    if (!branch_id) {
      return res.status(400).json({
        ok: false,
        code: "BRANCH_REQUIRED",
        message: "No se pudo determinar branch_id (token/contexto).",
      });
    }

    const branch = await Branch.findByPk(branch_id, { raw: true });
    if (!branch) {
      return res.status(404).json({ ok: false, code: "BRANCH_NOT_FOUND", message: "Sucursal inexistente." });
    }

    const warehouses = await Warehouse.findAll({
      where: { branch_id },
      order: [["id", "ASC"]],
      raw: true,
    });

    // user mínimo (para front)
    const userId = Number(req?.user?.id || req?.auth?.id || req?.user?.user_id || req?.auth?.user_id || 0) || 0;
    const user = userId ? await User.findByPk(userId, { raw: true }) : null;

    return res.json({
      ok: true,
      data: {
        branch,
        warehouses,
        user,
      },
    });
  } catch (e) {
    next(e);
  }
});

// ============================
// SALES
// ============================
router.get("/sales", requireAuth, posSales.listSales);
router.get("/sales/stats", requireAuth, posSales.statsSales);

// desplegables reales
router.get("/sales/options/sellers", requireAuth, posSales.optionsSellers);
router.get("/sales/options/customers", requireAuth, posSales.optionsCustomers);
router.get("/sales/options/products", requireAuth, posSales.optionsProducts);

// CRUD
router.get("/sales/:id", requireAuth, posSales.getSaleById);
router.post("/sales", requireAuth, posSales.createSale);
router.delete("/sales/:id", requireAuth, posSales.deleteSale);

module.exports = router;
