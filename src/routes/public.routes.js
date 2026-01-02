// src/routes/public.routes.js
// ✅ COPY-PASTE FINAL
// Ecommerce público (NO requiere auth)

const router = require("express").Router();
const PublicController = require("../controllers/public.controller");

// Health ecommerce
router.get("/health", (req, res) =>
  res.json({ ok: true, scope: "ecommerce-public" })
);

// Sucursales activas
router.get("/branches", PublicController.listBranches);

// Catálogo por sucursal
router.get("/catalog", PublicController.listCatalog);

// Detalle de producto
router.get("/products/:id", PublicController.getProductById);

module.exports = router;
