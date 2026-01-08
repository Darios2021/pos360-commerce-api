// src/routes/pos.routes.js
// ✅ COPY-PASTE FINAL COMPLETO (NO cambia tu controller)

const router = require("express").Router();

const {
  listSales,
  statsSales,
  optionsSellers,
  optionsCustomers,
  optionsProducts,
  getSaleById,
  createSale,
  deleteSale,
} = require("../controllers/posSales.controller");

// OJO: requireAuth YA viene aplicado desde v1.routes.js en /pos
// safeUse("/pos", requireAuth, posRoutes);
// así que acá NO lo volvemos a meter.

router.get("/sales/stats", statsSales);

// options (antes que :id)
router.get("/sales/options/sellers", optionsSellers);
router.get("/sales/options/customers", optionsCustomers);
router.get("/sales/options/products", optionsProducts);

router.get("/sales", listSales);
router.get("/sales/:id", getSaleById);

router.post("/sales", createSale);
router.delete("/sales/:id", deleteSale);

module.exports = router;
