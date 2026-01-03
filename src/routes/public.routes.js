// src/routes/public.routes.js
// ✅ COPY-PASTE FINAL
// Rutas públicas para Ecommerce (catálogo, sucursales, taxonomía, detalle, sugerencias)

const express = require("express");
const router = express.Router();

const PublicController = require("../controllers/public.controller");

// Health simple (opcional)
router.get("/health", (req, res) => res.json({ ok: true, scope: "public" }));

// ✅ Taxonomía (rubros / subrubros)
router.get("/categories", PublicController.listCategories);
router.get("/subcategories", PublicController.listSubcategories);

// ✅ Sucursales activas
router.get("/branches", PublicController.listBranches);

// ✅ Catálogo por sucursal (con filtros y paginación)
router.get("/catalog", PublicController.listCatalog);

// ✅ Sugerencias para buscador (typeahead)
router.get("/suggestions", PublicController.listSuggestions);

// ✅ Detalle de producto (por sucursal)
router.get("/products/:id", PublicController.getProductById);

module.exports = router;
