// src/routes/index.js
const router = require("express").Router();

const authRoutes = require("./auth.routes");

// auth middleware (compatible con tus variantes)
const { requireAuth } = (() => {
  const authMw = require("../middlewares/auth.middleware");
  return {
    requireAuth: authMw.requireAuth || authMw.authenticate || authMw.auth || authMw,
  };
})();

// =====================
// Health (public)
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
// Auth (public)
// =====================
router.use("/auth", authRoutes);

// =====================
// Uploads (PROTEGIDO)
// POST /api/v1/upload   (ojo: el routes/uploads.routes.js debe tener POST "/")
// =====================
router.use("/upload", requireAuth, require("./uploads.routes"));

// =====================
// Product Images (PROTEGIDO)
// GET /api/v1/products/:id/images
// =====================
router.get(
  "/products/:id/images",
  requireAuth,
  require("../controllers/productImages.controller").listByProduct
);

// =====================
// Inventory / Core (PROTEGIDO)
// =====================
router.use("/products", requireAuth, require("./products.routes"));
router.use("/categories", requireAuth, require("./categories.routes"));

// Import CSV
router.use("/import", requireAuth, require("./import.routes"));

router.use("/branches", requireAuth, require("./branches.routes"));
router.use("/warehouses", requireAuth, require("./warehouses.routes"));
router.use("/stock", requireAuth, require("./stock.routes"));

module.exports = router;
