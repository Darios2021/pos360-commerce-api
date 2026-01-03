// src/routes/public.routes.js
// ✅ COPY-PASTE FINAL
// Rutas públicas Ecommerce (catálogo, sugerencias, taxonomía, sucursales, producto)

const express = require("express");
const router = express.Router();

const PublicController = require("../controllers/public.controller");

// =====================
// Health (opcional)
// =====================
router.get("/health", (req, res) => {
  res.json({ ok: true, scope: "public" });
});

// =====================
// Taxonomía
// =====================
// Rubros + subrubros (padres e hijos)
router.get("/categories", PublicController.listCategories);
router.get("/subcategories", PublicController.listSubcategories);

// =====================
// Sucursales
// =====================
router.get("/branches", PublicController.listBranches);

// =====================
// 🔍 Search & Catalog
// =====================

// 🔮 SUGERENCIAS (autocomplete tipo MercadoLibre)
router.get("/suggestions", PublicController.listSuggestions);

// 📦 Catálogo público (paginado + filtros)
router.get("/catalog", PublicController.listCatalog);

// =====================
// Producto
// =====================

// Detalle de producto (requiere branch_id)
router.get("/products/:id", PublicController.getProductById);

module.exports = router;
