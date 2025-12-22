// src/routes/index.js
const router = require("express").Router();

const authRoutes = require("./auth.routes");
const { requireAuth } = require("../middlewares/auth");

// =====================
// Health (PUBLICO) - primero siempre
// =====================
router.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "pos360-commerce-api",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// =====================
// Auth (PUBLICO)
// =====================
router.use("/auth", authRoutes);

// =====================
// Uploads + imágenes + inventory (PROTEGIDO)
// =====================

// ✅ OJO: si montás /upload, adentro NO debe ser /upload otra vez.
router.use("/upload", requireAuth, require("./uploads.routes"));

// Productos / categorías
router.use("/products", requireAuth, require("./products.routes"));
router.use("/categories", requireAuth, require("./categories.routes"));

// Import
router.use("/import", requireAuth, require("./import.routes"));

// Otros
router.use("/branches", requireAuth, require("./branches.routes"));
router.use("/warehouses", requireAuth, require("./warehouses.routes"));
router.use("/stock", requireAuth, require("./stock.routes"));

// =====================
// POS (PROTEGIDO)
// =====================
router.use("/pos", requireAuth, require("../modules/pos/pos.routes"));

module.exports = router;
