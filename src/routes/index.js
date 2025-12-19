// src/routes/index.js
const router = require("express").Router();

const authRoutes = require("./auth.routes"); // asumo que ya existe

const { requireAuth } = (() => {
  const authMw = require("../middlewares/auth.middleware");
  return {
    requireAuth: authMw.requireAuth || authMw.authenticate || authMw.auth || authMw,
  };
})();

// Public / base
router.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "pos360-commerce-api",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// Auth
router.use("/auth", authRoutes);

// Inventory (protegido)
router.use("/products", requireAuth, require("./products.routes"));
router.use("/categories", requireAuth, require("./categories.routes"));

// ✅ IMPORT CSV (protegido)
router.use("/import", requireAuth, require("./import.routes"));

router.use("/branches", requireAuth, require("./branches.routes"));
router.use("/warehouses", requireAuth, require("./warehouses.routes"));
router.use("/stock", requireAuth, require("./stock.routes"));

module.exports = router;
